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

let sql = null
let sqlSource = null
let pool = null
let poolSource = null

/**
 * LOT P0 (audit 19/09/2026, B1) — le pool ne doit JAMAIS être un simple cache.
 *
 * Le `Pool` exposé par `@neondatabase/serverless` est le `pg` Pool embarqué. Ce
 * dernier rattache à chaque client rendu inactif un « idle listener » qui, à la
 * première erreur du socket, fait `pool._remove(client); pool.emit('error', err)`.
 * Un EventEmitter qui émet `'error'` sans auditeur **jette hors de toute
 * promesse** : ni le `try/catch` de l'appelant, ni celui de `scheduledBackup()`
 * (`server/index.js`), ni `readDbSafe()` ne peuvent l'attraper — le processus
 * meurt. Reproduit en direct avec un PostgreSQL factice qui casse son socket
 * 1,2 s après le handshake :
 *
 *   Error: Connection terminated unexpectedly
 *       at …/@neondatabase/serverless/index.mjs:1010:76    → exit 1
 *
 * Ce n'est pas un scénario exotique : un compute Neon suspendu, un pooler qui
 * ferme les connexions oisives ou une coupure réseau produisent cette trace, et
 * `transactionPool()` sert **toutes** les écritures (`updateNeonState`) — un
 * client idle existe donc entre deux requêtes. Le service est rendu
 * silencieusement depuis l'application ; le `try/catch` autour du backup
 * n'y changeait rien.
 *
 * Deux gardes, dans l'ordre :
 *  1. un auditeur `'error'` → plus rien ne remonte jusqu'à Node ;
 *  2. le pool fautif est **écarté** (`disposeTransactionPool`) et `max: 1` étant
 *     la seule taille autorisée, la reconstruction est **paresseuse** : le pool
 *     suivant est créé à la prochaine écriture, sur une connexion neuve.
 */
const poolStatus = { created: 0, idleErrors: 0, lastError: null, lastErrorAt: null }

function shortMessage(error) {
  return String((error && error.message) || error || 'unknown error').slice(0, 300)
}

/**
 * Rend un client au pool sans jamais laisser un échec de fermeture parler plus
 * fort que le résultat de l'appelant : `conn.release()` dans un `finally` lève si
 * le pool a été écarté entre-temps (le cas B1), ce qui tournerait une écriture
 * réussie en 500 — exactement l'effet inverse de celui recherché.
 */
function releaseQuietly(conn) {
  try {
    if (typeof conn?.release === 'function') conn.release()
  } catch (error) {
    console.warn('[pcstar-db] client non rendu au pool (fermé ou écarté).', { message: shortMessage(error) })
  }
}

/** Écarte le pool courant (fermeture gracieuse, jamais bloquante, jamais bruyante). */
function disposeTransactionPool() {
  const dying = pool
  pool = null
  poolSource = null
  if (!dying) return
  try {
    Promise.resolve(dying.end()).catch(() => {
      /* une seconde panne pendant la fermeture n'ajoute rien au diagnostic */
    })
  } catch {
    /* pool déjà fermé */
  }
}

/**
 * Diagnostic — consommé par `GET /api/db/status` (master) et par le test de
 * non-régression `src/p0NeonPool.test.js`. Aucun secret, aucun identifiant :
 * compteurs d'erreurs et horodatages seulement.
 */
export function neonPoolStatus() {
  return {
    ...poolStatus,
    active: Boolean(pool),
    // Un pool vivant SANS auditeur 'error' est exactement le défaut B1 : la
    // sonde sert à le voir revenir.
    errorListeners: pool ? pool.listenerCount('error') : 0,
    size: pool ? pool.totalCount : 0,
    idle: pool ? pool.idleCount : 0
  }
}

/** Pool courant, exposé pour le diagnostic et le test B1 (jamais pour écrire). */
export function peekTransactionPool() {
  return pool || null
}

function client() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  // Une URL qui change (rotation de secret, reconfiguration, test) invalide le
  // cache : sinon le processus resterait collé à l'ancienne base jusqu'au
  // redémarrage.
  if (!sql || sqlSource !== url) {
    sql = neon(url)
    sqlSource = url
  }
  return sql
}
/**
 * Le pool de transactions — unique point de création, donc unique endroit où la
 * garde B1 peut vivre. Exporté pour le diagnostic (`neonPoolStatus`) et pour le
 * test de non-régression `src/p0NeonPool.test.js` : **jamais** pour conduire une
 * requête hors de ce module, ce qui court-circuiterait le verrou de ligne.
 */
export function transactionPool() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (pool && poolSource !== url) disposeTransactionPool()
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 1 })
    poolSource = url
    poolStatus.created += 1
    pool.on('error', (error) => {
      poolStatus.idleErrors += 1
      poolStatus.lastError = shortMessage(error)
      poolStatus.lastErrorAt = new Date().toISOString()
      console.error('[pcstar-db] erreur sur un client idle du pool Neon — pool écarté, reconstruit à la prochaine écriture.', {
        message: poolStatus.lastError
      })
      disposeTransactionPool()
    })
  }
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
    releaseQuietly(conn)
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
    releaseQuietly(conn)
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
    releaseQuietly(conn)
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
    releaseQuietly(conn)
  }
}
