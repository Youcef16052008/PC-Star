/**
 * Master catalog CRUD + photo upload helpers.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newId } from './db.js'
import { ensureStock, setStock, liveStockOf } from './catalog.js'
import { PRODUCTS } from '../src/data.js'
import { uploadBlob, deleteBlob, MAX_BYTES, MAX_PHOTOS } from './blobStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * LOT 2.6 (F10) — `needs` normalisé en **tableau de chaînes**.
 *
 * Le bug était une asymétrie entre deux chemins d'écriture :
 *  · `createProduct` stockait `needs: String(body.needs || '').trim()` — une
 *    CHAÎNE (comme le fait aussi le client, `src/shopStore.js` : `needs: ''`) ;
 *  · `sanitizeProductPatch` exigeait `Array.isArray(patch.needs)` et renvoyait
 *    `{ ok: false, error: 'needs' }` sinon.
 *
 * Autrement dit : un produit créé par le maître ne pouvait plus être édité sur
 * ce champ — `PUT /api/master/products/:id {"needs": "…"}` répondait **400**, et
 * même `{"needs": ["…"]}` sur un produit stocké en chaîne produisait un objet
 * au type incohérent d'une fiche à l'autre. Le front affiche `product.needs`
 * tel quel (src/ProductPage.jsx) : une chaîne s'affiche, un tableau se
 * concatène sans séparateur — d'où la normalisation ET le rendu corrigé.
 *
 * Chaîne → tableau : découpe sur les retours à la ligne uniquement. Les
 * virgules sont conservées dans le texte (« Alimentation 750W, 20 cm » reste un
 * seul besoin) : les séparer serait une interprétation, pas une normalisation.
 */
/** Borne d'une ligne de `needs` — cf. `short` (200) et `name` (120) ci-dessous. */
export const MAX_NEED_LINE = 160

export function normalizeNeeds(value) {
  if (value == null) return []
  const parts = Array.isArray(value)
    ? value.map((x) => String(x ?? '').trim())
    : String(value).split(/[\r\n]+/).map((x) => x.trim())
  // Bornée comme TOUS les autres champs texte de `sanitizeProductPatch` : sans
  // cette coupe, une ligne de 4 Ko partait en base puis dans la fiche produit,
  // l'export CSV et le message WhatsApp — `needs` était le seul champ texte non
  // borné du patch.
  return parts.filter(Boolean).slice(0, 12).map((x) => x.slice(0, MAX_NEED_LINE))
}

/**
 * LOT 2.6 : migration des produits déjà stockés avec une chaîne. Appelée sur
 * les chemins master qui lisent/écrivent `extraProducts` — la base se
 * normalise au premier accès, sans script de migration dédié.
 */
function migrateNeeds(db) {
  const extras = db?.meta?.extraProducts
  if (!Array.isArray(extras)) return
  for (const p of extras) {
    // Champ absent compris : la forme stockée devient uniforme (`[]` plutôt que
    // `undefined`), ce qui évite au front de tester les deux cas.
    if (p && !Array.isArray(p.needs)) p.needs = normalizeNeeds(p.needs)
  }
}

export function listMasterProducts(db) {
  ensureStock(db)
  migrateNeeds(db)
  const hidden = new Set(db.meta?.hiddenProductIds || [])
  // P8 (P7-1) : la vue master doit refléter les overrides (prix/nom/stock/
  // photos) exactement comme le catalogue public — sinon le master édite des
  // valeurs obsolètes (et le panneau photos écrase les uploads).
  const overrides = db.meta?.productOverrides || {}
  const base = PRODUCTS.map((p) => ({
    ...p,
    ...(overrides[p.id] || {}),
    stock: liveStockOf(db, p.id),
    hidden: hidden.has(p.id),
    source: 'catalog'
  }))
  const extras = (db.meta?.extraProducts || []).map((p) => ({
    ...p,
    stock: liveStockOf(db, p.id),
    hidden: hidden.has(p.id),
    source: 'extra'
  }))
  return [...base, ...extras]
}

