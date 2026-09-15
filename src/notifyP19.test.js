import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// P19 — notification du master + suppression de commande.
//
// Trois comportements exigés par le comptoir :
//   1. une commande arrivée doit être poussée au Desk (socket) et notifiée
//      (navigateur + WhatsApp) — sans attendre la fenêtre de polling de 20 s ;
//   2. le master doit pouvoir SUPPRIMER une commande (ses propres tests ne
//      doivent pas rester dans l'historique) — avec le stock rendu ;
//   3. rien de tout cela ne doit casser une commande client si WhatsApp tombe
//      ou si le socket est indisponible (cas Vercel).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p19-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const { handler } = await import('../server/index.js')
const { deleteOrder, placeOrder, liveStockOf, ensureStock } = await import('../server/catalog.js')
const {
  whatsappConfig,
  formatOrderMessage,
  sendWhatsApp,
  broadcastDesk,
  addDeskClient,
  removeDeskClient,
  deskClientCount,
  __notifyInternals
} = await import('../server/notify.js')
const { createDeskStream } = await import('./deskStream.js')
const { notifyNewOrder, showNotification, notificationPermission } = await import('./notify.js')
const { dict } = await import('./i18n.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

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

async function masterToken() {
  const r = await call('POST', '/api/auth/login', { body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD } })
  assert.ok(r.data?.token, `login master impossible : ${JSON.stringify(r.data)}`)
  return r.data.token
}

// ---------------------------------------------------------------- catalogue

describe('P19 — deleteOrder (catalog)', () => {
  it('supprime la ligne et rend le stock', () => {
    const db = { users: [], orders: [], stock: {}, meta: {} }
    ensureStock(db)
    const avant = liveStockOf(db, 'cpu-7800x3d')
    const r = placeOrder(db, { items: [{ id: 'cpu-7800x3d', qty: 2 }], name: 'Test', phone: '0550123456' })
    assert.ok(r.ok, 'placeOrder a échoué')
    assert.equal(liveStockOf(db, 'cpu-7800x3d'), avant - 2, 'stock non réservé')

    const d = deleteOrder(db, r.order.code)
    assert.equal(d.ok, true)
    assert.equal(d.restocked, true)
    assert.equal(liveStockOf(db, 'cpu-7800x3d'), avant, 'stock non rendu')
    assert.equal(db.orders.length, 0, 'la commande est encore là')
  })

  it('une seconde suppression répond not_found et ne rend pas le stock deux fois', () => {
    const db = { users: [], orders: [], stock: {}, meta: {} }
    ensureStock(db)
    const avant = liveStockOf(db, 'cpu-7800x3d')
    const r = placeOrder(db, { items: [{ id: 'cpu-7800x3d', qty: 3 }], name: 'Test', phone: '0550123456' })
    deleteOrder(db, r.order.code)
    const apres = liveStockOf(db, 'cpu-7800x3d')
    assert.equal(apres, avant)
    const again = deleteOrder(db, r.order.code)
    assert.deepEqual(again, { ok: false, error: 'not_found' })
    assert.equal(liveStockOf(db, 'cpu-7800x3d'), avant, 'stock rendu en double')
  })

  it('une commande déjà annulée ne rend pas le stock une seconde fois', () => {
    const db = { users: [], orders: [], stock: {}, meta: {} }
    ensureStock(db)
    const avant = liveStockOf(db, 'cpu-7800x3d')
    const r = placeOrder(db, { items: [{ id: 'cpu-7800x3d', qty: 2 }], name: 'Test', phone: '0550123456' })
    db.orders[0].status = 'cancelled' // l'annulation a déjà rendu le stock
    const d = deleteOrder(db, r.order.code)
    assert.equal(d.ok, true)
    assert.equal(d.restocked, false, 'ne doit pas rendre le stock')
    assert.equal(liveStockOf(db, 'cpu-7800x3d'), avant - 2, 'le stock de la commande annulée a bougé')
  })
})

// ------------------------------------------------------------------- routes

