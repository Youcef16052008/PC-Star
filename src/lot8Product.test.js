import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import {
  CATEGORIES,
  CATEGORY_IDS,
  KINDS,
  KIND_IDS,
  PART_LINES,
  PRODUCTS,
  isKnownCategory,
  isKnownKind,
  kindForCategory
} from './data.js'
import { publicCatalog } from '../server/catalog.js'
import { addProduct } from './shopStore.js'
import { errToast } from './MasterPage.jsx'
import { dict, LANGS, t } from './i18n.js'

// ---------------------------------------------------------------------------
// LOT 8.10 — audit A→Z du 16/09/2026, item A10 (🟡).
//
// `createProduct` acceptait une `category` et un `kind` **libres** :
//
//     kind: body.kind || 'part',
//     category: String(body.category || 'accessories'),
//
// Le nom, le prix, le SKU, `needs`, le nombre de photos et la longueur des
// champs texte étaient validés (lots 1.9 et 2.6) — pas ces deux champs, qui
// décident pourtant où le produit est joignable. Un produit `category: "SSD"`
// (libellé, pas id) ou `category: "ssd"` (cet id n'existe pas : le catalogue
// utilise `memory`) était enregistré, visible dans le panneau master, et
// n'apparaissait dans AUCUN filtre de la vitrine (`App.jsx:1027` compare
// `p.category === category`), dans aucune ligne de `PART_LINES` (toutes les
// fonctions `match` testent des ids précis), jamais dans le Builder
// (`slot.pick` filtre par catégorie) — invendable par navigation, trouvable
// seulement par recherche texte, avec un libellé retombant sur l'id brut.
//
// Trois correctifs, une seule source de vérité (`src/data.js`) :
//   1. création ET patch validés contre `CATEGORIES` / `KINDS` hors `all`,
//      refus **400 explicite** plutôt que correction muette ;
//   2. `sanitizeProductPatch` validait `category` contre un ensemble dérivé de
//      `PRODUCTS` — remplacé par `CATEGORIES`, la liste que le formulaire
//      master propose réellement ;
//   3. `kind` n'était **ni validé ni appliqué** au patch : il ne figurait pas
//      dans la liste des champs recopiés par `updateProduct`, donc
//      `PUT { kind: 'machine' }` répondait 200 sans rien changer.
// Le mode local (`shopStore.addProduct`) valide désormais la catégorie avec la
// même liste, et sa règle de dérivation du `kind` (une ternaire inline) est
// partagée avec le serveur via `kindForCategory`.
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot8-product-'))
process.env.PCSTAR_DATA_DIR = dir
const DB_FILE = path.join(dir, 'store.json')

// `server/masterApi.js` importe `server/db.js`, qui **résout `DATA_DIR` au
// chargement du module**. Un `import` statique en tête de fichier est évalué
// AVANT le corps du module — donc avant la ligne ci-dessus — et les routes
// testées plus bas écriraient dans `server/data/` (base partagée, non isolée)
// au lieu du répertoire temporaire : c'est exactement ce qui est arrivé pendant
// la mise au point de ce fichier (46 produits de test retrouvés dans
// `server/data/store.json`, dont un `category: "SSD"` créé par une
// neutralisation). Import dynamique, comme dans `src/masterSecrets.test.js`.
const { createProduct, listMasterProducts, sanitizeProductPatch, updateProduct } = await import(
  '../server/masterApi.js'
)

fs.writeFileSync(
  DB_FILE,
  JSON.stringify({
    users: [],
    orders: [],
    stock: {},
    meta: {
      demoSeeded: true,
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: {}
    }
  })
)

const { handler } = await import('../server/index.js')

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
      fs.rmSync(dir, { recursive: true, force: true })
      resolve()
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

async function masterToken() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, 'connexion maître (fixture de test)')
  return r.data.token
}

