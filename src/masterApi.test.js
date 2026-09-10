import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createProduct,
  hideProductMaster,
  listMasterProducts,
  ordersToCsv,
  updateProduct
} from '../server/masterApi.js'
import { publicCatalog } from '../server/catalog.js'

function emptyDb() {
  return {
    orders: [],
    stock: {},
    meta: {
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: [],
      productOverrides: {}
    }
  }
}

describe('master CRUD', () => {
  it('creates an extra product with stock', () => {
    const db = emptyDb()
    const r = createProduct(db, {
      name: 'Test Stick',
      price: 1500,
      stock: 4,
      category: 'usb',
      brand: 'PC Star',
      short: 'demo'
    })
    assert.equal(r.ok, true)
    assert.ok(r.product.id)
    assert.equal(db.stock[r.product.id], 4)
    const list = listMasterProducts(db)
    assert.ok(list.some((p) => p.id === r.product.id))
  })

  it('updates stock and hides catalog product', () => {
    const db = emptyDb()
    const id = 'cpu-5600'
    const u = updateProduct(db, id, { stock: 3, short: 'override' })
    assert.equal(u.ok, true)
    assert.equal(db.stock[id], 3)
    const h = hideProductMaster(db, id, true)
    assert.equal(h.ok, true)
    assert.ok(db.meta.hiddenProductIds.includes(id))
    const pub = publicCatalog(db)
    assert.ok(!pub.some((p) => p.id === id))
  })

  it('masque/unmasque un produit créé par le master (extra)', () => {
    const db = emptyDb()
    const r = createProduct(db, { name: 'Masquable', price: 500, stock: 2, category: 'usb' })
    assert.equal(r.ok, true)
    assert.ok(publicCatalog(db).some((p) => p.id === r.product.id), 'visible avant masquage')

    const h = hideProductMaster(db, r.product.id, true)
    assert.equal(h.ok, true)
    assert.ok(db.meta.hiddenProductIds.includes(r.product.id))
    assert.ok(!publicCatalog(db).some((p) => p.id === r.product.id), 'masqué du catalogue public')
    const listed = listMasterProducts(db).find((p) => p.id === r.product.id)
    assert.equal(listed.hidden, true, 'listMasterProducts signale hidden')

    const u = hideProductMaster(db, r.product.id, false)
    assert.equal(u.ok, true)
    assert.ok(publicCatalog(db).some((p) => p.id === r.product.id), 'revisible après unmasquage')
    assert.equal(listMasterProducts(db).find((p) => p.id === r.product.id).hidden, false)
  })

  it('exports CSV with headers', () => {
    const csv = ordersToCsv([
      {
        code: 'PS-20260910-0001',
        status: 'new',
        at: '2026-09-10T10:00:00.000Z',
        name: 'Karim',
        phone: '0550123456',
        carrier: 'ooredoo',
        wilaya: 'Oran',
        slot: '16:00',
        total: 24500,
        items: [{ qty: 1, name: 'CPU' }]
      }
    ], { day: '2026-09-10' })
    assert.match(csv, /^code,status/)
    assert.match(csv, /PS-20260910-0001/)
    assert.match(csv, /Karim/)
  })
})
