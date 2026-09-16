/**
 * LOT 1.1 / 1.2 / 7.3 — non-régression « aucun secret maître dans le dépôt ».
 *
 * Avant ces correctifs :
 *   · `src/shopStore.js` exportait `MASTER = { email, password }` en clair —
 *     Vite l'incluait dans le bundle JS public (retrouvé par `grep` sur
 *     `dist/assets/index-*.js`), et ces identifiants ouvraient une vraie
 *     session `role: 'master'` sur l'API (reproduit : `POST /api/auth/login`
 *     → 200 + token) ;
 *   · `server/db.js` seedait le même couple en dur ;
 *   · cinq fichiers de documentation le publiaient ;
 *   · quatre scripts de recette le codaient en dur ;
 *   · `GET /api/health` (public) renvoyait l'e-mail du maître.
 *
 * Ce test verrouille les cinq points. Les valeurs interdites ne sont JAMAIS
 * écrites ici : elles sont lues depuis l'environnement de test, ce qui évite de
 * réintroduire le secret dans le dépôt par le test censé le prévenir.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
const { masterAccount } = await import('../server/db.js')
const shopStore = await import('./shopStore.js')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Fichiers suivis à examiner, hors documentation d'audit (qui cite l'historique). */
function sourceFiles() {
  const dirs = ['src', 'server', 'scripts', 'api', 'e2e']
  const out = []
  for (const d of dirs) {
    const full = path.join(ROOT, d)
    if (!fs.existsSync(full)) continue
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/\.(js|jsx|mjs|cjs|json)$/.test(entry.name)) continue
      out.push(path.join(full, entry.name))
    }
  }
  // Documentation publiée + exemples de configuration.
  for (const f of [
    'README.md',
    '.env.example',
    'docs/README.md',
    'docs/GUIDE-DEMO.md',
    'docs/GUIDE-DEMO-FR.md',
    'docs/GUIDE-DEMO-AR.md',
    'docs/DEPLOY-VERCEL.md'
  ]) {
    const full = path.join(ROOT, f)
    if (fs.existsSync(full)) out.push(full)
  }
  return out
}