/** Base de travail jetable, par test — `createProduct` appelle `ensureStock`. */
function fakeDb() {
  return {
    users: [],
    orders: [],
    stock: {},
    meta: {
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: [],
      productOverrides: {}
    }
  }
}

const BASE_PRODUCT = { name: 'Kit de test A10', price: 12500, stock: 2, short: 'fixture' }

describe('LOT 8.10 (A10) — création : `category` validée contre CATEGORIES', () => {
  it('`category: "SSD"` (un libellé, pas un id) → refus `category`', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, category: 'SSD' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'category')
  })

  it('`category: "ssd"` (cet id n’existe pas, le catalogue utilise `memory`) → refus', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, category: 'ssd' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'category')
  })

  it('`category: "all"` → refus : c’est une valeur de filtre, pas une classification', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, category: 'all' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'category')
    assert.ok(!CATEGORY_IDS.includes('all'), '`all` est exclu de la liste autorisée')
    assert.ok(CATEGORIES.some((c) => c.id === 'all'), 'mais reste proposé comme filtre')
  })

  it('un id réel (`memory`) est accepté et enregistré tel quel', () => {
    const db = fakeDb()
    const r = createProduct(db, { ...BASE_PRODUCT, category: 'memory' })
    assert.equal(r.ok, true)
    assert.equal(r.product.category, 'memory')
    assert.ok(db.meta.extraProducts.some((p) => p.id === r.product.id), 'produit enregistré')
  })

  it('catégorie absente → repli `accessories` (comportement conservé)', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT })
    assert.equal(r.ok, true)
    assert.equal(r.product.category, 'accessories')
  })

  it('toutes les catégories du formulaire master sont acceptées', () => {
    // Le `select` de MasterPage.jsx liste exactement `CATEGORIES` hors `all` :
    // le serveur doit accepter tout ce que le formulaire propose.
    for (const id of CATEGORY_IDS) {
      const r = createProduct(fakeDb(), { ...BASE_PRODUCT, name: `Produit ${id}`, category: id })
      assert.equal(r.ok, true, `catégorie ${id} refusée à tort`)
      assert.equal(r.product.category, id)
    }
    assert.equal(CATEGORY_IDS.length, CATEGORIES.length - 1)
  })

  it('la liste autorisée vient de CATEGORIES, pas des produits de base', () => {
    // Avant le correctif, `sanitizeProductPatch` validait contre
    // `new Set(PRODUCTS.map(p => p.category))`. Les deux ensembles sont
    // identiques AUJOURD'HUI — ce test le verrouille, pour qu'un ajout à
    // `CATEGORIES` sans produit de base ne crée pas un formulaire qui propose
    // une catégorie que le serveur refuse.
    const fromProducts = [...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))].sort()
    assert.deepEqual([...CATEGORY_IDS].sort(), fromProducts)
    assert.ok(isKnownCategory('cpu') && !isKnownCategory('CPU'), 'comparaison exacte, sans casse')
  })

  it('un refus n’enregistre rien : ni produit, ni stock', () => {
    const db = fakeDb()
    const r = createProduct(db, { ...BASE_PRODUCT, category: 'SSD' })
    assert.equal(r.ok, false)
    assert.equal(db.meta.extraProducts.length, 0)
    assert.deepEqual(Object.keys(db.stock), [])
    assert.equal(listMasterProducts(db).filter((p) => p.source === 'extra').length, 0)
  })
})

