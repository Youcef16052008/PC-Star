import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { photoCandidates } from './media.js'

// P5 (B12) : flux de création produit + photos, sans fichiers `tmp-*`.
// Les env doivent être posés AVANT l'import des modules serveur (ils lisent
// process.env au chargement).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-upload-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const { createProduct, savePhotoDataUrls, unlinkUpload } = await import('../server/masterApi.js')
const { handler } = await import('../server/index.js')
const { readDb } = await import('../server/db.js')

// PNG 1×1 valide (70 octets > 32 → accepté par savePhotoDataUrls)
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

async function call(method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* pas de corps JSON */
  }
  return { status: res.status, data }
}

function listing() {
  return fs.existsSync(process.env.PCSTAR_UPLOAD_DIR) ? fs.readdirSync(process.env.PCSTAR_UPLOAD_DIR) : []
}

describe('createProduct avec id pré-généré (B12)', () => {
  it('id explicite → produit + stock sous CET id', () => {
    const db = { orders: [], stock: {}, meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] } }
    const r = createProduct(db, { name: 'Câble HDMI', price: 800, stock: 4 }, 'sku-test-123')
    assert.equal(r.ok, true)
    assert.equal(r.product.id, 'sku-test-123')
    assert.equal(db.stock['sku-test-123'], 4)
    assert.equal(db.meta.extraProducts.length, 1)
  })

  it('sans id → id généré automatiquement (comportement antérieur)', () => {
    const db = { orders: [], stock: {}, meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] } }
    const r = createProduct(db, { name: 'Clé USB', price: 500, stock: 2 })
    assert.equal(r.ok, true)
    assert.match(r.product.id, /^sku-/)
    assert.equal(db.stock[r.product.id], 2)
  })

  it('id déjà utilisé → rejeté (pas d’écrasement)', () => {
    const db = { orders: [], stock: {}, meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] } }
    assert.equal(createProduct(db, { name: 'A', price: 100, stock: 1 }, 'sku-dup').ok, true)
    const again = createProduct(db, { name: 'B', price: 200, stock: 1 }, 'sku-dup')
    assert.equal(again.ok, false)
    assert.equal(db.meta.extraProducts.length, 1)
  })
})

describe('savePhotoDataUrls + unlinkUpload (B12)', () => {
  it('fichier nommé <productId>-… ; unlinkUpload le retire', () => {
    const paths = savePhotoDataUrls('sku-test-123', [PNG_1PX])
    assert.equal(paths.length, 1)
    assert.match(paths[0], /^\/photos\/uploads\/sku-test-123-.*\.png$/)
    const file = paths[0].split('/').pop()
    assert.ok(fs.existsSync(path.join(process.env.PCSTAR_UPLOAD_DIR, file)))
    unlinkUpload(paths[0])
    assert.equal(fs.existsSync(path.join(process.env.PCSTAR_UPLOAD_DIR, file)), false)
  })

  it('refuse une URL malformée (pas de ../, pas de slash)', () => {
    const created = savePhotoDataUrls('sku-x', [PNG_1PX])
    const before = listing().length
    unlinkUpload('/photos/uploads/../../etc/passwd')
    unlinkUpload('/photos/uploads')
    assert.equal(listing().length, before)
    // nettoyage : ne rien laisser pour les suites suivantes
    for (const p of created) unlinkUpload(p)
    assert.equal(listing().length, before - 1)
  })
})

describe('POST /api/master/products (B12, bout en bout)', () => {
  async function masterToken() {
    const r = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    return r.data.token
  }

  it('photoDataUrls → fichiers sous le vrai id du produit, zéro `tmp-*`', async () => {
    const token = await masterToken()
    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: 'SSD Test NVMe', price: 1200, stock: 3, photoDataUrls: [PNG_1PX, PNG_1PX] }
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    const product = r.data.product
    assert.ok(product.id)
    assert.equal(product.photos.length, 2)
    for (const p of product.photos) {
      assert.match(p, new RegExp(`^/photos/uploads/${product.id}-.*\\.png$`))
    }
    const files = listing()
    assert.equal(files.length, 2)
    assert.equal(files.some((f) => f.startsWith('tmp-')), false)
    // la base persiste les mêmes photos (pas de 2e passage tmp→id)
    const persisted = readDb().meta.extraProducts.find((p) => p.id === product.id)
    assert.deepEqual(persisted.photos, product.photos)
  })

  it('produit invalide → 400 + aucun fichier orphelin', async () => {
    const token = await masterToken()
    const before = listing().length
    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: '', price: 0, photoDataUrls: [PNG_1PX] }
    })
    assert.equal(r.status, 400)
    assert.equal(listing().length, before, 'les fichiers de la tentative échouée doivent être supprimés')
  })
})

describe('P10 (P7-13) — photoCandidates : plus de sonde webp sur les uploads', () => {
  it('catalogue statique → webp d\'abord, repli original', () => {
    assert.deepEqual(photoCandidates('/photos/cpu.jpg'), ['/photos/cpu.webp', '/photos/cpu.jpg'])
    assert.deepEqual(photoCandidates('/photos/sku/cpu-1.jpg'), ['/photos/sku/cpu-1.webp', '/photos/sku/cpu-1.jpg'])
    assert.deepEqual(photoCandidates('/photos/psu.png'), ['/photos/psu.webp', '/photos/psu.png'])
  })
  it('uploads du master → JAMAIS de sonde webp (le fichier n\'existe pas)', () => {
    assert.deepEqual(photoCandidates('/photos/uploads/cpu-5600-abc1.jpg'), ['/photos/uploads/cpu-5600-abc1.jpg'])
    // serverless (Vercel)
    assert.deepEqual(photoCandidates('/api/upload-file?name=cpu-5600-abc1.jpg'), ['/api/upload-file?name=cpu-5600-abc1.jpg'])
  })
  it('déjà webp / dataURL / vide → seul le src (pas de double requête)', () => {
    assert.deepEqual(photoCandidates('/photos/cpu.webp'), ['/photos/cpu.webp'])
    assert.deepEqual(photoCandidates('data:image/jpeg;base64,AAAA'), ['data:image/jpeg;base64,AAAA'])
    assert.deepEqual(photoCandidates(''), [])
    assert.deepEqual(photoCandidates(null), [])
  })
})
