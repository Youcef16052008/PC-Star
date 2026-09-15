import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// LOT 3 — robustesse & concurrence, partie CLIENTE (modules purs, sans React).
//
//  3.1  (F7+F8) `safeStorage` : un stockage qui lève (SecurityError en iframe
//               tierce, QuotaExceededError) ne casse rien et bascule en mémoire
//  3.8  (B11)   un 401 sur une route authentifiée déclenche le handler global
//  3.9  (B13)   … sauf sur `/api/auth/*` (login/register/me gèrent eux-mêmes)
//  3.10 (B14)   `createDeskStream` arrête de retenter le socket après N échecs
//               consécutifs (cas Vercel : pas de WebSocket serverless)
//  3.11 (B16)   l'horodatage du dernier pull Desk est persisté
//  3.18 (R14)   aucun token dans l'URL du socket : authentification par message
//
// Les comportements React (bandeau dégradé daté, toast « session expirée »,
// garde de stock au double-clic, résas manquées) sont dans src/lot3UI.test.js ;
// le montage avec un stockage bloqué, dans src/lot3StorageBlocked.test.js.
// ---------------------------------------------------------------------------

const {
  createSafeStorage,
  asSafeStorage,
  safeStorage,
  storageMode,
  isStorageBlocked,
  resetSafeStorage
} = await import('./safeStorage.js')
const { loadDeskSeenAt, saveDeskSeenAt, loadOrders, saveOrders } = await import('./prefs.js')
const { createMemoryStorage } = await import('./shopStore.js')
const api = await import('./api.js')
const { createDeskStream } = await import('./deskStream.js')

/* ------------------------------------------------------- 3.1 safeStorage */

describe('LOT 3.1 (F7 + F8) — safeStorage ne lève jamais', () => {
  /** `localStorage` d'une iframe tierce : le getter comme les accès lèvent. */
  const securityErrorStorage = () => {
    const boom = () => {
      const e = new Error('The operation is insecure.')
      e.name = 'SecurityError'
      throw e
    }
    return { getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 0 }
  }

  it('SecurityError sur chaque accès → repli mémoire, aucune exception', () => {
    const st = createSafeStorage(securityErrorStorage())
    assert.doesNotThrow(() => st.setItem('panier', '{"a":1}'))
    assert.equal(st.getItem('panier'), '{"a":1}', 'la valeur doit survivre en mémoire')
    assert.equal(st.setItem('panier', '{"a":2}'), false, 'l’écriture persistante a échoué')
    assert.equal(st.getItem('panier'), '{"a":2}')
    assert.doesNotThrow(() => st.removeItem('panier'))
    assert.equal(st.getItem('panier'), null)
    assert.equal(st.blocked, true)
    assert.equal(st.persistent, false)
    assert.equal(storageMode(st), 'memory')
    assert.equal(isStorageBlocked(st), true, 'l’UI doit pouvoir le dire')
    assert.equal(st.error?.name, 'SecurityError')
  })

  it('QuotaExceededError en cours de session → la copie mémoire fait foi', () => {
    const disk = new Map([['k', 'ancienne-valeur']])
    let quota = false
    const st = createSafeStorage({
      getItem: (k) => disk.get(String(k)) ?? null,
      setItem: (k, v) => {
        if (quota) {
          const e = new Error('quota')
          e.name = 'QuotaExceededError'
          throw e
        }
        disk.set(String(k), String(v))
      },
      removeItem: (k) => disk.delete(String(k))
    })
    assert.equal(st.setItem('k', 'v1'), true)
    assert.equal(st.getItem('k'), 'v1')
    quota = true // le disque se remplit (photos master en data-URL)
    assert.equal(st.setItem('k', 'v2'), false)
    assert.equal(st.getItem('k'), 'v2', 'sans ombrage on relirait la valeur périmée du disque')
    assert.equal(disk.get('k'), 'v1')
    assert.equal(st.persistent, false)
  })

  it('asSafeStorage : null → wrapper partagé ; un stockage brut est enveloppé (et mis en cache)', () => {
    assert.equal(asSafeStorage(null), safeStorage)
    assert.equal(asSafeStorage(safeStorage), safeStorage)
    const raw = createMemoryStorage()
    const w1 = asSafeStorage(raw)
    const w2 = asSafeStorage(raw)
    assert.equal(w1, w2, 'le wrapper doit être stable pour un même stockage')
    assert.notEqual(w1, safeStorage)
    assert.equal(w1.persistent, true)
    assert.equal(storageMode(w1), 'persistent')
    assert.equal(isStorageBlocked(w1), false)
    // Un wrapper déjà sûr n'est pas ré-enveloppé.
    assert.equal(asSafeStorage(w1), w1)
  })

  it('prefs : langue/panier/commandes passent par le wrapper et survivent au stockage mort', () => {
    const st = createSafeStorage(securityErrorStorage())
    const orders = [{ code: 'PS-TEST-1', name: 'Client', total: 1000, items: [] }]
    assert.doesNotThrow(() => saveOrders(st, orders))
    assert.deepEqual(loadOrders(st), orders)
    const mem = createMemoryStorage()
    saveOrders(mem, orders)
    assert.deepEqual(loadOrders(mem), orders)
  })
})