describe('LOT 8.10 (A10) — création : `kind` validé contre KINDS, déduit sinon', () => {
  it('`kind` inconnu → refus `kind` (pas de repli silencieux)', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, kind: 'widget' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'kind')
  })

  it('`kind: "all"` → refus : valeur de filtre, pas nature de produit', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, kind: 'all' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'kind')
    assert.ok(!KIND_IDS.includes('all'))
    assert.ok(KINDS.some((k) => k.id === 'all'))
  })

  it('tous les `kind` de KINDS (hors `all`) sont acceptés', () => {
    for (const id of KIND_IDS) {
      const r = createProduct(fakeDb(), { ...BASE_PRODUCT, name: `Nature ${id}`, kind: id })
      assert.equal(r.ok, true, `kind ${id} refusé à tort`)
      assert.equal(r.product.kind, id)
      assert.ok(isKnownKind(id))
    }
    assert.deepEqual(KIND_IDS, ['part', 'accessory', 'machine', 'service'])
  })

  it('`kind` absent → déduit de la catégorie étendue (machine, accessoire, service ou pièce)', () => {
    const cas = [
      ['repair', 'service'],
      ['laptop', 'machine'],
      ['desktop', 'machine'],
      ['printer', 'accessory'],
      ['network', 'accessory'],
      ['console', 'accessory'],
      ['accessories', 'accessory'],
      ['cpu', 'part'],
      ['memory', 'part']
    ]
    for (const [category, attendu] of cas) {
      const r = createProduct(fakeDb(), { ...BASE_PRODUCT, name: `Dérivé ${category}`, category })
      assert.equal(r.ok, true)
      assert.equal(r.product.kind, attendu, `category ${category}`)
      assert.equal(kindForCategory(category), attendu)
    }
  })

  it('un `kind` fourni explicitement l’emporte sur la dérivation', () => {
    const r = createProduct(fakeDb(), { ...BASE_PRODUCT, category: 'repair', kind: 'part' })
    assert.equal(r.ok, true)
    assert.equal(r.product.kind, 'part')
  })

  it('le catalogue de base est cohérent avec la règle de dérivation sur les catégories typées', () => {
    // La règle reprise du mode local n'invente rien : elle reproduit ce que le
    // catalogue de base fait déjà pour repair / laptop / ready / accessories.
    for (const category of ['repair', 'laptop', 'ready', 'accessories']) {
      const echantillon = PRODUCTS.filter((p) => p.category === category)
      assert.ok(echantillon.length > 0, `aucun produit de base en ${category}`)
      for (const p of echantillon) assert.equal(p.kind, kindForCategory(category), `${p.id}`)
    }
  })
})

