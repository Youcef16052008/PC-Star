import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTS } from './data.js'
import { emptyDb, normalizeDb } from '../server/db.js'
import {
  MAX_ORDERS_HARD,
  cancelOrder,
  cancelOwnOrder,
  liveStockOf,
  ordersForUser,
  placeOrder
} from '../server/catalog.js'

const product = PRODUCTS.find((item) => Number(item.stock) >= 3)
assert.ok(product, 'un produit de fixture doit avoir au moins trois unités')

function state({ stock = 3, orders = [] } = {}) {
  return {
    orders,
    stock: { [product.id]: stock },
    meta: { hiddenProductIds: [], extraProducts: [], productOverrides: {} }
  }
}

function line(qty = 1) {
  return { id: product.id, sku: product.sku, name: product.name, qty, price: 1 }
}

function body(items) {
  return {
    name: 'Client phase 3',
    phone: '0550123456',
    wilaya: 'Oran',
    items,
    day: '2026-09-17'
  }
}

describe('Phase 3 — propriété des commandes et intégrité de réservation', () => {
  it('agrège les lignes du même produit avant de contrôler et réserver le stock', () => {
    const insufficient = state({ stock: 1 })
    const refused = placeOrder(insufficient, body([line(1), line(1)]))
    assert.equal(refused.ok, false)
    assert.equal(refused.error, 'stock')
    assert.deepEqual(refused.shortages.map((item) => ({ id: item.id, need: item.need, left: item.left })), [
      { id: product.id, need: 2, left: 1 }
    ])
    assert.equal(liveStockOf(insufficient, product.id), 1, 'un refus ne décrémente rien')
    assert.equal(insufficient.orders.length, 0)

    const enough = state({ stock: 3 })
    const accepted = placeOrder(enough, body([line(1), line(2)]), { userId: 'buyer-a' })
    assert.equal(accepted.ok, true)
    assert.deepEqual(accepted.order.items.map((item) => ({ id: item.id, qty: item.qty })), [{ id: product.id, qty: 3 }])
    assert.equal(liveStockOf(enough, product.id), 0)
  })

  it('valide la capacité de commandes avant de modifier le stock', () => {
    const activeOrders = Array.from({ length: MAX_ORDERS_HARD }, (_, index) => ({
      code: `PS-20260917-${String(index + 1).padStart(4, '0')}`,
      status: 'new',
      items: []
    }))
    const db = state({ stock: 2, orders: activeOrders })
    const result = placeOrder(db, body([line(1)]), { userId: 'buyer-a' })

    assert.deepEqual(result, { ok: false, error: 'orders_full' })
    assert.equal(liveStockOf(db, product.id), 2, 'stock modifié alors que la commande est refusée')
    assert.equal(db.orders.length, MAX_ORDERS_HARD, 'une commande partielle a été ajoutée')
  })

  it('rend une réservation idempotente et refuse la réutilisation de clé pour un panier différent', () => {
    const db = state({ stock: 3 })
    const key = 'reservation-key-phase3-0001'
    const first = placeOrder(db, { ...body([line(1)]), idempotencyKey: key }, { userId: 'buyer-a' })
    assert.equal(first.ok, true)
    assert.equal(first.idempotent, undefined)
    assert.equal(liveStockOf(db, product.id), 2)

    const retried = placeOrder(db, { ...body([line(1)]), idempotencyKey: key }, { userId: 'buyer-a' })
    assert.equal(retried.ok, true)
    assert.equal(retried.idempotent, true)
    assert.equal(retried.order.code, first.order.code)
    assert.equal(db.orders.length, 1)
    assert.equal(liveStockOf(db, product.id), 2, 'le retry a décrémenté le stock une deuxième fois')
    assert.equal(JSON.stringify(db).includes(key), false, 'la clé brute ne doit jamais être persistée')

    const conflict = placeOrder(db, { ...body([line(2)]), idempotencyKey: key }, { userId: 'buyer-a' })
    assert.deepEqual(conflict, { ok: false, error: 'idempotency_conflict' })
    assert.equal(liveStockOf(db, product.id), 2)
  })

  it('n’associe jamais une commande guest à un compte sur la seule égalité du téléphone', () => {
    const db = state({
      orders: [
        { code: 'GUEST-OWNERSHIP', userId: null, phone: '0550123456', claimable: false, status: 'new', items: [line(1)] },
        { code: 'OWN-ORDER', userId: 'buyer-a', phone: '0550123456', status: 'new', items: [line(1)] }
      ]
    })

    assert.deepEqual(
      ordersForUser(db, 'buyer-a').map((order) => order.code),
      ['OWN-ORDER'],
      'le téléphone du profil ne doit pas donner accès à une réservation guest'
    )
    assert.deepEqual(cancelOwnOrder(db, 'GUEST-OWNERSHIP', 'buyer-a'), { ok: false, error: 'not_found' })
    assert.equal(db.orders[0].status, 'new')
  })

  it('migre les commandes guest historiques hors de toute reprise par téléphone', () => {
    const legacy = emptyDb()
    normalizeDb(legacy)
    legacy.orders.push({ code: 'LEGACY-GUEST', userId: null, phone: '0550123456', status: 'new', items: [] })
    assert.equal(normalizeDb(legacy), true)
    assert.equal(legacy.orders.at(-1).claimable, false)
    assert.equal(normalizeDb(legacy), false, 'migration idempotente après persistance')
  })

  it('revalide dans le mutateur la propriété et le statut avant un restock, puis reste idempotent', () => {
    const db = state({
      stock: 0,
      orders: [{ code: 'OWN-CANCEL', userId: 'buyer-a', status: 'new', items: [line(2)] }]
    })

    assert.deepEqual(cancelOwnOrder(db, 'OWN-CANCEL', 'buyer-b'), { ok: false, error: 'not_found' })
    assert.equal(liveStockOf(db, product.id), 0)

    const cancelled = cancelOwnOrder(db, 'OWN-CANCEL', 'buyer-a')
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.order.status, 'cancelled')
    assert.equal(liveStockOf(db, product.id), 2)

    // Le routeur passe par cancelOwnOrder et empêche une deuxième annulation;
    // la primitive master cancelOrder reste aussi sans double-restock.
    assert.deepEqual(cancelOwnOrder(db, 'OWN-CANCEL', 'buyer-a'), { ok: false, error: 'status' })
    assert.equal(cancelOrder(db, 'OWN-CANCEL').ok, true)
    assert.equal(liveStockOf(db, product.id), 2)

    db.orders[0].status = 'preparing'
    assert.deepEqual(cancelOwnOrder(db, 'OWN-CANCEL', 'buyer-a'), { ok: false, error: 'status' })
    assert.equal(liveStockOf(db, product.id), 2)
  })
})
