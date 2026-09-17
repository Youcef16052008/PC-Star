#!/usr/bin/env node
import { neon } from '@neondatabase/serverless'
import { emptyDb, normalizeDb } from '../server/db.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Create a Neon project and export its pooled connection string.')
  process.exit(2)
}

const RESET = process.argv.includes('--reset')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let lastError
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    const sql = neon(process.env.DATABASE_URL)
    await sql`CREATE TABLE IF NOT EXISTS pcstar_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
    await sql`CREATE INDEX IF NOT EXISTS pcstar_state_updated_at_idx ON pcstar_state (updated_at)`
    if (RESET) {
      // Isolation CI : réinitialise l'état partagé (pollution inter-runs sinon).
      await sql`INSERT INTO pcstar_state (id, data) VALUES (1, ${JSON.stringify(emptyDb())}::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`
    } else {
      await sql`INSERT INTO pcstar_state (id, data) VALUES (1, ${JSON.stringify(emptyDb())}::jsonb) ON CONFLICT (id) DO NOTHING`
      // AUDIT-2026-09-17 / phase 2 : les anciennes bases Neon peuvent contenir
      // sessions/states expirés ou un maître avant rotation. Les normaliser ici
      // rend la migration effective sans attendre la première mutation métier.
      const current = await sql`SELECT data FROM pcstar_state WHERE id = 1`
      const state = current[0]?.data
      if (state && normalizeDb(state)) {
        await sql`UPDATE pcstar_state SET data = ${JSON.stringify(state)}::jsonb, updated_at = now() WHERE id = 1`
      }
    }
    // Archive des commandes archivées hors du document JSONB chaud
    await sql`CREATE TABLE IF NOT EXISTS pcstar_archived_orders (code text PRIMARY KEY, data jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT now())`
    await sql`CREATE INDEX IF NOT EXISTS pcstar_archived_orders_at_idx ON pcstar_archived_orders (archived_at)`
    if (RESET) {
      await sql`DELETE FROM pcstar_archived_orders`
    }
    console.log(RESET ? 'Neon schema reset: pcstar_state + pcstar_archived_orders' : 'Neon schema ready: pcstar_state + pcstar_archived_orders')
    process.exit(0)
  } catch (error) {
    lastError = error
    console.error(`Neon migration attempt ${attempt}/5 failed:`, error?.message || error)
    if (attempt < 5) await wait(attempt * 3000)
  }
}
console.error('Neon migration failed after retries:', lastError?.message || lastError)
process.exit(1)
