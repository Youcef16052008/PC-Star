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

/**
 * LOT 1.19 — le scanner parcourt TOUT le dépôt, et pas cinq dossiers à un seul
 * niveau plus une liste fixe de sept documents.
 *
 * Deux angles morts mesurés le 16/09/2026 sur le « lot 0 » livré sur la branche
 * `arena/01a090f7-pc-star` (voir `docs/VERIFICATION-RAPPORT-LOT0.md` §4) :
 *
 *  1. les 19 fichiers posés dans un dossier imbriqué `PC-Star-main/` — dont un
 *     `src/shopStore.js` réexportant le mot de passe maître en clair et un
 *     `server/db.js` semant quatre empreintes codées en dur — laissaient ce
 *     scanner **vert (8/8)** : l'ancien `sourceFiles()` ne descendait jamais
 *     sous le premier niveau de `src server scripts api e2e` ;
 *  2. leur `README.md` et leur `docs/GUIDE-COMPTES.md`, posés à la racine avec
 *     un tableau `| Rôle | E-mail | Mot de passe |` publiant la paire réelle,
 *     le laissaient **vert aussi** : les règles ciblaient des formes de CODE
 *     (`MASTER = {…password`, `hashPassLegacy('…')`, `password: 'mot12'`),
 *     jamais une valeur publiée en prose, et la documentation était limitée à
 *     une liste fixe où `GUIDE-COMPTES*.md` n'existait pas.
 *
 * D'où : parcours récursif depuis la racine, extension du jeu de fichiers
 * suivis aux `.md`, et quatrième règle sur les tableaux de documentation.
 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-crawl',
  'coverage',
  '.preview-data',
  'data', // server/data : base locale + backups (déjà ignorés de git)
  'backups'
  // ⚠️ PAS `tmp-scanner-probe` : c'est le dossier où les contre-épreuves de ce
  // scanner posent un secret pour vérifier qu'il est **vu**. L'exclure rendrait
  // le test vert sans rien prouver. Il est ignoré de git (.gitignore) pour qu'un
  // test interrompu ne laisse pas un fichier suivi — le `finally` le supprime.
])
const SCANNED_EXT = /\.(js|jsx|mjs|cjs|json|md)$/

/**
 * Documentation qui **cite l'historique** : rapports d'audit, plan de
 * correction, journal des bugs. Leur objet est de reproduire les valeurs
 * compromises et le code fautif — les exclure n'est pas un angle mort mais une
 * nécessité, à condition que la liste reste courte, nominative et vérifiée
 * (un test impose la convention de nommage : un nouveau document publié ne peut
 * pas s'y glisser).
 */
const HISTORIQUE = new Set([
  'docs/VERIFICATION-RAPPORT-AUDIT.md',
  'docs/VERIFICATION-RAPPORT-AUDIT-2.md',
  'docs/VERIFICATION-RAPPORT-AUDIT-3.md',
  'docs/VERIFICATION-RAPPORT-LOT0.md',
  'docs/BUGS-AND-FIXES.md',
  'docs/PLAN-CORRECTIONS.md'
])

/** @returns {string[]} chemins relatifs (séparateur `/`) des fichiers suivis. */
function trackedFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Les fichiers/dossiers cachés sont hors périmètre, SAUF `.env.example`
    // (documenté, publié) et `.github` (workflows : ils pourraient poser une
    // valeur en dur).
    if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.github') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      trackedFiles(full, out)
      continue
    }
    if (!SCANNED_EXT.test(entry.name)) continue
    if (entry.name === 'package-lock.json') continue // 100 Ko de résolutions npm
    const rel = path.relative(ROOT, full).split(path.sep).join('/')
    if (rel === 'src/masterSecrets.test.js') continue // ce scanner lui-même
    if (HISTORIQUE.has(rel)) continue
    out.push(rel)
  }
  return out
}

const SEP_CELL = /^:?-{2,}:?$/

