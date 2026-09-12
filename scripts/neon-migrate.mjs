#!/usr/bin/env node
import fs from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import { emptyDb } from '../server/db.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Create a Neon project and export its pooled connection string.')
  process.exit(2)
}

const sql = neon(process.env.DATABASE_URL)
const migration = await fs.readFile(new URL('../sql/001-neon-state.sql', import.meta.url), 'utf8')
// This migration contains two independent DDL statements. Neon supports them
// through the tagged client; splitting is deliberately limited to this file.
for (const statement of migration.split(';').map((x) => x.trim()).filter(Boolean)) {
  await sql.query(statement)
}
await sql.query(
  'INSERT INTO pcstar_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
  [JSON.stringify(emptyDb())]
)
console.log('Neon schema ready: pcstar_state')
