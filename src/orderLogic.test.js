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
  mergeServerOrders,
  waNumber,
  nextLocalOrderCode,
  orderApiFailure,
  pickupForUser,
  BUILD_PRESETS
} from './orderLogic.js'
import { makeOrderCode as makeServerOrderCode, placeOrder, cancelOrder, liveStockOf, priceOf, purgeUser, serverDay, setOrderStatus } from '../server/catalog.js'
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

describe('Phase 6 — journée de commande côté serveur, code+CSV cohérents', () => {
  it('localDay reste utile au repli local, mais serverDay est calé sur le fuseau du magasin', () => {
    assert.equal(localDay(new Date(2026, 8, 12, 0, 30)), '2026-09-12')
    // 23:30 UTC appartient au lendemain en Afrique/Alger.
    assert.equal(serverDay(new Date('2026-09-11T23:30:00.000Z')), '2026-09-12')
  })

  it('placeOrder ignore body.day : seul le jour du serveur date le code', () => {
    const id = PRODUCTS[0].id
    const db = { orders: [], stock: { [id]: 2 }, meta: {} }
    const expectedDay = serverDay()
    const ok = placeOrder(
      db,
      {
        name: 'T',
        phone: '0550123456',
        day: '2099-12-25',
        items: [{ id, sku: 'X', name: 'P', qty: 1, price: 1000 }]
      },
      {}
    )
    assert.equal(ok.ok, true)
    assert.equal(ok.order.day, expectedDay)
    assert.equal(ok.order.code, `PS-${expectedDay.replaceAll('-', '')}-0001`)
  })

  it('placeOrder : day invalide/absent → toujours la date serveur (jamais crash)', () => {
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

// P14 (#3) — WhatsApp du comptoir : la base stocke le format local 0XXXXXXXXX,
// wa.me exige l'international. L'ancienne conversion (locale au DeskPage) ne
// traitait que les 9 chiffres → CHAQUE lien du comptoir était mort.
describe('P14 (#3) — waNumber : formats téléphoniques DZ → wa.me', () => {
  it('format local stocké (0 + 9 chiffres) → 213XXXXXXXXX', () => {
    assert.equal(waNumber('0550123456'), '213550123456')
    assert.equal(waNumber('0669174617'), '213669174617')
    assert.equal(waNumber('0770650387'), '213770650387')
  })

  it('variantes saisies par le client', () => {
    assert.equal(waNumber('550123456'), '213550123456', '9 chiffres nus')
    assert.equal(waNumber('+213550123456'), '213550123456')
    assert.equal(waNumber('00213550123456'), '213550123456', 'préfixe 00')
    assert.equal(waNumber('213550123456'), '213550123456')
    assert.equal(waNumber('0770 65 03 87'), '213770650387', 'espaces')
    assert.equal(waNumber('07-70-65-03-87'), '213770650387', 'tirets')
  })

  it('numéro inexploitable → chaîne vide (pas de lien mort)', () => {
    assert.equal(waNumber(''), '')
    assert.equal(waNumber(null), '')
    assert.equal(waNumber(undefined), '')
    assert.equal(waNumber('123'), '')
    assert.equal(waNumber('041234567'), '', 'fixe (hors 05/06/07)')
    assert.equal(waNumber('33612345678'), '', 'étranger')
  })

  it('tous les téléphones acceptés par isDzPhone donnent un lien wa.me valide', () => {
    for (const prefix of ['05', '06', '07']) {
      for (const tail of ['50123456', '69174617', '70650387']) {
        const local = prefix + tail
        assert.match(waNumber(local), /^213[567]\d{8}$/, local)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// P21 — « je clique sur préparer, rien ne change ».
//
// `pull()` envoyait `GET /api/orders` puis appliquait la réponse par
// `setReservations(next)`, sans condition. Si le maître cliquait entre l'envoi
// et la réponse, le PATCH aboutissait, puis la réponse du polling — produite
// AVANT le PATCH — remettait l'ancien statut. Le badge revenait en arrière,
// ce qui se lit exactement comme « rien ne change ».
// ---------------------------------------------------------------------------
describe('P21 — mergeServerOrders : le polling ne rétrograde plus un changement récent', () => {
  const server = [
    { code: 'PS-1', status: 'new', name: 'Karim' },
    { code: 'PS-2', status: 'new', name: 'Amina' }
  ]
  const local = [
    { code: 'PS-1', status: 'preparing', name: 'Karim' },
    { code: 'PS-2', status: 'new', name: 'Amina' }
  ]

  it('une transition décidée APRÈS le départ de la requête est conservée', () => {
    // Requête partie à t=1000 ; le maître a cliqué à t=2000.
    const editedAt = new Map([['PS-1', 2000]])
    const merged = mergeServerOrders(server, local, 1000, editedAt)
    assert.equal(merged.find((o) => o.code === 'PS-1').status, 'preparing')
    // Le reste de l'objet serveur est conservé.
    assert.equal(merged.find((o) => o.code === 'PS-1').name, 'Karim')
    // Une commande non touchée prend la valeur du serveur.
    assert.equal(merged.find((o) => o.code === 'PS-2').status, 'new')
  })

  it('une transition décidée AVANT le départ de la requête cède la place au serveur', () => {
    // Requête partie à t=3000, clic à t=2000 : la réponse est postérieure,
    // le serveur reste la source de vérité.
    const editedAt = new Map([['PS-1', 2000]])
    const merged = mergeServerOrders(server, local, 3000, editedAt)
    assert.equal(merged.find((o) => o.code === 'PS-1').status, 'new')
  })

  it('le serveur qui a déjà enregistré le changement gagne (pas de blocage)', () => {
    const serverFresh = [{ code: 'PS-1', status: 'preparing', name: 'Karim' }]
    const editedAt = new Map([['PS-1', 2000]])
    const merged = mergeServerOrders(serverFresh, local, 1000, editedAt)
    assert.equal(merged[0].status, 'preparing', 'statut serveur déjà à jour')
  })

  it('sans édition locale, la liste serveur est reprise telle quelle', () => {
    const merged = mergeServerOrders(server, local, 1000, new Map())
    assert.deepEqual(merged, server)
  })

  it('une commande absente de l\'état local ne casse pas la fusion', () => {
    const editedAt = new Map([['PS-9', 2000]])
    const merged = mergeServerOrders(server, local, 1000, editedAt)
    assert.deepEqual(merged, server, 'PS-9 inconnu du serveur : aucun effet')
  })

  it('entrées dégénérées : listes vides ou absentes', () => {
    assert.deepEqual(mergeServerOrders([], local, 1000, new Map()), [])
    assert.deepEqual(mergeServerOrders(null, local, 1000, new Map()), [])
    // Pas de Map → on retombe sur la liste serveur (comportement antérieur).
    assert.deepEqual(mergeServerOrders(server, local, 1000, null), server)
  })
})
