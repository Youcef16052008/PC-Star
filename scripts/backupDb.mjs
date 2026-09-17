#!/usr/bin/env node
/**
 * Sauvegarde de l'état courant, sans supposer le driver.
 *
 * - local : copie bornée de server/data/store.json ;
 * - Neon  : snapshot JSONB transactionnel conservé dans pcstar_backups.
 *
 * Pour une copie réellement hors du projet Neon (incident fournisseur), utiliser
 * `npm run db:export:neon -- /chemin/hors-du-dépôt/pcstar-export.json` puis la
 * stocker dans le coffre/stockage de sauvegarde de l'exploitant.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupStore, capBackups } from '../server/masterApi.js'

if (process.env.DATABASE_URL) {
  const { createNeonBackup } = await import('../server/neonStore.js')
  const backup = await createNeonBackup('cli')
  console.log(`Neon backup ${backup.id} (${backup.createdAt})`)
} else {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const SRC = path.join(ROOT, 'server/data/store.json')
  const DIR = path.join(ROOT, 'server/data/backups')
  if (!fs.existsSync(SRC)) {
    console.error('no store.json yet')
    process.exit(1)
  }
  const dest = backupStore(SRC, DIR)
  const removed = capBackups(DIR)
  console.log('backup', dest, removed ? `(removed ${removed} old)` : '')
}