/* ------------------------------------------------- 3.11 (B16) deskSeenAt */

describe('LOT 3.11 (B16) — horodatage du dernier pull Desk', () => {
  it('round-trip : absent → 0 (« jamais vu »), posé → relu à l’identique', () => {
    const st = createMemoryStorage()
    assert.equal(loadDeskSeenAt(st), 0)
    const at = Date.now()
    saveDeskSeenAt(st, at)
    assert.equal(loadDeskSeenAt(st), at)
  })

  it('valeur corrompue, non finie ou négative → 0, jamais NaN', () => {
    const st = createMemoryStorage()
    st.setItem('pcstar-desk-seen-at', 'pas-un-nombre')
    assert.equal(loadDeskSeenAt(st), 0)
    saveDeskSeenAt(st, Number.NaN)
    assert.equal(loadDeskSeenAt(st), 0, 'une écriture invalide ne change rien')
    saveDeskSeenAt(st, 0)
    assert.equal(loadDeskSeenAt(st), 0)
    saveDeskSeenAt(st, -5)
    assert.equal(loadDeskSeenAt(st), 0)
  })

  it('stockage bloqué → aucune exception, la valeur survit en mémoire', () => {
    const boom = () => {
      const e = new Error('insecure')
      e.name = 'SecurityError'
      throw e
    }
    const st = createSafeStorage({ getItem: boom, setItem: boom, removeItem: boom })
    const at = Date.now()
    assert.doesNotThrow(() => saveDeskSeenAt(st, at))
    assert.equal(loadDeskSeenAt(st), at, 'le repli mémoire doit rendre la valeur')
    assert.equal(isStorageBlocked(st), true)
  })
})

/* ----------------------------------------------------- 3.8/3.9 handler 401 */

