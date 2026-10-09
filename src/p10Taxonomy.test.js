// P10 — Taxonomie et suppressions sous la main du maître.
//
// Contrat du lot : le maître supprime TOUTES les fiches (y compris celles du
// catalogue de base, via `deletedProductIds`), et gère marques et catégories
// (ajouter / masquer / supprimer). « Masquer » se défait, « supprimer »
// nettoie les fiches qui portaient la valeur — jamais l'inverse : une fiche
// ne doit pas garder une marque ou une catégorie fantôme.
//
// La PARITÉ local/API est vérifiée ici aussi (P2/B12) : le mode hors ligne
// applique les mêmes règles que les fonctions serveur, bornes comprises.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { PRODUCTS } from '../src/data.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-taxo-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.FRONT_URL = 'http://127.0.0.1:5173'
delete process.env.TRUST_PROXY
delete process.env.VERCEL
const DB_FILE = path.join(dir, 'store.json')

const { handler } = await import('../server/index.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

// Une fiche de base porteuse d'une marque ET d'une catégorie : les deux
// suppressions de taxonomie doivent la nettoyer sans casser son catalogue.
const BASE_WITH_BRAND = PRODUCTS.find((p) => p.brand && p.category)
assert.ok(BASE_WITH_BRAND, 'le catalogue de base porte au moins une fiche marquée')

let server
let base

test.before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

test.beforeEach(() => {
  __rateLimitInternals.buckets.clear()
})

async function call(method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { status: res.status, data }
}

const readStore = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {})

async function loginMaster() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, `login maître : ${r.status}`)
  return r.data.token
}

async function registerClient() {
  const email = `taxo.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.dz`
  const r = await call('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name: 'Client Taxo' }
  })
  assert.equal(r.status, 201)
  return { token: r.data.token, id: r.data.user.id }
}

// ─── Marques ───

test('P10 — marques : ajout, doublon, masquage, suppression propre', async () => {
  const master = await loginMaster()

  const added = await call('PUT', '/api/master/taxonomy', {
    body: { brand: { add: '  Marque Test  ' } },
    token: master
  })
  assert.equal(added.status, 200, JSON.stringify(added.data))
  assert.deepEqual(added.data.meta.extraBrands, ['Marque Test'], 'le nom est nettoyé et borné')

  const dupe = await call('PUT', '/api/master/taxonomy', { body: { brand: { add: 'Marque Test' } }, token: master })
  assert.equal(dupe.status, 400)
  assert.equal(dupe.data.error, 'brand_taken')

  const hidden = await call('PUT', '/api/master/taxonomy', {
    body: { brand: { hide: { name: 'Marque Test', hidden: true } } },
    token: master
  })
  assert.equal(hidden.status, 200)
  assert.deepEqual(hidden.data.meta.hiddenBrands, ['Marque Test'])

  // Le masquage se défait : la marque sort de la liste sans être supprimée.
  const shown = await call('PUT', '/api/master/taxonomy', {
    body: { brand: { hide: { name: 'Marque Test', hidden: false } } },
    token: master
  })
  assert.equal(shown.status, 200)
  assert.deepEqual(shown.data.meta.hiddenBrands, [])

  // Suppression d'une marque RÉELLEMENT portée par une fiche de base : la
  // fiche perd sa marque (override), elle ne garde pas une valeur fantôme.
  const usedBrand = BASE_WITH_BRAND.brand
  const gone = await call('PUT', '/api/master/taxonomy', { body: { brand: { remove: usedBrand } }, token: master })
  assert.equal(gone.status, 200, JSON.stringify(gone.data))
  assert.equal(gone.data.meta.extraBrands.includes(usedBrand), false, 'marque retirée des listes')
  const store = readStore()
  assert.equal(store.meta.productOverrides[BASE_WITH_BRAND.id].brand, '', 'fiche de base sans marque fantôme')

  // La marque supprimée n'apparaît plus dans les suggestions (marques connues).
  const brands = await call('GET', '/api/meta')
  assert.equal(brands.data.meta.hiddenBrands.includes(usedBrand), false)
})

// ─── Catégories ───

