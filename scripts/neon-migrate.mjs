#!/usr/bin/env node
import { neon } from '@neondatabase/serverless'
import { emptyDb } from '../server/db.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Create a Neon project and export its pooled connection string.')
  process.exit(2)
}

const sql = neon(process.env.DATABASE_URL)
await sql`CREATE TABLE IF NOT EXISTS pcstar_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
await sql`CREATE INDEX IF NOT EXISTS pcstar_state_updated_at_idx ON pcstar_state (updated_at)`
await sql`INSERT INTO pcstar_state (id, data) VALUES (1, ${JSON.stringify(emptyDb())}::jsonb) ON CONFLICT (id) DO NOTHING`
console.log('Neon schema ready: pcstar_state')
