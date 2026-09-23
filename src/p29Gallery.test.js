/** P29 — conserver les deux sources sans annuler les choix du maître (P28). */
import { after, afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p29-'))
process.env.PCSTAR_DATA_DIR = dir
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true })
const { window } = dom
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = (await import('react')).default
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ProductPage } = await import('./ProductPage.jsx')
const { default: PartThumb } = await import('./PartThumb.jsx')
const { PRODUCTS } = await import('./data.js')
const { dict } = await import('./i18n.js')
const { ensureProductPhotos } = await import('./productPhotos.js')
const { buildShopView, setProductPhotos } = await import('./shopStore.js')
const { publicCatalog } = await import('../server/catalog.js')
const { updateProduct, listMasterProducts } = await import('../server/masterApi.js')
const roots = []
afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount())
    host.remove()
  }
})
after(() => {
  dom.window.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
const tr = (lang) => (key, vars) => String(dict[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, n) => vars?.[n] ?? `{${n}}`)
const id = 'prn-hp-107a'
const P = PRODUCTS.find((p) => p.id === id)
const pack = `/photos/pack/${id}.jpg`
const real = [1, 2, 3].map((n) => `/photos/sku/${id}-${n}.jpg`)
const uploaded = '/photos/uploads/p29-real.jpg'
const emptyDb = () => ({ stock: {}, meta: { extraProducts: [], hiddenProductIds: [], productOverrides: {} } })
const publicPhotos = (db) => ensureProductPhotos(publicCatalog(db).find((p) => p.id === id)).photos

function mount(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ host, root })
  const render = (element) => act(() => root.render(element))
  render(element)
  return { host, render }
}

function gallery(product = { ...P, photos: [pack, ...real] }, { initialIndex = 0, lang = 'fr' } = {}) {
  function Harness({ product }) {
    const [index, setIndex] = useState(initialIndex)
    return React.createElement(ProductPage, {
      product, photoIndex: index, setPhotoIndex: setIndex,
      t: tr(lang), lang, left: 4, catalog: [], liveStock: () => 4,
      onBack() {}, onAdd() {}, onOpen() {}, onAddRelated() {}
    })
  }
  const ui = mount(React.createElement(Harness, { product }))
  return {
    ...ui,
    change: (next) => ui.render(React.createElement(Harness, { product: next })),
    hero: () => ui.host.querySelector('.pdp-zoom'),
    caption: () => ui.host.querySelector('[data-photo-source]'),
    select: (index) => {
      const button = [...ui.host.querySelectorAll('button[aria-label]')].find((b) => b.getAttribute('aria-label') === `${product.name} ${index + 1}`)
      assert.ok(button, `vignette ${index + 1} absente`)
      act(() => button.click())
    }
  }
}
const fail = (img) => {
  assert.ok(img, 'image absente du scénario')
  act(() => img.dispatchEvent(new window.Event('error')))
}

describe('P29 — galerie mixte et priorité aux choix du maître', () => {
  it('par défaut : le packshot et les trois vues réelles de la même référence', () => {
    assert.deepEqual(P.photos, [pack, ...real])
    assert.deepEqual(publicPhotos(emptyDb()), [pack, ...real])
    assert.deepEqual(ensureProductPhotos(ensureProductPhotos(P)).photos, [pack, ...real])
  })

  it('une photo maître remplace les quatre images, sans les rajouter derrière', () => {
    const db = emptyDb()
    assert.equal(updateProduct(db, id, { photos: [uploaded] }).ok, true)
    assert.deepEqual(publicPhotos(db), [uploaded])
    assert.deepEqual(listMasterProducts(db).find((p) => p.id === id).photos, [uploaded])
  })

  it('le maître peut garder et réordonner une sélection des deux sources', () => {
    const db = emptyDb()
    const chosen = [real[2], pack, uploaded]
    updateProduct(db, id, { photos: chosen })
    assert.deepEqual(publicPhotos(db), chosen)
    assert.deepEqual(listMasterProducts(db).find((p) => p.id === id).photos, chosen)
  })

  it('vider la galerie restaure les deux sources, pas seulement le packshot', () => {
    const db = emptyDb()
    updateProduct(db, id, { photos: [uploaded] })
    const cleared = updateProduct(db, id, { photos: [] })
    assert.deepEqual(cleared.product.photos, [pack, ...real])
    assert.deepEqual(publicPhotos(db), [pack, ...real])
    assert.deepEqual(listMasterProducts(db).find((p) => p.id === id).photos, [pack, ...real])
  })

  it('hors ligne : même remplacement et même restauration des deux sources', () => {
    const original = { extraProducts: [], hiddenProductIds: [], photoOverrides: {} }
    const edited = setProductPhotos(original, id, [uploaded])
    assert.deepEqual(buildShopView([P], [], [], edited.meta).products[0].photos, [uploaded])
    const cleared = setProductPhotos(edited.meta, id, [])
    assert.deepEqual(buildShopView([P], [], [], cleared.meta).products[0].photos, [pack, ...real])
  })
})