/**
 * @param {string} [id] P5 (B12) : id pré-généré — permet de sauver les photos
 * directement sous le vrai id avant la création (plus de fichiers `tmp-*`).
 */
export function createProduct(db, body, id) {
  ensureStock(db)
  if (!db.meta) db.meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] }
  if (!Array.isArray(db.meta.extraProducts)) db.meta.extraProducts = []

  const name = String(body.name || '').trim()
  const price = Math.max(0, Number(body.price) || 0)
  if (!name || price <= 0) return { ok: false, error: 'invalid' }
  if (id && db.meta.extraProducts.some((p) => p.id === id)) return { ok: false, error: 'invalid' }

  const finalId = id || newId('sku')
  const sku = String(body.sku || finalId).trim()
  // P22 (bug H) : le SKU saisi n'était confronté à rien. Un master pouvait
  // créer plusieurs produits portant le SKU d'une référence du catalogue de
  // base — mesuré en direct : trois produits se sont retrouvés avec
  // `100-100000910WOF` (celui de `cpu-7800x3d`). Le SKU est ce qui identifie
  // une référence sur l'étiquette, dans l'export CSV et dans le dossier de
  // photos : un doublon rend la fiche ambiguë. On refuse.
  const taken = new Set(
    [...PRODUCTS, ...db.meta.extraProducts].map((x) => String(x.sku || '').trim()).filter(Boolean)
  )
  if (taken.has(sku)) return { ok: false, error: 'sku_taken' }
  const product = {
    id: finalId,
    sku,
    name,
    brand: String(body.brand || 'PC Star').trim(),
    kind: body.kind || 'part',
    category: String(body.category || 'accessories'),
    price,
    stock: Math.max(0, Math.floor(Number(body.stock) || 0)),
    rating: 0,
    reviews: 0,
    related: [],
    photos: Array.isArray(body.photos) ? body.photos.slice(0, MAX_PHOTOS) : [],
    short: String(body.short || '').trim(),
    // LOT 2.6 (F10) : tableau, comme au patch — plus de produit qu'on ne peut
    // pas éditer sur ce champ.
    needs: normalizeNeeds(body.needs),
    compat: body.compat && typeof body.compat === 'object' ? body.compat : {},
    tags: Array.isArray(body.tags) ? body.tags : []
  }
  db.meta.extraProducts = [product, ...db.meta.extraProducts]
  setStock(db, finalId, product.stock)
  return { ok: true, product }
}

// P16 (#18) : les champs d'un patch produit étaient recopiés TELS QUELS dans
// `meta.productOverrides` (branche catalogue) puis servis dans le catalogue
// PUBLIC : `price: "abc"` donnait « NaN DA » en vitrine et `priceOf` → 0, un
// `name` de 500 caractères cassait les cartes, `photos: "x"` cassait PartThumb.
// Tout passe maintenant par ici.
const CATEGORY_SET = new Set(PRODUCTS.map((p) => p.category).filter(Boolean))

