import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD, TEST_DEMO_PASSWORD } from '../scripts/test-env.mjs'
import { ordersToCsv, sanitizeProductPatch, updateProduct } from '../server/masterApi.js'
import { demoConsentHtml, safeReturnUrl } from '../server/oauth.js'
import crypto from 'node:crypto'
import { hashPassAsync, verifyPass } from '../server/db.js'

// ---------------------------------------------------------------------------
// LOT 1 — corrections SERVEUR.
//
// Chaque test ci-dessous reproduit d'abord le comportement fautif décrit dans
// docs/VERIFICATION-RAPPORT-AUDIT-2.md, puis vérifie la correction :
//
//  1.5  un changement de mot de passe laissait les AUTRES sessions valides
//  1.6  /api/auth/register, /api/me, /api/me/password sans rate-limit, et
//       `scryptSync` sur le thread principal à chaque inscription
//  1.7  `state` interpolé sans échappement dans la page de consentement démo
//  1.8  export CSV : `=HYPERLINK(…)` / `+cmd|…` repris tels quels
//  1.9  `wilaya`, `slot`, `name` de commande acceptés sans validation
//  1.11 photo Blob : l'URL CDN brute stockée en base et servie au client
//  1.12 `price: 0` accepté au patch produit (alors que `createProduct` refuse)
//  1.13 repli OAuth : `FRONT_URL` brut concaténé dans un `Location` à token
//  1.14 branche legacy de `verifyPass` comparée avec `===`
//  1.15 /api/oauth/start sans limite ; `intent:'link'` sans session accepté
//  1.18 `FRONT_URL` sans schéma rejetait silencieusement tout returnUrl valide
//
// Les limites de débit étant en mémoire PAR PROCESSUS (server/rateLimit.js), les
// tests qui les épuisent tournent contre des serveurs ENFANTS dédiés : dans le
// processus du runner, `server/index.js` est déjà chargé par d'autres fichiers
// de test avec leur propre base, et les compteurs seraient partagés.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Démarre un serveur enfant isolé (base + compteurs de débit propres). */
async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot1-'))
  const portFile = path.join(dir, 'port')
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import ${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'scripts', 'test-env.mjs'))))}\n` +
        `import http from 'node:http'\n` +
        `import fs from 'node:fs'\n` +
        `const { handler } = await import(${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'server', 'index.js'))))})\n` +
        `const srv = http.createServer(handler)\n` +
        `srv.listen(0, '127.0.0.1', () => {\n` +
        `  fs.writeFileSync(${JSON.stringify(portFile)}, String(srv.address().port))\n` +
        `})\n` +
        `setInterval(() => {}, 1 << 30)\n`
    ],
    {
      env: {
        ...process.env,
        PCSTAR_DATA_DIR: dir,
        DATABASE_URL: '',
        BLOB_READ_WRITE_TOKEN: '',
        WHATSAPP_TOKEN: '',
        WHATSAPP_PHONE_NUMBER_ID: '',
        OAUTH_DEMO: '1',
        FRONT_URL: '',
        FRONT_ORIGIN: '',
        OAUTH_REDIRECT_BASE: '',
        VERCEL_URL: '',
        TRUST_PROXY: '',
        MASTER_EMAIL: TEST_MASTER_EMAIL,
        MASTER_PASSWORD: TEST_MASTER_PASSWORD
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += String(d)
  })
  child.stdout.resume()

  const t0 = Date.now()
  while (!fs.existsSync(portFile)) {
    if (child.exitCode !== null) throw new Error(`serveur enfant mort (code ${child.exitCode}) : ${stderr.slice(0, 500)}`)
    if (Date.now() - t0 > 20000) throw new Error(`serveur enfant non démarré : ${stderr.slice(0, 500)}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  const base = `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').trim()}`
  return {
    base,
    dir,
    stop: () =>
      new Promise((resolve) => {
        child.once('exit', resolve)
        child.kill('SIGKILL')
      })
  }
}

async function call(base, method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data, headers: res.headers }
}

async function register(base, email, password = 'secret-1') {
  return call(base, 'POST', '/api/auth/register', { body: { email, password } })
}

/** Produit du catalogue de base toujours en stock (voir apiServer.test.js). */
const IN_STOCK_ID = 'cpu-7800x3d'

function orderBody(over = {}) {
  return {
    name: 'Client Test',
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '12:30',
    items: [{ id: IN_STOCK_ID, sku: 'X', name: 'CPU', qty: 1 }],
    ...over
  }
}

// ---------------------------------------------------------------------------
// Serveur A — sémantique (sessions, validation, CSV, prix, OAuth)
// ---------------------------------------------------------------------------
let A = null
// ---------------------------------------------------------------------------
// Serveur B — épuisement des rate-limits (compteurs détruits avec le processus)
// ---------------------------------------------------------------------------
let B = null

before(async () => {
  A = await startServer()
  B = await startServer()
})

after(async () => {
  for (const s of [A, B]) {
    try {
      await s?.stop()
      if (s?.dir) fs.rmSync(s.dir, { recursive: true, force: true })
    } catch {
      /* déjà arrêté */
    }
  }
})

