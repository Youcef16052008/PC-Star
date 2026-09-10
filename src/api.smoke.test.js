import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCTS } from './data.js'
import { DZ_EXTRA, DZ_BRANDS } from './dzCatalog.js'
import { isDzPhone, phoneCarrier } from './shopStore.js'

describe('DZ catalog fill', () => {
  it('has a thick catalog with local brands', () => {
    assert.ok(PRODUCTS.length >= 220, `expected >=220 products, got ${PRODUCTS.length}`)
    assert.ok(DZ_EXTRA.length >= 70, `expected >=70 DZ skus, got ${DZ_EXTRA.length}`)
    const brands = new Set(PRODUCTS.map((p) => p.brand))
    ;['Spirit of Gamer', 'Havit', 'Twinmos', 'Magma', 'Gamemax', 'Tenda'].forEach((b) => {
      assert.ok(brands.has(b), `missing brand ${b}`)
    })
    assert.ok(DZ_BRANDS.includes('Spirit of Gamer'))
  })

  it('tags budget and dz-hit items', () => {
    const hits = PRODUCTS.filter((p) => (p.tags || []).includes('dz-hit'))
    const budget = PRODUCTS.filter((p) => (p.tags || []).includes('budget'))
    assert.ok(hits.length >= 15)
    assert.ok(budget.length >= 15)
  })
})

describe('checkout phone DZ', () => {
  it('only accepts mobilis ooredoo djezzy', () => {
    assert.equal(phoneCarrier('0550123456'), 'ooredoo')
    assert.equal(phoneCarrier('0669174617'), 'mobilis')
    assert.equal(phoneCarrier('0770650387'), 'djezzy')
    assert.equal(isDzPhone('0210000000'), false)
  })
})
