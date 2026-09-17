import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// ---------------------------------------------------------------------------
// LOT 3 — robustesse & concurrence, partie SERVEUR.
//
//  3.10 (B15) heartbeat `ping`/`pong` : `deskClientCount()` ne compte plus de
//             sockets fantômes (TCP à moitié mort = `readyState OPEN` pour
//             toujours)
//  3.12 (B17) réponse 413 porte `Connection: close` : on a refusé le corps AVANT
//             de l'avoir lu, la connexion ne doit pas être réutilisée
//  3.13 (B18) `OAUTH_DEMO` / `OAUTH_REDIRECT_BASE` lus À LA DEMANDE (fonctions)
//             au lieu d'être figés à l'import du module
//  3.14 (B4)  `productOverrides[id]` effacé quand l'override redevient vide
//  3.15 (B5)  deux backups dans la même seconde → deux fichiers distincts
//  3.17 (B21) `hashPassLegacy` déclaré AVANT `masterAccount()` (plus de hoisting ;
//             LOT 1.20 : le repère n'est plus l'objet `MASTER`, supprimé)
//  3.18 (R14) WebSocket : authentification par PREMIER message, plus de token
//             dans l'URL d'upgrade
//
// La partie cliente (B6→B14, B16, B19) est dans src/lot3Client.test.js ; le
// retour OAuth par fragment (`#oauth_token=`) est couvert par
// src/securityFixes.test.js.
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot3srv-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')
// Timeout d'authentification et heartbeat raccourcis : les comportements testés
// sont les mêmes, sans attendre 5 s / 30 s.
process.env.DESK_WS_AUTH_TIMEOUT_MS = '400'
process.env.DESK_WS_HEARTBEAT_MS = '250'

const { handler } = await import('../server/index.js')
const {
  attachDeskSocket,
  closeDeskSocket,
  heartbeatOnce,
  deskPendingCount,
  WS_CLOSE,
  __deskSocketInternals
} = await import('../server/deskSocket.js')
const {
  addDeskClient,
  removeDeskClient,
  deskClientCount,
  broadcastDesk,
  __notifyInternals
} = await import('../server/notify.js')
const { backupStore, capBackups, updateProduct, hideProductMaster } = await import('../server/masterApi.js')
const { oauthConfig, oauthDemo, oauthBase, startOAuth } = await import('../server/oauth.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')
const { PRODUCTS } = await import('./data.js')

let server
let base

