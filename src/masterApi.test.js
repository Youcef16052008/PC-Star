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

describe('P8 (P7-1) — la vue master reflète les productOverrides', () => {
  it('prix + nom override visibles dans listMasterProducts (et pas seulement au public)', () => {
    const db = emptyDb()
    const u = updateProduct(db, 'cpu-5600', { price: 99999, name: 'RYZEN TEST' })
    assert.equal(u.ok, true)
    const list = listMasterProducts(db)
    const row = list.find((p) => p.id === 'cpu-5600')
    assert.equal(row.price, 99999)
    assert.equal(row.name, 'RYZEN TEST')
    // le public et le master doivent afficher la même valeur
    const pub = publicCatalog(db).find((p) => p.id === 'cpu-5600')
    assert.equal(pub.price, row.price)
    assert.equal(pub.name, row.name)
  })

  it('photos override visibles dans la vue master (le panneau photos ne part plus de l\'ancienne liste)', () => {
    const db = emptyDb()
    updateProduct(db, 'cpu-5600', { photos: ['/photos/uploads/cpu-5600-new.jpg'] })
    const row = listMasterProducts(db).find((p) => p.id === 'cpu-5600')
    assert.deepEqual(row.photos, ['/photos/uploads/cpu-5600-new.jpg'])
  })

  it('stock live + flag hidden restent ceux du serveur (pas écrasés par l\'override)', () => {
    const db = emptyDb()
    updateProduct(db, 'cpu-5600', { price: 12345 })
    updateProduct(db, 'cpu-5600', { stock: 2 })
    hideProductMaster(db, 'cpu-5600', true)
    const row = listMasterProducts(db).find((p) => p.id === 'cpu-5600')
    assert.equal(row.price, 12345)
    assert.equal(row.stock, 2)
    assert.equal(row.hidden, true)
    // un produit SANS override garde ses valeurs de base
    const base = listMasterProducts(db).find((p) => p.id === 'gpu-4060')
    assert.equal(base.hidden, false)
    assert.ok(base.price > 0)
  })
})
