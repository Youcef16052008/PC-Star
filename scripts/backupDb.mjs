#!/usr/bin/env node
/** Daily-ish backup of server/data/store.json → server/data/backups/ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'server/data/store.json')
const DIR = path.join(ROOT, 'server/data/backups')
fs.mkdirSync(DIR, { recursive: true })
if (!fs.existsSync(SRC)) {
  console.error('no store.json yet')
  process.exit(1)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(DIR, `store-${stamp}.json`)
fs.copyFileSync(SRC, dest)
// keep last 14
const all = fs
  .readdirSync(DIR)
  .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
  .sort()
while (all.length > 14) {
  const f = all.shift()
  fs.unlinkSync(path.join(DIR, f))
}
console.log('backup', dest)
