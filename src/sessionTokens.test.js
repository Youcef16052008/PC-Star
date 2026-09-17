import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// ---------------------------------------------------------------------------
// Durcissement des jetons de session (demandé hors rapports, 15/09/2026).
//
// Avant : `db.sessions` était indexé PAR JETON. Les jetons valides — y compris
// celui du maître — étaient donc écrits en clair dans `store.json`, puis
// recopiés tels quels dans chaque backup (`backupStore`, timer 6 h + manuels) et
// dans chaque quarantine. Une copie qui fuit donnait des sessions immédiatement
// utilisables, sans mot de passe à deviner.
//
// Après : la clé est `sha256(token)` (hex, 64 caractères). Le jeton brut n'existe
// que dans la réponse d'authentification et dans le stockage du navigateur.
// Les sessions d'avant le changement (clés = jetons bruts) sont invalides et
// purgées du fichier sans attendre — tout le monde se reconnecte une fois.
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-sessions-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const { handler } = await import('../server/index.js')
const db = await import('../server/db.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

const DB_FILE = path.join(process.env.PCSTAR_DATA_DIR, 'store.json')
const HEX64 = /^[a-f0-9]{64}$/

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

beforeEach(() => __rateLimitInternals.buckets.clear())

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
  return { status: res.status, data }
}

