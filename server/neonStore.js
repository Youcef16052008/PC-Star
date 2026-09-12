import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

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
