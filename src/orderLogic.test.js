import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORDER_STATUSES,
  applyPreset,
  applyStockDecrement,
  applyStockRestore,
  buildPowerRecap,
  canTransition,
  checkStock,
  localDay,
  makeOrderCode,
  nextLocalOrderCode,
  orderApiFailure,
  pickupForUser,
  BUILD_PRESETS
} from './orderLogic.js'
import { makeOrderCode as makeServerOrderCode, placeOrder, cancelOrder, liveStockOf, priceOf, purgeUser, setOrderStatus } from '../server/catalog.js'
import { ordersToCsv } from '../server/masterApi.js'
import { PRODUCTS } from './data.js'

describe('order codes', () => {
  it('formats PS-YYYYMMDD-XXXX', () => {
    const d = new Date('2026-09-10T12:00:00Z')
    assert.equal(makeOrderCode(d, 1), 'PS-20260910-0001')
    assert.equal(makeOrderCode(d, 12), 'PS-20260910-0012')
  })
})

describe('stock math', () => {
  it('detects shortages', () => {
    const r = checkStock(
      [
        { id: 'a', qty: 2, name: 'A' },
        { id: 'b', qty: 1, name: 'B' }
      ],
      { a: 1, b: 5 }
    )
    assert.equal(r.ok, false)
    assert.equal(r.shortages[0].id, 'a')
  })

  it('decrements and restores', () => {
    const base = { a: 5, b: 3 }
    const dec = applyStockDecrement(base, [
      { id: 'a', qty: 2 },
      { id: 'b', qty: 1 }
    ])
    assert.deepEqual(dec, { a: 3, b: 2 })
    const rest = applyStockRestore(dec, [
      { id: 'a', qty: 2 },
      { id: 'b', qty: 1 }
    ])
    assert.deepEqual(rest, base)
  })
})

describe('status transitions', () => {
  it('allows forward flow and cancel', () => {
    assert.equal(canTransition('new', 'preparing'), true)
    assert.equal(canTransition('preparing', 'ready'), true)
    assert.equal(canTransition('ready', 'picked'), true)
    assert.equal(canTransition('new', 'cancelled'), true)
    assert.equal(canTransition('picked', 'new'), false)
    assert.equal(canTransition('cancelled', 'ready'), false)
  })

  it('lists five statuses', () => {
    assert.equal(ORDER_STATUSES.length, 5)
  })
})

describe('server placeOrder', () => {
  it('decrements stock and blocks oversell', () => {
    const id = PRODUCTS[0].id
    const db = { orders: [], stock: { [id]: 2 }, meta: {} }
    const ok = placeOrder(
      db,
      {
        name: 'Test',
        phone: '0550123456',
        items: [{ id, sku: 'X', name: 'P', qty: 2, price: 1000 }]
      },
      {}
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.order.status, 'new')
    assert.match(ok.order.code, /^PS-\d{8}-\d{4}$/)
    assert.equal(liveStockOf(db, id), 0)

    const fail = placeOrder(
      db,
      {
        name: 'Test2',
        phone: '0550123456',
        items: [{ id, sku: 'X', name: 'P', qty: 1, price: 1000 }]
      },
      {}
    )
    assert.equal(fail.ok, false)
    assert.equal(fail.error, 'stock')
  })

  it('restocks on cancel', () => {
    const id = PRODUCTS[1].id
    const db = { orders: [], stock: { [id]: 4 }, meta: {} }
    const ok = placeOrder(
      db,
      {
        name: 'A',
        phone: '0669174617',
        items: [{ id, sku: 'Y', name: 'Q', qty: 3, price: 500 }]
      },
      {}
    )
    assert.equal(ok.ok, true)
    assert.equal(liveStockOf(db, id), 1)
    const c = cancelOrder(db, ok.order.code)
    assert.equal(c.ok, true)
    assert.equal(c.order.status, 'cancelled')
    assert.equal(liveStockOf(db, id), 4)
  })

  it('patches status preparing → ready', () => {
    const id = PRODUCTS[2].id
    const db = { orders: [], stock: { [id]: 5 }, meta: {} }
    const ok = placeOrder(db, {
      name: 'B',
      phone: '0770650387',
      items: [{ id, sku: 'Z', name: 'R', qty: 1, price: 100 }]
    })
    const s1 = setOrderStatus(db, ok.order.code, 'preparing')
    assert.equal(s1.ok, true)
    assert.equal(s1.order.status, 'preparing')
    const s2 = setOrderStatus(db, ok.order.code, 'ready')
    assert.equal(s2.order.status, 'ready')
  })
})

describe('builder presets', () => {
  it('applies student preset from catalog', () => {
    const build = applyPreset(PRODUCTS, BUILD_PRESETS[0])
    assert.ok(build.cpu)
    assert.ok(build.motherboard)
    assert.equal(build.cpu.compat.socket, build.motherboard.compat.socket)
  })

  it('power recap suggests watts', () => {
    const gpu = PRODUCTS.find((p) => p.id === 'gpu-4060')
    const psu = PRODUCTS.find((p) => p.id === 'psu-750')
    const r = buildPowerRecap([gpu, psu])
    assert.ok(r.estimateWatts >= 550)
    assert.equal(r.psuOk, true)
  })
})

