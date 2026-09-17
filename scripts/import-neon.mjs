#!/usr/bin/env node
import fs from 'node:fs/promises'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const args = process.argv.slice(2)
const sources = args.filter((arg) => !arg.startsWith('--'))
if (sources.length > 1) {
  console.error('Usage: npm run db:import:neon -- [store.json] [--force --confirm-overwrite]')
  process.exit(2)
}
const source = sources[0] || 'server/data/store.json'
const force = args.includes('--force')
if (force && !args.includes('--confirm-overwrite')) {
  console.error('Refusing destructive --force without --confirm-overwrite. Export a backup first.')
  process.exit(2)
}

// Gardes ci-dessus avant les imports serveur : une commande de confirmation
// oubliée n'a besoin ni de réseau ni de secrets maître pour échouer proprement.
const [{ neon }, { normalizeDb }] = await Promise.all([import('@neondatabase/serverless'), import('../server/db.js')])
const data = JSON.parse(await fs.readFile(source, 'utf8'))
if (!data || !Array.isArray(data.users) || !Array.isArray(data.orders) || !data.meta) {
  throw new Error('Invalid PC Star store shape')
}
// Même état sain que le store local : expiration de sessions/states, identité
// maître alignée sur l'environnement et structure OAuth complète avant l'écriture.
normalizeDb(data)
const sql = neon(process.env.DATABASE_URL)
await sql`CREATE TABLE IF NOT EXISTS pcstar_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
const existing = await sql`SELECT data FROM pcstar_state WHERE id = 1`
if (existing[0]?.data && !force) {
  throw new Error('Neon already contains state. Re-run with --force only after taking a backup.')
}
await sql`INSERT INTO pcstar_state (id, data, updated_at) VALUES (1, ${JSON.stringify(data)}::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`
console.log(`Imported ${data.users.length} users and ${data.orders.length} orders from ${source}`)