export function sanitizeProductPatch(patch = {}) {
  const out = {}
  if (patch.name != null) {
    const name = String(patch.name).trim()
    if (!name) return { ok: false, error: 'name' }
    if (name.length > 120) return { ok: false, error: 'name_too_long' }
    out.name = name
  }
  if (patch.price != null) {
    const price = Number(patch.price)
    // LOT 1.12 : `price < 0` laissait passer **0**. Or `priceOf`
    // (server/catalog.js) renvoie `Math.max(0, …)` : un produit du catalogue
    // mis à 0 DA par override produisait des commandes à 0 DA, acceptées et
    // recalculées à 0 par le serveur — sans aucun avertissement. Asymétrie
    // vérifiée : `createProduct` exige déjà `price > 0`. Reproduit à l'audit :
    // `PUT /api/master/products/cpu-7600 {"price":0}` → 200, `price: 0`.
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'price' }
    out.price = Math.round(price)
  }
  if (patch.brand != null) out.brand = String(patch.brand).trim().slice(0, 60)
  if (patch.category != null) {
    const category = String(patch.category)
    if (!CATEGORY_SET.has(category)) return { ok: false, error: 'category' }
    out.category = category
  }
  if (patch.short != null) out.short = String(patch.short).slice(0, 200)
  if (patch.sku != null) {
    const sku = String(patch.sku).trim()
    if (sku.length > 40 || !/^[\w .\-/]*$/.test(sku)) return { ok: false, error: 'sku' }
    out.sku = sku
  }
  if (patch.photos != null) {
    if (!Array.isArray(patch.photos)) return { ok: false, error: 'photos' }
    out.photos = patch.photos
      .map((u) => String(u).trim())
      .filter((u) => u.startsWith('/') || /^https?:\/\//.test(u))
      .slice(0, MAX_PHOTOS)
  }
  if (patch.needs != null) {
    // LOT 2.6 (F10) : chaîne OU tableau, normalisé en tableau. Le refus pur et
    // simple d'une chaîne rendait tout produit créé par `createProduct`
    // in-éditable sur ce champ. Un type non convertible (nombre, objet) reste
    // accepté en tant que texte — `String()` — plutôt que refusé : le champ est
    // descriptif, et un 400 ici bloquait l'enregistrement du reste du patch.
    out.needs = normalizeNeeds(patch.needs)
  }
  if (patch.stock != null) {
    const stock = Number(patch.stock)
    if (!Number.isFinite(stock) || stock < 0) return { ok: false, error: 'stock' }
    out.stock = Math.floor(stock)
  }
  if (patch.hidden != null) out.hidden = patch.hidden === true
  return { ok: true, patch: out }
}

export function updateProduct(db, id, rawPatch) {
  ensureStock(db)
  migrateNeeds(db)
  const sane = sanitizeProductPatch(rawPatch || {})
  if (!sane.ok) return { ok: false, error: sane.error }
  const patch = sane.patch
  if (!db.meta) db.meta = {}
  // extra product
  const extras = db.meta.extraProducts || []
  const ei = extras.findIndex((p) => p.id === id)
  if (ei >= 0) {
    const cur = { ...extras[ei] }
    if (patch.name != null) cur.name = String(patch.name).trim()
    if (patch.price != null) cur.price = Math.max(0, Number(patch.price) || 0)
    if (patch.brand != null) cur.brand = String(patch.brand).trim()
    if (patch.category != null) cur.category = String(patch.category)
    if (patch.short != null) cur.short = String(patch.short)
    if (patch.sku != null) cur.sku = String(patch.sku)
    if (patch.photos != null && Array.isArray(patch.photos)) cur.photos = patch.photos.slice(0, MAX_PHOTOS)
    // LOT 2.6 (F10), second volet : `needs` n'était repris que dans la branche
    // « override du catalogue de base » ci-dessous. Pour un produit CRÉÉ par le
    // maître (`extraProducts`), le champ était validé par
    // `sanitizeProductPatch` puis **silencieusement jeté** : la route répondait
    // 200 avec un produit inchangé. Le master croyait avoir enregistré.
    if (patch.needs != null) cur.needs = patch.needs
    if (patch.stock != null) {
      cur.stock = Math.max(0, Math.floor(Number(patch.stock) || 0))
      setStock(db, id, cur.stock)
    }
    if (patch.hidden === true) {
      const set = new Set(db.meta.hiddenProductIds || [])
      set.add(id)
      db.meta.hiddenProductIds = [...set]
    }
    if (patch.hidden === false) {
      db.meta.hiddenProductIds = (db.meta.hiddenProductIds || []).filter((x) => x !== id)
    }
    extras[ei] = cur
    db.meta.extraProducts = extras
    return { ok: true, product: { ...cur, stock: liveStockOf(db, id), source: 'extra' } }
  }
  // catalog override via meta.productOverrides
  if (!db.meta.productOverrides) db.meta.productOverrides = {}
  const base = PRODUCTS.find((p) => p.id === id)
  if (!base) return { ok: false, error: 'not_found' }
  const prev = db.meta.productOverrides[id] || {}
  const next = { ...prev }
  for (const k of ['name', 'price', 'brand', 'category', 'short', 'sku', 'photos', 'needs']) {
    if (patch[k] != null) next[k] = patch[k]
  }
  if (patch.stock != null) {
    setStock(db, id, Math.max(0, Math.floor(Number(patch.stock) || 0)))
  }
  if (patch.hidden === true) {
    const set = new Set(db.meta.hiddenProductIds || [])
    set.add(id)
    db.meta.hiddenProductIds = [...set]
  }
  if (patch.hidden === false) {
    db.meta.hiddenProductIds = (db.meta.hiddenProductIds || []).filter((x) => x !== id)
  }
  // LOT 3.14 (B4) : un override sans aucune clé n'est PAS stocké. Masquer puis
  // réafficher un produit du catalogue laissait `productOverrides[id] = {}` pour
  // toujours — une entrée résiduelle qui gonfle store.json, se recopie dans
  // chaque backup et dans chaque export de meta, et fait croire à un override
  // là où il n'y en a pas. On efface la clé dès qu'elle redevient vide.
  if (Object.keys(next).length === 0) delete db.meta.productOverrides[id]
  else db.meta.productOverrides[id] = next
  const merged = { ...base, ...next, stock: liveStockOf(db, id), source: 'catalog' }
  return { ok: true, product: merged }
}

