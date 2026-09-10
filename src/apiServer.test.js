import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// Base temporaire isolée — ne touche jamais server/data/store.json.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-api-'))
process.env.PCSTAR_DATA_DIR = dir
const { handler } = await import('../server/index.js')

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

describe('routes (P2) — handler HTTP réel', () => {
  it('GET /api/catalog : objets complets (compat/needsKey/rating) + stock live', async () => {
    const { status, data } = await call('GET', '/api/catalog')
    assert.equal(status, 200)
    assert.ok(data.ok)
    assert.ok(data.products.length >= 250)
    const cpu = data.products.find((p) => p.id === 'cpu-7800x3d')
    assert.ok(cpu, 'cpu-7800x3d présent')
    assert.equal(cpu.compat.socket, 'AM5')
    // P3 : needs → clé i18n (needsKey), servie complète au client
    assert.ok(cpu.needsKey, 'needsKey présent (plus de sous-ensemble de champs)')
    assert.ok(cpu.rating > 0)
    assert.ok(Array.isArray(cpu.photos) && cpu.photos.length > 0)
  })

  it('GET /api/customers : 403 sans master, 200 avec master', async () => {
    const noAuth = await call('GET', '/api/customers')
    assert.equal(noAuth.status, 403)
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    assert.equal(master.status, 200)
    const withAuth = await call('GET', '/api/customers', { token: master.data.token })
    assert.equal(withAuth.status, 200)
    assert.ok(Array.isArray(withAuth.data.customers))
    assert.ok(withAuth.data.customers.length >= 3)
    assert.ok(!withAuth.data.customers.some((c) => c.role === 'master'))
  })

  it('POST /api/orders : total trafiqué recalculé (route)', async () => {
    const { status, data } = await call('POST', '/api/orders', {
      body: {
        name: 'Trafiqué',
        phone: '0550123456',
        items: [{ id: 'mousepad', sku: 'G640', name: 'G640', qty: 2, price: 1 }],
        total: 1
      }
    })
    assert.equal(status, 201)
    assert.equal(data.order.total, 15000)
    assert.equal(data.order.items[0].price, 7500)
  })

  it('produit créé par le master : visible dans /api/catalog, prix recalculé à la commande', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const created = await call('POST', '/api/master/products', {
      token: master.data.token,
      body: { name: 'P2 TEST', price: 1234, stock: 3, category: 'usb', brand: 'PC Star' }
    })
    assert.equal(created.status, 201)
    const cat = await call('GET', '/api/catalog')
    const found = cat.data.products.find((p) => p.id === created.data.product.id)
    assert.ok(found, 'produit master visible dans le catalogue public')
    assert.equal(found.stock, 3)
    const order = await call('POST', '/api/orders', {
      body: {
        name: 'X',
        phone: '0669174617',
        items: [{ id: found.id, sku: found.sku, name: found.name, qty: 1, price: 1 }],
        total: 1
      }
    })
    assert.equal(order.status, 201)
    assert.equal(order.data.order.total, 1234)
  })

  it('masquage d’un produit master via HTTP : disparaît du catalogue public', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const created = await call('POST', '/api/master/products', {
      token: master.data.token,
      body: { name: 'P2 MASQ', price: 300, stock: 1, category: 'usb' }
    })
    assert.equal(created.status, 201)
    const id = created.data.product.id
    let cat = await call('GET', '/api/catalog')
    assert.ok(cat.data.products.some((p) => p.id === id))
    const hide = await call('POST', `/api/master/products/${id}/hide`, {
      token: master.data.token,
      body: { hidden: true }
    })
    assert.equal(hide.status, 200)
    cat = await call('GET', '/api/catalog')
    assert.ok(!cat.data.products.some((p) => p.id === id), 'plus visible après masquage')
  })

  it('DELETE /api/customers/:id : token client → 401 (route)', async () => {
    const email = `p2-${Date.now()}@demo.dz`
    const reg = await call('POST', '/api/auth/register', {
      body: { email, password: 'azerty12345', name: 'P2' }
    })
    assert.equal(reg.status, 201)
    const custTok = reg.data.token
    const cust = await call('GET', '/api/me', { token: custTok })
    assert.equal(cust.status, 200)
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const del = await call('DELETE', `/api/customers/${cust.data.user.id}`, { token: master.data.token })
    assert.equal(del.status, 200)
    assert.equal(del.data.ok, true)
    const after = await call('GET', '/api/me', { token: custTok })
    assert.equal(after.status, 401)
  })
})