test('P10 — catégories : ajout borné, doublon, masquage, réaffectation', async () => {
  const master = await loginMaster()

  const added = await call('PUT', '/api/master/taxonomy', {
    body: { category: { add: { id: '  Imprimantes d’occasion  ', labels: { fr: 'Imprimantes', en: 'Printers' } } } },
    token: master
  })
  assert.equal(added.status, 200, JSON.stringify(added.data))
  const row = added.data.meta.extraCategories.find((c) => c.id === 'imprimantes-d-occasion')
  assert.ok(row, 'identifiant nettoyé (minuscules, tirets, caractères sûrs)')
  assert.equal(row.labels.fr, 'Imprimantes')
  assert.equal(row.labels.en, 'Printers')

  const dupe = await call('PUT', '/api/master/taxonomy', {
    body: { category: { add: { id: 'imprimantes-d-occasion', labels: {} } } },
    token: master
  })
  assert.equal(dupe.status, 400)
  assert.equal(dupe.data.error, 'category_taken')

  // Une catégorie du CODE ne peut pas être « ajoutée » : l'id est déjà pris.
  const baseId = BASE_WITH_BRAND.category
  const dupeBase = await call('PUT', '/api/master/taxonomy', {
    body: { category: { add: { id: baseId, labels: {} } } },
    token: master
  })
  assert.equal(dupeBase.status, 400)
  assert.equal(dupeBase.data.error, 'category_taken')

  const hidden = await call('PUT', '/api/master/taxonomy', {
    body: { category: { hide: { id: 'imprimantes-d-occasion', hidden: true } } },
    token: master
  })
  assert.equal(hidden.status, 200)
  assert.deepEqual(hidden.data.meta.hiddenCategories, ['imprimantes-d-occasion'])

  // Suppression d'une catégorie réellement utilisée : ses fiches partent au
  // rayon neutre `accessories` — aucune fiche ne garde une catégorie fantôme.
  const gone = await call('PUT', '/api/master/taxonomy', { body: { category: { remove: baseId } }, token: master })
  assert.equal(gone.status, 200, JSON.stringify(gone.data))
  const store = readStore()
  assert.ok(store.meta.hiddenCategories.includes(baseId), 'catégorie du code retirée du filtre')
  assert.equal(store.meta.extraCategories.some((c) => c.id === 'imprimantes-doccasion'), false, 'catégorie ajoutée supprimée')
  assert.equal(
    store.meta.productOverrides[BASE_WITH_BRAND.id].category,
    'accessories',
    'fiche réaffectée au rayon neutre'
  )
  assert.equal(
    (store.meta.extraProducts || []).some((p) => p.category === baseId),
    false,
    'aucune fiche master ne garde la catégorie supprimée'
  )
})

// ─── Sécurité ───

test('P10 — un client ne touche pas à la taxonomie', async () => {
  const client = await registerClient()
  const r = await call('PUT', '/api/master/taxonomy', { body: { brand: { add: 'Pirate' } }, token: client.token })
  assert.equal(r.status, 403)
  const store = readStore()
  assert.equal((store.meta.extraBrands || []).includes('Pirate'), false, 'rien écrit')
})

// ─── Suppression de fiche : le produit sorti n'est plus commandable ───

test('P10 — une fiche supprimée n’est plus commandable (A1)', async () => {
  const master = await loginMaster()
  const id = PRODUCTS[0].id
  const del = await call('DELETE', `/api/master/products/${encodeURIComponent(id)}`, { token: master })
  assert.equal(del.status, 200, JSON.stringify(del.data))
  assert.equal(del.data.base, true)

  // La liste master ne la propose plus non plus.
  const list = await call('GET', '/api/master/products', { token: master })
  assert.equal((list.data.products || []).some((p) => p.id === id), false, 'fiche absente de la gestion')

  // Et une commande qui la vise est refusée « indisponible », pas 500.
  const order = await call('POST', '/api/orders', {
    body: { name: 'Client Taxo', phone: '0555000000', items: [{ id, qty: 1 }] }
  })
  assert.equal(order.status, 409, JSON.stringify(order.data))
  assert.ok(
    (order.data.unavailable || []).some((u) => u.id === id),
    'la fiche supprimée est signalée indisponible'
  )
})

// ─── Parité local / API (P2/B12) ───

test('P10 — le mode local applique les mêmes règles que l’API', async () => {
  const {
    addBrand,
    setBrandHidden,
    deleteBrand,
    addCategory,
    setCategoryHidden,
    deleteCategory
  } = await import('../src/shopStore.js')

  // Marque : ajout, doublon refusé, masquage réversible.
  let meta = { extraBrands: [], hiddenBrands: [], extraCategories: [], hiddenCategories: [], productOverrides: {} }
  const a = addBrand(meta, '  Marque Locale  ')
  assert.equal(a.ok, true)
  assert.deepEqual(a.meta.extraBrands, ['Marque Locale'])
  assert.equal(addBrand(a.meta, 'Marque Locale').ok, false, 'doublon refusé comme à l’API')
  const h = setBrandHidden(a.meta, 'Marque Locale', true)
  assert.deepEqual(h.meta.hiddenBrands, ['Marque Locale'])
  assert.deepEqual(setBrandHidden(h.meta, 'Marque Locale', false).meta.hiddenBrands, [])

  // Suppression : la fiche de base perd sa marque, comme côté serveur.
  const usedBrand = BASE_WITH_BRAND.brand
  const db = deleteBrand(a.meta, usedBrand, PRODUCTS)
  assert.ok(db.touched >= 1)
  assert.equal(db.meta.productOverrides[BASE_WITH_BRAND.id].brand, '')

  // Catégorie : identifiant nettoyé, doublon refusé, réaffectation identique.
  const c = addCategory(meta, { id: '  Imprimantes d’occasion  ', labels: { fr: 'Imprimantes', en: 'Printers' } })
  assert.equal(c.ok, true)
  assert.equal(c.meta.extraCategories[0].id, 'imprimantes-d-occasion')
  assert.equal(addCategory(c.meta, { id: 'imprimantes-d-occasion', labels: {} }).ok, false)
  const ch = setCategoryHidden(c.meta, 'imprimantes-d-occasion', true)
  assert.deepEqual(ch.meta.hiddenCategories, ['imprimantes-d-occasion'])
  const cd = deleteCategory(c.meta, BASE_WITH_BRAND.category, PRODUCTS)
  assert.equal(cd.meta.productOverrides[BASE_WITH_BRAND.id].category, 'accessories')
  // La catégorie AJOUTÉE n'est pas celle qu'on supprime : elle reste en place.
  assert.equal(cd.meta.extraCategories.length, 1)
  assert.ok(cd.meta.hiddenCategories.includes(BASE_WITH_BRAND.category))
})