const readStore = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {})
const readRaw = () => (fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf8') : '')
const sessionKeys = () => Object.keys(readStore().sessions || {})

async function loginMaster() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, `login maître : ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.token
}

async function registerClient(suffix = Date.now()) {
  const email = `sess.${suffix}@test.dz`
  const r = await call('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name: 'Client Sessions' }
  })
  assert.equal(r.status, 201, `inscription : ${r.status} ${JSON.stringify(r.data)}`)
  return { email, token: r.data.token, id: r.data.user?.id }
}

/* ------------------------------------------------------------------ unités */

describe('hashToken / putSession / findSession / deleteSession', () => {
  it('empreinte déterministe, 64 hex, et différente du jeton', () => {
    const tok = db.newToken()
    const h1 = db.hashToken(tok)
    assert.equal(h1, db.hashToken(tok), 'déterministe (sinon aucune recherche possible)')
    assert.match(h1, HEX64)
    assert.equal(h1.includes(tok), false)
    assert.equal(tok.length, 48, 'un jeton brut fait 48 hex — distinguable d’une empreinte')
    assert.notEqual(db.hashToken('a'), db.hashToken('b'))
  })

  it('putSession stocke l’empreinte, jamais le jeton', () => {
    const d = { sessions: {} }
    const tok = db.newToken()
    const key = db.putSession(d, tok, 'u1')
    assert.equal(key, db.hashToken(tok))
    assert.deepEqual(Object.keys(d.sessions), [key])
    assert.equal(d.sessions[key].userId, 'u1')
    assert.equal(JSON.stringify(d).includes(tok), false, 'le jeton brut ne doit pas être stocké')
  })

  it('findSession retrouve par jeton, et seulement par jeton exact', () => {
    const d = { sessions: {} }
    const tok = db.newToken()
    db.putSession(d, tok, 'u1')
    assert.equal(db.findSession(d, tok).userId, 'u1')
    assert.equal(db.findSession(d, db.hashToken(tok)), null, 'l’empreinte n’est pas un jeton')
    assert.equal(db.findSession(d, tok.slice(0, -1)), null)
    assert.equal(db.findSession(d, ''), null)
    assert.equal(db.findSession(d, null), null)
    assert.equal(db.findSession(null, tok), null)
  })

  it('findSession refuse immédiatement les sessions expirées ou malformées', () => {
    const d = { sessions: {} }
    const expired = db.newToken()
    const malformed = db.newToken()
    const fresh = db.newToken()
    d.sessions[db.hashToken(expired)] = { userId: 'old', at: Date.now() - db.SESSION_TTL_MS - 1 }
    d.sessions[db.hashToken(malformed)] = { userId: 'bad', at: 'hier' }
    d.sessions[db.hashToken(fresh)] = { userId: 'fresh', at: Date.now() }

    // Ce contrôle ne dépend pas de purgeExpired()/d'une écriture : c'est ce qui
    // protège les lectures JSONB de Neon entre deux mutations.
    assert.equal(db.findSession(d, expired), null)
    assert.equal(db.findSession(d, malformed), null)
    assert.equal(db.findSession(d, fresh)?.userId, 'fresh')
  })

  it('createSession renvoie un jeton utilisable et stocke son empreinte', () => {
    const d = {}
    const tok = db.createSession(d, 'u2')
    assert.equal(typeof tok, 'string')
    assert.match(tok, /^[a-f0-9]{48}$/)
    assert.deepEqual(Object.keys(d.sessions), [db.hashToken(tok)])
    assert.equal(db.findSession(d, tok).userId, 'u2')
  })

  it('deleteSession retire la bonne entrée et est idempotent', () => {
    const d = { sessions: {} }
    const a = db.createSession(d, 'u1')
    const b = db.createSession(d, 'u2')
    assert.equal(db.deleteSession(d, a), true)
    assert.equal(db.deleteSession(d, a), false, 'deuxième retrait : rien à faire')
    assert.equal(db.findSession(d, a), null)
    assert.equal(db.findSession(d, b).userId, 'u2', 'les autres sessions ne bougent pas')
    assert.equal(db.deleteSession(d, ''), false)
  })

  it('normalizeDb purge toute clé qui n’est pas une empreinte', () => {
    const d = db.emptyDb()
    db.normalizeDb(d) // première passe : le seed (utilisateurs, meta…)
    d.sessions['jeton-brut-48hex'] = { userId: 'u1', at: Date.now() }
    d.sessions[db.newToken()] = { userId: 'u2', at: Date.now() } // 48 hex : jeton brut
    d.sessions[db.hashToken('ok')] = { userId: 'u3', at: Date.now() }
    assert.equal(db.normalizeDb(d), true, 'la purge doit être signalée comme changement')
    assert.deepEqual(Object.keys(d.sessions), [db.hashToken('ok')], 'seule l’empreinte subsiste')
    assert.equal(db.normalizeDb(d), false, 'idempotent — plus aucun changement')
  })
})

/* ------------------------------------------------------------- bout en bout */

describe('Jetons de session en base — aucun jeton brut persisté', () => {
  it('login maître : le jeton fonctionne, la base ne contient que des empreintes', async () => {
    const token = await loginMaster()
    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 200, 'le jeton renvoyé est utilisable')
    assert.equal(me.data.user.role, 'master')

    const keys = sessionKeys()
    assert.ok(keys.length >= 1)
    assert.equal(keys.every((k) => HEX64.test(k)), true, `clés : ${keys.join(', ')}`)
    assert.equal(readRaw().includes(token), false, 'le jeton brut apparaît dans store.json')
    assert.equal(readStore().sessions[token], undefined)
    assert.ok(readStore().sessions[db.hashToken(token)], 'la session est bien là, sous son empreinte')
  })

  it('inscription : même garantie, et le jeton n’est pas la clé', async () => {
    const { token } = await registerClient(1)
    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 200)
    assert.equal(readRaw().includes(token), false, 'jeton brut persisté à l’inscription')
    assert.equal(sessionKeys().every((k) => HEX64.test(k)), true)
  })

  it('déconnexion : l’empreinte est retirée et le jeton ne répond plus', async () => {
    const { token } = await registerClient(2)
    const key = db.hashToken(token)
    assert.ok(readStore().sessions[key], 'session présente avant déconnexion')
    const out = await call('POST', '/api/auth/logout', { token })
    assert.equal(out.status, 200)
    assert.equal(readStore().sessions[key], undefined, 'session encore présente après déconnexion')
    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 401, 'un jeton déconnecté ne doit plus répondre')
  })

  it('présenter l’EMPREINTE comme jeton ne donne aucun accès', async () => {
    const token = await loginMaster()
    const forged = db.hashToken(token)
    const me = await call('GET', '/api/me', { token: forged })
    assert.equal(me.status, 401, 'lire la base ne doit pas suffire à s’authentifier')
  })

  it('changement de mot de passe : les AUTRES sessions sont révoquées, la courante conservée', async () => {
    const { email, token: current } = await registerClient(3)
    const second = await call('POST', '/api/auth/login', { body: { email, password: 'motdepasse123' } })
    assert.equal(second.status, 200)
    const other = second.data.token
    assert.ok(readStore().sessions[db.hashToken(other)], 'deuxième session enregistrée')

    const changed = await call('POST', '/api/me/password', {
      body: { current: 'motdepasse123', password: 'nouveaumotdepasse' },
      token: current
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.data))
    assert.equal(changed.data.revoked, 1, 'une autre session révoquée')

    const meCurrent = await call('GET', '/api/me', { token: current })
    assert.equal(meCurrent.status, 200, 'la session courante survit au changement de mot de passe')
    const meOther = await call('GET', '/api/me', { token: other })
    assert.equal(meOther.status, 401, 'le jeton volé doit être mort')
    assert.equal(readStore().sessions[db.hashToken(other)], undefined)
    assert.equal(readRaw().includes(other), false, 'le jeton révoqué ne traîne pas dans le fichier')
  })

  it('reset maître du mot de passe client : toutes les sessions du compte tombent', async () => {
    const master = await loginMaster()
    const { id, token } = await registerClient(4)
    const reset = await call('POST', `/api/master/customers/${id}/reset-password`, {
      body: { password: 'nouveaumotdepasse' },
      token: master
    })
    assert.equal(reset.status, 200, JSON.stringify(reset.data))
    assert.ok(reset.data.revoked >= 1, `révocations : ${reset.data.revoked}`)
    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 401, 'la session du compte réinitialisé doit être morte')
    assert.equal(readStore().sessions[db.hashToken(token)], undefined)
  })

  it('suppression d’un client : ses sessions partent avec le compte', async () => {
    const master = await loginMaster()
    const { id, token } = await registerClient(5)
    const key = db.hashToken(token)
    assert.ok(readStore().sessions[key])
    const del = await call('DELETE', `/api/customers/${id}`, { token: master })
    assert.ok([200, 404].includes(del.status), `suppression : ${del.status}`)
    if (del.status === 200) {
      assert.equal(readStore().sessions[key], undefined, 'sessions orphelines laissées en base')
      const me = await call('GET', '/api/me', { token })
      assert.equal(me.status, 401)
    }
  })
})

/* ---------------------------------------------------------------- migration */

describe('Migration — sessions d’avant le hachage', () => {
  it('un jeton brut resté en base ne fonctionne plus et est purgé du fichier', async () => {
    const legacyToken = db.newToken() // 48 hex : la forme d’avant
    const store = readStore()
    store.sessions = store.sessions || {}
    store.sessions[legacyToken] = { userId: 'master-pcstar', at: Date.now() }
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2))
    assert.ok(readRaw().includes(legacyToken), 'fixture : le jeton brut est bien sur le disque')

    // Une lecture suffit : la purge est immédiate (propriété de sécurité, comme
    // `_lastAuth`) — un backup pris avant la prochaine écriture ne doit pas
    // emporter de jeton utilisable.
    const me = await call('GET', '/api/me', { token: legacyToken })
    assert.equal(me.status, 401, 'une clé legacy ne doit plus authentifier personne')
    assert.equal(readRaw().includes(legacyToken), false, 'le jeton brut est encore sur le disque')
    assert.equal(readStore().sessions[legacyToken], undefined)
    assert.equal(sessionKeys().every((k) => HEX64.test(k)), true)
  })

  it('les sessions hachées survivent à la purge des clés legacy', async () => {
    const token = await loginMaster()
    const legacy = 'b2'.repeat(24)
    const store = readStore()
    store.sessions[legacy] = { userId: 'u-x', at: Date.now() }
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2))

    const me = await call('GET', '/api/me', { token })
    assert.equal(me.status, 200, 'la session hachée doit continuer de fonctionner')
    assert.equal(readRaw().includes(legacy), false, 'clé legacy purgée')
    assert.ok(readStore().sessions[db.hashToken(token)], 'empreinte conservée')
  })
})