describe('prix recalculés côté serveur (B3)', () => {
  const priced = PRODUCTS.find((p) => Number.isFinite(p.price) && p.price > 0)

  it('ignore le total et les prix envoyés par le client', () => {
    const db = { orders: [], stock: {}, meta: {} }
    const ok = placeOrder(
      db,
      {
        name: 'Trafiqué',
        phone: '0550123456',
        items: [{ id: priced.id, sku: priced.sku, name: priced.name, qty: 2, price: 1 }],
        total: 1
      },
      {}
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.order.items[0].price, priced.price)
    assert.equal(ok.order.total, priced.price * 2)
  })

  it('applique l’override de prix master (productOverrides)', () => {
    const db = { orders: [], stock: {}, meta: { productOverrides: { [priced.id]: { price: 1234 } } } }
    const ok = placeOrder(db, {
      name: 'X',
      phone: '0550123456',
      items: [{ id: priced.id, sku: priced.sku, name: priced.name, qty: 3, price: 5 }]
    })
    assert.equal(ok.ok, true)
    assert.equal(ok.order.total, 1234 * 3)
  })

  it('utilise le prix du produit créé par le master (extraProducts)', () => {
    const db = {
      orders: [],
      stock: { 'extra-1': 5 },
      meta: { extraProducts: [{ id: 'extra-1', name: 'E', price: 999, stock: 5 }] }
    }
    const ok = placeOrder(db, {
      name: 'X',
      phone: '0669174617',
      items: [{ id: 'extra-1', sku: 'E', name: 'E', qty: 2, price: 1 }],
      total: 2
    })
    assert.equal(ok.ok, true)
    assert.equal(ok.order.items[0].price, 999)
    assert.equal(ok.order.total, 999 * 2)
  })

  it('priceOf: null pour un id inconnu', () => {
    assert.equal(priceOf({ meta: {} }, 'n-importe-quoi'), null)
  })
})

describe('purgeUser (B13)', () => {
  it('supprime l’utilisateur, purge ses sessions, délie ses commandes', () => {
    const db = {
      users: [{ id: 'a', role: 'customer' }, { id: 'm', role: 'master' }],
      sessions: { t1: { userId: 'a' }, t2: { userId: 'm' } },
      orders: [{ code: 'C1', userId: 'a' }, { code: 'C2', userId: 'm' }],
      meta: {}
    }
    assert.equal(purgeUser(db, 'a').ok, true)
    assert.equal(db.users.length, 1)
    assert.equal(db.sessions.t1, undefined)
    assert.ok(db.sessions.t2)
    assert.equal(db.orders[0].userId, null)
    assert.equal(db.orders[1].userId, 'm')
  })

  it('refuse le master et les inconnus', () => {
    const db = { users: [{ id: 'm', role: 'master' }], sessions: {}, orders: [], meta: {} }
    assert.equal(purgeUser(db, 'm').ok, false)
    assert.equal(purgeUser(db, 'inconnu').ok, false)
    assert.equal(db.users.length, 1)
  })
})

describe('P8 (P7-2) — orderApiFailure : seul l\'offline justifie le repli local', () => {
  it('offline (backend injoignable) → repli local', () => {
    assert.equal(orderApiFailure({ ok: false, status: 0, data: null, offline: true }).kind, 'offline')
    assert.equal(orderApiFailure(null).kind, 'offline')
  })
  it('409 / stock → stock (pas de repli)', () => {
    assert.equal(orderApiFailure({ ok: false, status: 409, data: { error: 'stock', shortages: [{ id: 'x' }] } }).kind, 'stock')
    assert.equal(orderApiFailure({ ok: false, status: 500, data: { error: 'stock' } }).kind, 'stock')
  })
  it('429 → rate avec retryAfter (pas de repli)', () => {
    const r = orderApiFailure({ ok: false, status: 429, data: { error: 'rate', retryAfter: 42 } })
    assert.equal(r.kind, 'rate')
    assert.equal(r.retryAfter, 42)
  })
  it('5xx / 4xx divers → server (pas de repli)', () => {
    assert.equal(orderApiFailure({ ok: false, status: 500, data: { error: 'server' } }).kind, 'server')
    assert.equal(orderApiFailure({ ok: false, status: 502, data: null }).kind, 'server')
    assert.equal(orderApiFailure({ ok: false, status: 400, data: { error: 'phone' } }).kind, 'server')
  })
})

describe('P8 (P7-2) — nextLocalOrderCode : séquence sans collision', () => {
  const d = new Date('2026-09-11T10:00:00')
  it('aucune commande du jour → 0001', () => {
    assert.equal(nextLocalOrderCode([], d), 'PS-20260911-0001')
  })
  it('max du jour + 1 (jamais length + 1)', () => {
    assert.equal(nextLocalOrderCode(['PS-20260911-0007', 'PS-20260911-0002'], d), 'PS-20260911-0008')
  })
  it('liste partielle : le trou (0003 manquant) ne provoque aucune collision', () => {
    // le serveur a fait 0001..0005, le client ne voit que 0001 et 0004
    assert.equal(nextLocalOrderCode(['PS-20260911-0001', 'PS-20260911-0004'], d), 'PS-20260911-0005')
  })
  it('les autres jours / formats sont ignorés', () => {
    assert.equal(nextLocalOrderCode(['PS-20260910-0099', 'ABC', 'PS-20260911-0001'], d), 'PS-20260911-0002')
  })
})

