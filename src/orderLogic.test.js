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
  makeOrderCode,
  BUILD_PRESETS
} from './orderLogic.js'
import { placeOrder, cancelOrder, liveStockOf, setOrderStatus } from '../server/catalog.js'
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
