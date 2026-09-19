/**
 * LOT P2 (audit 19/09/2026, B12) — les bornes d'une fiche produit.
 *
 * Trois portes mènent à un produit : `POST /api/master/products`
 * (`createProduct`), `PUT /api/master/products/:id` (`sanitizeProductPatch`) et
 * le mode local sans serveur (`shopStore.addProduct`). Avant ce lot, les
 * limites de nom, de marque et de raccourci n'existaient qu'à **une seule**
 * porte, en dur dans le patch :
 *
 *     createProduct          : if (!name) return { ok:false, error:'invalid' }   // aucune mesure
 *     sanitizeProductPatch   : if (name.length > 120) …                          // 120 en dur
 *     shopStore.addProduct   : if (!title || n < 0) …                            // aucune mesure, et `price: 0` admis
 *
 * Effet mesuré : une fiche au nom de 5 000 caractères se créait en 201, puis le
 * MÊME produit refusait le moindre `PUT` avec `name_too_long` — impossible de
 * corriger le nom sans supprimer la fiche. Et le mode local vendait à 0 DA ce
 * que l'API refuse depuis le LOT 1.12.
 *
 * Une seule source désormais : `NAME_LIMIT` / `BRAND_LIMIT` / `SHORT_LIMIT`
 * (`src/productMeta.js`), utilisée par les trois portes et par le formulaire.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-b12-limits-'))
process.env.PCSTAR_DATA_DIR = dir

const { NAME_LIMIT, BRAND_LIMIT, SHORT_LIMIT } = await import('./productMeta.js')
const { addProduct } = await import('./shopStore.js')
const { createProduct, sanitizeProductPatch } = await import('../server/masterApi.js')
const { handler } = await import('../server/index.js')

const MASTER_API = fs.readFileSync(path.join(process.cwd(), 'server/masterApi.js'), 'utf8')
const STORE = fs.readFileSync(path.join(process.cwd(), 'src/shopStore.js'), 'utf8')
const FORM = fs.readFileSync(path.join(process.cwd(), 'src/MasterPage.jsx'), 'utf8')
const sansCommentaires = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

function fakeDb() {
  return {
    users: [],
    orders: [],
    stock: {},
    meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], productOverrides: {} }
  }
}
const emptyMeta = () => ({ extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], photoOverrides: {} })
const tropLong = (n) => 'x'.repeat(n + 1)

let server
let base
let masterToken = ''

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD })
  })
  masterToken = (await res.json()).token
  assert.ok(masterToken, 'session maître ouverte pour POST /api/master/products')
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('P2/B12 — le nom se refuse, des trois côtés et à la même longueur', () => {
  it('un nom trop long est refusé à la création, au patch et en local', () => {
    const long = tropLong(NAME_LIMIT)
    assert.equal(createProduct(fakeDb(), { name: long, price: 1000, stock: 1 }).error, 'name_too_long')
    assert.deepEqual(sanitizeProductPatch({ name: long }), { ok: false, error: 'name_too_long' })
    assert.equal(addProduct(emptyMeta(), { name: long, price: 1000 }).error, 'name_too_long')
  })

  it('la longueur maximale passe encore — les trois portes', () => {
    const exact = 'y'.repeat(NAME_LIMIT)
    assert.equal(createProduct(fakeDb(), { name: exact, price: 1000, stock: 1 }).ok, true)
    assert.equal(sanitizeProductPatch({ name: exact }).ok, true)
    assert.equal(addProduct(emptyMeta(), { name: exact, price: 1000 }).ok, true)
  })

  it('un nom vide reste refusé avec son code à lui', () => {
    assert.equal(createProduct(fakeDb(), { name: '   ', price: 1000 }).error, 'invalid')
    assert.deepEqual(sanitizeProductPatch({ name: '  ' }), { ok: false, error: 'name' })
    assert.equal(addProduct(emptyMeta(), { name: ' ', price: 1000 }).error, 'product')
  })
})

describe('P2/B12 — marque et raccourci se tronquent à la même taille', () => {
  it('brand est coupé à BRAND_LIMIT des deux côtés', () => {
    const long = 'B'.repeat(BRAND_LIMIT + 300)
    const cree = createProduct(fakeDb(), { name: 'Fiche bornée', price: 1000, stock: 1, brand: long })
    assert.equal(cree.product.brand.length, BRAND_LIMIT)
    assert.equal(sanitizeProductPatch({ brand: long }).patch.brand.length, BRAND_LIMIT)
    const local = addProduct(emptyMeta(), { name: 'Fiche bornée', price: 1000, brand: long })
    assert.equal(local.ok, true)
    assert.equal(local.meta.extraProducts[0].brand.length, BRAND_LIMIT)
  })

  it('short est coupé à SHORT_LIMIT des deux côtés', () => {
    const long = 's'.repeat(SHORT_LIMIT + 300)
    assert.equal(createProduct(fakeDb(), { name: 'Fiche courte', price: 1000, short: long }).product.short.length, SHORT_LIMIT)
    assert.equal(sanitizeProductPatch({ short: long }).patch.short.length, SHORT_LIMIT)
    assert.equal(addProduct(emptyMeta(), { name: 'Fiche courte', price: 1000, short: long }).meta.extraProducts[0].short.length, SHORT_LIMIT)
  })

  it('le raccourci local reste le titre quand il est absent, sans dépasser la borne', () => {
    const titre = 'T'.repeat(NAME_LIMIT)
    const r = addProduct(emptyMeta(), { name: titre, price: 1000 })
    assert.equal(r.meta.extraProducts[0].short, titre, 'le repli sur le titre doit tenir sous SHORT_LIMIT')
  })

  it('une marque vide au patch ne devient pas « PC Star »', () => {
    // Le patch efface le champ, la création pose le repli : deux règles
    // différentes, qui ne doivent pas être fondues par une troncature commune.
    assert.equal(sanitizeProductPatch({ brand: '   ' }).patch.brand, '')
    assert.equal(createProduct(fakeDb(), { name: 'Sans marque', price: 1000 }).product.brand, 'PC Star')
  })
})

describe('P2/B12 — le mode local ne peut plus accepter ce que l’API refuse', () => {
  it('price: 0 est refusé en local comme à l’API', () => {
    assert.equal(addProduct(emptyMeta(), { name: 'Gratuit', price: 0 }).error, 'price')
    assert.equal(addProduct(emptyMeta(), { name: 'Négatif', price: -5 }).error, 'price')
    assert.equal(createProduct(fakeDb(), { name: 'Gratuit', price: 0 }).error, 'price')
    assert.deepEqual(sanitizeProductPatch({ price: 0 }), { ok: false, error: 'price' })
    assert.equal(addProduct(emptyMeta(), { name: 'Payant', price: 1 }).ok, true)
  })

  it('les limites ne sont plus écrites en dur dans les portes', () => {
    const api = sansCommentaires(MASTER_API)
    assert.equal(/\.slice\(0, ?(?:60|200)\)/.test(api), false, 'une troncature littérale est réapparue côté serveur')
    assert.equal(/name\.length > 120/.test(api), false, 'un 120 en dur est réapparu côté serveur')
    assert.equal((api.match(/NAME_LIMIT/g) || []).length >= 2, true, 'createProduct et sanitizeProductPatch doivent lire la même constante')
    assert.equal(/title\.length > /.test(sansCommentaires(STORE)), true, 'addProduct ne mesure plus le nom')
  })

  it('le formulaire borne la saisie sur les trois champs', () => {
    for (const [id, limite] of [
      ['master-product-name', 'NAME_LIMIT'],
      ['master-product-brand', 'BRAND_LIMIT'],
      ['master-product-short', 'SHORT_LIMIT']
    ]) {
      assert.match(
        FORM,
        new RegExp(`id="${id}"[^>]*maxLength=\\{${limite}\\}`),
        `l'entrée #${id} ne porte plus maxLength={${limite}}`
      )
    }
  })
})

describe('P2/B12 — en direct sur l’API', () => {
  it('POST /api/master/products refuse le nom long et tronque la marque', async () => {
    const refus = await fetch(`${base}/api/master/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({ name: 'z'.repeat(NAME_LIMIT + 1), price: 1000, stock: 1 })
    })
    assert.equal(refus.status, 400)
    assert.equal((await refus.json()).error, 'name_too_long')

    // Nom à la limite exacte (il doit passer), marque et raccourci hors limite
    // (ils doivent être tronqués, pas refusés) : c'est la différence de
    // traitement entre un champ qui identifie la fiche et un champ descriptif.
    const ok = await fetch(`${base}/api/master/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterToken}` },
      body: JSON.stringify({
        name: 'W'.repeat(NAME_LIMIT),
        brand: 'M'.repeat(BRAND_LIMIT + 40),
        short: 'c'.repeat(SHORT_LIMIT + 40),
        price: 2000,
        stock: 3
      })
    })
    assert.equal(ok.status, 201, 'création refusée alors que le nom est à la limite')
    const product = (await ok.json()).product
    assert.equal(product.brand.length, BRAND_LIMIT)
    assert.equal(product.short.length, SHORT_LIMIT)
    const relus = await fetch(`${base}/api/master/products`, { headers: { Authorization: `Bearer ${masterToken}` } })
    const corps = await relus.json()
    const dansListe = corps.products.find((p) => p.id === product.id)
    assert.equal(dansListe.brand.length, BRAND_LIMIT, 'la liste maître relit une autre longueur')
  })
})