describe('P19 — DELETE /api/orders/:code', () => {
  it('refuse sans session master (403)', async () => {
    const r = await call('DELETE', '/api/orders/PS-INCONNU')
    assert.equal(r.status, 403, `statut inattendu : ${r.status}`)
  })

  it('404 sur un code inexistant, et supprime une commande réelle', async () => {
    const token = await masterToken()

    const missing = await call('DELETE', '/api/orders/PS-INEXISTANT', { token })
    assert.equal(missing.status, 404, `statut inattendu : ${missing.status}`)
    assert.equal(missing.data?.error, 'not_found')

    const created = await call('POST', '/api/orders', {
      body: { items: [{ id: 'cpu-7800x3d', qty: 1 }], name: 'Test P19', phone: '0550123456', wilaya: 'Oran' },
      token
    })
    assert.equal(created.status, 201, `création refusée : ${JSON.stringify(created.data)}`)
    const code = created.data.order.code

    const listed = await call('GET', '/api/orders', { token })
    assert.ok(listed.data.orders.some((o) => o.code === code), 'la commande créée n\'est pas listée')

    const del = await call('DELETE', `/api/orders/${code}`, { token })
    assert.equal(del.status, 200, `suppression refusée : ${JSON.stringify(del.data)}`)
    assert.equal(del.data.ok, true)
    assert.equal(del.data.restocked, true)

    const after = await call('GET', '/api/orders', { token })
    assert.ok(!after.data.orders.some((o) => o.code === code), 'la commande supprimée est encore listée')
  })

  it('une session non-master ne peut pas supprimer', async () => {
    const created = await call('POST', '/api/auth/register', {
      body: { email: `client.p19.${Date.now()}@example.dz`, password: 'motdepasse123', name: 'Client P19' }
    })
    const token = created.data?.token
    assert.ok(token, `inscription client impossible : ${JSON.stringify(created.data)}`)
    const r = await call('DELETE', '/api/orders/PS-PEUIMPORTE', { token })
    assert.equal(r.status, 403, `statut inattendu : ${r.status}`)
  })
})

// ------------------------------------------------------------------ WhatsApp

describe('P19 — WhatsApp Cloud API', () => {
  it('non configuré par défaut : désactivé, destinataire = numéro du magasin', () => {
    const cfg = whatsappConfig({})
    assert.equal(cfg.enabled, false)
    assert.equal(cfg.recipient, '213770650387')
    assert.equal(cfg.apiVersion, 'v21.0')
  })

  it('activé dès que le token et le phone_number_id sont présents', () => {
    const cfg = whatsappConfig({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_RECIPIENT: ' 213 550 123 456 ' })
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.recipient, '213550123456', 'les espaces doivent être retirés')
  })

  it('sans configuration, l’envoi est ignoré sans erreur (jamais bloquant)', async () => {
    const r = await sendWhatsApp('bonjour', { env: {} })
    assert.deepEqual(r, { ok: false, skipped: true, error: 'not_configured' })
  })

  it('configuré, l’envoi POSTe le payload Cloud API attendu', async () => {
    let seen = null
    const fetchImpl = async (url, opts) => {
      seen = { url, opts }
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }
    }
    const env = { WHATSAPP_TOKEN: 'EAAtok', WHATSAPP_PHONE_NUMBER_ID: '109876543210', WHATSAPP_RECIPIENT: '213770650387', WHATSAPP_API_VERSION: 'v21.0' }
    const r = await sendWhatsApp('Nouvelle commande PS-1', { env, fetchImpl })
    assert.equal(r.ok, true, `envoi échoué : ${JSON.stringify(r)}`)
    assert.equal(seen.url, 'https://graph.facebook.com/v21.0/109876543210/messages')
    assert.equal(seen.opts.method, 'POST')
    assert.equal(seen.opts.headers.Authorization, 'Bearer EAAtok')
    const body = JSON.parse(seen.opts.body)
    assert.equal(body.messaging_product, 'whatsapp')
    assert.equal(body.to, '213770650387')
    assert.equal(body.type, 'text')
    assert.equal(body.text.body, 'Nouvelle commande PS-1')
    assert.equal(body.text.preview_url, true, 'le lien wa.me doit être cliquable')
  })

  it('une erreur HTTP de Meta est remontée sans lever d’exception', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid token' } }) })
    const env = { WHATSAPP_TOKEN: 'mauvais', WHATSAPP_PHONE_NUMBER_ID: '123' }
    const r = await sendWhatsApp('texte', { env, fetchImpl })
    assert.equal(r.ok, false)
    assert.match(String(r.error), /^http_401/)
  })

  it('un fetch qui rejette ne propage pas l’exception', async () => {
    const fetchImpl = async () => {
      throw new Error('réseau coupé')
    }
    const env = { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '123' }
    const r = await sendWhatsApp('texte', { env, fetchImpl })
    assert.equal(r.ok, false)
    assert.ok(r.error, 'une erreur doit être rapportée')
  })
})