describe('P8 (P7-3) — pickupForUser : reset au logout, reprise au login', () => {
  const DEF = { name: '', phone: '', slot: 'S2', wilaya: 'Oran', payment: 'cash' }
  it('pas de compte → valeurs vides (plus les infos du précédent)', () => {
    const prev = { name: 'Karim B.', phone: '0550123456', slot: 'S1', wilaya: 'Oran', payment: 'cash' }
    assert.deepEqual(pickupForUser(null, prev, DEF), DEF)
  })
  it('compte → reprise profil, slot conservé', () => {
    const user = { name: 'Amina K.', phone: '0669174617', wilaya: 'Oran' }
    const prev = { name: 'Karim B.', phone: '0550123456', slot: 'S1', wilaya: 'Sétif', payment: 'cash' }
    assert.deepEqual(pickupForUser(user, prev, DEF), {
      name: 'Amina K.',
      phone: '0669174617',
      slot: 'S1',
      wilaya: 'Oran',
      payment: 'cash'
    })
  })
  it('compte sans téléphone → téléphone précédent conservé', () => {
    const user = { name: 'Amina K.' }
    const prev = { name: '', phone: '0550123456', slot: 'S2', wilaya: 'Oran', payment: 'cash' }
    assert.equal(pickupForUser(user, prev, DEF).phone, '0550123456')
  })
})

describe('P9 (P7-4) — la « journée » = date locale du client, partagée code+CSV', () => {
  it('localDay : date locale YYYY-MM-DD (jamais UTC)', () => {
    // 2026-09-11T23:30 UTC = 2026-09-12T00:30 à Oran (UTC+1) :
    // le client oranaise DOIT produire 2026-09-12 (sa journée), pas 2026-09-11
    assert.equal(localDay(new Date(2026, 8, 12, 0, 30)), '2026-09-12')
    assert.equal(localDay(new Date(2026, 8, 1, 23, 59)), '2026-09-01')
  })

  it('placeOrder : body.day valide → stocké + intégré au code', () => {
    const id = PRODUCTS[0].id
    const db = { orders: [], stock: { [id]: 2 }, meta: {} }
    const ok = placeOrder(
      db,
      {
        name: 'T',
        phone: '0550123456',
        day: '2026-12-25',
        items: [{ id, sku: 'X', name: 'P', qty: 1, price: 1000 }]
      },
      {}
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.order.day, '2026-12-25')
    assert.equal(ok.order.code, 'PS-20261225-0001')
  })

  it('placeOrder : day invalide/absent → repli date locale serveur (jamais crash)', () => {
    const id = PRODUCTS[0].id
    const db = { orders: [], stock: { [id]: 2 }, meta: {} }
    const ok = placeOrder(
      db,
      { name: 'T', phone: '0550123456', day: 'hack;drop', items: [{ id, sku: 'X', name: 'P', qty: 1, price: 1000 }] },
      {}
    )
    assert.equal(ok.ok, true)
    assert.match(ok.order.day, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(ok.order.code.slice(3, 11), ok.order.day.replace(/-/g, ''))
  })

  it('makeOrderCode serveur : séquence continue sur la journée donnée', () => {
    const db = {
      orders: [
        { code: 'PS-20261225-0001', at: 'x' },
        { code: 'PS-20261225-0002', at: 'x' },
        { code: 'PS-20261224-0099', at: 'x' }
      ]
    }
    assert.equal(makeServerOrderCode(db, '2026-12-25'), 'PS-20261225-0003')
  })

  it('ordersToCsv : la commande oranaise de 00h30 reste dans SA journée (o.day)', () => {
    // 00:30 le 26/12 à Oran (UTC+1) = 23:30 UTC le 25/12 — la date d'`at`
    // (UTC) est trompeuse : seul o.day (date locale du client) est juste.
    const orders = [
      { code: 'PS-20261226-0001', day: '2026-12-26', at: '2026-12-25T23:30:00.000Z', name: 'A', phone: '0550000001' },
      { code: 'PS-20261225-0002', at: '2026-12-25T12:00:00.000Z', name: 'B', phone: '0550000002' } // legacy : pas de day
    ]
    const csv26 = ordersToCsv(orders, { day: '2026-12-26' })
    assert.match(csv26, /PS-20261226-0001/) // grâce à o.day (avant : perdue, at=25/12)
    assert.doesNotMatch(csv26, /PS-20261225-0002/)
    const csv25 = ordersToCsv(orders, { day: '2026-12-25' })
    assert.match(csv25, /PS-20261225-0002/) // legacy : repli sur la date d'at
    assert.doesNotMatch(csv25, /PS-20261226-0001/)
  })
})
