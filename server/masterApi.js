/**
 * Master catalog CRUD + photo upload helpers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newId } from './db.js'
import { ensureStock, setStock, liveStockOf } from './catalog.js'
import { PRODUCTS } from '../src/data.js'
import { uploadBlob, deleteBlob, MAX_BYTES, MAX_PHOTOS } from './blobStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function listMasterProducts(db) {
  ensureStock(db)
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
  const product = {
    id: finalId,
    sku: String(body.sku || finalId).trim(),
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
    needs: String(body.needs || '').trim(),
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
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: 'price' }
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
    if (!Array.isArray(patch.needs)) return { ok: false, error: 'needs' }
    out.needs = patch.needs.map((x) => String(x)).slice(0, 12)
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
  db.meta.productOverrides[id] = next
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

function csvEscape(v) {
  const s = String(v ?? '')
  // P16 : `\r` ajouté — un retour chariot seul sortait de la cellule et
  // décalait toutes les colonnes suivantes dans Excel.
  if (/["\,\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * P9 (P7-7) : borne le répertoire de backups aux `keep` plus récents
 * (les noms `store-<timestamp>` sont triables chronologiquement).
 */
export function capBackups(backupDir, keep = 14) {
  if (!fs.existsSync(backupDir)) return 0
  const all = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
    .sort()
  let removed = 0
  while (all.length > keep) {
    const f = all.shift()
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(backupDir, `store-${stamp}.json`)
  fs.copyFileSync(dbPath, dest)
  capBackups(backupDir) // P9 (P7-7) : plus de croissance infinie (timer 6 h + manuels)
  return dest
}