describe('LOT 3.8 + 3.9 (B11 + B13) — handler global de session expirée', () => {
  const realFetch = globalThis.fetch
  let calls = []

  beforeEach(() => {
    resetSafeStorage()
    calls = []
    api.clearUnauthorizedHandler()
  })

  afterEach(() => {
    api.clearUnauthorizedHandler()
    globalThis.fetch = realFetch
    resetSafeStorage()
  })

  /** fetch simulé : 401 sur les routes listées, 200 ailleurs. */
  function fakeFetch(unauthorized = ['/api/orders']) {
    globalThis.fetch = async (url, opts) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '')
      calls.push({ path, method: opts?.method || 'GET' })
      const is401 = unauthorized.some((p) => path.startsWith(p))
      return {
        ok: !is401,
        status: is401 ? 401 : 200,
        headers: { get: () => null },
        json: async () => (is401 ? { ok: false, error: 'auth' } : { ok: true, orders: [], user: { id: 'u1' } })
      }
    }
  }

  it('401 sur une route authentifiée → handler appelé une fois', async () => {
    api.setToken('tok-valide')
    fakeFetch(['/api/orders'])
    let hits = 0
    api.setUnauthorizedHandler(() => {
      hits += 1
    })
    const r = await api.listOrders()
    assert.equal(r.status, 401)
    assert.equal(hits, 1, 'le handler doit être appelé')
    assert.equal(calls[0].path, '/api/orders')
  })

  it('401 sur /api/auth/login et /api/auth/register → handler NON appelé', async () => {
    // Un identifiant erroné est une réponse NORMALE du formulaire de connexion :
    // annoncer « session expirée » à ce moment-là serait faux (et inquiétant).
    api.setToken('tok')
    fakeFetch(['/api/auth/login', '/api/auth/register'])
    let hits = 0
    api.setUnauthorizedHandler(() => {
      hits += 1
    })
    const login = await api.login('a@b.c', 'faux')
    assert.equal(login.status, 401)
    assert.equal(hits, 0, 'un mot de passe erroné ne doit pas annoncer « session expirée »')
    const reg = await api.register({ email: 'a@b.c', password: 'faux1234', name: 'A' })
    assert.equal(reg.status, 401)
    assert.equal(hits, 0)
  })

  it('401 sur /api/me → handler appelé : le jeton stocké est mort', async () => {
    // Démarrage avec un jeton expiré/révoqué : l'utilisateur doit le savoir au
    // lieu de se retrouver silencieusement en mode local.
    api.setToken('vieux-jeton')
    fakeFetch(['/api/me'])
    let hits = 0
    api.setUnauthorizedHandler((info) => {
      hits += 1
      assert.equal(info.status, 401)
      assert.equal(info.path, '/api/me')
    })
    const me = await api.me()
    assert.equal(me.status, 401)
    assert.equal(hits, 1)
  })

  it('clearUnauthorizedHandler coupe le signal ; un 200 ne déclenche rien', async () => {
    api.setToken('tok')
    fakeFetch([]) // tout en 200
    let hits = 0
    api.setUnauthorizedHandler(() => {
      hits += 1
    })
    await api.listOrders()
    assert.equal(hits, 0)
    fakeFetch(['/api/orders'])
    api.clearUnauthorizedHandler()
    const r = await api.listOrders()
    assert.equal(r.status, 401)
    assert.equal(hits, 0)
  })

  it('setUnauthorizedHandler remplace le handler précédent (pas d’accumulation)', async () => {
    api.setToken('tok')
    fakeFetch(['/api/orders'])
    let a = 0
    let b = 0
    api.setUnauthorizedHandler(() => {
      a += 1
    })
    api.setUnauthorizedHandler(() => {
      b += 1
    })
    await api.listOrders()
    assert.equal(a, 0, 'l’ancien handler ne doit plus être appelé')
    assert.equal(b, 1)
  })

  it('une réponse réseau en échec n’est pas traitée comme une session expirée', async () => {
    api.setToken('tok')
    globalThis.fetch = async () => {
      throw new TypeError('offline')
    }
    let hits = 0
    api.setUnauthorizedHandler(() => {
      hits += 1
    })
    const r = await api.listOrders()
    assert.equal(r.ok, false)
    assert.equal(hits, 0, 'hors-ligne ≠ session morte')
  })
})

/* ------------------------------------------------- 3.10 (B14) + 3.18 (R14) */