/**
 * Quatrième règle — une documentation **publiée** ne doit pas imprimer de mot de
 * passe dans un tableau. Cible la forme exacte du README, des guides de
 * démonstration et du `GUIDE-COMPTES.md` de la branche lot 0 :
 * `| Rôle | E-mail | Mot de passe |` suivi d'un séparateur, puis une valeur
 * littérale dans la colonne mot de passe.
 *
 * Sont admis : un emplacement réservé en italique (`_variable MASTER_PASSWORD_`,
 * _not published_) et une cellule qui nomme la variable d'environnement ou
 * l'état verrouillé. Tout le reste — `` `mot12` ``, `Czyx8f9g2jK3mWZ5R2Tn`,
 * `star31` — est signalé.
 *
 * L'en-tête n'est reconnu **que** si la ligne suivante est un séparateur :
 * sans cette condition, toute ligne de prose contenant le mot « password »
 * devenait un en-tête et signalait des cellules sans rapport (mesuré sur
 * `docs/ARCHITECTURE.md`, `docs/SECURITY-AUDIT.md`, `docs/BUGS-AND-FIXES.md`).
 */
function passwordTableCells(text) {
  const hits = []
  const lines = text.split('\n')
  let col = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed.startsWith('|')) {
      col = -1
      continue
    }
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim())
    const next = (lines[i + 1] || '').trim()
    const nextCells = next.startsWith('|') ? next.split('|').slice(1, -1).map((c) => c.trim()) : []
    const nextIsSeparator = nextCells.length > 1 && nextCells.every((c) => SEP_CELL.test(c))
    if (nextIsSeparator) {
      col = cells.findIndex((c) => /mot de passe|password|كلمة المرور/i.test(c))
      i++ // le séparateur n'est pas une ligne de données
      continue
    }
    if (col < 0 || cells.length <= col) continue
    const cell = cells[col]
    if (!cell) continue
    if (/^_.+_$/.test(cell)) continue
    if (/variable|env\b|DEMO_PASSWORD|MASTER_PASSWORD|DEMO_LOCAL_PASSWORD|not published|locked|verrouill/i.test(cell)) continue
    hits.push(cell)
  }
  return hits
}

/**
 * Balayage complet.
 *
 * @param {{forbid?: string[]}} [opts] valeurs supplémentaires à interdire. Le
 *   crochet d'origine lisait `PCSTAR_FORBIDDEN_SECRET` (utile en CI pour bloquer
 *   une valeur précise sans l'écrire dans le dépôt) ; il est conservé et
 *   complété par `PCSTAR_FORBIDDEN_SECRETS` (liste séparée par des virgules), et
 *   un test vérifie que le crochet **fonctionne** — un verrou non testé est un
 *   verrou supposé.
 * @returns {string[]} coups trouvés, `chemin — motif`.
 */
function scanRepo({ forbid = [] } = {}) {
  // Les motifs sont ASSEMBLÉS à l'exécution : écrits littéralement dans ce
  // fichier, ils se détecteraient eux-mêmes.
  const P = (parts, flags) => new RegExp(parts.join(''), flags)
  // Classe de caractères « guillemet simple ou double », sans l'écrire ici.
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
      // Forme du secret compromis (mot + 2 chiffres). LOT 1.19 : plus AUCUNE
      // exemption — ni `src/shopStore.js` (le mot de passe du maître et ceux des
      // trois comptes de démonstration en ont disparu), ni les fichiers de
      // tests (ils lisent `scripts/test-env.mjs`).
      // LOT 1.19 : la clé n'est pas seulement `password` — le bundle client
      // publiait les trois comptes sous `passwordPlain` (`DEMO_CUSTOMERS`), une
      // forme que `pass` + `word` + `:` ne voyait pas. D'où `pass\w*`, qui
      // couvre `password`, `passwordPlain`, `passwordHash`, `pass`… sans élargir
      // au point de signaler du texte ordinaire (mesuré : 0 faux positif sur les
      // 146 fichiers suivis).
      nom: 'mot de passe littéral en forme « mot + 2 chiffres »',
      re: P(['pass', '\\w*', '\\s*:\\s*', QC, '[a-z]+\\d{2}', QC], 'i')
    },
    {
      // LOT 1.19 — la forme de régression la plus probable : « remettre une
      // valeur de repli pour que la démo marche sans configuration ». Mesurée
      // en neutralisation N58 : `String(process.env.DEMO_PASSWORD || '…')`
      // réintroduisait un mot de passe publié sans déclencher les trois règles
      // précédentes (aucune n'était en position d'assignation).
      //
      // Un repli sur une chaîne **vide** reste admis : c'est le comportement
      // voulu (comptes verrouillés, maître refusé au démarrage).
      nom: 'repli littéral sur une variable d’environnement *PASSWORD*',
      re: P(['\\w*', 'PASSWORD', '\\w*', '\\s*\\|\\|\\s*', QC, NOTQ, QC])
    }
  ]
  const interdits = [
    ...forbid,
    ...(process.env.PCSTAR_FORBIDDEN_SECRET ? [process.env.PCSTAR_FORBIDDEN_SECRET] : []),
    ...(process.env.PCSTAR_FORBIDDEN_SECRETS || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  ].filter(Boolean)

  const hits = []
  for (const rel of trackedFiles()) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const rule of rules) {
      if (rule.re.test(text)) hits.push(rel + ' — ' + rule.nom)
    }
    if (/\.md$/.test(rel)) {
      const cells = passwordTableCells(text)
      for (const cell of cells) hits.push(rel + ' — mot de passe publié dans un tableau : ' + cell)
    }
    for (const value of interdits) {
      if (text.includes(value)) hits.push(rel + ' — valeur interdite présente')
    }
  }
  return hits
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