before(async () => {
  server = http.createServer(handler)
  // Même prédicat que `startLocalServer()` : seul un token de session **master**
  // ouvre un socket Desk.
  attachDeskSocket(server, async (token) => {
    const { readDbAsync, findSession } = await import('../server/db.js')
    try {
      const db = await readDbAsync()
      // Durcissement des jetons : la base est indexée par EMPREINTE sha256.
      const sess = findSession(db, token)
      if (!sess) return false
      return db.users.some((u) => u.id === sess.userId && u.role === 'master')
    } catch {
      return false
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  closeDeskSocket()
  await new Promise((resolve) => server.close(resolve))
  __notifyInternals.deskClients.clear()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

beforeEach(() => {
  __rateLimitInternals.buckets.clear()
  // Les sockets fermés côté client peuvent rester enregistrés côté serveur
  // quelques millisecondes : on repart d'un registre propre à chaque test.
  __notifyInternals.deskClients.clear()
})

async function call(method, pathname, { body, token } = {}) {
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

async function masterToken() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, `login master : ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.token
}

/** Ouvre un socket Desk et renvoie {ws, url, frames, closed, ready}. */
function openDeskSocket(wsUrl = `ws://127.0.0.1:${server.address().port}/api/desk-stream`) {
  const state = { url: wsUrl, frames: [], closed: false, closeCode: null }
  const ws = new WebSocket(wsUrl)
  ws.on('message', (raw) => {
    try {
      state.frames.push(JSON.parse(String(raw)))
    } catch {
      state.frames.push({ raw: String(raw) })
    }
  })
  ws.on('close', (code) => {
    state.closed = true
    state.closeCode = code
  })
  state.ws = ws
  state.open = () =>
    new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout ouverture socket')), 4000)
      ws.once('open', () => {
        clearTimeout(to)
        resolve()
      })
      ws.once('error', (e) => {
        clearTimeout(to)
        reject(e)
      })
    })
  state.waitClose = (ms = 2000) =>
    new Promise((resolve) => {
      if (state.closed) return resolve(state.closeCode)
      const to = setTimeout(() => resolve(state.closed ? state.closeCode : 'timeout'), ms)
      ws.once('close', (code) => {
        clearTimeout(to)
        resolve(code)
      })
    })
  state.send = (obj) => ws.send(JSON.stringify(obj))
  return state
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------- 3.2 (B1+B2+B3) */

describe('LOT 3.2 (B1 + B2 + B3) — driver fichier : concurrence et lectures', () => {
  const storePath = () => path.join(process.env.PCSTAR_DATA_DIR, 'store.json')

  it('dix updateDbAsync parallèles sur le MÊME compteur → aucune mutation perdue', async () => {
    const { updateDbAsync, readDbAsync } = await import('../server/db.js')
    await updateDbAsync((db) => {
      db.meta.concCount = 0
      return db
    })
    await Promise.all(
      Array.from({ length: 10 }, () =>
        updateDbAsync((db) => {
          db.meta.concCount = (db.meta.concCount || 0) + 1
          return db
        })
      )
    )
    const after = await readDbAsync()
    assert.equal(after.meta.concCount, 10, `compteur : ${after.meta.concCount} — des incrémentations ont été perdues`)
    // Nettoyage : la clé ne doit pas traîner dans les backups suivants.
    await updateDbAsync((db) => {
      delete db.meta.concCount
      return db
    })
  })

  it('deux mutations parallèles distinctes survivent toutes les deux', async () => {
    const { updateDbAsync, readDbAsync } = await import('../server/db.js')
    await Promise.all([
      updateDbAsync((db) => {
        db.meta.concA = 'a'
        return db
      }),
      updateDbAsync((db) => {
        db.meta.concB = 'b'
        return db
      })
    ])
    const after = await readDbAsync()
    assert.equal(after.meta.concA, 'a')
    assert.equal(after.meta.concB, 'b')
    await updateDbAsync((db) => {
      delete db.meta.concA
      delete db.meta.concB
      return db
    })
  })

  it('B2 : des GET ne provoquent plus AUCUNE écriture disque', async () => {
    const p = storePath()
    assert.ok(fs.existsSync(p), 'store.json existe (écrit au démarrage)')
    const before = fs.statSync(p).mtimeMs
    await call('GET', '/api/catalog')
    await call('GET', '/api/orders')
    await call('GET', '/api/meta')
    await call('GET', '/api/health')
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(fs.statSync(p).mtimeMs, before, 'une lecture a écrit sur le disque')
  })

  it('B2/S3 : les clés internes (_lastAuth, _err) ne sont jamais persistées', async () => {
    const token = await masterToken()
    assert.ok(token, 'session maître ouverte')
    await new Promise((r) => setTimeout(r, 50))
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    // P13 (S3) : `_lastAuth` recopiait le DERNIER jeton émis dans store.json,
    // donc dans chaque backup. Il n'est plus persisté.
    assert.equal(raw._lastAuth, undefined, '_lastAuth ne doit plus être écrit')
    assert.equal(raw._err, undefined, '_err ne doit plus être écrit')
    assert.equal(Object.keys(raw).some((k) => k.startsWith('_')), false, 'aucune clé interne au fichier')
    assert.equal(JSON.stringify(raw).includes(token), false, 'le jeton brut ne doit plus être dans store.json')
    // Durcissement des jetons (demandé hors rapports) : le registre `sessions`
    // est indexé par EMPREINTE sha256 du jeton — le jeton brut, lui, n'est plus
    // nulle part dans le fichier (donc plus dans aucun backup).
    const { hashToken } = await import('../server/db.js')
    assert.ok(raw.sessions?.[hashToken(token)], 'la session maître est enregistrée sous son empreinte')
    assert.equal(Object.keys(raw.sessions).every((k) => /^[a-f0-9]{64}$/.test(k)), true, 'clés = empreintes')
    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 200)
  })
})

/* ------------------------------------------------------------------ 3.16 */

describe('LOT 3.16 (B19) — /api/catalog expose l’âge de son état', () => {
  it('base joignable → db.source = « db » et asOf daté', async () => {
    const r = await call('GET', '/api/catalog')
    assert.equal(r.status, 200)
    assert.equal(r.data.degraded, false)
    assert.equal(r.data.db.source, 'db', JSON.stringify(r.data.db))
    assert.equal(typeof r.data.db.asOf, 'number', 'asOf = horodatage ms')
    assert.ok(r.data.db.asOf <= Date.now() && r.data.db.asOf > Date.now() - 60000)
    assert.equal(r.data.db.reachable, true)
  })
})

/* ------------------------------------------------------------------ 3.12 */

describe('LOT 3.12 (B17) — un corps trop gros ferme la connexion', () => {
  it('la réponse 413 porte Connection: close', async () => {
    // ~16 Mo : au-delà de MAX_BODY_BYTES (15 Mo). Le serveur refuse AVANT
    // d'avoir lu le corps — sur une connexion keep-alive, la requête suivante
    // commencerait alors au milieu d'un corps abandonné.
    const pad = 'x'.repeat(16 * 1024 * 1024)
    const res = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'b17@test.dz', password: 'secret1', name: pad })
    })
    assert.equal(res.status, 413)
    assert.equal(String(res.headers.get('connection') || '').toLowerCase(), 'close', 'Connection: close attendu')
    const data = await res.json()
    assert.equal(data.ok, false)
    assert.equal(data.error, 'too_large')
  })
})