describe('P19 — formatOrderMessage', () => {
  const order = {
    code: 'PS-20260913-0002',
    name: 'Karim Ben',
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '14h-16h',
    total: 148000,
    items: [
      { name: 'Ryzen 7 7800X3D', qty: 1, price: 97000 },
      { name: 'RTX 4070', qty: 1, price: 51000 }
    ]
  }

  it('contient le code, le client, le total et les articles', () => {
    const msg = formatOrderMessage(order)
    assert.match(msg, /PS-20260913-0002/)
    assert.match(msg, /Karim Ben/)
    assert.match(msg, /0550123456/)
    assert.match(msg, /Oran/)
    assert.match(msg, /148\s?000/)
    assert.match(msg, /Ryzen 7 7800X3D/)
    assert.match(msg, /RTX 4070/)
  })

  it('le lien de rappel est au format international (P14 #3)', () => {
    const msg = formatOrderMessage(order)
    assert.match(msg, /https:\/\/wa\.me\/213550123456/, `lien invalide : ${msg.split('\n').pop()}`)
    assert.ok(!/wa\.me\/0\d/.test(msg), 'un numéro local en 0… ne fonctionne pas sur wa.me')
  })
})

// ------------------------------------------------------------------- socket

describe('P19 — registre de clients Desk', () => {
  it('ajoute, diffuse et retire un client', () => {
    __notifyInternals.deskClients.clear()
    const sent = []
    const fake = { readyState: 1, send: (m) => sent.push(m), close() {} }
    addDeskClient(fake)
    assert.equal(deskClientCount(), 1)

    broadcastDesk({ type: 'order:new', order: { code: 'PS-X' } })
    assert.equal(sent.length, 1)
    assert.equal(JSON.parse(sent[0]).type, 'order:new')

    removeDeskClient(fake)
    assert.equal(deskClientCount(), 0)
  })

  it('un client déjà fermé est retiré sans interrompre la diffusion', () => {
    __notifyInternals.deskClients.clear()
    const dead = { readyState: 3, send: () => { throw new Error('fermé') } }
    const alive = { readyState: 1, send() {}, close() {} }
    addDeskClient(dead)
    addDeskClient(alive)
    assert.doesNotThrow(() => broadcastDesk({ type: 'order:new' }))
    assert.equal(deskClientCount(), 1, 'le client mort doit être retiré')
    __notifyInternals.deskClients.clear()
  })
})

describe('P19 — createDeskStream (client)', () => {
  it('sans WebSocket disponible, retombe sur le polling', async () => {
    const saved = globalThis.WebSocket
    delete globalThis.WebSocket
    let refreshes = 0
    const stream = createDeskStream({
      getToken: () => 'tok',
      onRefresh: () => {
        refreshes += 1
      },
      pollMs: 15
    })
    try {
      assert.equal(stream.isLive(), false)
      await new Promise((r) => setTimeout(r, 60))
      assert.ok(refreshes >= 2, `le polling n'a pas pris le relais (${refreshes} appel(s))`)
    } finally {
      stream.close()
      if (saved) globalThis.WebSocket = saved
    }
  })

  it('sans token, n’ouvre pas de socket et poll quand même', async () => {
    let opened = 0
    const saved = globalThis.WebSocket
    globalThis.WebSocket = class {
      constructor() {
        opened += 1
      }
    }
    let refreshes = 0
    const stream = createDeskStream({ getToken: () => null, onRefresh: () => { refreshes += 1 }, pollMs: 15 })
    try {
      assert.equal(opened, 0, 'aucun socket ne doit être ouvert sans token')
      await new Promise((r) => setTimeout(r, 50))
      assert.ok(refreshes >= 2, 'le polling doit fonctionner sans token')
    } finally {
      stream.close()
      globalThis.WebSocket = saved
    }
  })

  it('socket ouvert : passe en live, rafraîchit tout de suite, puis se replie à la fermeture', async () => {
    const savedWs = globalThis.WebSocket
    const savedLoc = globalThis.location
    // Le navigateur fournit `location` ; Node non. Sans hôte, le module
    // retombe volontairement sur le polling — on simule donc une origine.
    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:5173' },
      configurable: true,
      writable: true
    })
    let instance = null
    globalThis.WebSocket = class {
      constructor(url) {
        this.url = url
        instance = this
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
      }
      close() {
        this.onclose?.()
      }
    }
    let refreshes = 0
    const events = []
    // try/finally impératif : sans `close()`, l'intervalle de polling resterait
    // vivant et le runner de tests ne se terminerait jamais.
    const stream = createDeskStream({
      getToken: () => 'tok-master',
      onEvent: (m) => events.push(m),
      onRefresh: () => {
        refreshes += 1
      },
      pollMs: 15,
      livePollMs: 100000
    })
    try {
      assert.ok(instance, 'le socket doit être créé')
      assert.match(instance.url, /\/api\/desk-stream\?token=tok-master/)

      instance.onopen?.()
      assert.equal(stream.isLive(), true)
      assert.ok(refreshes >= 1, 'un rafraîchissement immédiat est attendu à l\'ouverture')

      const before = refreshes
      instance.onmessage?.({ data: JSON.stringify({ type: 'order:new', order: { code: 'PS-1' } }) })
      assert.equal(events.length, 1)
      assert.ok(refreshes > before, 'une commande reçue doit déclencher un rafraîchissement')

      // Message invalide : ignoré, pas d'exception.
      assert.doesNotThrow(() => instance.onmessage?.({ data: 'pas-du-json' }))

      instance.close()
      assert.equal(stream.isLive(), false, 'le socket fermé doit repasser hors live')
      await new Promise((r) => setTimeout(r, 50))
      assert.ok(refreshes > before + 1, 'le polling doit reprendre après la coupure')
    } finally {
      stream.close()
      globalThis.WebSocket = savedWs
      Object.defineProperty(globalThis, 'location', { value: savedLoc, configurable: true, writable: true })
    }
  })

  it('un constructeur WebSocket qui lève retombe aussi sur le polling', async () => {
    const saved = globalThis.WebSocket
    globalThis.WebSocket = class {
      constructor() {
        throw new Error('bloqué par le proxy')
      }
    }
    let refreshes = 0
    const stream = createDeskStream({
      getToken: () => 'tok',
      onRefresh: () => {
        refreshes += 1
      },
      pollMs: 15
    })
    try {
      await new Promise((r) => setTimeout(r, 50))
      assert.ok(refreshes >= 2, 'le polling doit prendre le relais')
    } finally {
      stream.close()
      globalThis.WebSocket = saved
    }
  })
})

