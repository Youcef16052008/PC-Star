/**
 * LOT P1 (audit 19/09/2026, B5) — modifier une fiche existante.
 *
 * Le panneau maître ne proposait d'éditer QUE les photos :
 * `api.masterUpdateProduct(id, { photos })` était le seul appel de
 * `masterUpdateProduct` du composant. Un prix saisi de travers, un nom fautif ou
 * un stock réel jamais rapporté ne pouvaient donc pas être corrigés — il fallait
 * masquer la fiche et la recréer, donc changer d'identifiant, donc perdre les
 * photos liées et l'historique de stock. Le serveur, lui, sait tout appliquer
 * (`sanitizeProductPatch` + `meta.productOverrides` pour les 301 fiches du
 * catalogue de base) : c'était uniquement un trou d'interface.
 *
 * Le mappage (fiche → champs, champs → corps) vit maintenant dans
 * `src/masterForm.js` et se teste ici sans navigateur.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { emptyProductForm, productFormFromProduct, productPayloadFromForm } from './masterForm.js'
import { PRODUCTS } from './data.js'
import { compatValues, normalizeProductCompat } from './productMeta.js'
import { dict } from './i18n.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-master-edit-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.TRUST_PROXY
delete process.env.VERCEL

const { handler } = await import('../server/index.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

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
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

async function call(method, pathname, { body, token = null } = {}) {
  __rateLimitInternals.buckets.clear()
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

describe('P1/B5 — mappage fiche → formulaire → corps de requête', () => {
  it('le formulaire vide présente les listes de compatibilité comme des listes', () => {
    const form = emptyProductForm()
    assert.deepEqual(form.compat.socket, [])
    assert.deepEqual(form.compat.memory, [])
    assert.deepEqual(form.compat.form, [])
    assert.equal(form.stock, '1')
    assert.equal(form.price, '', 'un prix non saisi n’est pas 0')
  })

  it('une fiche se relit dans les champs, nombres en chaînes', () => {
    const p = PRODUCTS.find((x) => x.category === 'cpu')
    const form = productFormFromProduct(p)
    assert.equal(form.name, p.name)
    assert.equal(form.price, String(p.price))
    assert.equal(form.sku, p.sku)
    assert.equal(typeof form.stock, 'string')
    assert.deepEqual(compatValues(p.compat?.socket), form.compat.socket)
    assert.ok(Array.isArray(form.details) && form.details.length >= 1)
    assert.deepEqual(form.photos, [], 'les photos restent gérées par leur panneau')
  })

  it('un prix nul ou négatif ne se pré-remplit pas (il serait refusé au serveur)', () => {
    assert.equal(productFormFromProduct({ name: 'X', price: 0 }).price, '')
    assert.equal(productFormFromProduct({ name: 'X', price: '12 500' }).price, '')
    assert.equal(productFormFromProduct({ name: 'X', price: 97000 }).price, '97000')
    assert.equal(productFormFromProduct(null).name, '')
  })

  it('le corps reconstruit ne perd rien de la fiche (ré-enregistrement idempotent)', () => {
    for (const p of PRODUCTS.slice(0, 40)) {
      const payload = productPayloadFromForm(productFormFromProduct(p))
      assert.equal(payload.name, p.name, p.id)
      assert.equal(payload.price, Number(p.price), p.id)
      const expected = normalizeProductCompat({
        socket: compatValues(p.compat?.socket),
        memory: compatValues(p.compat?.memory),
        form: compatValues(p.compat?.form),
        psuWatts: p.compat?.psuWatts,
        psuMin: p.compat?.psuMin
      })
      assert.deepEqual(normalizeProductCompat(payload.compat), expected, `compat ${p.id}`)
    }
  })

  it('les cases décochées ne deviennent jamais une valeur vide refusée', () => {
    const form = { ...emptyProductForm(), name: 'Sans compat', price: '1000', stock: '1' }
    const payload = productPayloadFromForm(form)
    assert.deepEqual(payload.compat.socket, [])
    assert.deepEqual(normalizeProductCompat(payload.compat), {}, 'aucun champ vide envoyé')
    assert.equal(payload.sku, undefined, 'SKU vide = « à générer », pas une chaîne vide')
  })
})

describe('P1/B5 — le serveur applique l’édition', () => {
  const target = PRODUCTS.find((p) => p.category === 'gpu')

  it('PUT /api/master/products/:id corrige nom, prix et stock d’une fiche de base', async () => {
    const avant = await call('GET', '/api/catalog')
    const brut = (avant.data.products || []).find((p) => p.id === target.id)
    assert.ok(brut, 'la fiche cible est dans le catalogue public')

    const r = await call('PUT', `/api/master/products/${target.id}`, {
      token: masterToken,
      body: { name: 'Carte corrigée', price: 123456, stock: 7 }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.product.name, 'Carte corrigée')
    assert.equal(r.data.product.price, 123456)
    assert.equal(r.data.product.stock, 7)

    const apres = await call('GET', '/api/catalog')
    const relu = (apres.data.products || []).find((p) => p.id === target.id)
    assert.equal(relu.price, 123456, 'le catalogue public voit la correction')
    assert.equal(relu.name, 'Carte corrigée')
    const stock = await call('GET', `/api/stock/${target.id}`)
    assert.equal(stock.data.stock, 7, 'le stock rapporté suit l’édition')
  })

  it('les mêmes règles de validation s’appliquent qu’à la création', async () => {
    assert.equal((await call('PUT', `/api/master/products/${target.id}`, { token: masterToken, body: { name: '   ' } })).data.error, 'name')
    const prix = await call('PUT', `/api/master/products/${target.id}`, { token: masterToken, body: { price: 0 } })
    assert.equal(prix.status, 400)
    assert.equal(prix.data.error, 'price', 'prix à 0 DA refusé : la ligne serait OFFERTE à la commande (B13)')
    const nom = await call('PUT', `/api/master/products/${target.id}`, { token: masterToken, body: { name: 'x'.repeat(5000) } })
    assert.equal(nom.status, 400, 'et la modification ne passe pas par un chemin plus permissif que la création (B12)')
    assert.equal(nom.data.error, 'name_too_long')
  })

  it('sans session maître, rien ne se modifie', async () => {
    const r = await call('PUT', `/api/master/products/${target.id}`, { body: { price: 1 } })
    assert.ok(r.status === 401 || r.status === 403, JSON.stringify(r.data))
  })

  it('la compatibilité en liste passe par le même PUT (B11)', async () => {
    const r = await call('PUT', `/api/master/products/cooler`, {
      token: masterToken,
      body: { compat: productPayloadFromForm(productFormFromProduct({ compat: { socket: ['AM4', 'AM5'] } })).compat }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.deepEqual(r.data.product.compat.socket, ['AM4', 'AM5'])
  })
})

describe('P1/B5 — le panneau maître expose l’édition', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'MasterPage.jsx'), 'utf8')

  it('un bouton de modification par fiche, branché sur le formulaire', () => {
    assert.match(src, /onClick=\{\(\) => startEditProduct\(p\)\}/)
    assert.match(src, /setForm\(productFormFromProduct\(p\)\)/)
    assert.match(src, /disabled=\{!apiOnline\}/, 'hors serveur, le bouton est neutralisé et expliqué')
    assert.match(src, /title=\{!apiOnline \? t\('masterEditApiOnly'\)/)
  })

  it('l’enregistrement passe par masterUpdateProduct avec le corps complet', () => {
    assert.match(src, /api\.masterUpdateProduct\(editFormId, payload\)/)
    assert.match(
      src,
      /api\.masterUpdateProduct\(editId, \{ photos: paths \}\)/,
      'le panneau photos garde son appel étroit (il ne renvoie pas tout le corps)'
    )
    assert.match(src, /setToast\(t\('masterProductUpdated'\)\)/)
    assert.match(src, /setEditFormId\(null\)/)
  })

  it('un prix vide ou nul est arrêté par le formulaire lui-même', () => {
    // Le champ est `required` + `min=1` : un envoi vide ne part plus, et un 0
    // (qui rendrait la ligne incommandable, cf. B13) est signalé nativement.
    assert.match(src, /id="master-product-price"[^>]*min="1"/)
    assert.match(src, /title=\{t\('masterPriceRequired'\)\}/)
    // Côté serveur, le 400 `price` du PUT garde le même message.
    assert.match(src, /if \(code === 'price'\) setToast\(t\('masterPriceRequired'\)\)/)
  })

  it('les clés i18n de l’édition existent dans les deux langues', () => {
    const keys = [
      'masterEditProduct',
      'masterEditProductActive',
      'masterEditingIntro',
      'masterCancelEdit',
      'masterSaveProduct',
      'masterProductUpdated',
      'masterUpdateFail',
      'masterPriceRequired',
      'masterEditApiOnly'
    ]
    for (const key of keys) {
      for (const lang of ['fr', 'en']) {
        assert.ok(String(dict[lang][key] || '').length > 3, `${key} absent de ${lang}`)
      }
      // `errToast(...)` reçoit la clé en chaîne nue (c'est son message de
      // dernier recours), les autres passent par `t('…')`.
      assert.match(src, new RegExp(`t\\('${key}'\\)|'${key}'`), `${key} est défini mais jamais utilisé`)
    }
    assert.notEqual(dict.fr.masterEditProduct, dict.fr.masterEditPhotos, 'deux actions distinctes, deux libellés distincts')
  })
})
