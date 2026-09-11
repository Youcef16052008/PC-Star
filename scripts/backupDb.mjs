#!/usr/bin/env node
/** Daily-ish backup of server/data/store.json → server/data/backups/ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupStore, capBackups } from '../server/masterApi.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'server/data/store.json')
const DIR = path.join(ROOT, 'server/data/backups')
if (!fs.existsSync(SRC)) {
  console.error('no store.json yet')
  process.exit(1)
}
// P9 (P7-7) : même chemin que le timer 6 h du serveur (backup + bornage 14)
const dest = backupStore(SRC, DIR)
const removed = capBackups(DIR)
console.log('backup', dest, removed ? `(removed ${removed} old)` : '')