export function hideProductMaster(db, id, hidden = true) {
  return updateProduct(db, id, { hidden })
}

export async function savePhotoDataUrls(productId, dataUrls = []) {
  const out = []
  let i = 0
  // P18 : l'id produit vient de l'URL décodée — on n'en garde que [A-Za-z0-9_-].
  // C'est la première des deux barrières contre l'écriture hors répertoire
  // (la seconde est `safeUploadName` dans blobStore).
  const safeId = String(productId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'sku'
  try {
  for (const raw of dataUrls.slice(0, MAX_PHOTOS)) {
    i += 1
    const m = String(raw).match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i)
    if (!m) continue
    const mime = m[2].toLowerCase()
    const ext = mime === 'png' ? 'png' : mime === 'webp' ? 'webp' : 'jpg'
    const buf = Buffer.from(m[3], 'base64')
    if (buf.length > MAX_BYTES || buf.length < 32) continue
    const name = `${safeId}-${Date.now().toString(36)}-${i}.${ext}`
    const { url } = await uploadBlob(name, buf, `image/${ext}`)
    out.push(url)
  }
  } catch (err) {
    // P18 : avant, une erreur en cours de boucle laissait les photos déjà
    // envoyées orphelines — la compensation de la route ne voyait jamais
    // `newPaths` puisque la fonction n'était pas revenue.
    for (const u of out) await unlinkUpload(u)
    throw err
  }
  return out
}

/** P5 (B12) : supprime un fichier d'upload à partir de son URL publique ou Blob CDN. */
export async function unlinkUpload(publicPath) {
  await deleteBlob(publicPath)
}

export function ordersToCsv(orders, { day = null } = {}) {
  const rows = [['code', 'status', 'at', 'name', 'phone', 'carrier', 'wilaya', 'slot', 'total', 'items']]
  for (const o of orders || []) {
    if (day) {
      // P9 (P7-4) : la « journée » = o.day (date locale du client, P9) —
      // repli sur la date d'`at` (UTC) pour les anciennes commandes.
      const d = o.day || String(o.at || '').slice(0, 10)
      if (d !== day) continue
    }
    const items = (o.items || []).map((i) => `${i.qty}x ${i.name}`).join(' | ')
    rows.push([
      o.code,
      o.status || 'new',
      o.at || '',
      o.name || '',
      o.phone || '',
      o.carrier || '',
      o.wilaya || '',
      o.slot || '',
      o.total ?? '',
      items
    ])
  }
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
}

