// Date de retrait + gestion master — chemin HTTP complet.
//
// 1. Le client choisit une DATE de retrait (pas seulement un créneau) au
//    checkout ; le serveur la valide (format ISO court) et la stocke.
// 2. Le comptoir annonce ou décale cette date (PATCH dédié, avec ou sans
//    changement de statut) ; le client la voit dans « Mes commandes ».
// 3. Le maître peut SUPPRIMER définitivement un produit qu'il a créé ; les
//    produits du catalogue de base se masquent, ils ne se suppriment pas.
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { PRODUCTS } from '../src/data.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-pickup-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.FRONT_URL = 'http://127.0.0.1:5173'
delete process.env.TRUST_PROXY
delete process.env.VERCEL
const DB_FILE = path.join(dir, 'store.json')

const { handler } = await import('../server/index.js')
const { setOrderPickupDate } = await import('../server/catalog.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

const PRODUCTS_BASE_ID = PRODUCTS[0].id

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

beforeEach(() => {
  __rateLimitInternals.buckets.clear()
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
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { status: res.status, data }
}

const readStore = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {})
const storeOrder = (code) => (readStore().orders || []).find((o) => o.code === code)

async function loginMaster() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, `login maître : ${r.status}`)
  return r.data.token
}

async function registerClient() {
  const email = `pickup.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.dz`
  const r = await call('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name: 'Client Retrait' }
  })
  assert.equal(r.status, 201)
  return { token: r.data.token, id: r.data.user.id }
}

const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const inDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('Date de retrait — réservation client', () => {
  it('la date choisie au checkout est validée et stockée ; défaut = jour de réservation', async () => {
    const order = await call('POST', '/api/orders', {
      body: {
        name: 'Client',
        phone: '0550000001',
        pickupDate: inDays(2),
        items: [{ id: 'ssd-1t', qty: 1 }]
      }
    })
    assert.equal(order.status, 201, JSON.stringify(order.data))
    assert.equal(order.data.order.pickupDate, inDays(2))

    const noDate = await call('POST', '/api/orders', {
      body: { name: 'Client', phone: '0550000002', items: [{ id: 'ssd-1t', qty: 1 }] }
    })
    assert.equal(noDate.status, 201)
    assert.equal(noDate.data.order.pickupDate, today(), 'sans choix, le jour de la réservation est retenu')

    const bad = await call('POST', '/api/orders', {
      body: { name: 'Client', phone: '0550000003', pickupDate: 'demain matin', items: [{ id: 'ssd-1t', qty: 1 }] }
    })
    assert.equal(bad.status, 400)
    assert.equal(bad.data.error, 'pickup_date')
  })

  it('unitaire : setOrderPickupDate refuse un format invalide sans toucher la commande', () => {
    const db = { orders: [{ code: 'PS-X', status: 'new', items: [] }] }
    assert.deepEqual(setOrderPickupDate(db, 'PS-X', '31/12/2026'), { ok: false, error: 'pickup_date' })
    assert.equal(db.orders[0].pickupDate, undefined)
    assert.equal(setOrderPickupDate(db, 'INCONNU', '2026-12-31').error, 'not_found')
    const okR = setOrderPickupDate(db, 'PS-X', '2026-12-31')
    assert.equal(okR.ok, true)
    assert.equal(db.orders[0].pickupDate, '2026-12-31')
  })
})

describe('Date de retrait — comptoir (PATCH master)', () => {
  it('fixer puis décaler la date sans toucher au statut ; le client la voit', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const created = await call('POST', '/api/orders', {
      body: { name: 'Client', phone: '0550000004', items: [{ id: 'ssd-1t', qty: 1 }] },
      token: client.token
    })
    const code = created.data.order.code

    const patched = await call('PATCH', `/api/orders/${encodeURIComponent(code)}`, {
      body: { pickupDate: inDays(3) },
      token: master
    })
    assert.equal(patched.status, 200, JSON.stringify(patched.data))
    assert.equal(patched.data.order.pickupDate, inDays(3))
    assert.equal(patched.data.order.status, 'new', 'le statut ne bouge pas')
    assert.equal(storeOrder(code).pickupDate, inDays(3))

    const mine = await call('GET', '/api/me/orders', { token: client.token })
    assert.equal((mine.data.orders || []).find((o) => o.code === code)?.pickupDate, inDays(3))

    // Statut + date en un seul aller-retour (le « prêt » annonce la date).
    const ready = await call('PATCH', `/api/orders/${encodeURIComponent(code)}`, {
      body: { status: 'ready', pickupDate: inDays(1) },
      token: master
    })
    assert.equal(ready.status, 200)
    assert.equal(ready.data.order.status, 'ready')
    assert.equal(ready.data.order.pickupDate, inDays(1))

    const invalid = await call('PATCH', `/api/orders/${encodeURIComponent(code)}`, {
      body: { pickupDate: 'la semaine prochaine' },
      token: master
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error, 'pickup_date')

    const empty = await call('PATCH', `/api/orders/${encodeURIComponent(code)}`, { body: {}, token: master })
    assert.equal(empty.status, 400)

    // Un client ne peut pas modifier la date d'une commande.
    const forbidden = await call('PATCH', `/api/orders/${encodeURIComponent(code)}`, {
      body: { pickupDate: inDays(5) },
      token: client.token
    })
    assert.equal(forbidden.status, 403)
  })
})

describe('Suppression produit par le maître', () => {
  it('créé → supprimé (fiche, stock, override) ; base → refusée ; inconnu → 404', async () => {
    const master = await loginMaster()
    const created = await call('POST', '/api/master/products', {
      body: {
        name: 'Produit à supprimer',
        price: 1500,
        stock: 2,
        category: 'cpu',
        brand: 'Generic',
        sku: 'DEL-1',
        short: 'test'
      },
      token: master
    })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    const id = created.data.product.id

    // Le patch modifie la fiche extra en place ; le stock existe dès la création.
    await call('PUT', `/api/master/products/${encodeURIComponent(id)}`, { body: { price: 1600 }, token: master })
    const afterPatch = readStore()
    assert.equal(
      (afterPatch.meta.extraProducts || []).find((p) => p.id === id)?.price,
      1600,
      'fiche extra patchée avant suppression'
    )
    assert.equal(afterPatch.stock?.[id], 2, 'stock présent avant suppression')

    const del = await call('DELETE', `/api/master/products/${encodeURIComponent(id)}`, { token: master })
    assert.equal(del.status, 200, JSON.stringify(del.data))
    const store = readStore()
    assert.equal((store.meta.extraProducts || []).some((p) => p.id === id), false, 'fiche supprimée')
    assert.equal(store.stock?.[id], undefined, 'stock purgé')
    assert.equal(store.meta.productOverrides?.[id], undefined, 'override purgé s’il existait')
    assert.equal(del.data.id, id)

    const delBase = await call('DELETE', `/api/master/products/${encodeURIComponent(PRODUCTS_BASE_ID)}`, {
      token: master
    })
    assert.equal(delBase.status, 409)
    assert.equal(delBase.data.error, 'base')

    const delUnknown = await call('DELETE', '/api/master/products/produit-inexistant', { token: master })
    assert.equal(delUnknown.status, 404)

    // Un client ne peut pas supprimer.
    const client = await registerClient()
    const forbidden = await call('DELETE', `/api/master/products/${encodeURIComponent(id)}`, {
      token: client.token
    })
    assert.equal(forbidden.status, 403)
  })
})
