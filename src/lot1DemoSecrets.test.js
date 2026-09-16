/**
 * LOT 1.19 — les comptes de démonstration ne sont plus des identifiants publiés.
 *
 * État avant ce correctif (mesuré, pas supposé) : trois mots de passe étaient
 * codés en dur dans `server/db.js`, repris tels quels dans `src/shopStore.js`
 * (`DEMO_CUSTOMERS[].passwordPlain`), imprimés dans `README.md`, les trois
 * guides de démonstration et `.env.example` — donc livrés dans le bundle client
 * public. Le lot 1.2 avait traité le compte **maître** et laissé ces trois
 * comptes de côté (« leur retrait relève d'une décision produit ») ; la
 * vérification du « lot 0 » livré le 16/09 sur la branche
 * `arena/01a090f7-pc-star` (`docs/VERIFICATION-RAPPORT-LOT0.md` §4) a montré le
 * coût de ce statut intermédiaire : une rotation qui remplace un secret publié
 * par un autre secret publié, dans un dossier imbriqué que le scanner de l'époque
 * ne parcourait pas.
 *
 * Règle retenue, la même que pour le maître (lot 1.1) : le mot de passe vient de
 * `DEMO_PASSWORD`. Variable absente → les comptes sont seedés **verrouillés**
 * (`passwordHash: null`) et `POST /api/auth/login` répond `401 demo_locked`.
 *
 * Ce fichier couvre les comportements ; l'absence des valeurs littérales dans le
 * dépôt est couverte par `src/masterSecrets.test.js` (scanner récursif).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { TEST_DEMO_PASSWORD, TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// Racine du dépôt (les tests sont lancés depuis la racine).
const ROOT = path.resolve(process.cwd())

// Base temporaire isolée — ne touche jamais server/data/store.json.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-demo119-'))
process.env.PCSTAR_DATA_DIR = dir

const { demoPassword, demoPasswordHash, demoAccounts, emptyDb, normalizeDb, verifyPass, hashPassAsync, resetDbCache, updateDbAsync } =
  await import('../server/db.js')
// LOT 1.19 / §5.B du rapport lot 0 : la suppression du marqueur `demo: true`
// (voir plus bas) change ce que la garde S2 autorise — elle est testée ici.
const { startOAuth, completeDemo } = await import('../server/oauth.js')
const { handler } = await import('../server/index.js')
const { DEMO_CUSTOMERS, DEMO_LOCAL_PASSWORD, loginEmail, loadUsers, createMemoryStorage } = await import(
  './shopStore.js'
)

/** Les trois adresses de démonstration sont publiques (README) : pas un secret. */
const DEMO_EMAILS = ['karim.oran@demo.dz', 'amina.castors@demo.dz', 'yacine.pc@demo.dz']

/**
 * Bascule `DEMO_PASSWORD` le temps d'un bloc. `test-env.mjs` épingle la variable
 * pour toute la suite : sans restauration, un test « verrouillé » la laisserait
 * absente et les suivants échoueraient en cascade.
 */
async function withDemoPassword(value, fn) {
  const saved = process.env.DEMO_PASSWORD
  if (value === null) delete process.env.DEMO_PASSWORD
  else process.env.DEMO_PASSWORD = value
  try {
    return await fn()
  } finally {
    if (saved === undefined) delete process.env.DEMO_PASSWORD
    else process.env.DEMO_PASSWORD = saved
  }
}

/**
 * Une base issue de `emptyDb()` n'est pas encore « normalisée » : `normalizeDb`
 * pose `meta.demoSeeded`, `sessions`, `oauthPending`, etc. et renvoie donc
 * `true` au premier passage, quelle que soit la modification testée. On absorbe
 * ce premier passage pour que les assertions portent sur l'effet mesuré.
 */
function settledDb(mutate) {
  const db = emptyDb()
  normalizeDb(db)
  if (mutate) mutate(db)
  return db
}

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  new Promise((resolve) => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
})

