/**
 * Master catalog CRUD + photo upload helpers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newId } from './db.js'
import { ensureStock, setStock, liveStockOf } from './catalog.js'
import { PRODUCTS } from '../src/data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
const UPLOAD_DIR = IS_SERVERLESS
  ? path.join('/tmp', 'pcstar-uploads')
  : path.join(__dirname, '../public/photos/uploads')
const MAX_BYTES = 2.5 * 1024 * 1024
const MAX_PHOTOS = 6
/** Public URL prefix — on serverless uploads are not CDN-stable until Blob is wired. */
export const UPLOAD_PUBLIC_PREFIX = IS_SERVERLESS ? '/api/upload-file' : '/photos/uploads' 

export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

export function listMasterProducts(db) {
  ensureStock(db)
  const hidden = new Set(db.meta?.hiddenProductIds || [])
  const base = PRODUCTS.map((p) => ({
    ...p,
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

export function createProduct(db, body) {
  ensureStock(db)
  if (!db.meta) db.meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] }
  if (!Array.isArray(db.meta.extraProducts)) db.meta.extraProducts = []

  const name = String(body.name || '').trim()
  const price = Math.max(0, Number(body.price) || 0)
  if (!name || price <= 0) return { ok: false, error: 'invalid' }

  const id = newId('sku')
  const product = {
    id,
    sku: String(body.sku || id).trim(),
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
  setStock(db, id, product.stock)
  return { ok: true, product }
}

export function updateProduct(db, id, patch) {
  ensureStock(db)
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

/** Save data URL or raw base64 images to /photos/uploads and return public paths. */
export function savePhotoDataUrls(productId, dataUrls = []) {
  ensureUploadDir()
  const out = []
  let i = 0
  for (const raw of dataUrls.slice(0, MAX_PHOTOS)) {
    i += 1
    const m = String(raw).match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i)
    if (!m) continue
    const ext = m[2].toLowerCase() === 'png' ? 'png' : m[2].toLowerCase() === 'webp' ? 'webp' : 'jpg'
    const buf = Buffer.from(m[3], 'base64')
    if (buf.length > MAX_BYTES || buf.length < 32) continue
    const name = `${productId}-${Date.now().toString(36)}-${i}.${ext}`
    const file = path.join(UPLOAD_DIR, name)
    fs.writeFileSync(file, buf)
    out.push(IS_SERVERLESS ? `/api/upload-file?name=${encodeURIComponent(name)}` : `/photos/uploads/${name}`)
  }
  return out
}

export function ordersToCsv(orders, { day = null } = {}) {
  const rows = [['code', 'status', 'at', 'name', 'phone', 'carrier', 'wilaya', 'slot', 'total', 'items']]
  for (const o of orders || []) {
    if (day) {
      const d = String(o.at || '').slice(0, 10)
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
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function backupStore(dbPath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true })
  if (!fs.existsSync(dbPath)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(backupDir, `store-${stamp}.json`)
  fs.copyFileSync(dbPath, dest)
  return dest
}
