import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MASTER,
  addPanel,
  addProduct,
  buildShopView,
  createMemoryStorage,
  deleteCustomer,
  hashPass,
  hideProduct,
  isDzPhone,
  isEmail,
  loadMeta,
  loadSavedSearches,
  saveSavedSearches,
  loadUsers,
  loginEmail,
  normalizePhone,
  phoneCarrier,
  registerEmail,
  saveMeta,
  saveUsers,
  setProductPhotos,
  togglePanel,
  updateUser,
  DEMO_CUSTOMERS
} from './shopStore.js'

describe('phones and emails', () => {
  it('normalizes Algerian mobiles', () => {
    assert.equal(normalizePhone('0770 65 03 87'), '0770650387')
    assert.equal(normalizePhone('+213770650387'), '0770650387')
    assert.equal(normalizePhone('669174617'), '0669174617')
    assert.equal(isDzPhone('0550123456'), true)
    assert.equal(isDzPhone('021234567'), false)
  })

  it('accepts a simple email', () => {
    assert.equal(isEmail('a@b.dz'), true)
    assert.equal(isEmail('nope'), false)
  })

  it('maps DZ carriers', () => {
    assert.equal(phoneCarrier('0550123456'), 'ooredoo')
    assert.equal(phoneCarrier('0669174617'), 'mobilis')
    assert.equal(phoneCarrier('0770650387'), 'djezzy')
    assert.equal(phoneCarrier('021234567'), null)
  })
})

describe('email accounts', () => {
  it('registers a customer and logs them in', () => {
    let users = []
    const reg = registerEmail(users, {
      email: 'karim@test.dz',
      password: 'azerty12',
      name: 'Karim',
      phone: '0550123456'
    })
    assert.equal(reg.ok, true)
    assert.equal(reg.user.role, 'customer')
    assert.equal(reg.user.password, hashPass('azerty12'))
    users = reg.users
    const login = loginEmail(users, { email: 'karim@test.dz', password: 'azerty12' })
    assert.equal(login.ok, true)
    assert.equal(login.user.name, 'Karim')
  })

  it('rejects a wrong password and duplicate email', () => {
    const { users } = registerEmail([], {
      email: 'karim@test.dz',
      password: 'azerty12',
      name: 'Karim'
    })
    assert.equal(loginEmail(users, { email: 'karim@test.dz', password: 'nope' }).ok, false)
    assert.equal(registerEmail(users, { email: 'karim@test.dz', password: 'azerty12', name: 'X' }).ok, false)
  })

  it('logs in the seeded master', () => {
    const users = loadUsers(createMemoryStorage())
    const login = loginEmail(users, { email: MASTER.email, password: MASTER.password })
    assert.equal(login.ok, true)
    assert.equal(login.user.role, 'master')
  })

  it('seeds demo customers', () => {
    const users = loadUsers(createMemoryStorage())
    DEMO_CUSTOMERS.forEach((d) => {
      const login = loginEmail(users, { email: d.email, password: d.passwordPlain })
      assert.equal(login.ok, true)
      assert.equal(login.user.role, 'customer')
    })
  })
})

describe('master vs customer', () => {
  it('lets master delete a customer but not itself', () => {
    const seeded = loadUsers(createMemoryStorage())
    const { users, user } = registerEmail(seeded, {
      email: 'a@b.dz',
      password: 'secret99',
      name: 'Amina'
    })
    const master = users.find((u) => u.role === 'master')
    const gone = deleteCustomer(users, master, user.id)
    assert.equal(gone.ok, true)
    assert.equal(gone.users.some((u) => u.id === user.id), false)
    assert.equal(deleteCustomer(gone.users, master, master.id).ok, false)
    assert.equal(deleteCustomer(users, user, user.id).ok, false)
  })

  it('saves profile name and wilaya', () => {
    const { users, user } = registerEmail([], { email: 'a@b.dz', password: 'secret99', name: 'Amina' })
    const next = updateUser(users, user.id, { name: 'Amina B', wilaya: 'Mascara' })
    assert.equal(next.ok, true)
    assert.equal(next.user.name, 'Amina B')
    assert.equal(next.user.wilaya, 'Mascara')
  })
})

// P5 (B19) : plus aucun téléphone partagé entre master et comptes démo —
// un login SMS local ne doit jamais retomber sur le master.
describe('demo phone uniqueness (B19)', () => {
  it('master + démos : téléphones uniques', () => {
    const seeded = loadUsers(createMemoryStorage())
    const phones = seeded
      .filter((u) => u.phone)
      .map((u) => u.phone)
    assert.equal(new Set(phones).size, phones.length, 'téléphone dupliqué → ' + phones.join(', '))
    const master = seeded.find((u) => u.role === 'master')
    assert.ok(master.phone)
    assert.ok(!seeded.some((u) => u.role !== 'master' && u.phone === master.phone))
  })
})