describe('LOT 8.10 (A10) — patch : `category` et `kind` validés, `kind` enfin appliqué', () => {
  it('patch avec une catégorie inconnue → refus `category` (non-régression)', () => {
    const r = sanitizeProductPatch({ category: 'SSD' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'category')
  })

  it('patch avec un `kind` inconnu → refus `kind` (nouveau)', () => {
    const r = sanitizeProductPatch({ kind: 'widget' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'kind')
  })

  it('patch `kind` valide sur un produit master → APPLIQUÉ (plus de 200 qui ne change rien)', () => {
    const db = fakeDb()
    const c = createProduct(db, { ...BASE_PRODUCT, category: 'cpu' })
    assert.equal(c.product.kind, 'part')
    const u = updateProduct(db, c.product.id, { kind: 'machine' })
    assert.equal(u.ok, true)
    assert.equal(u.product.kind, 'machine')
    assert.equal(db.meta.extraProducts.find((p) => p.id === c.product.id).kind, 'machine', 'persisté')
  })

  it('patch `kind` valide sur un produit du catalogue de base → override stocké et fusionné', () => {
    const db = fakeDb()
    const cible = PRODUCTS.find((p) => p.category === 'cpu')
    const u = updateProduct(db, cible.id, { kind: 'accessory' })
    assert.equal(u.ok, true)
    assert.equal(u.product.kind, 'accessory')
    assert.equal(db.meta.productOverrides[cible.id].kind, 'accessory')
  })

  it('patch `category` valide sur un produit master → appliqué', () => {
    const db = fakeDb()
    const c = createProduct(db, { ...BASE_PRODUCT, category: 'cpu' })
    const u = updateProduct(db, c.product.id, { category: 'memory' })
    assert.equal(u.ok, true)
    assert.equal(u.product.category, 'memory')
  })

  it('le patch accepte exactement les mêmes catégories que la création', () => {
    // Les deux chemins doivent lire la MÊME liste. Avant le lot 8.10, la
    // création n'en lisait aucune et le patch lisait un ensemble dérivé de
    // `PRODUCTS` : si une catégorie était ajoutée à `CATEGORIES` sans produit
    // de base, le formulaire la proposerait, la création l'accepterait et le
    // patch la refuserait.
    for (const id of CATEGORY_IDS) {
      const r = sanitizeProductPatch({ category: id })
      assert.equal(r.ok, true, `catégorie ${id} refusée au patch`)
      assert.equal(r.patch.category, id)
      assert.equal(createProduct(fakeDb(), { ...BASE_PRODUCT, name: `Patch ${id}`, category: id }).ok, true)
    }
    for (const faux of ['SSD', 'ssd', 'all', '', 'cpu ']) {
      assert.equal(sanitizeProductPatch({ category: faux }).error, 'category', `patch ${JSON.stringify(faux)}`)
      assert.equal(createProduct(fakeDb(), { ...BASE_PRODUCT, category: faux }).error === 'category', true)
    }
  })

  it('le patch accepte exactement les mêmes `kind` que la création', () => {
    for (const id of KIND_IDS) {
      assert.equal(sanitizeProductPatch({ kind: id }).ok, true, `kind ${id} refusé au patch`)
    }
    for (const faux of ['all', 'Machine', 'gadget', '']) {
      assert.equal(sanitizeProductPatch({ kind: faux }).error, 'kind', `patch ${JSON.stringify(faux)}`)
      assert.equal(createProduct(fakeDb(), { ...BASE_PRODUCT, kind: faux }).error, 'kind', `création ${JSON.stringify(faux)}`)
    }
  })

  it('un patch refusé ne laisse aucun override résiduel', () => {
    const db = fakeDb()
    const cible = PRODUCTS.find((p) => p.category === 'gpu')
    const u = updateProduct(db, cible.id, { kind: 'inconnu' })
    assert.equal(u.ok, false)
    assert.equal(db.meta.productOverrides[cible.id], undefined, 'aucune clé posée (lot 3.14)')
  })

  it('un patch sans `kind` ne touche pas au `kind` existant', () => {
    const db = fakeDb()
    const c = createProduct(db, { ...BASE_PRODUCT, category: 'repair' })
    assert.equal(c.product.kind, 'service')
    const u = updateProduct(db, c.product.id, { price: 9000 })
    assert.equal(u.ok, true)
    assert.equal(u.product.kind, 'service')
    assert.equal(u.product.price, 9000)
  })
})

describe('LOT 8.10 (A10) — conséquence métier : un produit accepté est joignable', () => {
  it('un produit créé dans une catégorie réelle tombe dans le filtre vitrine et dans une ligne PART_LINES', () => {
    const db = fakeDb()
    const r = createProduct(db, {
      ...BASE_PRODUCT,
      name: 'SSD NVMe 1 To',
      category: 'memory',
      compat: { memory: 'DDR5' }
    })
    assert.equal(r.ok, true)
    const p = r.product
    // Vitrine : `App.jsx` filtre par `category === 'all' || p.category === category`.
    assert.equal(p.category === 'all' || p.category === 'memory', true)
    // Lignes de pièces : `ram` exige `category === 'memory' && compat.memory`.
    const ram = PART_LINES.find((l) => l.id === 'ram')
    // `match` renvoie `p.category === 'memory' && p.compat?.memory` — une valeur
    // truthy (la chaîne `DDR5`), pas nécessairement `true`.
    assert.ok(ram.match(p), 'proposé par la ligne RAM du Builder')
    assert.ok(publicCatalog(db).some((x) => x.id === p.id), 'visible dans le catalogue public')
  })

  it('une catégorie libre n’aurait été joignable nulle part — la raison du refus', () => {
    // Contre-épreuve : le produit que le correctif refuse est exactement celui
    // qui disparaissait de toute navigation.
    const fantome = { ...BASE_PRODUCT, id: 'x-1', category: 'ssd', compat: {} }
    // La ligne universelle « all » sert précisément à explorer le catalogue ;
    // elle ne rend pas une catégorie libre joignable par navigation dédiée.
    assert.equal(PART_LINES.filter((l) => l.id !== 'all').some((l) => l.match(fantome)), false, 'aucune ligne PART_LINES dédiée')
    for (const c of CATEGORIES) {
      if (c.id === 'all') continue
      assert.equal(fantome.category === c.id, false, `filtre vitrine ${c.id}`)
    }
    assert.ok(!isKnownCategory(fantome.category))
  })
})

describe('LOT 8.10 (A10) — mode local : la même validation, la même dérivation', () => {
  it('`addProduct` avec une catégorie libre → refus `category`, meta inchangé', () => {
    const meta = { extraProducts: [], hiddenProductIds: [] }
    const r = addProduct(meta, { ...BASE_PRODUCT, category: 'SSD' })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'category')
    assert.equal(meta.extraProducts.length, 0, 'la meta passée n’est pas modifiée')
  })

  it('`addProduct` refuse aussi `all` et accepte les ids réels', () => {
    assert.equal(addProduct({ extraProducts: [] }, { ...BASE_PRODUCT, category: 'all' }).error, 'category')
    const r = addProduct({ extraProducts: [] }, { ...BASE_PRODUCT, category: 'usb' })
    assert.equal(r.ok, true)
    assert.equal(r.product.category, 'usb')
  })

  it('serveur et mode local dérivent le même `kind` pour chaque catégorie', () => {
    for (const category of CATEGORY_IDS) {
      const viaApi = createProduct(fakeDb(), { ...BASE_PRODUCT, name: `Parité ${category}`, category })
      const viaLocal = addProduct({ extraProducts: [] }, { ...BASE_PRODUCT, name: `Parité ${category}`, category })
      assert.equal(viaApi.ok, true)
      assert.equal(viaLocal.ok, true)
      assert.equal(viaApi.product.kind, viaLocal.product.kind, `divergence en ${category}`)
    }
  })
})

describe('LOT 8.10 (A10) — routes réelles : 400 explicite, 201 quand c’est bon', () => {
  it('POST /api/master/products avec `category: "SSD"` → 400 { error: "category" }', async () => {
    const token = await masterToken()
    const avant = await call('GET', '/api/master/products', { token })
    const avantExtras = avant.data.products.filter((p) => p.source === 'extra').length
    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: 'SSD 1 To', price: 9800, stock: 1, category: 'SSD' }
    })
    assert.equal(r.status, 400)
    assert.equal(r.data.ok, false)
    assert.equal(r.data.error, 'category')
    const apres = await call('GET', '/api/master/products', { token })
    const extras = apres.data.products.filter((p) => p.source === 'extra')
    assert.equal(extras.length, avantExtras, 'aucun produit créé')
    assert.ok(!extras.some((p) => p.name === 'SSD 1 To'), 'rien n’est enregistré')
  })

  it('POST avec un `kind` inconnu → 400 { error: "kind" }', async () => {
    const token = await masterToken()
    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Objet bizarre', price: 500, stock: 1, category: 'usb', kind: 'gadget' }
    })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'kind')
  })

  it('POST valide → 201, publié et filtrable dans sa catégorie', async () => {
    const token = await masterToken()
    const r = await call('POST', '/api/master/products', {
      token,
      body: { name: 'RAM DDR5 32 Go', price: 21500, stock: 3, category: 'memory', brand: 'Corsair' }
    })
    assert.equal(r.status, 201)
    assert.equal(r.data.product.category, 'memory')
    assert.equal(r.data.product.kind, 'part', 'déduit de la catégorie')
    const cat = await call('GET', '/api/catalog')
    const pub = cat.data.products.find((p) => p.id === r.data.product.id)
    assert.ok(pub, 'présent dans le catalogue public')
    assert.equal(pub.category, 'memory')
    assert.equal(cat.data.products.filter((p) => p.category === 'memory').some((p) => p.id === pub.id), true)
  })

  it('PUT /api/master/products/:id avec une catégorie libre → 400 { error: "category" }', async () => {
    const token = await masterToken()
    const cible = PRODUCTS.find((p) => p.category === 'cpu')
    const r = await call('PUT', `/api/master/products/${cible.id}`, { token, body: { category: 'SSD' } })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'category')
  })

  it('PUT avec un `kind` valide → 200 et le champ est réellement appliqué', async () => {
    const token = await masterToken()
    const r0 = await call('POST', '/api/master/products', {
      token,
      body: { name: 'PC assemblé A10', price: 189000, stock: 1, category: 'ready' }
    })
    assert.equal(r0.status, 201)
    const id = r0.data.product.id
    const r = await call('PUT', `/api/master/products/${id}`, { token, body: { kind: 'machine' } })
    assert.equal(r.status, 200)
    assert.equal(r.data.product.kind, 'machine')
    const list = await call('GET', '/api/master/products', { token })
    assert.equal(list.data.products.find((p) => p.id === id).kind, 'machine', 'persisté en base')
  })

  it('PUT avec un `kind` inconnu → 400, fiche inchangée', async () => {
    const token = await masterToken()
    const cible = PRODUCTS.find((p) => p.category === 'gpu')
    const avant = cible.kind
    const r = await call('PUT', `/api/master/products/${cible.id}`, { token, body: { kind: 'bidule' } })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'kind')
    const list = await call('GET', '/api/master/products', { token })
    assert.equal(list.data.products.find((p) => p.id === cible.id).kind, avant)
  })
})