/* ------------------------------------------------------------------ 3.13 */

describe('LOT 3.13 (B18) — configuration OAuth lue à la demande', () => {
  const KEYS = ['OAUTH_DEMO', 'OAUTH_REDIRECT_BASE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']

  it('changer process.env APRÈS l’import change le comportement (sans réimport)', async () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    try {
      process.env.OAUTH_DEMO = '0'
      process.env.OAUTH_REDIRECT_BASE = 'https://pcstar.test'
      process.env.GOOGLE_CLIENT_ID = 'id-google'
      process.env.GOOGLE_CLIENT_SECRET = 'secret-google'

      assert.equal(oauthDemo(), false, 'le mode démo doit suivre OAUTH_DEMO')
      assert.equal(oauthBase(), 'https://pcstar.test')
      assert.equal(oauthConfig().demo, false)
      assert.equal(oauthConfig().redirectBase, 'https://pcstar.test')

      const st = await startOAuth('google', { intent: 'login' })
      assert.equal(st.ok, true)
      assert.equal(st.demo, false, 'plus de consentement simulé')
      assert.match(st.authorizeUrl, /^https:\/\/accounts\.google\.com\//)
      const params = new URL(st.authorizeUrl).searchParams
      assert.equal(
        params.get('redirect_uri'),
        'https://pcstar.test/api/oauth/google/callback',
        'redirect_uri construit sur la base COURANTE'
      )
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
    // Retour à la configuration de test : le module n'a pas mis en cache.
    assert.equal(oauthDemo(), process.env.OAUTH_DEMO !== '0')
  })

  it('sans clés fournisseur, le repli démo reste proposé (comportement inchangé)', async () => {
    const savedDemo = process.env.OAUTH_DEMO
    const savedId = process.env.GOOGLE_CLIENT_ID
    try {
      process.env.OAUTH_DEMO = '1'
      delete process.env.GOOGLE_CLIENT_ID
      const st = await startOAuth('google', { intent: 'login' })
      assert.equal(st.demo, true)
      assert.match(st.authorizeUrl, /^\/api\/oauth\/google\/demo\?state=/)
    } finally {
      if (savedDemo === undefined) delete process.env.OAUTH_DEMO
      else process.env.OAUTH_DEMO = savedDemo
      if (savedId !== undefined) process.env.GOOGLE_CLIENT_ID = savedId
    }
  })
})

/* ------------------------------------------------------------------ 3.14 */

describe('LOT 3.14 (B4) — pas d’override résiduel vide', () => {
  const id = PRODUCTS[0].id
  const freshDb = () => ({ orders: [], users: [], meta: {}, stock: {} })

  it('masquer puis réafficher un produit du catalogue ne laisse AUCUNE entrée', () => {
    const db = freshDb()
    hideProductMaster(db, id, true)
    assert.ok((db.meta.hiddenProductIds || []).includes(id), 'produit masqué')
    hideProductMaster(db, id, false)
    assert.equal(db.meta.productOverrides[id], undefined, 'override vide résiduel')
    assert.equal(Object.keys(db.meta.productOverrides || {}).length, 0)
  })

  it('un vrai override survit à masquer/réafficher', () => {
    const db = freshDb()
    updateProduct(db, id, { name: 'Nom boutique', price: 12345 })
    hideProductMaster(db, id, true)
    hideProductMaster(db, id, false)
    assert.equal(db.meta.productOverrides[id].name, 'Nom boutique')
    assert.equal(db.meta.productOverrides[id].price, 12345)
    assert.equal(db.meta.productOverrides[id].hidden, undefined, '`hidden` ne doit pas polluer l’override')
  })

  it('via l’API master : hide → unhide ne gonfle pas meta', async () => {
    const token = await masterToken()
    const hide = await call('POST', `/api/master/products/${id}/hide`, { body: { hidden: true }, token })
    assert.equal(hide.status, 200, `route hide : ${hide.status} ${JSON.stringify(hide.data)}`)
    await call('POST', `/api/master/products/${id}/hide`, { body: { hidden: false }, token })
    const meta = await call('GET', '/api/master/meta', { token })
    assert.equal(meta.status, 200)
    const overrides = meta.data?.meta?.productOverrides || {}
    assert.equal(overrides[id], undefined, 'entrée résiduelle exposée par /api/master/meta')
  })
})

/* ------------------------------------------------------------------ 3.15 */

describe('LOT 3.15 (B5) — noms de backup uniques', () => {
  it('trois backups dans la même seconde → trois fichiers distincts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot3-bk-'))
    const dbPath = path.join(dir, 'store.json')
    const backups = path.join(dir, 'backups')
    fs.writeFileSync(dbPath, JSON.stringify({ orders: [] }))
    const made = [backupStore(dbPath, backups), backupStore(dbPath, backups), backupStore(dbPath, backups)]
    const files = fs.readdirSync(backups).filter((f) => f.startsWith('store-') && f.endsWith('.json'))
    assert.equal(files.length, 3, `fichiers : ${files.join(', ')}`)
    assert.equal(new Set(made).size, 3, 'chemins identiques = écrasement silencieux')
    for (const f of files) assert.match(f, /^store-\d{4}-\d{2}-\d{2}T[\d-]+-[0-9a-f]{6}\.json$/, f)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('capBackups borne toujours à 14 et garde les plus récents (tri alphabétique = chrono)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot3-cap-'))
    const names = []
    for (let i = 0; i < 17; i += 1) {
      // Format réel : horodatage + suffixe aléatoire. Le suffixe vient APRÈS
      // l'horodatage, donc le tri alphabétique de capBackups reste chronologique.
      const n = `store-2026-09-15T10-${String(i).padStart(2, '0')}-00-${Math.random().toString(16).slice(2, 8)}.json`
      fs.writeFileSync(path.join(dir, n), '{}')
      names.push(n)
    }
    const removed = capBackups(dir, 14)
    assert.equal(removed, 3)
    const left = fs.readdirSync(dir).filter((f) => f.startsWith('store-'))
    assert.equal(left.length, 14)
    assert.ok(left.includes(names[16]), 'le dernier backup doit rester')
    assert.equal(left.includes(names[0]), false, 'le plus ancien doit partir')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('backupStore applique lui-même le plafond : 17 appels → 14 fichiers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot3-cap2-'))
    const dbPath = path.join(dir, 'store.json')
    const backups = path.join(dir, 'backups')
    fs.writeFileSync(dbPath, '{}')
    for (let i = 0; i < 17; i += 1) backupStore(dbPath, backups)
    const left = fs.readdirSync(backups).filter((f) => f.startsWith('store-'))
    assert.equal(left.length, 14, `fichiers : ${left.length}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

/* ------------------------------------------------------------------ 3.17 */

describe('LOT 3.17 (B21) — plus de dépendance au hoisting', () => {
  it('hashPassLegacy est déclaré AVANT `masterAccount()` dans server/db.js', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'server', 'db.js'), 'utf8')
    const decl = src.search(/function hashPassLegacy\s*\(/)
    // LOT 1.20 : l'objet `MASTER` (résolu au chargement) n'existe plus. Le
    // repère devient la fonction qu'il appelait pour produire l'empreinte —
    // c'est elle, et elle seule, que le compte maître doit suivre.
    const master = src.search(/^export function masterAccount\s*\(/m)
    assert.ok(decl > 0, 'hashPassLegacy introuvable')
    assert.ok(master > 0, 'masterAccount introuvable')
    assert.ok(decl < master, `hashPassLegacy (offset ${decl}) doit précéder masterAccount (offset ${master})`)
  })

  it('le compte maître est bien haché avec cette fonction (aucun mot de passe en clair)', async () => {
    const { masterAccount } = await import('../server/db.js')
    const master = masterAccount()
    assert.ok(master.email, 'e-mail maître présent')
    assert.ok(master.passwordHash && master.passwordHash.length > 20, 'hash présent')
    assert.equal(JSON.stringify(master).includes(TEST_MASTER_PASSWORD), false, 'fuite du mot de passe')
  })
})

/* ------------------------------------------------------------------ 3.18 */

describe('LOT 3.18 (R14) — WebSocket : authentification par premier message', () => {
  it('aucun token dans l’URL d’upgrade ; `auth` en premier message → hello', async () => {
    const token = await masterToken()
    const sock = openDeskSocket()
    await sock.open()
    assert.equal(sock.url.includes('token='), false, `token dans l'URL : ${sock.url}`)
    sock.send({ type: 'auth', token })
    await wait(250)
    const hello = sock.frames.find((f) => f.type === 'hello')
    assert.ok(hello, `frames reçus : ${JSON.stringify(sock.frames)}`)
    assert.equal(hello.authed, true)
    assert.equal(sock.closed, false, 'un master authentifié ne doit pas être fermé')
    assert.ok(deskClientCount() >= 1, 'le socket authentifié est enregistré')
    sock.ws.close()
    await sock.waitClose()
  })

  it('premier message non-auth → fermé 4401, aucune donnée reçue', async () => {
    const sock = openDeskSocket()
    await sock.open()
    sock.send({ type: 'ping' })
    const code = await sock.waitClose()
    assert.equal(code, WS_CLOSE.AUTH_REQUIRED, `code reçu : ${code}`)
    assert.equal(sock.frames.some((f) => f.type === 'pong'), false, 'pas de réponse avant authentification')
  })

  it('token non-master → fermé 4403', async () => {
    const reg = await call('POST', '/api/auth/register', {
      body: { email: `lot3.client.${Date.now()}@test.dz`, password: 'motdepasse123', name: 'Client' }
    })
    assert.equal(reg.status, 201)
    const sock = openDeskSocket()
    await sock.open()
    sock.send({ type: 'auth', token: reg.data.token })
    const code = await sock.waitClose()
    assert.equal(code, WS_CLOSE.FORBIDDEN, `code reçu : ${code}`)
    assert.equal(sock.frames.length, 0, 'rien ne doit être envoyé à un non-master')
  })

  it('token invalide → fermé 4403', async () => {
    const sock = openDeskSocket()
    await sock.open()
    sock.send({ type: 'auth', token: 'pas-un-token' })
    const code = await sock.waitClose()
    assert.equal(code, WS_CLOSE.FORBIDDEN, `code reçu : ${code}`)
  })

  it('socket muet → fermé 4408 après le délai d’authentification', async () => {
    const sock = openDeskSocket()
    await sock.open()
    const code = await sock.waitClose(3000)
    assert.equal(code, WS_CLOSE.AUTH_TIMEOUT, `code reçu : ${code}`)
    assert.equal(deskPendingCount(), 0, 'les sockets en attente doivent être décomptés')
  })

  it('un socket pas encore authentifié ne reçoit aucune diffusion', async () => {
    const token = await masterToken()
    const good = openDeskSocket()
    const pending = openDeskSocket()
    await good.open()
    await pending.open()
    good.send({ type: 'auth', token })
    await wait(150)
    const sent = broadcastDesk({ type: 'order:new', order: { code: 'PS-R14' } })
    assert.equal(sent, 1, 'un seul client authentifié touché')
    await wait(80)
    assert.ok(good.frames.some((f) => f.type === 'order:new'), 'le socket authentifié reçoit la commande')
    assert.equal(pending.frames.length, 0, 'le socket non authentifié ne reçoit RIEN')
    pending.ws.close()
    good.ws.close()
    await pending.waitClose()
    await good.waitClose()
  })

  it('le token legacy en query reste accepté pendant la transition (même exigence master)', async () => {
    const token = await masterToken()
    const sock = openDeskSocket(
      `ws://127.0.0.1:${server.address().port}/api/desk-stream?token=${encodeURIComponent(token)}`
    )
    await sock.open()
    await wait(250)
    assert.ok(sock.frames.some((f) => f.type === 'hello'), `frames : ${JSON.stringify(sock.frames)}`)
    sock.ws.close()
    await sock.waitClose()
  })
})

