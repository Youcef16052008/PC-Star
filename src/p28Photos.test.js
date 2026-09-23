/**
 * LOT P28 / phase 1 — la galerie que le maître enregistre est celle que le client voit.
 *
 * Deux défauts relevés à la relecture du rapport P26/P27, mesurés avant correctif :
 *
 *  B. Une photo montée par le maître sur une fiche du catalogue était COMPLÉTÉE :
 *     `photosForProduct` ajoutait derrière elle `/photos/sku/<id>-1|2`. Sur
 *     `prn-hp-107a`, le client voyait trois photos dont deux que le maître n'avait
 *     pas choisies ; sur les quatre écrans ajoutés au lot P27 (aucun trio sur le
 *     disque), deux 404 par galerie. Sur les vingt fiches « studio », c'était pire :
 *     moins de trois photos montées, et la fiche gardait son visuel d'origine — la
 *     photo du maître n'apparaissait nulle part. Une vue RETIRÉE du trio revenait.
 *
 *  F. Vider la galerie d'une fiche à packshot stockait `{ photos: [], photoMode:
 *     'packshot' }` : la liste vide masquait celle du catalogue et la fiche tombait
 *     sur son repère de rayon (« PRN ») au lieu de retrouver son packshot, comme
 *     le commentaire de P27 le promettait.
 *
 * Et en passant : les vignettes de la galerie produit n'avaient aucun repli — une
 * image qui ne charge pas restait une case cassée dans la bande.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

// `server/db.js` résout son répertoire au chargement : isolé AVANT les imports.
process.env.PCSTAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p28-photos-'))

const { PRODUCTS } = await import('./data.js')
const { photosForProduct, ensureProductPhotos } = await import('./productPhotos.js')
const { buildShopView } = await import('./shopStore.js')
const { updateProduct, listMasterProducts, currentProductPhotos } = await import('../server/masterApi.js')
const { publicCatalog } = await import('../server/catalog.js')

const emptyDb = () => ({
  orders: [],
  stock: {},
  meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], productOverrides: {} }
})
const P = (id) => {
  const p = PRODUCTS.find((x) => x.id === id)
  assert.ok(p, `fiche de fixture absente du catalogue : ${id}`)
  return p
}
/** Ce que la vitrine affiche en mode API : catalogue serveur, puis `ensureProductPhotos` (App.jsx). */
const vuClient = (db, id) => {
  const p = publicCatalog(db).find((x) => x.id === id)
  assert.ok(p, `${id} absent du catalogue public`)
  return ensureProductPhotos(p).photos
}
const vuMaster = (db, id) => listMasterProducts(db).find((x) => x.id === id)

const UPLOAD = '/photos/uploads/p28-comptoir-1.jpg'

describe('P28 (B) — la galerie du maître est servie telle quelle', () => {
  it('une photo montée sur une fiche à packshot : une photo, pas trois', () => {
    const db = emptyDb()
    assert.equal(updateProduct(db, 'prn-hp-107a', { photos: [UPLOAD] }).ok, true)
    assert.deepEqual(vuClient(db, 'prn-hp-107a'), [UPLOAD], 'des photos que le maître n’a pas choisies s’ajoutent derrière la sienne')
  })

  it('un écran du lot P27 (aucun trio sur le disque) : pas de chemin fantôme', () => {
    const db = emptyDb()
    updateProduct(db, 'mon-samsung-g3-24', { photos: [UPLOAD] })
    const photos = vuClient(db, 'mon-samsung-g3-24')
    assert.deepEqual(photos, [UPLOAD])
    const publicDir = path.join(process.cwd(), 'public')
    for (const src of photos.filter((s) => s.startsWith('/photos/sku/'))) {
      assert.ok(fs.existsSync(path.join(publicDir, src)), `404 servi au client : ${src}`)
    }
  })

  it('une fiche « studio » : la photo du maître remplace le visuel d’origine', () => {
    const db = emptyDb()
    assert.ok(P('mouse').photos[0].startsWith('/photos/studio/'), 'fixture : la souris n’est plus une fiche studio')
    updateProduct(db, 'mouse', { photos: [UPLOAD] })
    assert.deepEqual(vuClient(db, 'mouse'), [UPLOAD], 'la photo du maître n’apparaît pas sur une fiche studio')
  })

  it('une vue retirée du trio ne revient pas, et l’ordre du maître est gardé', () => {
    const db = emptyDb()
    const [v1, v2, v3] = P('gpu-4060').photos
    assert.ok(v3, 'fixture : gpu-4060 n’a plus son trio')
    updateProduct(db, 'gpu-4060', { photos: [v3, v1] })
    assert.deepEqual(vuClient(db, 'gpu-4060'), [v3, v1], 'la vue retirée est revenue, ou l’ordre a été refait')
    assert.equal(vuClient(db, 'gpu-4060').includes(v2), false)
  })

  it('la vue du maître et la vitrine disent la même chose', () => {
    const db = emptyDb()
    updateProduct(db, 'prn-hp-107a', { photos: [UPLOAD] })
    const m = vuMaster(db, 'prn-hp-107a')
    assert.deepEqual(m.photos, [UPLOAD])
    assert.equal(m.photoMode, 'custom')
    assert.deepEqual(ensureProductPhotos(m).photos, vuClient(db, 'prn-hp-107a'))
  })

  it('un override enregistré avant ce lot (sans drapeau) est lu comme la galerie du maître', () => {
    const db = emptyDb()
    db.meta.productOverrides['gpu-4060'] = { photos: [UPLOAD] }
    assert.deepEqual(vuClient(db, 'gpu-4060'), [UPLOAD])
  })

  // Le mode local servait déjà la liste telle quelle (il ne repasse pas par
  // `photosForProduct`) : ce test garde la règle identique des deux côtés.
  it('le mode local (sans API) suit la même règle', () => {
    const view = buildShopView(PRODUCTS, [], [], { photoOverrides: { 'prn-hp-107a': [UPLOAD] } })
    const p = view.products.find((x) => x.id === 'prn-hp-107a')
    assert.deepEqual(photosForProduct(p), [UPLOAD])
  })

  it('le catalogue statique est inchangé : aucune fiche ne bouge sans override', () => {
    for (const p of PRODUCTS) {
      assert.deepEqual(photosForProduct(p), p.photos, `${p.id} : ses photos changent sans que le maître n’ait rien fait`)
    }
  })
})

