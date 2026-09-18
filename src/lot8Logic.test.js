import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// LOT 8 — audit A→Z du 16/09/2026, partie LOGIQUE PURE (A1 + A2).
//
//  8.1 (A1) 🔴 un produit MASQUÉ par le maître (`hiddenProductIds`) restait
//            commandable par n'importe qui : `publicCatalog` le filtrait de la
//            vitrine, `placeOrder` ne le consultait jamais. Reproduit en direct
//            pendant l'audit → HTTP 201, commande créée.
//  8.2 (A2) 🔴 un identifiant inconnu du serveur était tarifé **0 DA** :
//            `priceOf` → `null`, la normalisation écrivait `price: 0`, la
//            commande passait et décrémentait le stock de l'id fantôme.
//            `normalizeDb` ne purgeait pas les entrées orphelines qui
//            alimentent ce chemin (id retiré de src/data.js, migration,
//            restauration de sauvegarde).
//
// Les routes HTTP réelles sont dans src/lot8Server.test.js, le comportement
// rendu (message + retrait du panier) dans src/lot8UI.test.js.
// ---------------------------------------------------------------------------

import { placeOrder, liveStockOf, priceOf, publicCatalog } from '../server/catalog.js'
import { normalizeDb, purgeOrphanCatalogRefs } from '../server/db.js'
import { orderApiFailure, orderBlockedMessage, dropCartLines } from './orderLogic.js'
import { dict, LANGS } from './i18n.js'
import { PRODUCTS } from './data.js'

const PHONE = '0550123456'
const DAY = '2026-09-16'

/** Un produit de base en stock, et un second pour les paniers mixtes. */
const P1 = PRODUCTS.find((p) => p.id === 'cpu-7800x3d')
const P2 = PRODUCTS.find((p) => p.id === 'ssd-1t')
assert.ok(P1 && P2, 'fixtures : deux références réelles du catalogue')

function dbWith({ stock = {}, hidden = [], extras = [], overrides = {}, orders = [] } = {}) {
  return {
    users: [{ id: 'm', role: 'master' }],
    sessions: {},
    orders,
    stock,
    meta: {
      demoSeeded: true,
      extraProducts: extras,
      hiddenProductIds: hidden,
      extraPanels: [],
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: overrides
    }
  }
}

function order(items) {
  return { name: 'Client Test', phone: PHONE, wilaya: 'Oran', slot: '12:30', day: DAY, items }
}

/* ------------------------------------------------------------- 8.1 (A1) */

