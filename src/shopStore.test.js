import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
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
  DEMO_CUSTOMERS,
  // LOT 1.19 : mot de passe local partagé des comptes de démonstration, en
  // remplacement des `passwordPlain` publiés dans le README.
  DEMO_LOCAL_PASSWORD
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
      password: 'azerty-fixture',
      name: 'Karim',
      phone: '0550123456'
    })
    assert.equal(reg.ok, true)
    assert.equal(reg.user.role, 'customer')
    assert.equal(reg.user.password, hashPass('azerty-fixture'))
    users = reg.users
    const login = loginEmail(users, { email: 'karim@test.dz', password: 'azerty-fixture' })
    assert.equal(login.ok, true)
    assert.equal(login.user.name, 'Karim')
  })

  it('rejects a wrong password and duplicate email', () => {
    const { users } = registerEmail([], {
      email: 'karim@test.dz',
      password: 'azerty-fixture',
      name: 'Karim'
    })
    assert.equal(loginEmail(users, { email: 'karim@test.dz', password: 'nope' }).ok, false)
    assert.equal(registerEmail(users, { email: 'karim@test.dz', password: 'azerty-fixture', name: 'X' }).ok, false)
  })

  // LOT 1.1 : le compte maître n'est plus seedé côté client. Il était défini
  // ici avec e-mail + mot de passe EN CLAIR, donc inclus dans le bundle JS
  // public par Vite, et ces valeurs ouvraient une vraie session `role:
  // 'master'` sur l'API. Le maître ne peut plus venir que du serveur
  // (MASTER_EMAIL / MASTER_PASSWORD).
  it('ne seed AUCUN compte maître en mode local', () => {
    const users = loadUsers(createMemoryStorage())
    assert.equal(
      users.filter((u) => u.role === 'master').length,
      0,
      'un compte maître ne doit plus exister côté client'
    )
    assert.ok(users.length > 0, 'les comptes de démonstration restent seedés')
  })

  it("n'expose aucun identifiant maître dans le module client", async () => {
    const mod = await import('./shopStore.js')
    assert.equal(mod.MASTER, undefined, "l'export MASTER a disparu du module client")
  })

  it('seeds demo customers', () => {
    // LOT 1.19 : `DEMO_CUSTOMERS` ne porte plus de `passwordPlain` (le mot de
    // passe publié dans le README a disparu du module client) ; les trois comptes
    // de démonstration partagent `DEMO_LOCAL_PASSWORD`.
    const users = loadUsers(createMemoryStorage())
    DEMO_CUSTOMERS.forEach((d) => {
      const login = loginEmail(users, { email: d.email, password: DEMO_LOCAL_PASSWORD })
      assert.equal(login.ok, true)
      assert.equal(login.user.role, 'customer')
    })
  })
})

// LOT 1.1 : le maître n'est plus seedé côté client. `deleteCustomer` reste une
// fonction pure qui autorise selon `actor.role` — on la teste donc avec un
// acteur maître construit localement, sans dépendre d'un compte seedé (dont
// les identifiants étaient en clair dans le bundle).
function localMaster() {
  return { id: 'master-fixture', role: 'master', name: 'Comptoir', phone: '0770000000' }
}

describe('master vs customer', () => {
  it('lets master delete a customer but not itself', () => {
    const seeded = loadUsers(createMemoryStorage())
    const { users, user } = registerEmail(seeded, {
      email: 'a@b.dz',
      password: 'secret-fixture',
      name: 'Amina'
    })
    const master = localMaster()
    const gone = deleteCustomer([...users, master], master, user.id)
    assert.equal(gone.ok, true)
    assert.equal(gone.users.some((u) => u.id === user.id), false)
    assert.equal(deleteCustomer(gone.users, master, master.id).ok, false)
    assert.equal(deleteCustomer(users, user, user.id).ok, false)
  })

  it('refuse la suppression par un acteur non maître', () => {
    const seeded = loadUsers(createMemoryStorage())
    const { users, user } = registerEmail(seeded, {
      email: 'c@d.dz',
      password: 'secret-fixture',
      name: 'Karim'
    })
    assert.equal(deleteCustomer(users, localMaster(), user.id).ok, true)
    assert.equal(deleteCustomer(users, user, user.id).ok, false)
  })

  it('saves profile name and wilaya', () => {
    const { users, user } = registerEmail([], { email: 'a@b.dz', password: 'secret-fixture', name: 'Amina' })
    const next = updateUser(users, user.id, { name: 'Amina B', wilaya: 'Mascara' })
    assert.equal(next.ok, true)
    assert.equal(next.user.name, 'Amina B')
    assert.equal(next.user.wilaya, 'Mascara')
  })
})

// P5 (B19) : plus aucun téléphone partagé entre master et comptes démo —
// un login SMS local ne doit jamais retomber sur le master.
describe('demo phone uniqueness (B19)', () => {
  it('démos : téléphones uniques, et aucun maître seedé en local', () => {
    const seeded = loadUsers(createMemoryStorage())
    const phones = seeded
      .filter((u) => u.phone)
      .map((u) => u.phone)
    assert.equal(new Set(phones).size, phones.length, 'téléphone dupliqué → ' + phones.join(', '))
    // LOT 1.1 : plus de compte maître côté client — l'unicité ne se vérifie
    // donc plus que parmi les comptes de démonstration.
    assert.equal(seeded.filter((u) => u.role === 'master').length, 0)
    assert.ok(seeded.length >= DEMO_CUSTOMERS.length, 'les démos restent seedées')
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

// LOT P25 (S6) : le bloc « recherches sauvées persistées » (P10 / P15, quatre
// verrous) est parti avec la fonctionnalité — le client a demandé son retrait
// (« sauver la sauvegarde n'est pas utile »). Les deux fonctions de stockage
// (`loadSavedSearches` / `saveSavedSearches`) ont été supprimées avec lui : un
// test qui survit à la chose qu'il teste est la première marche du retour en
// arrière. Le verrou de non-retour, lui, vit dans `src/p6SearchSurface.test.js`
// (page + `shopStore.js` + dictionnaire).