describe('LOT 1.1 — le compte maître vient de l’environnement', () => {
  it('le module client n’exporte plus aucun compte maître', () => {
    assert.equal(shopStore.MASTER, undefined, 'export MASTER encore présent côté client')
    const seeded = shopStore.loadUsers(shopStore.createMemoryStorage())
    assert.equal(
      seeded.filter((u) => u.role === 'master').length,
      0,
      'un maître est encore seedé en mode local'
    )
  })

  it('masterAccount() lit l’environnement', () => {
    const m = masterAccount()
    assert.equal(m.email, TEST_MASTER_EMAIL)
    assert.equal(m.role, 'master')
    assert.equal(m.id, 'master-pcstar', 'l’id reste stable (non secret)')
    // Le mot de passe n'est jamais exposé en clair : seul son hash est stocké.
    assert.equal(m.password, undefined)
    assert.ok(String(m.passwordHash).length > 0, 'hash présent')
    assert.ok(
      !JSON.stringify(m).includes(TEST_MASTER_PASSWORD),
      'le mot de passe maître apparaît en clair dans l’objet compte'
    )
  })

  it('masterAccount() lève si les variables manquent — aucune valeur par défaut', () => {
    const savedEmail = process.env.MASTER_EMAIL
    const savedPass = process.env.MASTER_PASSWORD
    try {
      delete process.env.MASTER_EMAIL
      assert.throws(() => masterAccount(), /MASTER_EMAIL/, 'e-mail manquant : doit lever')
      process.env.MASTER_EMAIL = savedEmail
      delete process.env.MASTER_PASSWORD
      assert.throws(() => masterAccount(), /MASTER_PASSWORD/, 'mot de passe manquant : doit lever')
      // Une valeur vide ne doit pas passer non plus.
      process.env.MASTER_PASSWORD = '   '
      assert.throws(() => masterAccount(), /MASTER_PASSWORD/, 'mot de passe vide : doit lever')
    } finally {
      process.env.MASTER_EMAIL = savedEmail
      process.env.MASTER_PASSWORD = savedPass
    }
  })

  it('le serveur local refuse de démarrer sans compte maître, avec un message lisible', () => {
    const env = {
      ...process.env,
      // Chaînes VIDES (pas supprimées) : `server/env.js` n'applique le `.env`
      // que si la variable est `undefined`, donc un `.env` local ne peut pas
      // venir masquer ce test.
      MASTER_EMAIL: '',
      MASTER_PASSWORD: '',
      PCSTAR_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-nomaster-'))
    }
    const res = spawnSync(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env,
      encoding: 'utf8',
      timeout: 20000
    })
    assert.notEqual(res.status, 0, 'le serveur a démarré sans compte maître')
    assert.match(
      String(res.stderr) + String(res.stdout),
      /compte maître non configuré/,
      'le message d’échec doit dire quoi poser'
    )
    assert.match(String(res.stderr) + String(res.stdout), /MASTER_EMAIL/)
  })
  it('une base existante perd le maître compromis et conserve ses données', () => {
    // Cas réel d'un déploiement antérieur au correctif : `store.json` contient
    // déjà un compte maître créé à l'époque où les identifiants étaient codés
    // en dur. Sans synchronisation, poser MASTER_EMAIL / MASTER_PASSWORD
    // n'aurait AUCUN effet — l'ancien couple resterait valide pour toujours.
    //
    // `DATA_DIR` étant résolu au chargement du module, la sonde tourne dans un
    // processus enfant avec son propre PCSTAR_DATA_DIR.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-legacy-'))
    const legacySecret = 'legacy-compromis'
    const legacyHash =
      'sha256$pcstar:' +
      crypto.createHash('sha256').update('pcstar:' + legacySecret).digest('hex')
    const compromisedEmail = 'maitre.compromis@example.invalid'
    fs.writeFileSync(
      path.join(dir, 'store.json'),
      JSON.stringify({
        users: [
          {
            id: 'master-pcstar',
            role: 'master',
            email: compromisedEmail,
            passwordHash: legacyHash,
            name: 'PC Star Desk',
            provider: 'email'
          },
          { id: 'u-1', role: 'customer', email: 'client@example.invalid', name: 'Client' }
        ],
        orders: [{ code: 'PS-20260101-0001', status: 'new', total: 1000, items: [] }],
        stock: {},
        sessions: {},
        oauthPending: {},
        meta: { demoSeeded: true, extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], photoOverrides: {}, productOverrides: {} }
      })
    )

    const probe = `
      const { readDb } = await import(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))})
      const db = readDb()
      const m = db.users.find((u) => u.role === 'master')
      const legacyStillValid = (await import(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))}))
        .verifyPass(${JSON.stringify(legacySecret)}, m.passwordHash)
      console.log(JSON.stringify({
        email: m.email,
        isScrypt: String(m.passwordHash).startsWith('scrypt$'),
        legacyStillValid,
        customers: db.users.filter((u) => u.role === 'customer').map((u) => u.id),
        orders: db.orders.map((o) => o.code),
        onDisk: (await import('node:fs')).readFileSync(${JSON.stringify(path.join(dir, 'store.json'))}, 'utf8')
      }))
    `
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      env: { ...process.env, PCSTAR_DATA_DIR: dir },
      encoding: 'utf8',
      timeout: 30000
    })
    assert.equal(res.status, 0, 'sonde : ' + String(res.stderr).slice(0, 400))
    const out = JSON.parse(res.stdout.trim().split('\n').pop())

    assert.equal(out.email, TEST_MASTER_EMAIL, 'l’e-mail maître n’a pas été aligné sur l’environnement')
    assert.equal(out.legacyStillValid, false, 'les identifiants compromis fonctionnent encore')
    assert.deepEqual(out.customers, ['u-1'], 'les comptes clients doivent être conservés')
    assert.deepEqual(out.orders, ['PS-20260101-0001'], 'les commandes doivent être conservées')
    assert.ok(!out.onDisk.includes(compromisedEmail), 'l’ancien e-mail maître reste sur disque')
    assert.ok(!out.onDisk.includes(TEST_MASTER_PASSWORD), 'mot de passe en clair écrit sur disque')
  })
})

