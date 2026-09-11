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
    // 250 SKUs de base, dont `speakers` en rupture (stock 0) filtrée (P6) → 249
    assert.ok(data.products.length >= 249)
    assert.ok(data.products.length < 251)
    const cpu = data.products.find((p) => p.id === 'cpu-7800x3d')
    assert.ok(cpu, 'cpu-7800x3d présent')
    assert.equal(cpu.compat.socket, 'AM5')
    // P3 : needs → clé i18n (needsKey), servie complète au client
    assert.ok(cpu.needsKey, 'needsKey présent (plus de sous-ensemble de champs)')
    assert.ok(cpu.rating > 0)
    assert.ok(Array.isArray(cpu.photos) && cpu.photos.length > 0)
  })

  it('P6 : rupture (stock 0) invisible au client, visible au master', async () => {
    const cat = await call('GET', '/api/catalog')
    assert.ok(!cat.data.products.some((p) => p.id === 'speakers'), 'speakers (stock 0) absente du catalogue public')
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const list = await call('GET', '/api/master/products', { token: master.data.token })
    const sp = list.data.products.find((p) => p.id === 'speakers')
    assert.ok(sp, 'speakers visible dans la vue master')
    assert.equal(sp.stock, 0)

    // un produit en stock passe… puis disparaît quand le stock tombe à 0
    const created = await call('POST', '/api/master/products', {
      token: master.data.token,
      body: { name: 'P6 OOS', price: 100, stock: 1, category: 'usb' }
    })
    const id = created.data.product.id
    let c = await call('GET', '/api/catalog')
    assert.ok(c.data.products.some((p) => p.id === id), 'visible avec stock 1')
    const upd = await call('PUT', `/api/master/products/${id}`, {
      token: master.data.token,
      body: { stock: 0 }
    })
    assert.equal(upd.status, 200)
    c = await call('GET', '/api/catalog')
    assert.ok(!c.data.products.some((p) => p.id === id), 'invisible à stock 0')
    const list2 = await call('GET', '/api/master/products', { token: master.data.token })
    assert.ok(list2.data.products.find((p) => p.id === id), 'toujours visible côté master')
  })

  it('P6 : le client annule SA commande neuve (restock), pas celle d’autrui', async () => {
    const email = `p6-${Date.now()}@demo.dz`
    const reg = await call('POST', '/api/auth/register', {
      body: { email, password: 'azerty12345', name: 'P6', phone: '0550987654' }
    })
    assert.equal(reg.status, 201)
    const tok = reg.data.token
    // stock de départ du produit testé
    const stock0 = (await call('GET', '/api/stock/ssd-1t')).data.stock
    const ord = await call('POST', '/api/orders', {
      token: tok,
      body: { name: 'P6', phone: '0550987654', items: [{ id: 'ssd-1t', sku: 'SN770', name: 'SN770', qty: 1, price: 1 }] }
    })
    assert.equal(ord.status, 201)
    const code = ord.data.order.code
    assert.equal((await call('GET', '/api/stock/ssd-1t')).data.stock, stock0 - 1)

    // un autre client ne voit pas / n’annule pas cette commande
    const other = await call('POST', '/api/auth/register', {
      body: { email: `p6b-${Date.now()}@demo.dz`, password: 'azerty12345', name: 'P6b' }
    })
    const foreign = await call('POST', `/api/me/orders/${code}/cancel`, { token: other.data.token })
    assert.equal(foreign.status, 404)

    // la commande passe « preparing » : plus annulable par le client
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const prepping = await call('PATCH', `/api/orders/${code}`, { token: master.data.token, body: { status: 'preparing' } })
    assert.equal(prepping.status, 200)
    const late = await call('POST', `/api/me/orders/${code}/cancel`, { token: tok })
    assert.equal(late.status, 409)

    // le master annule → le stock est rétabli
    const cancel = await call('POST', `/api/orders/${code}/cancel`, { token: master.data.token })
    assert.equal(cancel.status, 200)
    assert.equal(cancel.data.order.status, 'cancelled')
    assert.equal((await call('GET', '/api/stock/ssd-1t')).data.stock, stock0)

    // et sur une commande « neuve » : le client peut s’annuler lui-même
    const ord2 = await call('POST', '/api/orders', {
      token: tok,
      body: { name: 'P6', phone: '0550987654', items: [{ id: 'ssd-1t', sku: 'SN770', name: 'SN770', qty: 1, price: 1 }] }
    })
    assert.equal(ord2.status, 201)
    const self = await call('POST', `/api/me/orders/${ord2.data.order.code}/cancel`, { token: tok })
    assert.equal(self.status, 200)
    assert.equal(self.data.order.status, 'cancelled')
    assert.equal((await call('GET', '/api/stock/ssd-1t')).data.stock, stock0)
  })

  it('P6 : panneaux synchronisés via /api/master/panels (master only, borné)', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const tok = master.data.token
    // non-master → 403
    const anon = await call('PUT', '/api/master/panels', { body: { hiddenPanelIds: ['desk'] } })
    assert.equal(anon.status, 403)

    // shape invalide → 400
    const bad = await call('PUT', '/api/master/panels', { token: tok, body: { hiddenPanelIds: 'non' } })
    assert.equal(bad.status, 400)

    // toggle + panneau custom → persistés (lisibles via /api/meta)
    const put = await call('PUT', '/api/master/panels', {
      token: tok,
      body: {
        hiddenPanelIds: ['desk'],
        extraPanels: [{ id: 'panel-test1', titles: { ar: 'لوحة', fr: 'Panneau', en: 'Panel' }, categories: ['usb'] }]
      }
    })
    assert.equal(put.status, 200)
    assert.deepEqual(put.data.meta.hiddenPanelIds, ['desk'])
    assert.equal(put.data.meta.extraPanels.length, 1)
    const meta = await call('GET', '/api/meta')
    assert.equal(meta.status, 200)
    assert.deepEqual(meta.data.meta.hiddenPanelIds, ['desk'])
    assert.equal(meta.data.meta.extraPanels.length, 1)
    // les clés produit du meta ne sont PAS écrasées par cet endpoint
    const products = await call('GET', '/api/master/products', { token: tok })
    assert.ok(products.data.products.length >= 250)
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

describe('P9 — bugs opérationnels (P7-4 / P7-5 / P7-8)', () => {
  it('P7-5 : GET /api/meta publique = panneaux uniquement (plus de fuite produits)', async () => {
    const meta = await call('GET', '/api/meta')
    assert.equal(meta.status, 200)
    const m = meta.data.meta
    // seuls les champs consommés par le shop
    assert.ok(Array.isArray(m.extraPanels))
    assert.ok(Array.isArray(m.hiddenPanelIds))
    // et RIEN d'autre : plus de fiches de produits masqués ni d'overrides
    assert.equal(m.extraProducts, undefined)
    assert.equal(m.productOverrides, undefined)
    assert.equal(m.hiddenProductIds, undefined)
  })

  it('P7-5 : GET /api/master/meta = méta complète, master only', async () => {
    const anon = await call('GET', '/api/master/meta')
    assert.equal(anon.status, 403)
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    // un override existe → observable dans le meta complet…
    const put = await call('PUT', '/api/master/products/cpu-5600', {
      token: master.data.token,
      body: { short: 'visible seulement au master ici' }
    })
    assert.equal(put.status, 200)
    const full = await call('GET', '/api/master/meta', { token: master.data.token })
    assert.equal(full.status, 200)
    assert.ok(full.data.meta.hiddenProductIds !== undefined)
    assert.ok(full.data.meta.productOverrides['cpu-5600'], 'override visible en master')
    // …et toujours invisible via la route publique
    const pub = await call('GET', '/api/meta')
    assert.equal(pub.data.meta.productOverrides, undefined)
    assert.equal(pub.data.meta.hiddenProductIds, undefined)
  })

  it('P7-8 : PUT /api/meta supprimé (plus d\'écrasement du meta)', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const put = await call('PUT', '/api/meta', { token: master.data.token, body: { meta: { hiddenPanelIds: ['desk'] } } })
    assert.equal(put.status, 404)
    // même sans auth → 404 (la route n'existe plus, pas un 403)
    const putAnon = await call('PUT', '/api/meta', { body: { meta: {} } })
    assert.equal(putAnon.status, 404)
  })

  it('P7-4 : commande avec « journée » locale → code daté à cette journée + CSV cohérent', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    // journée future fixe : le code DOIT porter cette date (pas la date serveur)
    const day = '2027-01-05'
    const ok = await call('POST', '/api/orders', {
      body: {
        name: 'Jour Test',
        phone: '0550999888',
        day,
        wilaya: 'Oran',
        slot: '14:00',
        items: [{ id: 'ssd-1t', sku: 'ssd-1t', name: 'SSD 1 To', qty: 1, price: 9900 }]
      }
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.order.day, day)
    assert.ok(ok.data.order.code.startsWith('PS-20270105-'), `code = ${ok.data.order.code}`)
    // annulée pour ne pas polluer le stock
    const cancel = await call('POST', `/api/orders/${ok.data.order.code}/cancel`, { token: master.data.token })
    assert.equal(cancel.status, 200)
  })
})