describe('LOT 1.5 — un changement de mot de passe révoque les autres sessions', () => {
  it('l’ancien token d’un AUTRE appareil renvoie 401, la session courante survit', async () => {
    const email = `revok-${Date.now()}@test.dz`
    const reg = await register(A.base, email, 'ancien-mdp')
    assert.equal(reg.status, 201, JSON.stringify(reg.data))
    const tokenA = reg.data.token

    // Second appareil : même compte, autre session.
    const login = await call(A.base, 'POST', '/api/auth/login', {
      body: { email, password: 'ancien-mdp' }
    })
    assert.equal(login.status, 200)
    const tokenB = login.data.token
    assert.notEqual(tokenA, tokenB, 'deux sessions distinctes')

    // Avant le correctif : les deux tokens restaient valides indéfiniment.
    assert.equal((await call(A.base, 'GET', '/api/me', { token: tokenB })).status, 200)

    const changed = await call(A.base, 'POST', '/api/me/password', {
      token: tokenA,
      body: { password: 'nouveau-mdp', current: 'ancien-mdp' }
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.data))
    assert.equal(changed.data.ok, true)
    assert.equal(changed.data.revoked, 1, 'le nombre de sessions révoquées est remonté')

    assert.equal(
      (await call(A.base, 'GET', '/api/me', { token: tokenB })).status,
      401,
      'le token volé/ancien doit être mort'
    )
    assert.equal(
      (await call(A.base, 'GET', '/api/me', { token: tokenA })).status,
      200,
      'la session qui vient de saisir le mot de passe reste ouverte'
    )
    // Et le nouveau mot de passe fonctionne.
    const relogin = await call(A.base, 'POST', '/api/auth/login', {
      body: { email, password: 'nouveau-mdp' }
    })
    assert.equal(relogin.status, 200)
  })

  it('le reset maître révoque TOUTES les sessions du compte visé', async () => {
    const email = `reset-${Date.now()}@test.dz`
    const reg = await register(A.base, email, 'ancien-mdp')
    assert.equal(reg.status, 201)
    const userToken = reg.data.token
    const userId = reg.data.user.id

    const master = await call(A.base, 'POST', '/api/auth/login', {
      body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
    })
    assert.equal(master.status, 200, 'connexion maître')

    const reset = await call(A.base, 'POST', `/api/master/customers/${userId}/reset-password`, {
      token: master.data.token,
      body: { password: 'pose-par-le-maitre' }
    })
    assert.equal(reset.status, 200, JSON.stringify(reset.data))
    assert.equal(reset.data.revoked, 1)
    assert.equal(
      (await call(A.base, 'GET', '/api/me', { token: userToken })).status,
      401,
      'un reset maître sert à reprendre un compte compromis : aucune session ne doit survivre'
    )
  })

  it('le mot de passe posé est haché en scrypt, jamais en clair sur disque', async () => {
    const raw = fs.readFileSync(path.join(A.dir, 'store.json'), 'utf8')
    assert.ok(raw.includes('scrypt$'), 'au moins un hash scrypt en base')
    assert.ok(!raw.includes('nouveau-mdp'), 'mot de passe en clair écrit sur disque')
    assert.ok(!raw.includes('pose-par-le-maitre'), 'mot de passe posé par le maître en clair')
    assert.ok(!raw.includes('"_lastAuth"'), 'aucun token de session persisté (S3)')
  })
})