// ------------------------------------------------------- notification nav.

describe('P19 — notification navigateur', () => {
  it('sans permission, rien n’est affiché', () => {
    const saved = globalThis.window
    globalThis.window = { Notification: { permission: 'default', requestPermission: async () => 'denied' } }
    assert.equal(notificationPermission(), 'default')
    assert.equal(showNotification({ title: 'x' }), false)
    assert.equal(notifyNewOrder({ code: 'PS-1', name: 'A', phone: '0550123456', total: 1000 }, () => 'Nouvelle commande'), false)
    globalThis.window = saved
  })

  it('permission accordée : la notification part avec le code en tag', () => {
    const saved = globalThis.window
    const made = []
    globalThis.window = {
      Notification: class {
        constructor(title, opts) {
          this.title = title
          this.opts = opts
          made.push({ title, opts })
        }
        static permission = 'granted'
        close() {}
      },
      focus() {}
    }
    const ok = notifyNewOrder(
      { code: 'PS-20260913-0007', name: 'Karim', phone: '0550123456', total: 148000 },
      (k) => (k === 'deskNotifyTitle' ? 'Nouvelle commande' : k)
    )
    assert.equal(ok, true)
    assert.equal(made.length, 1)
    assert.match(made[0].title, /PS-20260913-0007/)
    assert.match(made[0].opts.body, /Karim/)
    assert.match(made[0].opts.body, /148/)
    assert.equal(made[0].opts.tag, 'pcstar-order-PS-20260913-0007')
    globalThis.window = saved
  })

  it('API Notification absente : silencieux, pas d’exception', () => {
    const saved = globalThis.window
    globalThis.window = {}
    assert.equal(notificationPermission(), 'unsupported')
    assert.equal(showNotification({ title: 'x' }), false)
    globalThis.window = saved
  })
})

// -------------------------------------------------------------------- i18n

describe('P19 — clés i18n', () => {
  it('les 5 nouvelles clés existent dans les 3 langues', () => {
    const keys = ['deskDelete', 'deskDeleteFail', 'confirmDeleteOrder', 'deskNotifyTitle', 'orderDeleted']
    for (const lang of ['ar', 'fr', 'en']) {
      for (const k of keys) assert.ok(k in dict[lang], `${lang}.${k} manquante`)
    }
  })

  it('les dictionnaires restent symétriques', () => {
    const counts = ['ar', 'fr', 'en'].map((l) => Object.keys(dict[l]).length)
    assert.equal(new Set(counts).size, 1, `asymétrie : ${JSON.stringify(counts)}`)
  })
})
