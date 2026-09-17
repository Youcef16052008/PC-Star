/**
 * LOT 1.20 — non-régression « les scripts de base s'importent sans compte
 * maître » (chantier CI 1.B).
 *
 * Constat, mesuré en exécution sur la CI Neon (job « Create Neon Branch »,
 * 16/09/2026 15:39:37) : `server/db.js` résolvait le compte maître **au
 * chargement** (`const MASTER = masterAccount()`), donc tout importeur du module
 * exigeait `MASTER_EMAIL` / `MASTER_PASSWORD`. L'étape « Run Neon schema
 * migrations » (`npm run db:migrate:neon`) échouait en
 * `Error: [pcstar] compte maître non configuré …` avant même d'atteindre son
 * propre contrôle de `DATABASE_URL` — et, en cascade, les trois étapes suivantes
 * ne s'exécutaient jamais sur une PR (la concurrence, le `--reset` et la suite
 * complète sont des étapes d'un MÊME job, chaînées par `needs`).
 *
 * Ce qui est verrouillé ici :
 *  · les quatre commandes de scripts qui importent `server/db.js` démarrent sans
 *    compte maître — elles échouent (ou sortent) avec LEUR message, jamais avec
 *    celui du compte maître ;
 *  · `masterAccount()` **lève toujours** sans les variables : le verrou du
 *    LOT 1.1 n'est pas affaibli, seule la résolution est devenue paresseuse ;
 *  · `emptyDb()` / `normalizeDb()` ne sèment ni ne réinjectent de maître sans
 *    configuration, et ne SUPPRIMENT jamais un maître déjà présent en base.
 *
 * La CI ne pose donc pas `MASTER_*` sur ces étapes : la migration crée un
 * schéma, elle n'ouvre aucune session.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { TEST_MASTER_EMAIL } from '../scripts/test-env.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { emptyDb, normalizeDb, masterAccount, masterAccountOrNull } = await import('../server/db.js')

/** Répertoire de données jetable : aucun script de ce fichier ne touche au vrai. */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * Exécute un script `node` comme le ferait la CI : **sans** `MASTER_EMAIL` /
 * `MASTER_PASSWORD` (chaînes VIDES, pas supprimées : `server/env.js` n'applique
 * le `.env` que si la clé est `undefined` — un `.env` du poste ne peut donc pas
 * masquer le scénario) et sans `DATABASE_URL`, pour que le script s'arrête à son
 * propre contrôle sans ouvrir de connexion.
 */
function runScript(args, dataDir = tempDir('pcstar-lot120-')) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      MASTER_EMAIL: '',
      MASTER_PASSWORD: '',
      DATABASE_URL: '',
      PCSTAR_DATA_DIR: dataDir
    },
    encoding: 'utf8',
    timeout: 30000
  })
}

const output = (res) => String(res.stderr || '') + String(res.stdout || '')