async function post(pathname, body) {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

describe('LOT 1.19 — le seed suit DEMO_PASSWORD', () => {
  it('variable posée : trois comptes clients, empreinte de la variable', () => {
    const accounts = demoAccounts()
    assert.equal(accounts.length, 3)
    assert.deepEqual(
      accounts.map((a) => a.email).sort(),
      [...DEMO_EMAILS].sort()
    )
    for (const a of accounts) {
      // Ce sont des fixtures, pas des comptes privilégiés : le bug d'origine
      // tenait aussi à ce qu'ils ouvraient de vraies sessions sur l'API déployée.
      assert.equal(a.role, 'customer')
      assert.equal(a.demo, true)
      assert.equal(a.provider, 'email')
      assert.ok(a.passwordHash, 'une empreinte est posée')
      assert.equal(verifyPass(TEST_DEMO_PASSWORD, a.passwordHash), true, 'l’empreinte vient de la variable')
    }
  })

  it('variable absente : comptes verrouillés, aucun hash, aucune exception', async () => {
    await withDemoPassword(null, () => {
      assert.equal(demoPassword(), '')
      assert.equal(demoPasswordHash(), null)
      const accounts = demoAccounts()
      // Les comptes restent semés (le comptoir a des clients à afficher) mais
      // personne ne peut s'y connecter avec une valeur lue dans le dépôt.
      assert.equal(accounts.length, 3)
      for (const a of accounts) assert.equal(a.passwordHash, null)
    })
  })

  it('emptyDb() suit le même état (le seed n’est pas figé au chargement)', async () => {
    const seeded = emptyDb().users.filter((u) => u.demo === true)
    assert.equal(seeded.length, 3)
    assert.ok(seeded.every((u) => verifyPass(TEST_DEMO_PASSWORD, u.passwordHash)))

    const locked = await withDemoPassword(null, () => emptyDb().users.filter((u) => u.demo === true))
    assert.equal(locked.length, 3)
    assert.ok(locked.every((u) => u.passwordHash === null))
  })

  it('ids stables : la suppression d’un compte de démonstration ne le fait pas revenir', () => {
    // `normalizeDb` reconnaît les comptes par `id` OU `email` ; des ids aléatoires
    // rendraient l'alignement aveugle (bug voisin : `DELETE /api/customers/demo-karim`
    // renvoyait 200 et le compte revenait au chargement suivant).
    const ids = demoAccounts().map((a) => a.id)
    assert.deepEqual(ids, ['demo-karim', 'demo-amina', 'demo-yacine'])
    assert.deepEqual(ids, demoAccounts().map((a) => a.id), 'deux appels donnent les mêmes ids')
  })
})

describe('LOT 1.19 — normalizeDb aligne une base héritée', () => {
  it('une empreinte qui ne vérifie plus la variable est remplacée', async () => {
    // Cas réel : base constituée à l'époque où le mot de passe était codé en dur
    // (valeur publiée dans le README), puis `DEMO_PASSWORD` posé.
    const stale = await hashPassAsync('valeur-perimee-lot119')
    const db = settledDb((d) => {
      d.users.find((u) => u.email === 'karim.oran@demo.dz').passwordHash = stale
    })
    const changed = normalizeDb(db)
    assert.equal(changed, true, 'l’alignement est signalé comme changement')
    const karim = db.users.find((u) => u.email === 'karim.oran@demo.dz')
    assert.equal(verifyPass(TEST_DEMO_PASSWORD, karim.passwordHash), true)
    assert.equal(verifyPass('valeur-perimee-lot119', karim.passwordHash), false, 'l’ancienne valeur ne passe plus')
  })

  it('une empreinte déjà migrée en scrypt et correcte n’est pas dégradée', async () => {
    // P22 migre les hashes seedés en scrypt à la première connexion. Sans cette
    // exception, chaque normalisation réécrirait du sha256 non salé par-dessus.
    const migrated = await hashPassAsync(TEST_DEMO_PASSWORD)
    const db = settledDb((d) => {
      d.users.find((u) => u.email === 'amina.castors@demo.dz').passwordHash = migrated
    })
    const changed = normalizeDb(db)
    const amina = db.users.find((u) => u.email === 'amina.castors@demo.dz')
    assert.equal(amina.passwordHash, migrated, 'aucune réécriture')
    assert.ok(amina.passwordHash.startsWith('scrypt$'), 'l’empreinte scrypt est conservée')
    assert.equal(changed, false, 'rien n’a bougé → pas d’écriture disque en boucle')
  })

  it('variable retirée : verrouillage idempotent', async () => {
    await withDemoPassword(null, () => {
      const db = settledDb() // semée verrouillée, premier passage absorbé
      assert.equal(normalizeDb(db), false, 'déjà alignée : aucun changement')
      db.users.find((u) => u.email === 'yacine.pc@demo.dz').passwordHash = 'sha256$pcstar:reste'
      assert.equal(normalizeDb(db), true, 'un hash survivant est neutralisé')
      assert.equal(db.users.find((u) => u.email === 'yacine.pc@demo.dz').passwordHash, null)
      assert.equal(normalizeDb(db), false, 'second passage : plus rien à faire')
    })
  })

  it('un compte de démonstration revendiqué (flag `demo` retiré) n’est jamais touché', async () => {
    // Un client réel qui reprend l'adresse (OAuth) devient un compte ordinaire :
    // l'aligner sur `DEMO_PASSWORD` réinitialiserait son mot de passe à distance.
    const own = await hashPassAsync('mot-de-passe-du-client')
    const db = settledDb((d) => {
      const karim = d.users.find((u) => u.email === 'karim.oran@demo.dz')
      karim.demo = false
      karim.passwordHash = own
    })
    const changed = normalizeDb(db)
    const karim = db.users.find((u) => u.email === 'karim.oran@demo.dz')
    assert.equal(karim.passwordHash, own)
    assert.equal(verifyPass('mot-de-passe-du-client', karim.passwordHash), true)
    assert.equal(changed, false)
  })
})

describe('LOT 1.19 — connexion de démonstration via l’API', () => {
  it('variable absente : 401 demo_locked, pas un échec opaque', async () => {
    await withDemoPassword(null, async () => {
      resetDbCache() // la base doit être relue avec la variable absente
      const res = await post('/api/auth/login', {
        email: 'karim.oran@demo.dz',
        password: 'n-importe-quelle-valeur-publiee'
      })
      assert.equal(res.status, 401)
      assert.equal(res.data.ok, false)
      // Code dédié : l'exploitant qui suit le README comprend que l'état est
      // voulu, au lieu de chercher un mot de passe qui n'existe nulle part.
      assert.equal(res.data.error, 'demo_locked')
      assert.equal(res.data.token, undefined, 'aucune session ouverte')
    })
    resetDbCache()
  })

  it('variable posée : connexion réussie, rôle client, session ouverte', async () => {
    resetDbCache()
    const res = await post('/api/auth/login', {
      email: 'amina.castors@demo.dz',
      password: TEST_DEMO_PASSWORD
    })
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal(res.data.ok, true)
    assert.ok(res.data.token, 'un jeton est renvoyé')
    assert.equal(res.data.user.role, 'customer')
    assert.equal(res.data.user.email, 'amina.castors@demo.dz')
    // Le jeton n'est pas brut en base (durcissement des sessions, lot 4).
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'))
    assert.ok(
      Object.keys(store.sessions || {}).every((k) => !res.data.token.includes(k) || k.length !== res.data.token.length),
      'le jeton brut n’est pas une clé de session'
    )
  })

  it('variable posée mais mot de passe erroné : échec ordinaire, pas demo_locked', async () => {
    const res = await post('/api/auth/login', { email: 'amina.castors@demo.dz', password: 'mot-de-passe-errone' })
    assert.equal(res.status, 401)
    assert.notEqual(res.data.error, 'demo_locked', 'le compte est semé : ce n’est pas un verrou')
  })

  it('le compte maître reste indépendant de DEMO_PASSWORD', async () => {
    await withDemoPassword(null, async () => {
      resetDbCache()
      const res = await post('/api/auth/login', {
        email: TEST_MASTER_EMAIL,
        password: TEST_MASTER_PASSWORD
      })
      assert.equal(res.status, 200, JSON.stringify(res.data))
      assert.equal(res.data.user.role, 'master')
    })
    resetDbCache()
  })

  it('un compte de démonstration qui choisit son mot de passe cesse d’être aligné', async () => {
    // Régression mesurée : `normalizeDb` réaligne toute fixture encore marquée
    // `demo: true` sur `DEMO_PASSWORD`. Sans retrait du marqueur, le changement
    // annoncé 200 était **annulé** à la lecture suivante — P16 #13 échouait.
    const token = (
      await post('/api/auth/login', { email: 'karim.oran@demo.dz', password: TEST_DEMO_PASSWORD })
    ).data.token
    assert.ok(token, 'connexion initiale impossible')

    const res = await fetch(base + '/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: 'mot-de-passe-choisi', current: TEST_DEMO_PASSWORD })
    })
    assert.equal(res.status, 200, 'le changement légitime est refusé')

    resetDbCache() // force une relecture : c'est là que l'alignement frappait
    const again = await post('/api/auth/login', {
      email: 'karim.oran@demo.dz',
      password: 'mot-de-passe-choisi'
    })
    assert.equal(again.status, 200, 'le nouveau mot de passe ne survit pas à une relecture')
    const old = await post('/api/auth/login', { email: 'karim.oran@demo.dz', password: TEST_DEMO_PASSWORD })
    assert.equal(old.status, 401, 'la valeur d’environnement ne doit plus ouvrir ce compte')

    const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'))
    const karim = store.users.find((u) => u.email === 'karim.oran@demo.dz')
    assert.equal(karim.demo, false, 'le marqueur de fixture doit tomber')
    assert.equal(normalizeDb(structuredClone(store)), false, 'plus aucun réalignement à faire')
  })

  it('un reset posé par le maître n’est pas annulé par l’alignement', async () => {
    // Même mécanisme, autre porte d'entrée : P16 #14.
    const masterToken = (
      await post('/api/auth/login', { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD })
    ).data.token
    assert.ok(masterToken)
    const res = await fetch(base + '/api/master/customers/demo-yacine/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ password: 'tmp-2026-reset' })
    })
    assert.equal(res.status, 200)

    resetDbCache()
    const login = await post('/api/auth/login', { email: 'yacine.pc@demo.dz', password: 'tmp-2026-reset' })
    assert.equal(login.status, 200, 'le reset explicite n’a pas pris')
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'))
    assert.equal(store.users.find((u) => u.id === 'demo-yacine').demo, false)
  })
})