describe('LOT 1.2 — aucun identifiant maître dans le dépôt', () => {
  it('les valeurs de test ne sont littérales nulle part (elles viennent de l’env)', () => {
    // Garde-fou sur ce test lui-même : s'il contenait le secret en dur, il
    // cesserait de protéger quoi que ce soit.
    assert.ok(TEST_MASTER_EMAIL.includes('@test.'), 'l’e-mail de test doit être jetable')
  })

  it('aucun fichier source ni doc publiée ne contient d’identifiant maître codé en dur', () => {
    // Les motifs sont ASSEMBLÉS à l’exécution : écrits littéralement dans ce
    // fichier, ils se détecteraient eux-mêmes.
    const P = (parts, flags) => new RegExp(parts.join(''), flags)
    // Classe de caractères « guillemet simple ou double », sans l’écrire ici.
    const QC = '[' + String.fromCharCode(39) + String.fromCharCode(34) + ']'
    const NOTQ = '[^' + String.fromCharCode(39) + String.fromCharCode(34) + ']+'
    const rules = [
      {
        nom: 'objet MASTER avec mot de passe',
        re: P(['MASTER\\s*=\\s*\\{', '[^}]*', 'pass', 'word'])
      },
      {
        nom: 'hash de mot de passe littéral',
        re: P(['hashPassLegacy\\(\\s*', QC, NOTQ, QC, '\\s*\\)'])
      },
      {
        // Forme du secret compromis (mot + 2 chiffres), à ne pas confondre avec
        // les comptes de DÉMONSTRATION — ceux-ci sont `role: customer`, non
        // privilégiés, et relèvent du lot 1.3 du plan, pas de celui-ci.
        nom: 'mot de passe littéral en forme « mot + 2 chiffres »',
        re: P(['pass', 'word', '\\s*:\\s*', QC, '[a-z]+\\d{2}', QC], 'i'),
        // Fichiers de démonstration / fixtures : hors périmètre de ce lot.
        sauf: /^(src\/shopStore\.js|.*\.test\.js|.*\.jsx)$/
      }
    ]

    // Comptes de DÉMONSTRATION (`role: 'customer'`, non privilégiés, affichés
    // comme tels dans les guides). Leur retrait relève du lot 1.3 du plan, pas
    // de ce lot-ci : ils sont listés ici explicitement plutôt qu'exclus par un
    // motif flou, pour que toute NOUVELLE occurrence ailleurs soit détectée.
    const demoAllowlist = new Set([
      'server/db.js', // seed `DEMOS` (hashPassLegacy sur les mots de passe démo)
      'scripts/smoke-e2e.mjs', // recette : login d'un client de démonstration
      // LOT 6.9 (Q9) : le smoke Playwright doit vérifier l'ÉTAT CONNECTÉ, donc
      // se connecter — avec le compte client de démonstration (`demo-karim`,
      // `role: 'customer'`, non privilégié, documenté comme tel). Même nature
      // que `scripts/smoke-e2e.mjs` ci-dessus : aucun secret maître ici.
      'e2e/smoke.spec.js'
    ])

    const hits = []
    for (const file of sourceFiles()) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (rel === 'src/masterSecrets.test.js') continue // ce scanner lui-même
      const text = fs.readFileSync(file, 'utf8')
      for (const rule of rules) {
        if (rule.sauf && rule.sauf.test(rel)) continue
        if (demoAllowlist.has(rel) && rule.nom !== 'objet MASTER avec mot de passe') continue
        if (rule.re.test(text)) hits.push(rel + ' — ' + rule.nom)
      }
      // Valeur interdite supplémentaire injectée par l’environnement (utile en
      // CI pour bloquer une valeur précise sans l’écrire dans le dépôt).
      const secret = process.env.PCSTAR_FORBIDDEN_SECRET
      if (secret && text.includes(secret)) hits.push(rel + ' — secret interdit présent')
    }
    assert.deepEqual(hits, [], 'identifiants codés en dur :\n  ' + hits.join('\n  '))
  })


  it('GET /api/health ne divulgue plus l’e-mail du maître', async () => {
    const http = await import('node:http')
    // Base isolée POSÉE AVANT l'import : `server/db.js` résout `DATA_DIR` au
    // chargement du module (sinon la sonde écrirait dans server/data/).
    process.env.PCSTAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-health-'))
    const { handler } = await import('../server/index.js')
    const server = http.createServer(handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`)
      const data = await res.json()
      assert.equal(res.status, 200)
      assert.equal(data.ok, true)
      assert.equal(data.master, undefined, 'l’e-mail du maître est encore divulgué')
      assert.ok(
        !JSON.stringify(data).includes(TEST_MASTER_EMAIL),
        'l’e-mail du maître apparaît dans /api/health'
      )
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