describe('LOT 1.20 — les scripts de base ne dépendent plus du compte maître', () => {
  // Le pas de CI exact : `db:migrate:neon` puis `db:migrate:neon:reset`. Avant le
  // correctif, les deux échouaient sur « compte maître non configuré » à l'import.
  for (const args of [[], ['--reset']]) {
    const nom = args.length ? 'db:migrate:neon:reset (--reset)' : 'db:migrate:neon'
    it(`\`${nom}\` démarre sans MASTER_* et atteint son contrôle DATABASE_URL`, () => {
      const res = runScript([path.join('scripts', 'neon-migrate.mjs'), ...args])
      assert.equal(res.status, 2, `statut ${res.status} — sortie : ${output(res).slice(0, 400)}`)
      assert.match(output(res), /DATABASE_URL is required/, 'le script doit réclamer DATABASE_URL')
      assert.doesNotMatch(
        output(res),
        /compte maître non configuré/,
        'le script se plaint encore du compte maître : la résolution n’est pas paresseuse'
      )
    })
  }

  it('`test:neon:concurrency` démarre sans MASTER_* (import de readDbAsync/updateDbAsync)', () => {
    const res = runScript([path.join('scripts', 'test-neon-concurrency.mjs')])
    assert.equal(res.status, 2, `statut ${res.status} — sortie : ${output(res).slice(0, 400)}`)
    assert.match(output(res), /DATABASE_URL is required/)
    assert.doesNotMatch(output(res), /compte maître non configuré/)
  })

  it('`db:doctor` démarre sans MASTER_* et conclut sur l’absence de DATABASE_URL', () => {
    const res = runScript([path.join('scripts', 'neon-doctor.mjs')])
    assert.equal(res.status, 0, `statut ${res.status} — sortie : ${output(res).slice(0, 400)}`)
    assert.match(output(res), /DATABASE_URL absente/)
    assert.doesNotMatch(output(res), /compte maître non configuré/)
  })
})
describe('LOT 1.20 — le module serveur est importable sans compte maître', () => {
  /** Exécute `fn` avec MASTER_* retirées, puis restaure quoi qu'il arrive. */
  function sansMaster(fn) {
    const savedEmail = process.env.MASTER_EMAIL
    const savedPass = process.env.MASTER_PASSWORD
    try {
      delete process.env.MASTER_EMAIL
      delete process.env.MASTER_PASSWORD
      return fn()
    } finally {
      process.env.MASTER_EMAIL = savedEmail
      process.env.MASTER_PASSWORD = savedPass
    }
  }

  it('`masterAccount()` lève toujours sans les variables (verrou LOT 1.1 intact)', () => {
    assert.throws(() => sansMaster(() => masterAccount()), /MASTER_EMAIL/)
  })

  it('`masterAccountOrNull()` rend `null` sans configuration, l’objet sinon', () => {
    assert.equal(sansMaster(() => masterAccountOrNull()), null)
    const m = masterAccountOrNull()
    assert.equal(m.email, TEST_MASTER_EMAIL)
    assert.equal(m.role, 'master')
  })

  it('`emptyDb()` ne sème aucun maître quand MASTER_* sont absentes', () => {
    const db = sansMaster(() => emptyDb())
    assert.ok(Array.isArray(db.users), 'users présents')
    assert.equal(
      db.users.filter((u) => u.role === 'master').length,
      0,
      'la migration écrit un état sans maître : elle ne réclame pas d’identifiants'
    )
  })

  it('`normalizeDb()` ne supprime pas un maître déjà en base (la sync est l’action d’un serveur configuré)', () => {
    const db = emptyDb() // avec MASTER_* : un maître est semé
    const avant = db.users.filter((u) => u.role === 'master')
    assert.equal(avant.length, 1, 'état de départ : un maître')
    const changed = sansMaster(() => normalizeDb(db))
    const apres = db.users.filter((u) => u.role === 'master')
    assert.equal(apres.length, 1, 'un maître existant ne doit jamais être retiré ni dupliqué')
    assert.equal(apres[0].email, avant[0].email)
    assert.equal(typeof changed, 'boolean', 'normalizeDb rend un booléen de changement')
  })

  it('le module n’expose plus d’objet `MASTER` résolu à l’import, et le garde-fou serveur demeure', () => {
    const dbSrc = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8')
    assert.doesNotMatch(dbSrc, /^const MASTER\s*=/m, 'résolution de `MASTER` au chargement réintroduite')
    assert.ok(dbSrc.includes('masterAccountOrNull'), 'résolution paresseuse absente')
    assert.ok(dbSrc.includes('export function masterAccountOrNull'), 'masterAccountOrNull doit être exportée')

    // Le refus de démarrer sans compte maître ne peut pas se perdre avec la
    // résolution paresseuse : il est vérifié explicitement avant `listen()`.
    const indexSrc = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
    assert.ok(
      /assertMasterConfigured\s*\(/.test(indexSrc),
      'le serveur ne vérifie plus la configuration maître avant d’écouter'
    )
  })
})