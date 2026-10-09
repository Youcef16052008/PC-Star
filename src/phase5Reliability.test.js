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
    assert.match(exporter, /0o600/)
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
  })

  it('le nettoyage des branches Neon ne peut pas supprimer par accident', () => {
    // P27 — le projet est tombé au plafond du plan (10 branches, dont 8
    // `preview/*`) et la création de branche a échoué en 422. Le workflow de
    // nettoyage existe pour rendre ces branches récupérables d'un clic ; ce
    // verrou garantit qu'il ne peut pas faire de dégât tout seul. Chaque
    // assertion ci-dessous est la contre-épreuve d'un garde-fou vérifié au banc
    // avec un `curl` de test (PR fermée / ouverte / introuvable / illisible).
    const wf = read('.github/workflows/neon-cleanup.yml')
    assert.match(wf, /workflow_dispatch:/, 'le nettoyage doit rester déclenchable à la main')
    assert.doesNotMatch(
      wf,
      /^\s{2}(push|pull_request|schedule):/m,
      'un déclencheur automatique est revenu sur un workflow qui supprime des branches'
    )
    assert.match(wf, /default: true/, 'le mode annonce n est plus le défaut : une exécution supprimerait sans le dire')
    assert.match(wf, /inputs\.dry_run/, 'la suppression ne dépend plus d un choix explicite')
    assert.match(wf, /select\(\.default \| not\)/, 'la branche par défaut du projet n est plus protégée')
    assert.match(wf, /garde \(hors motif/, 'une branche hors du motif preview/pr-N-… peut entrer dans la liste')
    // La liste des branches à supprimer se remplit à DEUX endroits, et seulement
    // là : PR fermée, PR introuvable. Un troisième cas (ou un déplacement) doit
    // faire rougir ce test.
    const ajouts = wf.split('>> /tmp/orphelines.txt')
    assert.equal(ajouts.length - 1, 2, 'la liste à supprimer se remplit ailleurs que dans les deux cas prévus')
    assert.match(ajouts[0], /state" = "closed"/, 'une PR ouverte peut entrer dans la liste')
    assert.match(ajouts[1], /PR #\$n introuvable/, 'une PR introuvable n entre plus dans la liste')
  })

  it('distingue snapshot Neon et export indépendant dans la documentation d’exploitation', () => {
    const docs = read('docs/NEON-MIGRATION.md')
    assert.match(docs, /pcstar_backups/)
    assert.match(docs, /db:export:neon/)
    assert.match(docs, /db:restore:neon/)
    assert.match(docs, /--confirm-restore/)
  })
})