describe('LOT 3.10 (B14) — createDeskStream arrête de retenter un socket mort', () => {
  const savedWs = globalThis.WebSocket
  const savedLoc = globalThis.location
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  beforeEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:5173' },
      configurable: true,
      writable: true
    })
  })

  afterEach(() => {
    globalThis.WebSocket = savedWs
    Object.defineProperty(globalThis, 'location', { value: savedLoc, configurable: true, writable: true })
  })

  /** WebSocket simulé : échoue (onclose) ou réussit selon le plan fourni. */
  function fakeSocket(plan, log) {
    let n = 0
    globalThis.WebSocket = class {
      constructor(url) {
        const i = n++
        log.push({ i, url, sent: [] })
        this.sent = log[i].sent
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
        const outcome = plan(i)
        setTimeout(() => {
          if (outcome === 'open') this.onopen?.()
          else this.onclose?.({ code: outcome === 'throw' ? 1006 : 1005 })
        }, 1)
      }
      send(frame) {
        this.sent.push(String(frame))
      }
      close() {
        this.onclose?.({ code: 1000 })
      }
    }
  }

  it('échec répété de l’upgrade → abandon après N tentatives, polling maintenu', async () => {
    const log = []
    fakeSocket(() => 'close', log)
    let giveUps = 0
    let refreshes = 0
    const stream = createDeskStream({
      getToken: () => 'tok',
      onRefresh: () => {
        refreshes += 1
      },
      onGiveUp: (info) => {
        giveUps += 1
        assert.equal(info.fails, 3)
      },
      pollMs: 8,
      maxReconnectFails: 3,
      reconnectMinMs: 2,
      reconnectMaxMs: 4
    })
    try {
      await wait(200)
      assert.equal(log.length, 3, `tentatives : ${log.length} (attendu 3, plafond atteint)`)
      assert.equal(stream.socketGaveUp(), true, 'le socket doit être abandonné')
      assert.equal(giveUps, 1, 'onGiveUp appelé une seule fois')
      const before = stream.pollCount()
      await wait(80)
      assert.ok(stream.pollCount() > before, 'le polling continue après l’abandon')
      assert.equal(stream.isLive(), false)
      assert.ok(refreshes >= 3, `le polling a bien rafraîchi (${refreshes})`)
    } finally {
      stream.close()
    }
  })

  it('un constructeur qui lève (proxy bloquant) est compté comme un échec', async () => {
    const log = []
    globalThis.WebSocket = class {
      constructor(url) {
        log.push(url)
        throw new Error('bloqué par le proxy')
      }
    }
    const stream = createDeskStream({
      getToken: () => 'tok',
      onRefresh: () => {},
      pollMs: 8,
      maxReconnectFails: 4,
      reconnectMinMs: 2,
      reconnectMaxMs: 3
    })
    try {
      await wait(150)
      assert.equal(log.length, 4, `tentatives : ${log.length}`)
      assert.equal(stream.socketGaveUp(), true)
      assert.equal(stream.pollCount() > 0, true, 'le polling prend le relais')
    } finally {
      stream.close()
    }
  })

  it('une ouverture réussie remet le compteur à zéro (échecs CONSÉCUTIFS)', async () => {
    const log = []
    // échec, échec, succès, puis échec à nouveau
    fakeSocket((i) => (i === 2 ? 'open' : 'close'), log)
    const stream = createDeskStream({
      getToken: () => 'tok-master',
      onRefresh: () => {},
      pollMs: 8,
      livePollMs: 100000,
      maxReconnectFails: 3,
      reconnectMinMs: 2,
      reconnectMaxMs: 3
    })
    try {
      await wait(120)
      assert.equal(stream.isLive(), true, 'le 3e essai aboutit')
      assert.equal(stream.reconnectFails(), 0, 'le compteur d’échecs est remis à zéro')
      assert.equal(stream.socketGaveUp(), false)
      // LOT 3.18 (R14) : aucun token dans l'URL ; l'authentification est le
      // premier message envoyé.
      assert.equal(log[2].url, 'ws://localhost:5173/api/desk-stream')
      assert.equal(log[2].url.includes('token='), false)
      assert.deepEqual(JSON.parse(log[2].sent[0]), { type: 'auth', token: 'tok-master' })
    } finally {
      stream.close()
    }
  })

  it('maxReconnectFails: 0 → tentatives illimitées (comportement historique)', async () => {
    const log = []
    fakeSocket(() => 'close', log)
    const stream = createDeskStream({
      getToken: () => 'tok',
      onRefresh: () => {},
      pollMs: 1000,
      maxReconnectFails: 0,
      reconnectMinMs: 2,
      reconnectMaxMs: 3
    })
    try {
      await wait(120)
      assert.ok(log.length > 4, `sans plafond on retente (${log.length})`)
      assert.equal(stream.socketGaveUp(), false)
    } finally {
      stream.close()
    }
  })
})