describe('catalog paneaux', () => {
  const baseProducts = [
    { id: 'cpu-1', name: 'i5', category: 'cpu', price: 1000, stock: 2 },
    { id: 'usb-1', name: 'USB', category: 'usb', price: 500, stock: 4 }
  ]
  const baseLines = [
    { id: 'cpu', label: 'CPU', group: 'parts', match: (p) => p.category === 'cpu' },
    { id: 'usb', label: 'USB', group: 'desk', match: (p) => p.category === 'usb' }
  ]
  const basePanels = [
    { id: 'parts', titleKey: 'panelParts' },
    { id: 'desk', titleKey: 'panelDesk' }
  ]

  it('hides a product and adds a custom SKU', () => {
    let meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] }
    meta = hideProduct(meta, 'cpu-1')
    const added = addProduct(meta, {
      name: 'Flash 64 Go',
      price: 1200,
      category: 'usb',
      brand: 'Kingston',
      stock: 8,
      short: 'USB 3.2',
      photos: ['/photos/lib/usb-1.jpg', 'https://example.com/a.jpg']
    })
    assert.equal(added.ok, true)
    assert.equal(added.product.photos.length, 2)
    meta = added.meta
    const view = buildShopView(baseProducts, baseLines, basePanels, meta)
    assert.equal(view.products.some((p) => p.id === 'cpu-1'), false)
    assert.equal(view.products.some((p) => p.name === 'Flash 64 Go'), true)
  })

  it('P6 : SKU saisi par le master est conservé (sinon généré)', () => {
    const withSku = addProduct({ extraProducts: [] }, {
      name: 'Câble HDMI 2.1',
      price: 900,
      category: 'usb',
      stock: 5,
      sku: 'HDMI-15M'
    })
    assert.equal(withSku.ok, true)
    assert.equal(withSku.product.sku, 'HDMI-15M')
    const withoutSku = addProduct({ extraProducts: [] }, {
      name: 'Souris sans fil',
      price: 700,
      category: 'usb',
      stock: 2
    })
    assert.equal(withoutSku.ok, true)
    assert.match(withoutSku.product.sku, /^PS-/)
  })

  it('overrides catalog photos and keeps custom product photos', () => {
    let meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], photoOverrides: {} }
    const ov = setProductPhotos(meta, 'cpu-1', ['/photos/lib/cpu-1.jpg', '/photos/lib/cpu-2.jpg', '/photos/lib/cpu-3.jpg'])
    assert.equal(ov.ok, true)
    meta = ov.meta
    const view = buildShopView(baseProducts, baseLines, basePanels, meta)
    const cpu = view.products.find((p) => p.id === 'cpu-1')
    assert.equal(cpu.photos.length, 3)
    assert.equal(cpu.photos[0], '/photos/lib/cpu-1.jpg')
  })

  it('toggles a panel off and adds a custom panel', () => {
    let meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] }
    meta = togglePanel(meta, 'desk', false)
    const added = addPanel(meta, {
      titles: { ar: 'كابلات', fr: 'Cables', en: 'Cables' },
      categories: ['usb']
    })
    assert.equal(added.ok, true)
    const view = buildShopView(baseProducts, baseLines, basePanels, added.meta)
    assert.equal(view.panels.some((p) => p.id === 'desk'), false)
    assert.equal(view.panels.some((p) => p.id === added.panel.id), true)
    assert.equal(view.lines.some((l) => l.group === added.panel.id && l.match(baseProducts[1])), true)
  })
})

describe('storage roundtrip', () => {
  it('persists users and catalog meta', () => {
    const storage = createMemoryStorage()
    const users = loadUsers(storage)
    const { users: next } = registerEmail(users, { email: 'z@z.dz', password: 'passpass1', name: 'Z' })
    saveUsers(storage, next)
    assert.equal(loadUsers(storage).some((u) => u.email === 'z@z.dz'), true)
    const meta = addProduct(loadMeta(storage), { name: 'X', price: 10, category: 'usb', brand: 'A', stock: 1, short: 's' }).meta
    saveMeta(storage, meta)
    assert.equal(loadMeta(storage).extraProducts.length, 1)
  })
})

describe('P10 (P7-14) — recherches sauvées persistées', () => {
  it('vide par défaut, round-trip, bornées à 10', () => {
    const st = createMemoryStorage()
    assert.deepEqual(loadSavedSearches(st), [])
    const list = [{ id: 's-1', title: 'CPU · AM5', filters: { q: '' } }]
    saveSavedSearches(st, list)
    assert.deepEqual(loadSavedSearches(st), list)
    // 15 entrées → seules les 10 plus récentes (début de liste) survivent
    const big = Array.from({ length: 15 }, (_, i) => ({ id: `s-${i}`, title: `t${i}`, filters: {} }))
    saveSavedSearches(st, big)
    const loaded = loadSavedSearches(st)
    assert.equal(loaded.length, 10)
    assert.equal(loaded[0].id, 's-0')
    assert.equal(loaded[9].id, 's-9')
  })
  it('storage cassé / illisible → [] (jamais d\'exception)', () => {
    const st = createMemoryStorage()
    st.setItem('pcstar-saved-searches', '{pas du json')
    assert.deepEqual(loadSavedSearches(st), [])
    saveSavedSearches(null, [{ id: 'x' }]) // storage null : silencieux
  })
})