describe('LOT 1.19 — module client : plus de mot de passe publié', () => {
  it('DEMO_CUSTOMERS ne porte plus de passwordPlain', () => {
    assert.ok(DEMO_CUSTOMERS.length >= 3)
    for (const c of DEMO_CUSTOMERS) {
      assert.equal('passwordPlain' in c, false, `${c.email} expose encore un mot de passe`)
      assert.equal(c.password, undefined)
      assert.equal(c.passwordHash, undefined)
    }
    // Les trois adresses restent affichées (données de démonstration du comptoir).
    for (const email of DEMO_EMAILS) {
      assert.ok(DEMO_CUSTOMERS.some((c) => c.email === email), `${email} absent du module client`)
    }
  })

  it('la démo locale partage DEMO_LOCAL_PASSWORD et se connecte', () => {
    assert.equal(typeof DEMO_LOCAL_PASSWORD, 'string')
    assert.ok(DEMO_LOCAL_PASSWORD.length >= 6, 'assez long pour passer la validation locale')
    const users = loadUsers(createMemoryStorage())
    for (const email of DEMO_EMAILS) {
      const login = loginEmail(users, { email, password: DEMO_LOCAL_PASSWORD })
      assert.equal(login.ok, true, `${email} ne se connecte plus en démo locale`)
      assert.equal(login.user.role, 'customer')
    }
  })

  it('la valeur locale n’est pas celle de l’API (deux mondes, deux règles)', () => {
    // `DEMO_LOCAL_PASSWORD` n'ouvre rien sur un déploiement ; la confondre avec
    // `DEMO_PASSWORD` ferait croire qu'une valeur du bundle client est un secret.
    assert.notEqual(DEMO_LOCAL_PASSWORD, TEST_DEMO_PASSWORD)
    assert.equal(process.env.DEMO_PASSWORD, TEST_DEMO_PASSWORD, 'l’environnement de test épingle la variable')
  })
})