describe('LOT 8.10 (A10) — le refus est dit au maître, dans les trois langues', () => {
  it('`errToast` mappe `category` et `kind` sur des messages dédiés', () => {
    for (const { id: lang } of LANGS) {
      const vus = []
      errToast((m) => vus.push(m), (k) => t(lang, k), { ok: false, data: { error: 'category' } }, 'masterCreateFail')
      errToast((m) => vus.push(m), (k) => t(lang, k), { ok: false, data: { error: 'kind' } }, 'masterCreateFail')
      assert.equal(vus.length, 2)
      assert.equal(vus[0], t(lang, 'masterCategoryInvalid'))
      assert.equal(vus[1], t(lang, 'masterKindInvalid'))
      assert.notEqual(vus[0], t(lang, 'masterCreateFail'), 'message dédié, pas le repli générique')
      assert.notEqual(vus[1], vus[0])
    }
  })

  it('les deux clés existent et ne sont pas vides dans les trois langues', () => {
    for (const { id: lang } of LANGS) {
      for (const key of ['masterCategoryInvalid', 'masterKindInvalid']) {
        const v = dict[lang][key]
        assert.ok(typeof v === 'string' && v.trim().length > 3, `${lang}.${key}`)
        assert.equal(t(lang, key), v)
      }
    }
  })

  it('le message hors ligne et le message « pas de stockage » restent prioritaires', () => {
    // Non-régression sur l'ordre des gardes de `errToast` (P6, lot 4.2).
    const vus = []
    errToast((m) => vus.push(m), (k) => t('fr', k), { offline: true, data: { error: 'category' } }, 'masterCreateFail')
    errToast(
      (m) => vus.push(m),
      (k) => t('fr', k),
      { ok: false, data: { error: 'upload_storage' } },
      'masterCreateFail'
    )
    assert.equal(vus[0], t('fr', 'backendOffline'))
    assert.equal(vus[1], t('fr', 'masterPhotoNoStorage'))
  })
})