describe('LOT 1.6 — hachage asynchrone hors du thread principal', () => {
  it('hashPassAsync produit le même format que hashPass et se vérifie', async () => {
    const h = await hashPassAsync('mot-de-passe')
    assert.match(h, /^scrypt\$[0-9a-f]{16}\$[0-9a-f]{64}$/, `format inattendu : ${h}`)
    assert.equal(verifyPass('mot-de-passe', h), true)
    assert.equal(verifyPass('autre', h), false)
    // Deux appels → deux sels distincts (pas de hash déterministe).
    const h2 = await hashPassAsync('mot-de-passe')
    assert.notEqual(h, h2)
    assert.equal(verifyPass('mot-de-passe', h2), true)
  })

  it('les routes coûteuses passent par hashPassAsync, pas par scryptSync', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
    // `hashPass` synchrone ne doit plus apparaître que dans l'import… et nulle
    // part ailleurs : le seed du maître est dans server/db.js, au chargement.
    assert.ok(src.includes('hashPassAsync'), 'hashPassAsync importé')
    // `hashPass(` nu = `scryptSync`. Ni `hashPassAsync(` ni `hashPassLegacy(`
    // (sha256, non bloquant) ne doivent matcher.
    assert.ok(
      !/(?<!Async)(?<!Legacy)\bhashPass\(/.test(src),
      'un appel synchrone `hashPass(` subsiste dans une route HTTP'
    )
    const occurrences = src.split('hashPassAsync(').length - 1
    assert.ok(
      occurrences >= 4,
      `attendu ≥ 4 appels (register, migration au login, password, reset) : ${occurrences}`
    )
  })

  it('les comptes seedés se connectent, et leur empreinte migre en scrypt', async () => {
    // Garde-fou sur la migration P22 (item 1), dont le hachage vient de passer
    // en asynchrone hors du mutateur : les comptes seedés (maître + trois
    // démos) sont stockés en sha256 non salé et dépendent de la DERNIÈRE
    // branche de `verifyPass` — exactement celle que 1.14 a réécrite.
    const seed = async (email, password) => {
      const r = await call(A.base, 'POST', '/api/auth/login', { body: { email, password } })
      assert.equal(r.status, 200, `${email} → ${r.status} ${JSON.stringify(r.data)}`)
      return r.data.token
    }
    const masterToken = await seed(TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD)
    assert.equal((await call(A.base, 'GET', '/api/me', { token: masterToken })).data.user.role, 'master')
    // Les trois comptes de démonstration (conservés comme fixtures, lot 1.3).
    // LOT 1.19 : leur mot de passe n'est plus un littéral du dépôt — il vient de
    // `DEMO_PASSWORD`, épinglé par `scripts/test-env.mjs`.
    for (const email of ['karim.oran@demo.dz', 'amina.castors@demo.dz', 'yacine.pc@demo.dz']) {
      const token = await seed(email, TEST_DEMO_PASSWORD)
      const me = await call(A.base, 'GET', '/api/me', { token })
      assert.equal(me.data.user.role, 'customer', `${email} ne doit pas être privilégié`)
    }

    // La migration a bien eu lieu : plus aucune empreinte seedée non salée.
    const raw = fs.readFileSync(path.join(A.dir, 'store.json'), 'utf8')
    const db = JSON.parse(raw)
    for (const u of db.users) {
      assert.ok(
        String(u.passwordHash || '').startsWith('scrypt$'),
        `${u.email} encore en empreinte non salée après connexion`
      )
    }
    // Et la seconde connexion ne re-hache pas (sinon : un scrypt par login).
    const before = JSON.parse(fs.readFileSync(path.join(A.dir, 'store.json'), 'utf8')).users
    await seed(TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD)
    const after = JSON.parse(fs.readFileSync(path.join(A.dir, 'store.json'), 'utf8')).users
    const master = (list) => list.find((u) => u.email === TEST_MASTER_EMAIL).passwordHash
    assert.equal(master(after), master(before), 'empreinte re-hachée à chaque connexion')
  })

  it('le hachage n’a pas lieu DANS le mutateur de base', () => {
    // Un `await` inside `updateDbAsync` retiendrait le verrou d'écriture pendant
    // les ~35 ms du scrypt : le gain de l'asynchrone serait annulé.
    const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
    const anchor = 'await hashPassAsync(next)'
    let at = src.indexOf(anchor)
    let checked = 0
    while (at > 0) {
      // LOT 1.19 : la fenêtre de 1 500 caractères était un **nombre magique**
      // qui a fini par casser tout seul — la route /api/me/password porte
      // désormais deux blocs de commentaire entre le calcul du hash et son
      // mutateur (révocation des sessions, lot 1.5 ; retrait du marqueur
      // `demo`, lot 1.19) et le mutateur sortait de la fenêtre. Le verrou est
      // exprimé sans fenêtre : entre le hash et la fin du fichier, le premier
      // `updateDbAsync` doit précéder le premier `return db`. Si le hash était
      // DANS le mutateur, le premier `return db` rencontré serait celui de ce
      // mutateur et le premier `updateDbAsync` suivant serait celui de la route
      // d'après — l'ordre s'inverse et le test rougit (vérifié en neutralisation
      // N67).
      const after = src.slice(at)
      const mutator = after.indexOf('updateDbAsync')
      assert.ok(mutator > 0, 'le mutateur suit le calcul du hash')
      assert.ok(
        mutator < after.indexOf('return db'),
        'hashPassAsync appelé DANS le mutateur (verrou d’écriture tenu ~35 ms)'
      )
      checked += 1
      at = src.indexOf(anchor, at + 1)
    }
    assert.equal(checked, 2, 'les deux routes (changement + reset maître) sont vérifiées')

    // La migration de hash du login (P22 item 1) était le troisième appelant
    // synchrone : `hashPass(password)` DANS le mutateur, à chaque connexion
    // d'un compte seedé.
    assert.ok(
      src.includes('const migratedHash = needsRehash ? await hashPassAsync(password) : null'),
      'la migration au login est calculée avant le mutateur'
    )
    const migrationAt = src.indexOf('const migratedHash')
    assert.ok(
      src.indexOf('updateDbAsync', migrationAt) < src.indexOf('return d', migrationAt),
      'la migration ne doit pas retenir le verrou d’écriture'
    )
  })
})

