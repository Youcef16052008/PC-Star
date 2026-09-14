import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// ---------------------------------------------------------------------------
// P22 — Audit « toutes les pages, tous les boutons » (13 pages, 1 155 boutons
// cliqués en jsdom, 0 erreur applicative). Le crawl n'a rien trouvé : les bugs
// ci-dessous viennent de la lecture ligne à ligne et sont chacun démontrés par
// une mesure, avant et après correctif.
//
//  A. `normalizePhone` / `isDzPhone` ne retiraient pas le préfixe de sortie
//     international `00`. Mesuré AVANT : `POST /api/orders` avec
//     `00 213 550 123 456` → 400 `{"ok":false,"error":"phone"}`, alors que
//     `+213 550 123 456` → 201. Le client voyait « numéro invalide » pour un
//     numéro correct. Le même trou existait côté client et côté serveur, et
//     `waNumber()` (orderLogic.js, corrigée en P14) retirait déjà `00` : la
//     validation et la génération de lien WhatsApp n'étaient pas d'accord.
//
//  B. `skuSlug()` ne garde que 8 caractères utiles du nom et `addProduct()`
//     ne vérifiait aucune unicité. Mesuré AVANT : trois produits ajoutés en
//     mode local (« Samsung SSD 870 / 980 / 860 ») obtenaient tous
//     `PS-SAMSUNGS`. Le mode API n'est pas touché (le serveur génère son
//     propre id) — le défaut était limité au mode hors-ligne de MasterPage.
//
//  C. `applyStockDecrement` comptait `Math.max(1, … || 1)` et
//     `applyStockRestore` `Math.max(0, … || 0)`. Mesuré AVANT : stock 5,
//     commande d'une ligne sans `qty` → 4, annulation → 4. Une unité perdue à
//     chaque aller-retour. Les deux helpers sont exportés mais n'ont aujourd'hui
//     aucun appelant dans src/ ni server/ — le défaut était latent, pas actif.
//
//  D. `canTransition()` se terminait par `return to === 'cancelled'` dans une
//     branche où `to === 'cancelled'` avait déjà renvoyé `true` : la condition
//     ne pouvait donc rendre que `false`. Réécrite explicitement.
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p22-'))
const upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p22-up-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.PCSTAR_UPLOAD_DIR = upDir
const { handler } = await import('../server/index.js')
const {
  normalizePhone,
  isDzPhone,
  phoneCarrier,
  addProduct
} = await import('./shopStore.js')
const { PRODUCTS } = await import('./data.js')
const {
  applyStockDecrement,
  applyStockRestore,
  lineQty,
  canTransition
} = await import('./orderLogic.js')

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
    data = null
  }
  return { status: res.status, data }
}

describe('P22 bug A — préfixe international 00 accepté', () => {
  it('normalizePhone retire le préfixe 00 comme il retire le +', () => {
    assert.equal(normalizePhone('00213550123456'), '0550123456')
    assert.equal(normalizePhone('00 213 550 123 456'), '0550123456')
    assert.equal(normalizePhone('+213 550 123 456'), '0550123456')
    assert.equal(normalizePhone('213550123456'), '0550123456')
    assert.equal(normalizePhone('550123456'), '0550123456')
    assert.equal(normalizePhone('0550123456'), '0550123456')
  })

  it('isDzPhone accepte les trois écritures internationales', () => {
    for (const v of ['00213550123456', '00 213 550 123 456', '+213 550 123 456', '0550123456']) {
      assert.equal(isDzPhone(v), true, `${v} doit être accepté`)
    }
  })

  it('les numéros vraiment invalides restent refusés', () => {
    for (const v of ['', '12345', '055012345', '05501234567', '00112233', '0411234567', 'a@b.co']) {
      assert.equal(isDzPhone(v), false, `${JSON.stringify(v)} doit être refusé`)
    }
  })

  it('le transporteur est reconnu depuis l’écriture internationale', () => {
    assert.equal(phoneCarrier('00 213 550 123 456'), 'ooredoo')
    assert.equal(phoneCarrier('00 213 660 11 22 33'), 'mobilis')
    assert.equal(phoneCarrier('00 213 770 65 03 87'), 'djezzy')
  })

  it('POST /api/orders accepte 00 213 … et enregistre le format local', async () => {
    const r = await call('POST', '/api/orders', {
      body: {
        name: 'Client International',
        items: [{ id: 'cpu-5500', name: 'CPU', qty: 1 }],
        phone: '00 213 550 123 456',
        wilaya: 'Oran'
      }
    })
    assert.equal(r.status, 201, `attendu 201, reçu ${r.status} ${JSON.stringify(r.data)}`)
    assert.equal(r.data.ok, true)
    // Le numéro est normalisé en base : le comptoir voit le format local.
    assert.equal(r.data.order.phone, '0550123456')
    assert.equal(r.data.order.carrier, 'ooredoo')
  })

  it('POST /api/orders refuse toujours un numéro trop court', async () => {
    const r = await call('POST', '/api/orders', {
      body: {
        name: 'Client Invalide',
        items: [{ id: 'cpu-5500', name: 'CPU', qty: 1 }],
        phone: '055012345'
      }
    })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'phone')
  })
})