describe('P10 — robustesse (P7-10 / P7-12 / P7-15 / P7-18)', () => {
  it('P7-10 : corps > 15 Mo → 413 (pas un 500/OOM)', async () => {
    // ~16 Mo de padding dans un champ inoffensif
    const pad = 'x'.repeat(16 * 1024 * 1024)
    const res = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'big@test.dz', password: 'secret1', name: pad })
    })
    assert.equal(res.status, 413)
    const data = await res.json()
    assert.equal(data.ok, false)
    assert.equal(data.error, 'too_large')
  })

  it('P7-12 : export CSV préfixé du BOM UTF-8 (lisible dans Excel)', async () => {
    const master = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const res = await fetch(base + '/api/orders/export.csv', {
      headers: { Authorization: `Bearer ${master.data.token}` }
    })
    assert.equal(res.status, 200)
    // NB : res.text() SUPPRIME le BOM (spec WHATWG) → on vérifie les bytes bruts
    const buf = new Uint8Array(await res.arrayBuffer())
    assert.equal(buf[0], 0xef, 'byte 1 du BOM UTF-8 (EF BB BF)')
    assert.equal(buf[1], 0xbb, 'byte 2 du BOM')
    assert.equal(buf[2], 0xbf, 'byte 3 du BOM')
    const text = new TextDecoder('utf-8').decode(buf.slice(3))
    assert.match(text, /^code,status/)
  })

  it('P7-15 : deux comptes au même numéro — les commandes ne se croisent pas', async () => {
    // A et B partagent le même téléphone
    const phone = '0550000111'
    const a = await call('POST', '/api/auth/register', { body: { email: 'a.same@test.dz', password: 'secret1', name: 'A', phone } })
    const b = await call('POST', '/api/auth/register', { body: { email: 'b.same@test.dz', password: 'secret1', name: 'B', phone } })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    // A passe une commande (liée à A)
    const order = await call('POST', '/api/orders', {
      token: a.data.token,
      body: {
        name: 'A',
        phone,
        wilaya: 'Oran',
        slot: '14:00',
        items: [{ id: 'ssd-1t', sku: 'ssd-1t', name: 'SSD 1 To', qty: 1, price: 9900 }]
      }
    })
    assert.equal(order.status, 201)
    const code = order.data.order.code
    // B (même tél) ne voit PAS la commande de A
    const bOrders = await call('GET', '/api/me/orders', { token: b.data.token })
    assert.ok(!bOrders.data.orders.some((o) => o.code === code), 'B ne voit pas l\'ordre de A')
    // B ne peut PAS annuler la commande de A
    const bCancel = await call('POST', `/api/me/orders/${code}/cancel`, { token: b.data.token })
    assert.equal(bCancel.status, 404)
    // A voit toujours sa propre commande et peut l'annuler
    const aOrders = await call('GET', '/api/me/orders', { token: a.data.token })
    assert.ok(aOrders.data.orders.some((o) => o.code === code))
    const aCancel = await call('POST', `/api/me/orders/${code}/cancel`, { token: a.data.token })
    assert.equal(aCancel.status, 200)
  })

  it('P7-18 : wilaya bornée (liste connue + troncature, sinon Oran/existant)', async () => {
    const u = await call('POST', '/api/auth/register', { body: { email: 'wilaya@test.dz', password: 'secret1', name: 'W', phone: '0550000222' } })
    assert.equal(u.status, 201)
    const tok = u.data.token
    // valeur inconnue → repli (existant/'Oran'), pas de chaîne libre
    const bad = await call('PUT', '/api/me', { token: tok, body: { wilaya: 'Mars, la planète' } })
    assert.equal(bad.status, 200)
    assert.equal(bad.data.user.wilaya, 'Oran')
    // valeur de la liste connue → acceptée
    const good = await call('PUT', '/api/me', { token: tok, body: { wilaya: 'Mostaganem' } })
    assert.equal(good.status, 200)
    assert.equal(good.data.user.wilaya, 'Mostaganem')
    // chaîne très longue → tronquée à 32 puis rejetée (repli Oran/existant)
    const long = await call('PUT', '/api/me', { token: tok, body: { wilaya: 'A'.repeat(80) } })
    assert.equal(long.status, 200)
    assert.notEqual(long.data.user.wilaya, 'A'.repeat(80))
    assert.ok(long.data.user.wilaya.length <= 32 || long.data.user.wilaya === 'Mostaganem')
  })
})
