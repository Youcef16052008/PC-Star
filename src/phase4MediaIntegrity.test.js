import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ces variables doivent être définies avant les imports dynamiques : blobStore
// fixe son répertoire d'upload au chargement.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-phase4-'))
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const {
  cleanupUnreferencedUploads,
  createProduct,
  currentProductPhotos,
  mergeProductPhotos,
  savePhotoDataUrls,
  updateProduct
} = await import('../server/masterApi.js')
const { MAX_PHOTOS, UPLOAD_DIR } = await import('../server/blobStore.js')
const { PRODUCTS } = await import('./data.js')

after(() => fs.rmSync(root, { recursive: true, force: true }))

const pngDataUrl = () => `data:image/png;base64,${Buffer.alloc(256, 5).toString('base64')}`

function db() {
  return {
    orders: [],
    stock: {},
    meta: { extraProducts: [], hiddenProductIds: [], productOverrides: {} }
  }
}

function product(name, sku) {
  return { name, sku, price: 1000, stock: 2, category: 'accessories' }
}

describe('Phase 4 — galerie master, Blob et validation catalogue', () => {
  it('préserve une galerie en ajout, remplace seulement sur liste explicite et borne le résultat', () => {
    const previous = ['/photos/uploads/old-1.jpg', '/photos/uploads/old-2.jpg']
    assert.deepEqual(
      mergeProductPhotos(previous, null, ['/photos/uploads/new-1.jpg']),
      [...previous, '/photos/uploads/new-1.jpg'],
      'un client ancien qui envoie seulement un upload ne doit pas effacer la galerie'
    )
    assert.deepEqual(
      mergeProductPhotos(previous, ['/photos/uploads/old-2.jpg'], ['/photos/uploads/new-1.jpg']),
      ['/photos/uploads/old-2.jpg', '/photos/uploads/new-1.jpg'],
      'la liste explicite est la galerie finale à conserver'
    )
    const retained = Array.from({ length: MAX_PHOTOS - 1 }, (_, index) => `/photos/uploads/keep-${index}.jpg`)
    assert.equal(mergeProductPhotos([], retained, ['/photos/uploads/a.jpg', '/photos/uploads/b.jpg']).length, MAX_PHOTOS)
  })

  it('supprime après remplacement l’upload local devenu orphelin, sans toucher celui conservé', async () => {
    const [kept, removed] = await savePhotoDataUrls('sku-phase4-clean', [pngDataUrl(), pngDataUrl()])
    const names = [kept, removed].map((url) => decodeURIComponent(url.split('/').pop()))
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, names[0])))
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, names[1])))

    const failures = await cleanupUnreferencedUploads([kept, removed], [kept])
    assert.deepEqual(failures, [])
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, names[0])), 'la photo conservée a été supprimée')
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, names[1])), false, 'la photo retirée est restée orpheline')
  })

  it('supprime aussi une photo nouvellement uploadée mais exclue par la capacité de galerie', async () => {
    const [kept, overflow] = await savePhotoDataUrls('sku-phase4-cap', [pngDataUrl(), pngDataUrl()])
    const before = Array.from({ length: MAX_PHOTOS - 1 }, (_, index) => `/photos/uploads/keep-${index}.jpg`)
    const finalGallery = mergeProductPhotos([], before, [kept, overflow])
    const failures = await cleanupUnreferencedUploads([], finalGallery, [kept, overflow])
    assert.deepEqual(failures, [])
    assert.ok(finalGallery.includes(kept), 'la première photo nouvelle doit être gardée')
    assert.equal(finalGallery.includes(overflow), false, 'la photo en surplus doit être exclue')
    const overflowName = decodeURIComponent(overflow.split('/').pop())
    assert.equal(fs.existsSync(path.join(UPLOAD_DIR, overflowName)), false, 'upload écarté non supprimé')
  })

  it('lit les photos effectives (extra ou override) avant une substitution', () => {
    const state = db()
    state.meta.productOverrides['cpu-5500'] = { photos: ['/photos/uploads/cpu-5500-custom.jpg'] }
    assert.deepEqual(currentProductPhotos(state, 'cpu-5500'), ['/photos/uploads/cpu-5500-custom.jpg'])
    const created = createProduct(state, { ...product('Extra phase 4', 'P4-EXTRA') }, 'sku-phase4-extra')
    assert.equal(created.ok, true)
    assert.deepEqual(currentProductPhotos(state, created.product.id), [])
    assert.equal(currentProductPhotos(state, 'does-not-exist'), null)
  })

  it('résout un Blob par son pathname exact et autorise seulement son CDN en CSP', () => {
    const blobSource = fs.readFileSync(new URL('../server/blobStore.js', import.meta.url), 'utf8')
    const resolveStart = blobSource.indexOf('export async function resolveBlobUrl')
    const resolveBody = blobSource.slice(resolveStart, blobSource.indexOf('/**\n * Delete', resolveStart))
    assert.ok(resolveBody.includes('blob.list({ prefix: pathname'), 'le CDN doit être retrouvé après cold start')
    assert.ok(resolveBody.includes('item?.pathname === pathname'), 'la recherche ne doit pas accepter un préfixe voisin')
    assert.equal(resolveBody.includes('getDownloadUrl('), false, 'un pathname ne doit pas être donné à getDownloadUrl')

    const csp = fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
    assert.ok(csp.includes('https://*.public.blob.vercel-storage.com'), 'le CDN Blob doit être autorisé pour la destination du 302')
  })

  it('refuse les nombres non finis, SKU invalide et collision de SKU au patch sans muter la fiche', () => {
    const state = db()
    assert.deepEqual(createProduct(state, { ...product('Prix infini', 'P4-INF'), price: Infinity }), { ok: false, error: 'price' })
    assert.deepEqual(createProduct(state, { ...product('Stock infini', 'P4-STOCK'), stock: Infinity }), { ok: false, error: 'stock' })
    assert.deepEqual(createProduct(state, { ...product('SKU invalide', 'P4\nBAD') }), { ok: false, error: 'sku' })

    const first = createProduct(state, product('Premier', 'P4-UNIQUE-A'), 'sku-phase4-a')
    const second = createProduct(state, product('Second', 'P4-UNIQUE-B'), 'sku-phase4-b')
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    const duplicate = updateProduct(state, second.product.id, { sku: first.product.sku })
    assert.deepEqual(duplicate, { ok: false, error: 'sku_taken' })
    assert.equal(state.meta.extraProducts.find((item) => item.id === second.product.id).sku, 'P4-UNIQUE-B')

    const base = PRODUCTS.find((item) => item.sku)
    assert.ok(base)
    const baseCollision = updateProduct(state, second.product.id, { sku: base.sku })
    assert.deepEqual(baseCollision, { ok: false, error: 'sku_taken' })
  })
})