describe('P22 bug B — SKU uniques en mode local', () => {
  const emptyMeta = () => ({
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: [],
    photoOverrides: {}
  })

  it('trois noms partageant 8 caractères donnent trois SKU distincts', () => {
    let meta = emptyMeta()
    const skus = []
    for (const name of ['Samsung SSD 870 EVO 500Go', 'Samsung SSD 980 PRO 1To', 'Samsung SSD 860 QVO 2To']) {
      const r = addProduct(meta, { name, price: 1000, category: 'memory', stock: 5 })
      assert.equal(r.ok, true, `création de « ${name} »`)
      skus.push(r.product.sku)
      meta = r.meta
    }
    assert.deepEqual(skus, ['PS-SAMSUNGS', 'PS-SAMSUNGS-2', 'PS-SAMSUNGS-3'])
    assert.equal(new Set(skus).size, 3, 'aucun SKU en double')
  })

  it('un SKU saisi à la main n’est jamais réécrit ni suffixé', () => {
    let meta = emptyMeta()
    const a = addProduct(meta, { name: 'Samsung SSD 870 EVO 500Go', price: 1, category: 'memory', sku: 'SSD-870' })
    assert.equal(a.product.sku, 'SSD-870')
    const b = addProduct(a.meta, { name: 'Samsung SSD 980 PRO 1To', price: 1, category: 'memory', sku: 'SSD-980' })
    assert.equal(b.product.sku, 'SSD-980')
  })

  it('le suffixe saute les SKU déjà pris', () => {
    let meta = emptyMeta()
    meta = addProduct(meta, { name: 'Samsung SSD 870 EVO', price: 1, category: 'memory', sku: 'PS-SAMSUNGS' }).meta
    const r = addProduct(meta, { name: 'Samsung SSD 980 PRO', price: 1, category: 'memory' })
    assert.equal(r.product.sku, 'PS-SAMSUNGS-2')
  })
})

describe('P22 bug C — décrément et restauration de stock symétriques', () => {
  it('une ligne sans qty retire 1 unité et la rend', () => {
    const line = { id: 'cpu-5500', name: 'CPU' }
    const after = applyStockDecrement({ 'cpu-5500': 5 }, [line])
    assert.equal(after['cpu-5500'], 4, 'une unité réservée')
    const restored = applyStockRestore(after, [line])
    assert.equal(restored['cpu-5500'], 5, 'l’unité revient à l’annulation')
  })

  it('lineQty est la règle unique des deux fonctions', () => {
    assert.equal(lineQty({}), 1)
    assert.equal(lineQty({ qty: undefined }), 1)
    assert.equal(lineQty({ qty: '3' }), 3)
    assert.equal(lineQty({ qty: 0 }), 1, '0 retombe sur 1, comme le décrément historique')
    assert.equal(lineQty({ qty: 2.9 }), 2)
  })

  it('aller-retour stable sur plusieurs lignes', () => {
    const items = [{ id: 'a', qty: 2 }, { id: 'b' }, { id: 'c', qty: 3 }]
    const start = { a: 10, b: 10, c: 10 }
    assert.deepEqual(applyStockRestore(applyStockDecrement(start, items), items), start)
  })
})