/* ------------------------------------------------------------------ 3.10 */

describe('LOT 3.10 (B15) — heartbeat : plus de sockets fantômes', () => {
  it('un client qui n’a pas répondu au ping est terminé et retiré du registre', () => {
    __notifyInternals.deskClients.clear()
    const wss = __deskSocketInternals.wss
    assert.ok(wss, 'le serveur WS est attaché')

    let terminated = 0
    let pinged = 0
    let healthyTerminated = 0
    const ghost = {
      isAlive: false, // n'a pas répondu au ping précédent
      readyState: 1, // ... et pourtant toujours « OPEN » : c'est tout le bug
      terminate: () => {
        terminated += 1
      },
      ping: () => {
        pinged += 1
      },
      send: () => {},
      close: () => {}
    }
    const healthy = {
      isAlive: true,
      readyState: 1,
      terminate: () => {
        healthyTerminated += 1
      },
      ping: () => {
        pinged += 1
      },
      send: () => {},
      close: () => {}
    }
    wss.clients.add(ghost)
    wss.clients.add(healthy)
    addDeskClient(ghost)
    addDeskClient(healthy)
    assert.equal(deskClientCount(), 2)

    // NB : `wss.clients` peut encore contenir des sockets réels des tests
    // précédents (fermés côté client, pas encore côté serveur) : le heartbeat
    // les termine aussi. On n'asserte donc que sur NOS deux faux clients.
    heartbeatOnce()
    assert.equal(terminated, 1, 'le fantôme est terminé')
    assert.equal(healthyTerminated, 0, 'le client sain ne doit pas être terminé')
    assert.equal(pinged, 1, 'seul le client sain est pingé')
    assert.equal(healthy.isAlive, false, 'le client sain attend maintenant son pong')
    assert.equal(deskClientCount(), 1, 'le fantôme ne doit plus être compté')
    assert.equal(broadcastDesk({ type: 'order:new' }), 1, 'diffusion vers le client vivant seul')

    // Pong reçu → le cycle suivant ne le tue pas.
    healthy.isAlive = true
    heartbeatOnce()
    assert.equal(healthyTerminated, 0, 'un client qui répond au ping survit')
    assert.equal(deskClientCount(), 1)

    wss.clients.delete(healthy)
    removeDeskClient(healthy)
    __notifyInternals.deskClients.clear()
  })

  it('un vrai socket authentifié survit à plusieurs cycles de heartbeat', async () => {
    const token = await masterToken()
    const sock = openDeskSocket()
    await sock.open()
    sock.send({ type: 'auth', token })
    await wait(200)
    assert.ok(sock.frames.some((f) => f.type === 'hello'))
    const before = deskClientCount()
    // 3 cycles (~250 ms chacun) : le client `ws` répond aux pings automatiquement.
    await wait(800)
    assert.equal(sock.closed, false, 'un client vivant ne doit pas être terminé par le heartbeat')
    assert.equal(deskClientCount(), before, 'le registre reste stable')
    sock.ws.close()
    await sock.waitClose()
    await wait(60)
    assert.equal(deskClientCount(), before - 1, 'la fermeture retire le client du registre')
  })
})