describe('LOT 1.19 — scripts de recette', () => {
  /**
   * `demoCredentials()` est exécuté en sous-processus : le module appelle
   * `loadEnv()` à l'import et `test-env.mjs` épingle `DEMO_PASSWORD` dans
   * CE processus — impossible d'y simuler l'absence de la variable.
   */
  it('variable posée : le couple e-mail / mot de passe est renvoyé', () => {
    const res = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import('./scripts/masterEnv.mjs').then((m) => process.stdout.write('RESULT:' + JSON.stringify(m.demoCredentials('sonde'))))"
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, DEMO_PASSWORD: 'sonde-pw' }, encoding: 'utf8' }
    )
    assert.equal(res.status, 0, res.stderr)
    const payload = JSON.parse(res.stdout.split('RESULT:')[1])
    assert.equal(payload.password, 'sonde-pw')
    assert.equal(payload.email, 'karim.oran@demo.dz')
  })

  it('variable absente : null, sans sortie brutale (la recette bascule sur un compte jetable)', () => {
    const res = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import('./scripts/masterEnv.mjs').then((m) => process.stdout.write('RESULT:' + JSON.stringify(m.demoCredentials('sonde'))))"
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8' }
    )
    assert.equal(res.status, 0, `le script ne doit pas sortir en erreur : ${res.stderr}`)
    assert.equal(res.stdout.split('RESULT:')[1], 'null')
    assert.match(res.stdout, /verrouillés/, 'l’état est expliqué sur la sortie standard')
  })

  it('smoke-e2e.mjs ne code plus d’identifiant en dur', () => {
    const text = fs.readFileSync(path.join(ROOT, 'scripts', 'smoke-e2e.mjs'), 'utf8')
    assert.match(text, /demoCredentials\(/, 'la recette passe par masterEnv.mjs')
    assert.match(text, /\/api\/auth\/register/, 'un repli existe pour l’état verrouillé')
    assert.doesNotMatch(text, /password:\s*['"][a-z]+\d{2}['"]/, 'aucun mot de passe littéral')
  })
})

describe('LOT 1.19 — documentation d’exploitation cohérente', () => {
  it('les deux états sont documentés là où l’exploitant les rencontre', () => {
    const deploy = fs.readFileSync(path.join(ROOT, 'docs', 'DEPLOY-VERCEL.md'), 'utf8')
    assert.match(deploy, /DEMO_PASSWORD/, 'le guide de déploiement nomme la variable')
    assert.match(deploy, /demo_locked/, 'le guide explique le code de réponse')
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    assert.match(envExample, /^\s*#\s*DEMO_PASSWORD=/m, 'l’exemple documente la variable (non posée par défaut)')
  })
})

describe('LOT 1.19 — gardes S1/S2 : ce que le marqueur `demo` autorise', () => {
  /**
   * Le rapport de vérification du lot 0 (`docs/VERIFICATION-RAPPORT-LOT0.md`
   * §5.B) demandait un test sur la garde S2 **avant** toute suppression de
   * `demo: true`. Ces tests n'existaient nulle part dans le dépôt : les deux
   * gardes (S1 « le maître n'entre jamais par OAuth », S2 « pas d'appropriation
   * d'un compte réel par simple e-mail ») étaient du code non couvert.
   */
  async function demoState(provider) {
    const started = await startOAuth(provider, { intent: 'login' })
    assert.equal(started.ok, true, 'le mode démo OAuth doit être actif (OAUTH_DEMO=1)')
    assert.equal(started.demo, true)
    return new URL(started.authorizeUrl, 'http://local').searchParams.get('state')
  }

  it('un compte marqué demo: true reste ouvrable par le fournisseur de démo', async () => {
    await updateDbAsync((db) => {
      db.users.push({
        id: 'demo-sonde',
        role: 'customer',
        email: 'sonde.demo@demo.dz',
        passwordHash: null,
        name: 'Sonde',
        phone: '0550000000',
        provider: 'email',
        links: { google: null, meta: null },
        demo: true
      })
      return db
    })
    const done = await completeDemo('google', await demoState('google'), {
      email: 'sonde.demo@demo.dz',
      name: 'Sonde'
    })
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal(done.user.email, 'sonde.demo@demo.dz')
    assert.ok(done.token, 'une session est ouverte')
  })

  it('S2 — un compte client ordinaire n’est pas appropriable par e-mail non vérifié', async () => {
    const email = `client-reel-${Date.now()}@exemple.dz`
    const reg = await post('/api/auth/register', { email, password: 'mot-de-passe-client', name: 'Client Réel' })
    assert.equal(reg.status, 201, JSON.stringify(reg.data)) // création → 201

    const done = await completeDemo('meta', await demoState('meta'), { email, name: 'Usurpateur' })
    assert.equal(done.ok, false)
    assert.equal(done.error, 'demo_email', 'la garde S2 doit nommer son refus')
    assert.equal(done.token, undefined, 'aucune session sur le compte d’autrui')
  })

  it('S1 — l’e-mail du maître n’entre jamais par OAuth', async () => {
    const done = await completeDemo('google', await demoState('google'), {
      email: TEST_MASTER_EMAIL,
      name: 'Usurpateur'
    })
    assert.equal(done.ok, false)
    assert.equal(done.error, 'master_email')
    assert.equal(done.token, undefined)
  })

  it('LOT 1.19 — dès que le titulaire choisit son mot de passe, le compte n’est plus appropriable', async () => {
    // Chaîne complète : le marqueur tombe (voir le test API plus haut), et la
    // garde S2 se referme sur ce compte — c'est l'effet de bord assumé du lot.
    const login = await post('/api/auth/login', { email: 'amina.castors@demo.dz', password: TEST_DEMO_PASSWORD })
    assert.equal(login.status, 200, JSON.stringify(login.data))
    const res = await fetch(base + '/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.data.token}` },
      body: JSON.stringify({ password: 'choisi-par-amina', current: TEST_DEMO_PASSWORD })
    })
    assert.equal(res.status, 200)

    resetDbCache()
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'))
    const amina = store.users.find((u) => u.email === 'amina.castors@demo.dz')
    assert.equal(amina.demo, false, 'précondition : le marqueur est tombé')

    const done = await completeDemo('meta', await demoState('meta'), {
      email: 'amina.castors@demo.dz',
      name: 'Usurpateur'
    })
    assert.equal(done.ok, false, 'un compte devenu réel ne s’ouvre plus par simple e-mail')
    assert.equal(done.error, 'demo_email')
  })
})
