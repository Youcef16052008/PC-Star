import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

describe('Phase 5 — sauvegardes Neon et isolation CI', () => {
  it('migre et borne des snapshots Neon, puis restaure sous verrou', () => {
    const migration = read('scripts/neon-migrate.mjs')
    const store = read('server/neonStore.js')
    assert.match(migration, /CREATE TABLE IF NOT EXISTS pcstar_backups/)
    assert.match(migration, /DELETE FROM pcstar_backups/)
    assert.match(store, /export async function createNeonBackup/)
    assert.match(store, /SELECT data FROM pcstar_state WHERE id = 1 FOR SHARE/)
    assert.match(store, /OFFSET \$1/)
    assert.match(store, /export async function restoreNeonBackup/)
    assert.match(store, /SELECT id FROM pcstar_state WHERE id = 1 FOR UPDATE/)
  })

  it('n’autorise pas les commandes destructrices ou de test sans opt-in', () => {
    const migration = read('scripts/neon-migrate.mjs')
    const importer = read('scripts/import-neon.mjs')
    const concurrency = read('scripts/test-neon-concurrency.mjs')
    const backupTest = read('scripts/test-neon-backup-restore.mjs')
    const exporter = read('scripts/export-neon.mjs')
    assert.match(migration, /--confirm-reset/)
    assert.match(importer, /--confirm-overwrite/)
    assert.match(concurrency, /PCSTAR_NEON_TEST_ISOLATED/)
    assert.match(backupTest, /PCSTAR_NEON_TEST_ISOLATED/)
    assert.match(exporter, /fs\.open\(destination, force \? 'w' : 'wx', 0o600\)/)
    assert.match(exporter, /--confirm-overwrite/)
  })

  it('exécute les tests Neon sur une branche PR isolée et garde les unitaires isolés', () => {
    const workflow = read('.github/workflows/neon_workflow.yml')
    assert.match(workflow, /neondatabase\/create-branch-action@v6/)
    assert.match(workflow, /PCSTAR_NEON_TEST_ISOLATED: '1'/)
    assert.match(workflow, /npm run test:neon:concurrency/)
    assert.match(workflow, /npm run test:neon:backup/)
    assert.match(workflow, /Run full isolated regression suite/)
    assert.doesNotMatch(workflow, /Run full test suite against Neon/)
    const vercel = JSON.parse(read('vercel.json'))
    assert.deepEqual(vercel.crons, [{ path: '/api/internal/backup', schedule: '0 3 * * *' }])
    const server = read('server/index.js')
    assert.match(server, /pathname === '\/api\/internal\/backup'/)
    assert.match(server, /isAuthorizedCron\(req\)/)
    assert.match(server, /CRON_SECRET/)
  })

  it('distingue snapshot Neon et export indépendant dans la documentation d’exploitation', () => {
    const docs = read('docs/NEON-MIGRATION.md')
    assert.match(docs, /pcstar_backups/)
    assert.match(docs, /db:export:neon/)
    assert.match(docs, /db:restore:neon/)
    assert.match(docs, /--confirm-restore/)
  })
})
