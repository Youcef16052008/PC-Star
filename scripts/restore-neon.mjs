#!/usr/bin/env node
/** Restaure un instantané pcstar_backups, uniquement sur confirmation explicite. */
const args = process.argv.slice(2)
const backupIndex = args.indexOf('--backup')
const backupId = backupIndex >= 0 ? args[backupIndex + 1] : ''

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
if (!backupId || backupId.startsWith('--')) {
  console.error('Usage: npm run db:restore:neon -- --backup <snapshot-uuid> --confirm-restore')
  process.exit(2)
}
if (!args.includes('--confirm-restore')) {
  console.error('Refusing destructive restore without --confirm-restore.')
  process.exit(2)
}

const { restoreNeonBackup } = await import('../server/neonStore.js')
const restored = await restoreNeonBackup(backupId)
if (!restored) {
  console.error(`No Neon backup found for ${backupId}`)
  process.exit(1)
}
console.log(`Restored Neon backup ${restored.id} created at ${restored.createdAt}`)