describe('LOT 1.7 — la page de consentement démo échappe ses interpolations', () => {
  const PAYLOAD = '"><img src=x onerror=alert(1)>'

  it('demoConsentHtml ne produit aucune balise à partir de `state`', () => {
    const html = demoConsentHtml('google', PAYLOAD)
    assert.ok(!html.includes('<img'), 'balise <img> injectée')
    // Le texte du handler subsiste forcément (échappé) : ce qui compte est
    // qu'il ne puisse plus sortir de l'attribut — donc aucune guillemet ni
    // chevron brut issu de la charge utile.
    assert.ok(!/"\s*onerror=/.test(html), 'la charge utile sort de l’attribut')
    // La valeur doit être présente, mais échappée : le flux OAuth continue de
    // fonctionner (le `state` revient intact au POST).
    assert.ok(html.includes('&quot;&gt;&lt;img'), `échappement attendu, obtenu : ${html.slice(0, 200)}`)
    assert.ok(html.includes('name="state"'), 'le champ caché existe toujours')
  })

  it('les autres interpolations sont échappées elles aussi', () => {
    const html = demoConsentHtml('meta', PAYLOAD)
    assert.ok(!html.includes('<img'), 'provider meta')
    // `label`, `color` : littéraux internes, mais passés par la même fonction —
    // plus personne n'a à décider quels interpolateurs sont « sûrs ».
    assert.match(html, /<title>Lier [^<]*· PC Star<\/title>/)
  })

  it('la route réelle ne renvoie aucune balise injectée', async () => {
    const res = await fetch(`${A.base}/api/oauth/google/demo?state=${encodeURIComponent(PAYLOAD)}`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(!html.includes('<img'), 'balise injectée via le query param')
    assert.ok(!/<script/i.test(html), 'balise script injectée')
  })

  it('un `state` absent ne casse pas la page', () => {
    const html = demoConsentHtml('google', null)
    assert.ok(html.includes('name="state" value=""'), 'champ vide, pas « null »')
  })
})

describe('LOT 1.8 — export CSV : injection de formule neutralisée', () => {
  const cells = (row) => row.split(',')

  it('=HYPERLINK(…) est préfixé et ne peut plus être interprété', () => {
    const csv = ordersToCsv([
      {
        code: 'PS-20260915-0001',
        status: 'new',
        at: '2026-09-15T10:00:00.000Z',
        name: '=HYPERLINK("http://evil.dz";"cliquez")',
        phone: '0550123456',
        carrier: 'ooredoo',
        wilaya: 'Oran',
        slot: '12:30',
        total: 100,
        items: [{ qty: 1, name: 'CPU' }]
      }
    ])
    const line = csv.split('\n')[1]
    assert.ok(line.includes("'="), `cellule préfixée d'une apostrophe : ${line}`)
    // Aucune cellule ne doit COMMENCER par `=` une fois le CSV parsé.
    for (const cell of cells(line)) {
      const bare = cell.replace(/^"|"$/g, '')
      assert.ok(!bare.startsWith('='), `cellule encore interprétable : ${cell}`)
    }
  })

  it('les quatre vecteurs (= + - @) et tabulation/CR sont couverts', () => {
    for (const payload of ['=1+1', '+cmd|/C calc', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      const csv = ordersToCsv([
        { code: 'C1', status: 'new', at: '', name: payload, phone: '', carrier: '', wilaya: '', slot: '', total: 0, items: [] }
      ])
      const nameCell = csv.split('\n')[1].split(',')[3]
      assert.ok(nameCell.startsWith("'") || nameCell.startsWith('"\''), `${JSON.stringify(payload)} → ${nameCell}`)
    }
  })

  it('les valeurs normales ne sont pas altérées', () => {
    const csv = ordersToCsv([
      { code: 'PS-20260915-0002', status: 'new', at: 'x', name: 'Karim B.', phone: '0550123456', carrier: 'ooredoo', wilaya: 'Oran', slot: '12:30', total: 12500, items: [{ qty: 2, name: 'RAM' }] }
    ])
    const line = csv.split('\n')[1]
    assert.ok(line.includes('Karim B.'), `nom intact : ${line}`)
    assert.ok(!line.includes("'Karim"), 'pas d’apostrophe parasite')
    assert.ok(line.includes('2x RAM'), 'ligne d’article intacte')
  })

  it('de bout en bout : la commande piégée ressort neutralisée de la route', async () => {
    const master = await call(A.base, 'POST', '/api/auth/login', {
      body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
    })
    const placed = await call(A.base, 'POST', '/api/orders', {
      body: orderBody({ name: '=HYPERLINK("http://evil.dz";"x")'.slice(0, 60) })
    })
    assert.equal(placed.status, 201, JSON.stringify(placed.data))
    const res = await fetch(`${A.base}/api/orders/export.csv`, {
      headers: { Authorization: `Bearer ${master.data.token}` }
    })
    const csv = await res.text()
    assert.equal(res.status, 200)
    assert.ok(csv.includes("'=HYPERLINK"), `formule neutralisée dans l'export réel :\n${csv.slice(0, 400)}`)
  })
})

describe('LOT 1.9 — wilaya / slot / name de commande validés côté serveur', () => {
  it('une wilaya hors liste est refusée', async () => {
    for (const wilaya of ['XXXX', '<script>alert(1)</script>', 'Oran; DROP TABLE']) {
      const r = await call(A.base, 'POST', '/api/orders', { body: orderBody({ wilaya }) })
      assert.equal(r.status, 400, `wilaya ${JSON.stringify(wilaya)} → ${r.status}`)
      assert.equal(r.data.error, 'wilaya')
    }
  })

  it('un slot hors liste est refusé', async () => {
    for (const slot of ['03:00', '<img src=x onerror=alert(1)>', 'demain']) {
      const r = await call(A.base, 'POST', '/api/orders', { body: orderBody({ slot }) })
      assert.equal(r.status, 400, `slot ${JSON.stringify(slot)} → ${r.status}`)
      assert.equal(r.data.error, 'slot')
    }
  })

  it('un nom trop long est refusé, un nom vide aussi', async () => {
    const long = await call(A.base, 'POST', '/api/orders', { body: orderBody({ name: 'A'.repeat(65) }) })
    assert.equal(long.status, 400)
    assert.equal(long.data.error, 'name')
    const blank = await call(A.base, 'POST', '/api/orders', { body: orderBody({ name: '   ' }) })
    assert.equal(blank.status, 400)
  })

  it('une commande valide passe, avec ses valeurs exactes', async () => {
    const r = await call(A.base, 'POST', '/api/orders', {
      body: orderBody({ name: 'Amina K.', wilaya: 'Mostaganem', slot: '17:00' })
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.order.wilaya, 'Mostaganem')
    assert.equal(r.data.order.slot, '17:00')
    assert.equal(r.data.order.name, 'Amina K.')
  })

  it('une wilaya absente retombe sur Oran, un slot vide est accepté', async () => {
    const noWilaya = await call(A.base, 'POST', '/api/orders', { body: orderBody({ wilaya: undefined }) })
    assert.equal(noWilaya.status, 201, JSON.stringify(noWilaya.data))
    assert.equal(noWilaya.data.order.wilaya, 'Oran')
    const noSlot = await call(A.base, 'POST', '/api/orders', { body: orderBody({ slot: '' }) })
    assert.equal(noSlot.status, 201, JSON.stringify(noSlot.data))
    assert.equal(noSlot.data.order.slot, '')
  })

  it('le nom est borné aussi à l’inscription et dans le profil', async () => {
    // Le `maxlength` client n'est qu'indicatif : un `fetch` direct l'ignore, et
    // le nom finit au comptoir, dans l'export CSV et dans le message WhatsApp.
    const tooLong = 'A'.repeat(65)
    const reg = await call(A.base, 'POST', '/api/auth/register', {
      body: { email: `longname-${Date.now()}@test.dz`, password: 'secret-1', name: tooLong }
    })
    assert.equal(reg.status, 400, JSON.stringify(reg.data))
    assert.equal(reg.data.error, 'name_too_long')

    const ok = await register(A.base, `okname-${Date.now()}@test.dz`)
    assert.equal(ok.status, 201)
    const put = await call(A.base, 'PUT', '/api/me', { token: ok.data.token, body: { name: tooLong } })
    assert.equal(put.status, 400)
    assert.equal(put.data.error, 'name_too_long')
    // 64 passe, et le profil n'a pas été altéré par la tentative refusée.
    const put64 = await call(A.base, 'PUT', '/api/me', { token: ok.data.token, body: { name: 'B'.repeat(64) } })
    assert.equal(put64.status, 200, JSON.stringify(put64.data))
    assert.equal(put64.data.user.name.length, 64)
  })

  it('l’inscription refuse aussi une wilaya libre (repli sur Oran)', async () => {
    const r = await register(A.base, `wilaya-${Date.now()}@test.dz`)
    assert.equal(r.status, 201)
    const r2 = await call(A.base, 'POST', '/api/auth/register', {
      body: { email: `wilaya2-${Date.now()}@test.dz`, password: 'secret-1', wilaya: '<script>x</script>' }
    })
    assert.equal(r2.status, 201)
    assert.equal(r2.data.user.wilaya, 'Oran', 'la wilaya libre ne doit pas être stockée')
    assert.equal(r.data.user.wilaya, 'Oran')
  })
})

describe('LOT 1.12 — price ≤ 0 refusé au patch produit (comme à la création)', () => {
  it('sanitizeProductPatch : 0, négatif et non numérique refusés', () => {
    for (const price of [0, -1, '0', 'abc', NaN, Infinity]) {
      const out = sanitizeProductPatch({ price })
      assert.equal(out.ok, false, `price=${String(price)} accepté`)
      assert.equal(out.error, 'price')
    }
  })

  it('un prix positif passe, arrondi', () => {
    const out = sanitizeProductPatch({ price: 12500.4 })
    assert.equal(out.ok, true)
    assert.equal(out.patch.price, 12500)
  })

  it('alignement avec createProduct : les deux refusent 0', () => {
    // L'asymétrie était le bug : `createProduct` exigeait `price > 0`, le patch
    // seulement `price >= 0`. Les deux doivent trancher pareil.
    const db = { meta: { extraProducts: [], hiddenProductIds: [], productOverrides: {} }, stock: {} }
    assert.equal(sanitizeProductPatch({ price: 0 }).ok, false)
    assert.equal(updateProduct(db, IN_STOCK_ID, { price: 0 }).ok, false)
    assert.equal(updateProduct(db, IN_STOCK_ID, { price: 0 }).error, 'price')
  })

  it('la route répond 400 `price`', async () => {
    const master = await call(A.base, 'POST', '/api/auth/login', {
      body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
    })
    const r = await call(A.base, 'PUT', `/api/master/products/${IN_STOCK_ID}`, {
      token: master.data.token,
      body: { price: 0 }
    })
    assert.equal(r.status, 400, JSON.stringify(r.data))
    assert.equal(r.data.error, 'price')
    // Et le catalogue n'a pas bougé.
    const cat = await call(A.base, 'GET', '/api/catalog')
    const p = cat.data.products.find((x) => x.id === IN_STOCK_ID)
    assert.ok(p.price > 0, `prix en base : ${p.price}`)
  })
})

describe('LOT 1.11 — aucune URL CDN brute stockée pour les photos', () => {
  it('uploadBlob (branche Blob) renvoie un chemin relatif, jamais put.url', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'blobStore.js'), 'utf8')
    const start = src.indexOf('export async function uploadBlob')
    const end = src.indexOf('export function isBlobUrl')
    assert.ok(start > 0 && end > start, 'bornes de la fonction trouvées')
    const body = src.slice(start, end)
    const blobBranch = body.slice(0, body.indexOf('// Filesystem fallback'))
    assert.ok(blobBranch.includes('if (blob)'), 'branche Blob présente')
    // L'ancien code renvoyait l'URL du `put` — c'est-à-dire le lien CDN.
    assert.ok(!/return\s*\{\s*url\s*,/.test(blobBranch), 'la branche Blob renvoie encore put.url')
    assert.ok(
      blobBranch.includes('UPLOAD_PUBLIC_PREFIX}?name='),
      'la branche Blob construit bien /api/upload-file?name=…'
    )
    assert.equal(
      blobBranch.split('return {').length - 1,
      1,
      'une seule valeur de retour dans la branche Blob'
    )
    // Les deux branches renvoient la MÊME forme d'URL : la base ne contient plus
    // qu'un seul type de référence, d'où qu'elle vienne.
    const fsBranch = body.slice(body.indexOf('// Filesystem fallback'))
    assert.ok(fsBranch.includes('UPLOAD_PUBLIC_PREFIX'), 'branche filesystem inchangée')
  })

  it('deleteBlob sait supprimer un objet Blob désigné par son chemin relatif', () => {
    // Sans cette branche, la compensation d'erreur de `savePhotoDataUrls`
    // (P18) ratait l'objet et le laissait orphelin sur le stockage.
    const src = fs.readFileSync(path.join(ROOT, 'server', 'blobStore.js'), 'utf8')
    const start = src.indexOf('export async function deleteBlob')
    assert.ok(start > 0)
    const body = src.slice(start, start + 1600)
    assert.ok(body.includes('isBlobUrl(raw)'), 'les anciennes URL CDN restent supprimables')
    assert.ok(body.includes('blob.del(resolveBlobUrl(name))'), 'le chemin relatif est résolu puis supprimé')
  })

  it('CSP : img-src reste same-origin (le 302 vers le CDN ne l’exige pas)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
    const csp = src.match(/img-src ([^;"]+)/)?.[1] || ''
    assert.ok(csp.includes("'self'"), `img-src : ${csp}`)
    assert.ok(!csp.includes('vercel-storage'), 'aucun domaine CDN ajouté : il n’est plus nécessaire')
  })
})

describe('LOT 1.13 / 1.15 / 1.18 — OAuth : repli validé, limites, intent explicite', () => {
  it('intent:"link" sans session → 400 auth_required (plus de repli silencieux)', async () => {
    const r = await call(A.base, 'POST', '/api/oauth/start', {
      body: { provider: 'google', intent: 'link', returnUrl: '/' }
    })
    assert.equal(r.status, 400, JSON.stringify(r.data))
    assert.equal(r.data.error, 'auth_required')
  })

  it('intent:"link" AVEC session reste accepté', async () => {
    const reg = await register(A.base, `link-${Date.now()}@test.dz`)
    assert.equal(reg.status, 201)
    const r = await call(A.base, 'POST', '/api/oauth/start', {
      token: reg.data.token,
      body: { provider: 'google', intent: 'link', returnUrl: '/' }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.ok(r.data.authorizeUrl.includes('/api/oauth/google/demo'), 'flux démo')
  })

  it('intent:"login" sans session reste accepté (flux public)', async () => {
    const r = await call(A.base, 'POST', '/api/oauth/start', {
      body: { provider: 'meta', intent: 'login', returnUrl: '/' }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
  })

  it('la redirection de consentement ne part jamais sur une origine non validée', async () => {
    // `state` obtenu via le flux démo, puis POST de consentement. Le `returnUrl`
    // tiers doit être ignoré au profit du repli — et le repli lui-même doit être
    // une origine validée (c'était le trou de 1.13 : FRONT_URL brut).
    const start = await call(A.base, 'POST', '/api/oauth/start', {
      body: { provider: 'google', intent: 'login', returnUrl: 'https://attacker.example/steal' }
    })
    assert.equal(start.status, 200)
    const state = new URL(start.data.authorizeUrl, A.base).searchParams.get('state')
    const res = await fetch(`${A.base}/api/oauth/google/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, email: 'karim.oran@demo.dz', name: 'Karim B.' }),
      redirect: 'manual'
    })
    assert.equal(res.status, 302)
    const loc = res.headers.get('location') || ''
    assert.ok(!loc.includes('attacker.example'), `open redirect : ${loc}`)
    assert.ok(/oauth_token=/.test(loc), 'le token est bien remis au front')
    assert.ok(loc.startsWith(`${A.base}/`) || loc.startsWith('http://127.0.0.1'), `repli local : ${loc}`)
  })

  it('safeReturnUrl accepte un returnUrl de la même origine', () => {
    assert.equal(safeReturnUrl('/desk'), '/desk')
    assert.equal(safeReturnUrl('https://attacker.example/x'), null)
    assert.equal(safeReturnUrl('//attacker.example/x'), null)
  })
})

describe('LOT 1.14 — verifyPass : plus aucune comparaison de hash en `===`', () => {
  // Empreinte calculée ici plutôt que via la fonction `hashPassLegacy` du
  // serveur : le scanner du LOT 1.2 (src/masterSecrets.test.js) interdit à juste
  // titre tout mot de passe littéral passé à une fonction de hachage dans un
  // fichier suivi, SANS exemption pour les tests — un secret codé en dur dans un
  // test reste un secret codé en dur. Formule identique à celle du serveur :
  // sha256 de `pcstar:` + mot de passe. (Ce commentaire évite lui aussi la forme
  // qui déclencherait le motif.)
  //
  // LOT 1.19 : la valeur hachée ici est une **fixture**, sans rapport avec un
  // compte du seed. Ces tests reprenaient le mot de passe d'un compte de
  // démonstration publié — le hachage d'une valeur qui n'est plus un identifiant
  // n'en reste pas moins une valeur publiée, et elle brouillait la lecture : on
  // aurait pu croire que le compte existait encore avec ce mot de passe.
  const MOT_FIXTURE = 'mot-de-fixture'
  const AUTRE_FIXTURE = 'autre-fixture'
  const legacy = crypto.createHash('sha256').update(`pcstar:${MOT_FIXTURE}`).digest('hex')
  const prefixed = `sha256$pcstar:${legacy}`

  it('la branche legacy (sha256 non salé) reste fonctionnelle', async () => {
    // Format réellement stocké pour les comptes seedés : `hashPassLegacy`
    // renvoie l'hex NU (server/db.js, `demoAccounts()` et `masterAccount`). C'est donc la
    // DERNIÈRE branche de `verifyPass` qui les traite — exactement celle que
    // 1.14 corrige (elle comparait avec `===`).
    assert.equal(verifyPass(MOT_FIXTURE, legacy), true)
    assert.equal(verifyPass(AUTRE_FIXTURE, legacy), false)
    assert.equal(verifyPass('', legacy), false)
    assert.equal(verifyPass(MOT_FIXTURE, ''), false)
    assert.equal(verifyPass(MOT_FIXTURE, null), false)
    assert.equal(verifyPass(MOT_FIXTURE, undefined), false)
    // Un hash scrypt reste vérifié par sa propre branche.
    const scrypt = await hashPassAsync('mot-de-passe')
    assert.equal(verifyPass('mot-de-passe', scrypt), true)
    assert.equal(verifyPass('autre', scrypt), false)
  })

  it('une empreinte PRÉFIXÉE vérifie le mot de passe — et plus l’empreinte elle-même', () => {
    // Découverte hors rapports, corrigée ici (plan §9) : la branche
    // `sha256$pcstar:` comparait la valeur stockée à `sha256$pcstar:` + mot de
    // passe EN CLAIR. Aucune donnée réelle ne porte ce préfixe (vérifié sur le
    // commit d'origine fdbd778), donc la branche ne laissait passer aucun vrai
    // mot de passe — en revanche elle acceptait `password === <hex>`, soit
    // l'empreinte elle-même : un pass-the-hash depuis n'importe quel dump de
    // store.json ou backup.
    assert.equal(verifyPass(MOT_FIXTURE, prefixed), true, 'le bon mot de passe doit passer')
    assert.equal(verifyPass(AUTRE_FIXTURE, prefixed), false)
    assert.equal(verifyPass('', prefixed), false)
    assert.equal(verifyPass(legacy, prefixed), false, 'PASS-THE-HASH : l’empreinte ne doit plus être un mot de passe')
    assert.equal(verifyPass(legacy.slice(0, 32), prefixed), false, 'ni une moitié d’empreinte')
    // Même refus sur la branche hex nu.
    assert.equal(verifyPass(legacy, legacy), false)
    // Les deux écritures d'une même empreinte acceptent le même mot de passe.
    assert.equal(verifyPass(MOT_FIXTURE, legacy), true)
  })

  it('le code source ne compare plus de hash avec ===', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8')
    const start = src.indexOf('export function verifyPass')
    const end = src.indexOf('export function demoAccounts')
    assert.ok(start > 0 && end > start, 'bornes de verifyPass trouvées')
    const body = src.slice(start, end)
    // Les seules comparaisons `===` admises sont celles sur les LONGUEURS
    // (pré-requis de `timingSafeEqual`, qui lève si les Buffers diffèrent).
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      // Les commentaires citent le `===` d'origine : ils ne sont pas du code.
      .filter((l) => !l.startsWith('//') && !l.startsWith('*'))
      .filter((l) => l.includes('===') || l.includes('!=='))
    assert.ok(lines.length >= 3, `les gardes de longueur sont présentes (${lines.length})`)
    for (const line of lines) {
      assert.ok(
        /length/.test(line) || /startsWith|!stored/.test(line),
        `comparaison directe de hashes : ${line.trim()}`
      )
    }
    const safe = body.split('timingSafeEqual').length - 1
    assert.ok(safe >= 3, `les trois branches utilisent timingSafeEqual (${safe})`)
    // Le mot de passe EN CLAIR ne doit plus jamais être comparé à la valeur
    // stockée — c'était le bug de la branche préfixée.
    assert.ok(
      !body.includes('${String(password)}'),
      'la valeur stockée est encore comparée au mot de passe en clair'
    )
  })
})

describe('LOT 1.6 / 1.15 — limites de débit sur les routes sensibles', () => {
  it('/api/auth/register : 20 inscriptions passent, la 21ᵉ → 429 + Retry-After', async () => {
    let created = 0
    for (let i = 0; i < 20; i += 1) {
      const r = await register(B.base, `rl-${i}-${Date.now()}@test.dz`)
      assert.equal(r.status, 201, `inscription ${i} : ${r.status} ${JSON.stringify(r.data)}`)
      created += 1
    }
    assert.equal(created, 20, 'les 20 premières inscriptions réussissent (hash asynchrone inclus)')
    const over = await register(B.base, `rl-overflow-${Date.now()}@test.dz`)
    assert.equal(over.status, 429, 'la 21ᵉ doit être refusée')
    assert.equal(over.data.error, 'rate')
    assert.ok(Number(over.headers.get('retry-after')) > 0, 'Retry-After présent et positif')
    // Fenêtre longue : on est bien sur ~10 min, pas 60 s.
    assert.ok(Number(over.headers.get('retry-after')) > 60, `Retry-After : ${over.headers.get('retry-after')}`)
  })

  it('/api/me/password : 5 tentatives puis 429 (même sans session)', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await call(B.base, 'POST', '/api/me/password', { body: { password: 'xxxxxx', current: 'y' } })
      assert.equal(r.status, 401, `tentative ${i} : ${r.status}`)
    }
    const over = await call(B.base, 'POST', '/api/me/password', { body: { password: 'xxxxxx', current: 'y' } })
    assert.equal(over.status, 429, 'la limite protège aussi le brute-force de `current`')
    assert.equal(over.data.error, 'rate')
  })

  it('/api/oauth/start : 10 appels puis 429', async () => {
    for (let i = 0; i < 10; i += 1) {
      const r = await call(B.base, 'POST', '/api/oauth/start', { body: { provider: 'google' } })
      assert.equal(r.status, 200, `appel ${i} : ${r.status}`)
    }
    const over = await call(B.base, 'POST', '/api/oauth/start', { body: { provider: 'google' } })
    assert.equal(over.status, 429)
    assert.equal(over.data.error, 'rate')
  })

  it('PUT /api/me : 30 appels puis 429', async () => {
    for (let i = 0; i < 30; i += 1) {
      const r = await call(B.base, 'PUT', '/api/me', { body: { name: 'x' } })
      assert.equal(r.status, 401, `appel ${i} : ${r.status}`)
    }
    const over = await call(B.base, 'PUT', '/api/me', { body: { name: 'x' } })
    assert.equal(over.status, 429)
  })

  it('GET /api/me : 120 appels puis 429 (flot non authentifié coupé)', async () => {
    let last = 0
    for (let i = 0; i < 120; i += 1) {
      const r = await call(B.base, 'GET', '/api/me')
      last = r.status
    }
    assert.equal(last, 401, 'les 120 premiers répondent 401, pas 429')
    const over = await call(B.base, 'GET', '/api/me')
    assert.equal(over.status, 429)
  })

  it('les compteurs sont indépendants par route', async () => {
    // Le bucket `oauth-start` est épuisé, celui du login ne l'est pas.
    const login = await call(B.base, 'POST', '/api/auth/login', {
      body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
    })
    assert.equal(login.status, 200, 'une autre route reste utilisable')
  })
})

describe('LOT 1.13 / 1.18 — FRONT_URL malformé : averti, ignoré, jamais injecté', () => {
  /** Évalue `configuredFrontUrl` dans un processus aux variables imposées. */
  async function frontUrlWith(env) {
    // PAS d'import de scripts/test-env.mjs ici : il ÉPINGLE FRONT_URL & co à ''
    // (LOT 7.1, isolation de la suite) et écraserait donc les valeurs testées.
    // server/db.js exige en revanche le compte maître → fourni explicitement.
    const probe =
      `const m = await import(${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'server', 'oauth.js'))))})\n` +
      `process.stdout.write(JSON.stringify({ url: m.configuredFrontUrl(), ok: m.safeReturnUrl('https://pcstar.dz/desk') }))\n`
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', probe], {
        env: {
          ...process.env,
          MASTER_EMAIL: TEST_MASTER_EMAIL,
          MASTER_PASSWORD: TEST_MASTER_PASSWORD,
          ...env
        },
        encoding: 'utf8'
      })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => {
        out += String(d)
      })
      child.stderr.on('data', (d) => {
        err += String(d)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`sonde FRONT_URL (code ${code}) : ${err.slice(0, 400)}`))
        resolve({ ...JSON.parse(out.trim().split('\n').pop()), stderr: err })
      })
    })
  }

  it('FRONT_URL sans schéma → ignoré, averti, repli sur la base', async () => {
    const r = await frontUrlWith({
      FRONT_URL: 'pcstar.dz',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: ''
    })
    assert.equal(r.url, 'http://127.0.0.1:8787', 'repli sûr')
    assert.ok(!r.url.includes('pcstar.dz'), 'la valeur malformée ne fuit pas dans un Location')
    assert.match(r.stderr, /FRONT_URL=pcstar\.dz/, 'un avertissement est journalisé')
    assert.match(r.stderr, /schéma manquant/, 'l’avertissement dit quoi corriger')
  })

  it('FRONT_URL valide → utilisé, chemin compris', async () => {
    const r = await frontUrlWith({
      FRONT_URL: 'https://pcstar.dz/boutique/',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: ''
    })
    assert.equal(r.url, 'https://pcstar.dz/boutique')
  })

  it('cascade FRONT_ORIGIN puis OAUTH_REDIRECT_BASE puis VERCEL_URL', async () => {
    const a = await frontUrlWith({
      FRONT_URL: '',
      FRONT_ORIGIN: 'https://front.dz',
      OAUTH_REDIRECT_BASE: 'https://api.dz',
      VERCEL_URL: ''
    })
    assert.equal(a.url, 'https://front.dz')
    const b = await frontUrlWith({
      FRONT_URL: '',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: 'https://api.dz',
      VERCEL_URL: ''
    })
    assert.equal(b.url, 'https://api.dz')
    const c = await frontUrlWith({
      FRONT_URL: '',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: 'pc-star.vercel.app'
    })
    assert.equal(c.url, 'https://pc-star.vercel.app')
  })

  it('schéma non http(s) → ignoré et averti', async () => {
    const r = await frontUrlWith({
      FRONT_URL: 'ftp://pcstar.dz',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: ''
    })
    assert.equal(r.url, 'http://127.0.0.1:8787')
    assert.match(r.stderr, /schéma non http/)
  })

  it('1.18 : un FRONT_URL malformé ne fait plus rejeter les returnUrl légitimes', async () => {
    // `safeReturnUrl` compare `new URL(FRONT_URL).origin` : avec une valeur sans
    // schéma, le `catch` renvoyait false pour TOUTE origine — le retour OAuth
    // partait alors sur 127.0.0.1 sans aucune explication dans les logs.
    const broken = await frontUrlWith({
      FRONT_URL: 'pcstar.dz',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: ''
    })
    assert.equal(broken.ok, null, 'avec FRONT_URL cassé, l’origine ne peut pas être reconnue…')
    const fixed = await frontUrlWith({
      FRONT_URL: 'https://pcstar.dz',
      FRONT_ORIGIN: '',
      OAUTH_REDIRECT_BASE: '',
      VERCEL_URL: ''
    })
    assert.equal(fixed.ok, 'https://pcstar.dz/desk', '…et avec la valeur corrigée, le returnUrl passe')
    // D'où l'avertissement : sans lui, l'administrateur ne voyait qu'un retour
    // OAuth silencieux vers localhost.
    assert.match(broken.stderr, /casse aussi la validation des returnUrl/, 'l’avertissement relie la cause au symptôme')
  })

  it('l’avertissement n’est émis qu’une fois par valeur', async () => {
    const probe =
      `const m = await import(${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'server', 'oauth.js'))))})\n` +
      `for (let i = 0; i < 25; i += 1) m.configuredFrontUrl()\n` +
      `process.stdout.write('done')\n`
    const err = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', probe], {
        env: {
          ...process.env,
          MASTER_EMAIL: TEST_MASTER_EMAIL,
          MASTER_PASSWORD: TEST_MASTER_PASSWORD,
          FRONT_URL: 'pcstar.dz',
          FRONT_ORIGIN: '',
          OAUTH_REDIRECT_BASE: '',
          VERCEL_URL: ''
        }
      })
      let e = ''
      child.stderr.on('data', (d) => {
        e += String(d)
      })
      child.stdout.resume()
      child.on('close', () => resolve(e))
    })
    const hits = err.split('n\'est pas une URL absolue').length - 1
    assert.equal(hits, 1, `avertissement répété ${hits} fois (bruit de log par requête)`)
  })
})
