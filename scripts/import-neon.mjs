#!/usr/bin/env node
import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const source = process.argv[2] || 'server/data/store.json'
const force = process.argv.includes('--force')
const data = JSON.parse(await fs.readFile(source, 'utf8'))
if (!data || !Array.isArray(data.users) || !Array.isArray(data.orders) || !data.meta) {
  throw new Error('Invalid PC Star store shape')
}
const sql = neon(process.env.DATABASE_URL)
await sql`CREATE TABLE IF NOT EXISTS pcstar_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
const existing = await sql`SELECT data FROM pcstar_state WHERE id = 1`
if (existing[0]?.data && !force) {
  throw new Error('Neon already contains state. Re-run with --force only after taking a backup.')
}
await sql`INSERT INTO pcstar_state (id, data, updated_at) VALUES (1, ${JSON.stringify(data)}::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`
console.log(`Imported ${data.users.length} users and ${data.orders.length} orders from ${source}`)
