#!/usr/bin/env node
/** Export explicite d'un état Neon vers un fichier JSON restaurable par import-neon. */
import fs from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const force = args.includes('--force')
const confirmed = args.includes('--confirm-overwrite')
const destinations = args.filter((arg) => !arg.startsWith('--'))

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
if (destinations.length !== 1) {
  console.error('Usage: npm run db:export:neon -- /safe/backup/pcstar-export.json [--force --confirm-overwrite]')
  process.exit(2)
}
if (force && !confirmed) {
  console.error('Refusing --force without --confirm-overwrite.')
  process.exit(2)
}

const destination = path.resolve(destinations[0])
const { neon } = await import('@neondatabase/serverless')
const sql = neon(process.env.DATABASE_URL)
const rows = await sql`SELECT data FROM pcstar_state WHERE id = 1`
const state = rows[0]?.data
if (!state) {
  console.error('pcstar_state is empty; run db:migrate:neon first')
  process.exit(1)
}

await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
let handle
try {
  // `wx` empêche tout écrasement accidentel. Un export contient des hashes de
  // mots de passe et doit être traité comme une sauvegarde sensible.
  handle = await fs.open(destination, force ? 'w' : 'wx', 0o600)
  await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await handle.sync()
  await handle.chmod(0o600)
} finally {
  await handle?.close()
}
console.log(`Exported Neon state to ${destination}`)