describe('P29 — la galerie distingue les sources et supporte les changements en direct', () => {
  for (const lang of ['fr', 'en']) {
    it(`${lang} : chaque vignette affiche sa propre image et la bonne provenance`, () => {
      const ui = gallery(undefined, { lang })
      assert.equal(ui.hero().querySelector('img').getAttribute('src'), pack)
      assert.equal(ui.caption()?.dataset.photoSource, 'generated')
      assert.ok(ui.caption().textContent.includes(dict[lang].generatedPhotoLabel))
      for (let i = 1; i <= 3; i++) {
        ui.select(i)
        assert.equal(ui.hero().querySelector('img').getAttribute('src'), real[i - 1])
        assert.equal(ui.caption()?.dataset.photoSource, 'catalog')
        assert.ok(ui.caption().textContent.includes(dict[lang].catalogPhotoNotice))
        assert.ok(ui.hero().querySelector('img').alt.includes(dict[lang].catalogPhotoLabel))
      }
      ui.select(0)
      assert.equal(ui.caption()?.dataset.photoSource, 'generated')
    })
  }

  it('la mention suit le fichier, même dans une galerie `custom` mixte', () => {
    const ui = gallery({ ...P, photoMode: 'custom', photos: [pack, uploaded, real[0]] })
    assert.equal(ui.caption()?.dataset.photoSource, 'generated')
    ui.select(1)
    assert.equal(ui.caption(), null, 'un upload du maître ne doit pas être déclaré généré')
    assert.equal(ui.hero().querySelector('img').alt, P.name)
    ui.select(2)
    assert.equal(ui.caption()?.dataset.photoSource, 'catalog')
  })

  it('une galerie raccourcie pendant la visite ne rend jamais src=undefined', () => {
    const ui = gallery(undefined, { initialIndex: 3 })
    ui.change({ ...P, photoMode: 'custom', photos: [uploaded] })
    assert.equal(ui.hero().querySelector('img').getAttribute('src'), uploaded)
    assert.equal(ui.caption(), null)
  })

  it('un packshot qui échoue laisse place à la première photo réelle', () => {
    const ui = gallery()
    fail(ui.hero().querySelector('img'))
    assert.equal(ui.hero().querySelector('img').getAttribute('src'), real[0])
    assert.equal(ui.caption()?.dataset.photoSource, 'catalog')
  })

  it('toutes les images en erreur : repère de catégorie, sans boucle de rechargement', () => {
    const ui = gallery()
    for (let i = 0; i < 4; i++) fail(ui.hero().querySelector('img'))
    assert.equal(ui.hero().querySelector('img'), null)
    assert.ok(ui.hero().querySelector('.part-mark'))
    assert.equal(ui.caption(), null)
  })

  it('changer les photos de la même fiche efface les erreurs de la galerie précédente', () => {
    const ui = gallery(undefined, { initialIndex: 1 })
    fail(ui.hero().querySelector('img'))
    ui.change({ ...P, photoMode: 'custom', photos: [uploaded, '/photos/uploads/new-second.jpg'] })
    assert.equal(ui.hero().querySelector('img').getAttribute('src'), '/photos/uploads/new-second.jpg')
  })

  it('une vignette de grille tombée au badge réessaie une nouvelle URL du même produit', () => {
    const ui = mount(React.createElement(PartThumb, { product: { ...P, photos: [pack] } }))
    fail(ui.host.querySelector('img')) // WebP
    fail(ui.host.querySelector('img')) // JPG
    assert.ok(ui.host.querySelector('.part-mark'))
    ui.render(React.createElement(PartThumb, { product: { ...P, photos: [uploaded] } }))
    assert.equal(ui.host.querySelector('img')?.getAttribute('src'), uploaded)
  })
})