describe('P22 bug D — canTransition n’a plus de branche morte', () => {
  it('un statut inconnu ne peut rien atteindre sauf l’annulation', () => {
    assert.equal(canTransition('weird', 'new'), false)
    assert.equal(canTransition('weird', 'preparing'), false)
    assert.equal(canTransition('weird', 'cancelled'), true)
  })

  it('les transitions nominales restent autorisées', () => {
    assert.equal(canTransition('new', 'preparing'), true)
    assert.equal(canTransition('preparing', 'ready'), true)
    assert.equal(canTransition('ready', 'picked'), true)
    assert.equal(canTransition('new', 'cancelled'), true)
    assert.equal(canTransition('pending', 'ready'), true)
  })

  it('les états terminaux ne bougent plus', () => {
    assert.equal(canTransition('picked', 'new'), false)
    assert.equal(canTransition('cancelled', 'ready'), false)
  })
})

describe('P22 bug H — un SKU déjà pris est refusé, côté client ET serveur', () => {
  const emptyMeta = () => ({
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: [],
    photoOverrides: {}
  })
  const BASE_SKU = PRODUCTS.find((p) => p.sku).sku

  it('[client] un SKU manuel qui double le catalogue de base est refusé', () => {
    const r = addProduct(emptyMeta(), { name: 'Doublon', price: 100, category: 'ssd', sku: BASE_SKU }, PRODUCTS)
    assert.equal(r.ok, false)
    assert.equal(r.error, 'sku_taken')
  })

  it('[client] deux produits ne peuvent pas partager un SKU manuel', () => {
    const a = addProduct(emptyMeta(), { name: 'A', price: 1, category: 'ssd', sku: 'MON-SKU' }, PRODUCTS)
    assert.equal(a.ok, true)
    const b = addProduct(a.meta, { name: 'B', price: 1, category: 'ssd', sku: 'MON-SKU' }, PRODUCTS)
    assert.equal(b.ok, false)
    assert.equal(b.error, 'sku_taken')
  })

  it('[client] un SKU manuel libre reste accepté tel quel', () => {
    const r = addProduct(emptyMeta(), { name: 'Libre', price: 1, category: 'ssd', sku: 'SKU-LIBRE-1' }, PRODUCTS)
    assert.equal(r.ok, true)
    assert.equal(r.product.sku, 'SKU-LIBRE-1')
  })

  it('[client] un SKU généré évite aussi le catalogue de base', () => {
    // Trois noms partageant 8 caractères + un produit de base portant déjà le
    // SKU généré attendu : le suffixe doit sauter la collision.
    const fake = { id: 'fake-base', sku: 'PS-SAMSUNGS' }
    const r = addProduct(emptyMeta(), { name: 'Samsung SSD 870 EVO', price: 1, category: 'ssd' }, [fake])
    assert.equal(r.product.sku, 'PS-SAMSUNGS-2')
  })

  it('[serveur] POST /api/master/products refuse un SKU du catalogue de base', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    assert.equal(login.status, 200, 'login master')
    const token = login.data.token

    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Doublon serveur', price: 100, category: 'ssd', stock: 1, sku: BASE_SKU }
    })
    assert.equal(r.status, 400, `attendu 400, reçu ${r.status} ${JSON.stringify(r.data)}`)
    assert.equal(r.data.error, 'sku_taken')
  })

  it('[serveur] deux créations ne peuvent pas partager un SKU saisi', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const token = login.data.token
    const first = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Unique 1', price: 100, category: 'ssd', stock: 1, sku: 'SKU-UNIQUE-P22' }
    })
    assert.equal(first.status, 201, `1re création : ${first.status} ${JSON.stringify(first.data)}`)
    const second = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Unique 2', price: 100, category: 'ssd', stock: 1, sku: 'SKU-UNIQUE-P22' }
    })
    assert.equal(second.status, 400)
    assert.equal(second.data.error, 'sku_taken')
  })

  it('[serveur] sans SKU saisi, le serveur génère un id unique', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    const token = login.data.token
    const a = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Sans SKU A', price: 100, category: 'ssd', stock: 1 }
    })
    const b = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Sans SKU B', price: 100, category: 'ssd', stock: 1 }
    })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    assert.notEqual(a.data.product.sku, b.data.product.sku)
  })
})