/**
 * LOT 1.8 — neutralisation de l'injection de formule.
 *
 * Reproduit à l'audit : une commande dont le `name` valait `=HYPERLINK(…)` ou
 * `+cmd|/C calc` ressortait telle quelle dans `GET /api/orders/export.csv`.
 * Le quoting existant ne protège pas : il entoure la cellule de guillemets mais
 * **conserve le `=` initial**, qu'Excel interprète comme une formule. Le
 * `+cmd|…`, lui, n'était même pas quoté (aucun délimiteur dedans).
 *
 * Tous les champs du CSV sont contrôlés par le client (voir la validation de
 * `placeOrder`, lot 1.9) : un visiteur peut donc déposer une formule qui
 * s'exécutera à l'ouverture du fichier par le maître.
 *
 * Neutralisation : une apostrophe devant toute cellule commençant par `= + - @`
 * (plus tabulation et retour chariot, vecteurs équivalents). C'est la parade
 * habituelle ; elle rend la cellule textuelle dans Excel/LibreOffice/Sheets.
 * Effet de bord assumé : un nom commençant réellement par `-` (par exemple
 * « -1 ») s'affichera avec une apostrophe visible dans certains tableurs —
 * préférable à l'exécution de code.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/

function csvEscape(v) {
  let s = String(v ?? '')
  if (CSV_FORMULA_PREFIX.test(s)) s = `'${s}`
  // P16 : `\r` ajouté — un retour chariot seul sortait de la cellule et
  // décalait toutes les colonnes suivantes dans Excel.
  if (/["\,\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * P9 (P7-7) : borne le répertoire de backups aux `keep` plus récents
 * (les noms `store-<timestamp>` sont triables chronologiquement).
 */
/**
 * BORNE le répertoire de backups à `keep` jeux (P9 / P7-7).
 *
 * `protect` (chemin ou nom) désigne un fichier à ne JAMAIS supprimer : c'est le
 * backup que `backupStore` vient de créer. Sans cette protection, deux backups
 * tombés dans la même seconde pouvaient voir le plus récent supprimé sur-le-champ
 * — le tri est alphabétique, et à horodatage égal c'est le suffixe aléatoire qui
 * décidait de l'« ancienneté ». `backupStore` renvoyait alors un chemin déjà mort.
 */
export function capBackups(backupDir, keep = 14, protect = null) {
  if (!fs.existsSync(backupDir)) return 0
  const protectedName = protect ? path.basename(String(protect)) : null
  const all = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
    .sort()
  let removed = 0
  while (all.length > keep) {
    // le plus ANCIEN non protégé (et non le premier de la liste)
    const idx = protectedName ? all.findIndex((f) => f !== protectedName) : 0
    if (idx < 0) break
    const [f] = all.splice(idx, 1)
    try {
      fs.unlinkSync(path.join(backupDir, f))
      removed += 1
    } catch {
      /* best effort */
    }
  }
  return removed
}

export function backupStore(dbPath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true })
  if (!fs.existsSync(dbPath)) return null
  // LOT 3.15 (B5) : le nom portait la seule seconde courante. Deux backups
  // déclenchés dans la même seconde (timer 6 h + sauvegarde manuelle, ou un
  // appel double depuis deux requêtes) écrivaient le MÊME fichier : le second
  // écrasait le premier sans erreur, et `capBackups` croyait avoir 14 jeux alors
  // qu'il en manquait un.
  //
  // Deux garde-fous désormais :
  //  · l'horodatage descend à la MILLISECONDE (`slice(0, 23)` garde `…-789`,
  //    sans le `Z`) : le tri alphabétique de `capBackups` reste chronologique à
  //    l'échelle où deux backups peuvent vraiment se suivre ; les noms legacy à
  //    la seconde continuent de trier AVANT, donc comme plus anciens ;
  //  · le suffixe aléatoire rend chaque nom unique, et `capBackups` reçoit le
  //    chemin créé en `protect` : le bornage ne peut plus supprimer le backup
  //    qu'on vient de rendre (à milliseconde égale, l'ordre alphabétique des
  //    suffixes ne dit rien de l'âge réel).
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
  const dest = path.join(backupDir, `store-${stamp}-${crypto.randomBytes(3).toString('hex')}.json`)
  fs.copyFileSync(dbPath, dest)
  capBackups(backupDir, 14, dest) // P9 (P7-7) : plus de croissance infinie (timer 6 h + manuels)
  return dest
}