describe('LOT 8.1 (A1) — un produit masqué n’est pas commandable', () => {
  it('placeOrder refuse la ligne masquée : `unavailable`, stock intact, aucune commande', () => {
    const db = dbWith({ stock: { [P1.id]: 5 }, hidden: [P1.id] })
    const r = placeOrder(db, order([{ id: P1.id, sku: P1.sku, name: P1.name, qty: 2 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unavailable')
    assert.deepEqual(r.unavailable, [{ id: P1.id, name: P1.name }], 'la ligne en cause est nommée')
    // AVANT le correctif : ok=true, commande créée, stock décrémenté.
    assert.equal(liveStockOf(db, P1.id), 5, 'rien n’est décrémenté')
    assert.equal(db.orders.length, 0, 'aucune commande créée')
  })

  it('le masquage est bien ce qui refuse : démasquer rend la commande possible', () => {
    const db = dbWith({ stock: { [P1.id]: 5 }, hidden: [P1.id] })
    assert.equal(placeOrder(db, order([{ id: P1.id, qty: 1 }])).error, 'unavailable')
    db.meta.hiddenProductIds = []
    const r = placeOrder(db, order([{ id: P1.id, qty: 1 }]))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(liveStockOf(db, P1.id), 4)
  })

  it('panier mixte : TOUTE la commande est refusée, la ligne valide n’est pas décrémentée', () => {
    const db = dbWith({ stock: { [P1.id]: 5, [P2.id]: 7 }, hidden: [P1.id] })
    const r = placeOrder(
      db,
      order([
        { id: P2.id, sku: P2.sku, name: P2.name, qty: 1 },
        { id: P1.id, sku: P1.sku, name: P1.name, qty: 1 }
      ])
    )
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unavailable')
    // Atomicité : même exigence que le contrôle de stock (aucun commit partiel).
    assert.equal(liveStockOf(db, P1.id), 5)
    assert.equal(liveStockOf(db, P2.id), 7, 'la ligne valide n’est pas décrémentée non plus')
    assert.equal(db.orders.length, 0)
  })

  it('un produit MAÎTRE masqué est refusé lui aussi (extraProducts + hiddenProductIds)', () => {
    const extra = { id: 'extra-1', sku: 'XTRA-1', name: 'Produit maître', price: 1500 }
    const db = dbWith({ stock: { 'extra-1': 3 }, extras: [extra], hidden: ['extra-1'] })
    assert.ok(!publicCatalog(db).some((p) => p.id === 'extra-1'), 'absent de la vitrine publique')
    const r = placeOrder(db, order([{ id: 'extra-1', sku: extra.sku, name: extra.name, qty: 1 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unavailable')
    assert.equal(liveStockOf(db, 'extra-1'), 3)
  })

  it('la vitrine et la commande appliquent la MÊME règle (une seule source de vérité)', () => {
    const db = dbWith({ stock: { [P1.id]: 5, [P2.id]: 5 }, hidden: [P1.id] })
    const visible = publicCatalog(db).some((p) => p.id === P1.id)
    const orderable = placeOrder(db, order([{ id: P1.id, qty: 1 }])).ok
    assert.equal(visible, false, 'masqué → absent du catalogue public')
    assert.equal(orderable, false, 'masqué → non commandable')
    assert.equal(visible, orderable, 'plus de divergence vitrine/commande')
  })
})

/* ------------------------------------------------------------- 8.2 (A2) */

describe('LOT 8.2 (A2) — un id inconnu n’est jamais tarifé 0 DA', () => {
  const GHOST = 'produit-fantome'

  it('placeOrder refuse l’id inconnu : stock intact, aucune commande à 0 DA', () => {
    // Reproduit à l'audit : cette base donnait ok=true, total=0, code
    // PS-20260916-0001 et stock 5 → 0.
    const db = dbWith({ stock: { [GHOST]: 5 } })
    assert.equal(priceOf(db, GHOST), null, 'le serveur ne connaît aucun prix pour cet id')
    const r = placeOrder(db, order([{ id: GHOST, sku: 'GHOST', name: 'Fantôme', qty: 1, price: 99000 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
    assert.deepEqual(r.unknown, [{ id: GHOST, name: 'Fantôme' }])
    assert.equal(r.order, undefined, 'aucune commande renvoyée')
    assert.equal(liveStockOf(db, GHOST), 5, 'le stock fantôme n’est pas décrémenté')
    assert.equal(db.orders.length, 0)
    // Garde explicite sur le symptôme audité : plus AUCUN total à 0 DA.
    assert.ok(!db.orders.some((o) => Number(o.total) === 0), 'aucune commande à 0 DA en base')
  })

  it('le prix envoyé par le client ne rachète pas la ligne (confiance zéro)', () => {
    const db = dbWith({ stock: { [GHOST]: 5 } })
    const r = placeOrder(db, order([{ id: GHOST, name: 'Fantôme', qty: 1, price: 12345 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
  })

  it('panier mixte (valide + inconnu) : refus global, rien décrémenté', () => {
    const db = dbWith({ stock: { [P1.id]: 4, [GHOST]: 2 } })
    const r = placeOrder(
      db,
      order([
        { id: P1.id, sku: P1.sku, name: P1.name, qty: 2 },
        { id: GHOST, sku: 'GHOST', name: 'Fantôme', qty: 1 }
      ])
    )
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
    assert.equal(liveStockOf(db, P1.id), 4)
    assert.equal(liveStockOf(db, GHOST), 2)
    assert.equal(db.orders.length, 0)
  })

  it('ligne SANS identifiant : refusée comme inconnue (elle tombait dans « stock » avant)', () => {
    const db = dbWith({ stock: { [P1.id]: 4 } })
    const r = placeOrder(db, order([{ qty: 2, name: 'Sans id' }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
    assert.equal(liveStockOf(db, P1.id), 4)
  })

  it('pas de faux positif : produit de base, produit maître et override restent commandables', () => {
    const base = dbWith({ stock: { [P1.id]: 3 } })
    const r1 = placeOrder(base, order([{ id: P1.id, qty: 1 }]))
    assert.equal(r1.ok, true, JSON.stringify(r1))
    assert.equal(r1.order.total, P1.price, 'tarifé depuis le catalogue de base')

    const extra = { id: 'extra-1', sku: 'XTRA-1', name: 'Produit maître', price: 1500 }
    const withExtra = dbWith({ stock: { 'extra-1': 3 }, extras: [extra] })
    const r2 = placeOrder(withExtra, order([{ id: 'extra-1', qty: 2 }]))
    assert.equal(r2.ok, true, JSON.stringify(r2))
    assert.equal(r2.order.total, 3000, 'tarifé depuis le produit maître')

    const withOverride = dbWith({ stock: { [P2.id]: 3 }, overrides: { [P2.id]: { price: 8000 } } })
    const r3 = placeOrder(withOverride, order([{ id: P2.id, qty: 1 }]))
    assert.equal(r3.ok, true, JSON.stringify(r3))
    assert.equal(r3.order.total, 8000, 'tarifé depuis l’override maître')
  })

  it('un id inconnu ET masqué → `unknown_product` (l’id n’existe pas, priorité au fait le plus fort)', () => {
    const db = dbWith({ stock: { [GHOST]: 1 }, hidden: [GHOST] })
    const r = placeOrder(db, order([{ id: GHOST, qty: 1 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
  })
})

/* --------------------------------------- 8.2 (A2) — purge des orphelins */

describe('LOT 8.2 (A2) — normalizeDb purge les références orphelines', () => {
  it('purge stock + productOverrides inconnus, garde les ids valides', () => {
    const db = dbWith({
      stock: { [P1.id]: 4, 'produit-fantome': 5, 'cpu-5600': 2 },
      overrides: { [P2.id]: { price: 9000 }, ghost: { price: 1 } },
      extras: [{ id: 'extra-1', price: 1500 }]
    })
    // `cpu-5600` a VRAIMENT été retiré du catalogue (lot P21) : cas réel.
    assert.ok(!PRODUCTS.some((p) => p.id === 'cpu-5600'), 'fixture : cpu-5600 n’existe plus')
    const r = purgeOrphanCatalogRefs(db)
    assert.deepEqual(r.purged.sort(), ['productOverrides:ghost', 'stock:cpu-5600', 'stock:produit-fantome'])
    assert.deepEqual(db.stock, { [P1.id]: 4 })
    assert.deepEqual(Object.keys(db.meta.productOverrides), [P2.id])
    assert.equal(r.skipped, false)
  })

  it('un produit maître n’est PAS un orphelin (son stock et son override survivent)', () => {
    const db = dbWith({
      stock: { 'extra-1': 3 },
      overrides: { 'extra-1': { price: 1400 } },
      extras: [{ id: 'extra-1', price: 1500 }]
    })
    const r = purgeOrphanCatalogRefs(db)
    assert.deepEqual(r.purged, [])
    assert.deepEqual(db.stock, { 'extra-1': 3 })
    assert.deepEqual(db.meta.productOverrides, { 'extra-1': { price: 1400 } })
  })

  it('extraProducts illisible → on ne purge RIEN (mieux vaut une clé morte qu’un stock effacé)', () => {
    const db = dbWith({ stock: { 'extra-1': 3, [P1.id]: 2 } })
    db.meta.extraProducts = 'cassé'
    const r = purgeOrphanCatalogRefs(db)
    assert.equal(r.skipped, true)
    assert.deepEqual(r.purged, [])
    assert.deepEqual(db.stock, { 'extra-1': 3, [P1.id]: 2 }, 'stock intact')
  })

  it('normalizeDb signale le changement, purge, puis est idempotent (pas d’écriture en boucle)', () => {
    const db = dbWith({ stock: { 'produit-fantome': 5, [P1.id]: 2 }, overrides: { ghost: { price: 1 } } })
    // LOT 3.2 (B2/B3) : `changed` pilote la persistance — un faux positif
    // remettrait une écriture disque à chaque lecture.
    assert.equal(normalizeDb(db), true, 'premier passage : l’état a changé')
    assert.deepEqual(db.stock, { [P1.id]: 2 })
    assert.deepEqual(db.meta.productOverrides, {})
    assert.equal(normalizeDb(db), false, 'second passage : plus rien à changer')
  })

  it('après purge, une commande sur l’ancien id fantôme est refusée (fin du chemin 0 DA)', () => {
    const db = dbWith({ stock: { 'produit-fantome': 5 } })
    normalizeDb(db)
    const r = placeOrder(db, order([{ id: 'produit-fantome', qty: 1 }]))
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
    assert.equal(db.stock['produit-fantome'], undefined, 'la clé orpheline a disparu')
  })
})

/* ------------------------------- 8.1/8.2 — classification côté client */

describe('LOT 8.1 + 8.2 — le client classe et nomme les nouveaux refus', () => {
  it('orderApiFailure : 409 `unavailable` → kind "unavailable" (pas "stock")', () => {
    const r = orderApiFailure({
      ok: false,
      status: 409,
      data: { error: 'unavailable', unavailable: [{ id: 'x', name: 'Produit retiré' }] }
    })
    assert.equal(r.kind, 'unavailable')
    assert.deepEqual(r.lines, [{ id: 'x', name: 'Produit retiré' }])
  })

  it('orderApiFailure : 400 `unknown_product` → kind "unknown"', () => {
    const r = orderApiFailure({
      ok: false,
      status: 400,
      data: { error: 'unknown_product', unknown: [{ id: 'ghost', name: 'Fantôme' }] }
    })
    assert.equal(r.kind, 'unknown')
    assert.deepEqual(r.lines, [{ id: 'ghost', name: 'Fantôme' }])
  })

  it('orderApiFailure : conflit de clé de réservation ≠ rupture de stock', () => {
    assert.equal(orderApiFailure({ ok: false, status: 409, data: { error: 'idempotency_conflict' } }).kind, 'idempotency')
  })

  it('orderApiFailure : la rupture garde son classement (non-régression P8/LOT 5.2)', () => {
    assert.equal(
      orderApiFailure({ ok: false, status: 409, data: { error: 'stock', shortages: [{ id: 'x' }] } }).kind,
      'stock'
    )
    assert.equal(orderApiFailure({ ok: false, status: 500, data: { error: 'stock' } }).kind, 'stock')
    assert.equal(orderApiFailure({ ok: false, status: 429, data: {} }).kind, 'rate')
    assert.equal(orderApiFailure({ offline: true }).kind, 'offline')
    assert.equal(orderApiFailure({ ok: false, status: 500, data: {} }).kind, 'server')
  })

  const t = (key, vars) => {
    let s = dict.fr[key] ?? key
    Object.entries(vars || {}).forEach(([k, v]) => {
      s = s.replaceAll(`{${k}}`, String(v))
    })
    return s
  }

  it('orderBlockedMessage nomme les lignes refusées et reste court (max 3)', () => {
    const msg = orderBlockedMessage([{ id: 'a', name: 'RTX 4070 Super' }], t, 'unavailable')
    assert.ok(msg.includes('RTX 4070 Super'), 'le produit est nommé')
    assert.ok(msg.includes('vente'), 'le motif est dit')
    const long = orderBlockedMessage(
      [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, name: `Produit ${n}` })),
      t,
      'unavailable'
    )
    assert.ok(long.includes('Produit 3'), 'les 3 premières lignes sont nommées')
    assert.ok(!long.includes('Produit 4'), 'au-delà, on résume')
    assert.ok(long.includes('2'), 'le reliquat est annoncé')
    // Repli sans nom si le serveur n’a rien détaillé.
    assert.equal(orderBlockedMessage([], t, 'unavailable'), t('orderUnavailable'))
    assert.equal(orderBlockedMessage([], t, 'unknown'), t('orderUnknown'))
    assert.ok(orderBlockedMessage([{ id: 'ghost' }], t, 'unknown').includes('catalogue'))
  })

  it('les 4 nouvelles clés existent dans les 3 langues (couverture i18n)', () => {
    for (const key of ['orderUnavailable', 'orderUnavailableDetail', 'orderUnknown', 'orderUnknownDetail']) {
      for (const { id } of LANGS) {
        const v = dict[id]?.[key]
        assert.equal(typeof v, 'string', `${id}:${key} absent`)
        assert.ok(v.trim().length > 5, `${id}:${key} vide`)
      }
      if (key.endsWith('Detail')) {
        for (const { id } of LANGS) assert.ok(dict[id][key].includes('{lines}'), `${id}:${key} sans {lines}`)
      }
    }
  })

  it('le message de conflit d’idempotence existe dans les trois langues', () => {
    for (const { id } of LANGS) {
      const value = dict[id]?.orderRetryConflict
      assert.equal(typeof value, 'string', `${id}:orderRetryConflict absent`)
      assert.ok(value.trim().length > 8, `${id}:orderRetryConflict trop court`)
    }
  })

  it('dropCartLines retire exactement les lignes refusées et garde le reste', () => {
    const cart = [
      { id: P1.id, qty: 1, name: P1.name },
      { id: 'ghost', qty: 2, name: 'Fantôme' },
      { id: P2.id, qty: 1, name: P2.name }
    ]
    const kept = dropCartLines(cart, [{ id: 'ghost', name: 'Fantôme' }])
    assert.deepEqual(kept.map((c) => c.id), [P1.id, P2.id])
    // Les ids nus sont acceptés aussi (forme minimale du serveur).
    assert.deepEqual(dropCartLines(cart, [P2.id]).map((c) => c.id), [P1.id, 'ghost'])
    // Entrées invalides : rien ne saute, rien n’explose.
    assert.deepEqual(dropCartLines(cart, []), cart)
    assert.deepEqual(dropCartLines(cart, null), cart)
    assert.deepEqual(dropCartLines(null, [{ id: 'x' }]), [])
    assert.deepEqual(dropCartLines(cart, [{}, null, '']).length, 3, 'ligne sans id ignorée')
  })
})