// ---------------------------------------------------------------------------
// Fiche maître enrichie — les mêmes métadonnées passent par l'API et le repli
// local. Elles restent bornées afin de pouvoir apparaître sans risque dans la
// vitrine, l'export et les sauvegardes.
// ---------------------------------------------------------------------------
describe('fiche maître professionnelle : métadonnées commerciales et techniques', () => {
  const rich = {
    ...BASE_PRODUCT,
    category: 'laptop',
    model: 'ThinkPad T14 Gen 3',
    barcode: '0196801234567',
    description: 'Portable professionnel testé.\nChargeur inclus.',
    conditionNote: 'Batterie et clavier contrôlés au comptoir.',
    compareAtPrice: 14900,
    lowStockAt: 2,
    tags: ['Pro', 'laptop', 'pro', '', '  mobilité  '],
    details: [
      { label: 'Écran', value: '14 pouces FHD IPS' },
      { label: 'Mémoire', value: '16 Go DDR4' },
      { label: '', value: '' }
    ],
    compat: { memory: 'DDR4', psuMin: 100 }
  }

  it('crée et conserve une fiche détaillée normalisée', () => {
    const r = createProduct(fakeDb(), rich)
    assert.equal(r.ok, true)
    assert.equal(r.product.model, rich.model)
    assert.equal(r.product.barcode, rich.barcode)
    assert.equal(r.product.description, rich.description)
    assert.equal(r.product.compareAtPrice, 14900)
    assert.equal(r.product.lowStockAt, 2)
    assert.deepEqual(r.product.tags, ['Pro', 'laptop', 'mobilité'])
    assert.deepEqual(r.product.details, rich.details.slice(0, 2))
    assert.deepEqual(r.product.compat, { memory: 'DDR4', psuMin: 100 })
  })

  it('refuse un prix barré inférieur au prix actuel, un code-barres et une compatibilité invalides', () => {
    assert.equal(createProduct(fakeDb(), { ...rich, compareAtPrice: 12499 }).error, 'compare_at_price')
    assert.equal(createProduct(fakeDb(), { ...rich, barcode: '###' }).error, 'barcode')
    assert.equal(createProduct(fakeDb(), { ...rich, compat: { memory: 'LPDDR5' } }).error, 'compat')
  })

  it('le patch du catalogue applique ces champs et garde la règle du prix promotionnel', () => {
    const db = fakeDb()
    const base = PRODUCTS[0]
    const updated = updateProduct(db, base.id, {
      model: 'Référence atelier', barcode: '12345678', description: 'Description complète',
      conditionNote: 'Testé', compareAtPrice: base.price + 500, lowStockAt: 3,
      details: [{ label: 'Test', value: 'OK' }], tags: ['atelier'], compat: { socket: 'AM5' }
    })
    assert.equal(updated.ok, true)
    assert.equal(updated.product.model, 'Référence atelier')
    assert.equal(updated.product.details[0].value, 'OK')
    assert.equal(updateProduct(db, base.id, { compareAtPrice: base.price - 1 }).error, 'compare_at_price')
  })

  it('une vraie photo maître remplace le statut d’illustration de rayon', () => {
    const db = fakeDb()
    const illustrated = PRODUCTS.find((product) => product.photoMode === 'category')
    assert.ok(illustrated, 'un produit des nouveaux rayons existe')
    const updated = updateProduct(db, illustrated.id, { photos: ['/uploads/real-photo.jpg'] })
    assert.equal(updated.ok, true)
    assert.equal(updated.product.photoMode, 'custom')
  })

  it('le repli local stocke le même ensemble de champs', () => {
    const r = addProduct({ extraProducts: [], hiddenProductIds: [] }, rich, [])
    assert.equal(r.ok, true)
    assert.equal(r.product.description, rich.description)
    assert.equal(r.product.compareAtPrice, 14900)
    assert.deepEqual(r.product.details, rich.details.slice(0, 2))
  })
})