describe('P28 (F) — vider la galerie rend la fiche du catalogue', () => {
  it('fiche à packshot : le packshot revient, pas le repère de rayon', () => {
    const db = emptyDb()
    updateProduct(db, 'prn-hp-107a', { photos: [UPLOAD] })
    const r = updateProduct(db, 'prn-hp-107a', { photos: [] })
    assert.equal(r.ok, true)
    assert.deepEqual(vuClient(db, 'prn-hp-107a'), P('prn-hp-107a').photos, 'la fiche vidée ne retrouve pas son packshot')
    assert.equal(publicCatalog(db).find((x) => x.id === 'prn-hp-107a').photoMode, 'packshot')
    assert.equal(db.meta.productOverrides['prn-hp-107a'], undefined, 'un override vide reste stocké (lot 3.14)')
    assert.deepEqual(r.product.photos, P('prn-hp-107a').photos, 'la réponse de la route doit montrer la galerie rendue')
  })

  it('le reste de l’override survit (prix), seules les photos partent', () => {
    const db = emptyDb()
    updateProduct(db, 'prn-hp-107a', { photos: [UPLOAD], price: P('prn-hp-107a').price + 100 })
    updateProduct(db, 'prn-hp-107a', { photos: [] })
    assert.deepEqual(db.meta.productOverrides['prn-hp-107a'], { price: P('prn-hp-107a').price + 100 })
  })

  it('un override vide stocké par P27 est réparé à la lecture', () => {
    const db = emptyDb()
    db.meta.productOverrides['prn-hp-107a'] = { photos: [], photoMode: 'packshot' }
    assert.deepEqual(vuClient(db, 'prn-hp-107a'), P('prn-hp-107a').photos)
    assert.deepEqual(vuMaster(db, 'prn-hp-107a').photos, P('prn-hp-107a').photos)
    assert.deepEqual(currentProductPhotos(db, 'prn-hp-107a'), P('prn-hp-107a').photos)
  })

  it('fiche à trio : vider rend le trio, sans laisser de mode `custom` derrière', () => {
    const db = emptyDb()
    updateProduct(db, 'gpu-4060', { photos: [UPLOAD] })
    updateProduct(db, 'gpu-4060', { photos: [] })
    const p = publicCatalog(db).find((x) => x.id === 'gpu-4060')
    assert.equal(p.photoMode, undefined)
    assert.deepEqual(ensureProductPhotos(p).photos, P('gpu-4060').photos)
  })
})

/* ---- vignettes de la galerie produit : une image cassée sort de la bande ---- */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})

describe('P28 — une vignette qui ne charge pas sort de la galerie', () => {
  const window = dom.window
  let React, act, createRoot, ProductPage

  before(async () => {
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
      Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
    }
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
    globalThis.cancelAnimationFrame = clearTimeout
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
    React = (await import('react')).default
    ;({ act } = await import('react'))
    ;({ createRoot } = await import('react-dom/client'))
    ;({ default: ProductPage } = await import('./ProductPage.jsx'))
  })

  after(() => {
    for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      try {
        delete globalThis[k]
      } catch {
        /* getter en lecture seule sur Node 22 */
      }
    }
    window.close()
  })

  it('la case cassée disparaît, les autres restent ; seule, la bande se retire', () => {
    const product = { ...P('gpu-4060'), photos: ['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'] }
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    act(() =>
      createRoot(host).render(
        React.createElement(ProductPage, {
          t: (k) => k,
          lang: 'fr',
          product,
          photoIndex: 0,
          setPhotoIndex: () => {},
          left: 3,
          onBack: () => {},
          onAdd: () => {},
          onOpen: () => {},
          liveStock: () => 3,
          onAddRelated: () => {},
          catalog: PRODUCTS
        })
      )
    )
    const vignettes = () => [...host.querySelectorAll('button[aria-label]')].filter((b) => b.getAttribute('aria-label').startsWith(product.name + ' '))
    assert.equal(vignettes().length, 3, 'fixture : la bande n’a pas ses trois vignettes')
    const img = vignettes()[1].querySelector('img')
    act(() => img.dispatchEvent(new window.Event('error')))
    assert.deepEqual(
      vignettes().map((b) => b.getAttribute('aria-label')),
      [`${product.name} 1`, `${product.name} 3`],
      'la vignette cassée reste dans la bande'
    )
    act(() => vignettes()[1].querySelector('img').dispatchEvent(new window.Event('error')))
    assert.equal(vignettes().length, 0, 'une bande d’une seule vignette ne propose rien à choisir')
  })
})