describe('LOT 1.2 + 1.19 — aucun identifiant publié dans le dépôt', () => {
  it('les valeurs de test ne sont littérales nulle part (elles viennent de l’env)', () => {
    // Garde-fou sur ce test lui-même : s'il contenait le secret en dur, il
    // cesserait de protéger quoi que ce soit.
    assert.ok(TEST_MASTER_EMAIL.includes('@test.'), 'l’e-mail de test doit être jetable')
  })

  it('aucun fichier suivi — code, doc publiée, dossier imbriqué compris — ne contient d’identifiant codé en dur', () => {
    const hits = scanRepo()
    assert.deepEqual(hits, [], 'identifiants codés en dur :\n  ' + hits.join('\n  '))
  })

  it('le parcours est récursif : un secret posé dans un dossier imbriqué est vu', () => {
    // Contre-épreuve de l'angle mort n° 1 : le « lot 0 » du 16/09 avait posé 19
    // fichiers sous `PC-Star-main/`, hors de portée de l'ancien parcours.
    const dir = path.join(ROOT, 'tmp-scanner-probe', 'sous-dossier', 'src')
    const file = path.join(dir, 'shopStore.js')
    fs.mkdirSync(dir, { recursive: true })
    try {
      fs.writeFileSync(
        file,
        [
          'export const ' + 'MASTER' + ' = {',
          "  password: 'mot12'",
          '}',
          // Forme N58 : un repli littéral sur la variable d'environnement.
          'export function demoPass' + 'word() {',
          "  return String(process.env.DEMO_" + "PASSWORD || 'sonde31')",
          '}'
        ].join('\n') + '\n'
      )
      const hits = scanRepo()
      const sonde = hits.filter((h) => h.startsWith('tmp-scanner-probe/sous-dossier/src/shopStore.js'))
      assert.ok(sonde.length >= 1, 'le dossier imbriqué n’est pas parcouru : ' + JSON.stringify(hits))
      assert.deepEqual(
        sonde.map((h) => h.split(' — ')[1]).sort(),
        [
          'mot de passe littéral en forme « mot + 2 chiffres »',
          'objet ' + 'MASTER' + ' avec mot de passe',
          'repli littéral sur une variable d’environnement *' + 'PASSWORD*'
        ].sort(),
        'les trois règles attendues tombent sur la sonde : ' + sonde.join(' ; ')
      )
    } finally {
      fs.rmSync(path.join(ROOT, 'tmp-scanner-probe'), { recursive: true, force: true })
    }
    assert.deepEqual(scanRepo(), [], 'la sonde supprimée, le dépôt est propre')
  })

  it('un mot de passe publié dans un tableau de documentation est vu', () => {
    // Contre-épreuve de l'angle mort n° 2 : la forme exacte du `README.md` et du
    // `GUIDE-COMPTES.md` de la branche lot 0.
    const rel = 'docs/ZZ-sonde-scanner.md'
    const file = path.join(ROOT, rel)
    fs.writeFileSync(
      file,
      [
        '# Sonde',
        '',
        '| Rôle | E-mail | Mot de passe |',
        '|------|-------|--------------|',
        '| **Admin** | `admin@example.com` | `Czyx8f9g2jK3mWZ5R2Tn` |',
        '| Client | `client@example.com` | _variable `DEMO_PASSWORD`, ou verrouillé_ |',
        ''
      ].join('\n')
    )
    try {
      const hits = scanRepo()
      assert.equal(hits.length, 1, 'une seule ligne signalée : ' + JSON.stringify(hits))
      assert.ok(hits[0].startsWith(rel + ' — mot de passe publié'), hits[0])
      assert.ok(hits[0].includes('Czyx8f9g2jK3mWZ5R2Tn'), 'la valeur publiée est nommée')
    } finally {
      fs.rmSync(file, { force: true })
    }
    assert.deepEqual(scanRepo(), [], 'la sonde supprimée, le dépôt est propre')
  })

  it('le crochet « valeur interdite » fonctionne (verrou testé, pas supposé)', () => {
    const rel = 'docs/ZZ-sonde-interdit.md'
    const file = path.join(ROOT, rel)
    const valeur = 'valeur-interdite-sondee'
    fs.writeFileSync(file, `# Sonde\n\nLe mot de passe est ${valeur}.\n`)
    try {
      assert.deepEqual(scanRepo(), [], 'sans le crochet, la valeur n’est pas devinable')
      const hits = scanRepo({ forbid: [valeur] })
      assert.deepEqual(hits, [rel + ' — valeur interdite présente'])
      process.env.PCSTAR_FORBIDDEN_SECRETS = valeur
      try {
        assert.deepEqual(scanRepo(), [rel + ' — valeur interdite présente'], 'variable d’environnement lue')
      } finally {
        delete process.env.PCSTAR_FORBIDDEN_SECRETS
      }
    } finally {
      fs.rmSync(file, { force: true })
    }
  })

  it('l’exemption « historique » reste courte, nominative et vérifiable', () => {
    // Sans ce garde-fou, le moyen le plus simple de faire taire le scanner
    // serait d'ajouter un fichier à la liste — y compris un document publié.
    const liste = [...HISTORIQUE]
    assert.ok(liste.length >= 4 && liste.length <= 8, `liste bornée (${liste.length})`)
    for (const rel of liste) {
      assert.match(rel, /^docs\//, 'uniquement sous docs/')
      assert.match(
        path.basename(rel),
        /^(VERIFICATION-RAPPORT-|PLAN-CORRECTIONS|BUGS-AND-FIXES)/,
        `${rel} n'est pas un rapport d'audit, le plan de corrections ou le journal des bugs`
      )
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} n'existe pas (entrée morte)`)
    }
    // Réciproque, limitée aux deux familles qui sont **par nature** des
    // documents d'historique : un rapport de vérification et le journal des
    // bugs citent forcément les valeurs compromises. (`PLAN-DESIGN-TERMINAL-
    // CYBER.md` porte le préfixe `PLAN-` sans être un document d'audit : la
    // réciproque ne s'applique qu'au plan de corrections, exempté nominativement
    // parce que sa note de vérification du lot 0 cite le code fautif.)
    for (const rel of trackedFiles()) {
      if (!/^(VERIFICATION-RAPPORT-|BUGS-AND-FIXES)/.test(path.basename(rel))) continue
      assert.ok(HISTORIQUE.has(rel), `${rel} est un document d'historique non exempté`)
    }
  })

  it('les documents publiés renvoient aux variables d’environnement', () => {
    // LOT 1.19 : le README et les trois guides nommaient les mots de passe des
    // comptes de démonstration. Ils doivent désormais renvoyer à la variable.
    for (const rel of ['README.md', 'docs/GUIDE-DEMO.md', 'docs/GUIDE-DEMO-FR.md', 'docs/GUIDE-DEMO-AR.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      assert.ok(text.includes('DEMO_PASSWORD'), `${rel} ne mentionne pas DEMO_PASSWORD`)
      assert.ok(text.includes('MASTER_PASSWORD'), `${rel} ne mentionne pas MASTER_PASSWORD`)
    }
    assert.ok(
      fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').includes('DEMO_PASSWORD'),
      '.env.example ne documente pas la variable'
    )
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
