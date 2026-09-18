#!/usr/bin/env node
/**
 * Intégration Neon à exécuter UNIQUEMENT sur une branche éphémère.
 * Prouve qu'un snapshot sauvegardé restaure effectivement le document JSONB.
 */
import assert from 'node:assert/strict'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
if (process.env.PCSTAR_NEON_TEST_ISOLATED !== '1') {
  console.error('Refusing to mutate a shared Neon database. Set PCSTAR_NEON_TEST_ISOLATED=1 on an ephemeral branch only.')
  process.exit(2)
}

const { readDbAsync, updateDbAsync } = await import('../server/db.js')
const { createNeonBackup, restoreNeonBackup } = await import('../server/neonStore.js')
const marker = `backup-restore-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
const baseline = await createNeonBackup('ci-before-restore-test')

try {
  await updateDbAsync((db) => {
    db.meta ||= {}
    db.meta.backupRestoreProbe = marker
    return db
  })
  assert.equal((await readDbAsync()).meta?.backupRestoreProbe, marker, 'the probe mutation must be persisted before restore')

  const restored = await restoreNeonBackup(baseline.id)
  assert.ok(restored, 'the just-created snapshot must be restorable')
  assert.notEqual((await readDbAsync()).meta?.backupRestoreProbe, marker, 'restore must remove the post-backup mutation')
  console.log(`NEON BACKUP/RESTORE OK: snapshot ${baseline.id} restored the previous state`)
} finally {
  // Même après un échec d'assertion, laisser la branche CI identique à son état
  // initial. Le garde d'isolation au début interdit cette mutation en base partagée.
  await restoreNeonBackup(baseline.id).catch(() => {})
}
