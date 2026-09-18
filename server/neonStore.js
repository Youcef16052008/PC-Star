import crypto from 'node:crypto'
import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

// Les snapshots de l'état JSON sont conservés dans Neon (pas dans /tmp Vercel,
// qui disparaît à chaque instance). Ils protègent les restaurations opérateur
// et les erreurs métier; un export hors Neon reste nécessaire pour le scénario
// de perte totale du projet et est fourni par `npm run db:export:neon`.
const NEON_BACKUP_KEEP = 30

async function ensureBackupTable(conn) {
  await conn.query(
    'CREATE TABLE IF NOT EXISTS pcstar_backups (id text PRIMARY KEY, data jsonb NOT NULL, source text NOT NULL DEFAULT \'manual\', created_at timestamptz NOT NULL DEFAULT now())'
  )
  await conn.query('CREATE INDEX IF NOT EXISTS pcstar_backups_created_at_idx ON pcstar_backups (created_at DESC)')
}

let sql
let pool
function client() {
  if (!process.env.DATABASE_URL) return null
  sql ||= neon(process.env.DATABASE_URL)
  return sql
}
function transactionPool() {
  if (!process.env.DATABASE_URL) return null
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  return pool
}

export async function readNeonState(fallback) {
  const db = client()
  if (!db) return fallback()
  const rows = await db`SELECT data FROM pcstar_state WHERE id = 1`
  return rows[0]?.data || fallback()
}

export async function writeNeonState(data) {
  const db = client()
  if (!db) return data
  await db`INSERT INTO pcstar_state (id,data,updated_at) VALUES (1,${JSON.stringify(data)}::jsonb,now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`
  return data
}

/**
 * Crée un instantané durable de l'état Neon courant et le borne à 30 versions.
 * Le SELECT est effectué dans une transaction : un backup ne peut pas capturer
 * un JSON partiellement modifié par une réservation concurrente.
 */
export async function createNeonBackup(source = 'manual') {
  const p = transactionPool()
  if (!p) throw new Error('DATABASE_URL is required for a Neon backup')
  const conn = await p.connect()
  try {
    await conn.query('BEGIN')
    await ensureBackupTable(conn)
    const current = await conn.query('SELECT data FROM pcstar_state WHERE id = 1 FOR SHARE')
    const state = current.rows[0]?.data
    if (!state) throw new Error('pcstar_state is empty; run db:migrate:neon before backing up')
    const id = crypto.randomUUID()
    const safeSource = String(source || 'manual').slice(0, 40)
    const inserted = await conn.query(
      'INSERT INTO pcstar_backups (id, data, source) VALUES ($1, $2::jsonb, $3) RETURNING id, source, created_at',
      [id, JSON.stringify(state), safeSource]
    )
    // `OFFSET 30` sélectionne tous les instantanés plus anciens que les trente
    // plus récents. Le tie-breaker id rend le résultat déterministe.
    await conn.query(
      'DELETE FROM pcstar_backups WHERE id IN (SELECT id FROM pcstar_backups ORDER BY created_at DESC, id DESC OFFSET $1)',
      [NEON_BACKUP_KEEP]
    )
    await conn.query('COMMIT')
    const backup = inserted.rows[0]
    return { id: backup.id, source: backup.source, createdAt: new Date(backup.created_at).toISOString() }
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

/**
 * Restaure explicitement un snapshot Neon. Cette primitive n'est exposée qu'au
 * script d'exploitation, jamais à une route HTTP : restaurer est une action
 * destructive qui doit exiger la confirmation CLI de l'opérateur.
 */
export async function restoreNeonBackup(id) {
  const p = transactionPool()
  if (!p) throw new Error('DATABASE_URL is required for a Neon restore')
  const backupId = String(id || '')
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(backupId)) throw new Error('Invalid Neon backup id')
  const conn = await p.connect()
  try {
    await conn.query('BEGIN')
    await ensureBackupTable(conn)
    const found = await conn.query('SELECT data, created_at FROM pcstar_backups WHERE id = $1 FOR UPDATE', [backupId])
    const data = found.rows[0]?.data
    if (!data) {
      await conn.query('ROLLBACK')
      return null
    }
    // Verrouiller la ligne avant son upsert pour respecter le même sérialiseur
    // que updateNeonState(); une restauration ne doit pas écraser une mutation
    // validée entre la lecture du snapshot et l'écriture.
    await conn.query('SELECT id FROM pcstar_state WHERE id = 1 FOR UPDATE')
    await conn.query(
      'INSERT INTO pcstar_state (id, data, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
      [JSON.stringify(data)]
    )
    await conn.query('COMMIT')
    return { id: backupId, createdAt: new Date(found.rows[0].created_at).toISOString() }
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

/**
 * Read-modify-write under a PostgreSQL row lock. The old JSON adapter could
 * lose one of two simultaneous stock updates; this path serializes mutations.
 */
export async function updateNeonState(mutator, fallback) {
  const p = transactionPool()
  if (!p) return fallback()
  const conn = await p.connect()
  try {
    await conn.query('BEGIN')
    const rows = await conn.query('SELECT data FROM pcstar_state WHERE id = 1 FOR UPDATE')
    const current = rows.rows[0]?.data || fallback()
    const next = mutator(current) || current
    await conn.query(
      'INSERT INTO pcstar_state (id, data, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
      [JSON.stringify(next)]
    )
    await conn.query('COMMIT')
    return next
   } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

/**
 * Move completed/picked orders into pcstar_archived_orders (Neon only).
 * `mutator(orders)` must return { archived: Order[], remaining: Order[] }.
 * Runs under the same row lock as updateNeonState so no reservation is lost.
 */
export async function archiveOrders(mutator, fallback) {
  const p = transactionPool()
  if (!p) return fallback ? fallback() : { archived: 0, via: 'store-json' }
  const conn = await p.connect()
  try {
    await conn.query('BEGIN')
    const rows = await conn.query('SELECT data FROM pcstar_state WHERE id = 1 FOR UPDATE')
    const state = rows.rows[0]?.data
    if (!state || !Array.isArray(state.orders)) {
      const result = fallback ? fallback() : { archived: 0, via: 'empty' }
      await conn.query('ROLLBACK')
      return result
    }
    const { archived, remaining } = mutator(state.orders)
    for (const order of archived) {
      await conn.query(
        'INSERT INTO pcstar_archived_orders (code, data) VALUES ($1, $2::jsonb) ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data',
        [order.code, JSON.stringify(order)]
      )
    }
    state.orders = remaining
    await conn.query(
      'INSERT INTO pcstar_state (id, data, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at',
      [JSON.stringify(state)]
    )
    await conn.query('COMMIT')
    return { archived: archived.length, via: 'neon' }
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
