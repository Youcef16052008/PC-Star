/**
 * Catalog stock helpers — base stock from src/data.js + server overrides.
 */
import { PRODUCTS } from '../src/data.js'

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'picked', 'cancelled']

export function baseCatalog() {
  return PRODUCTS.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    stock: Number(p.stock) || 0,
    photos: p.photos || [],
    short: p.short,
    compat: p.compat || {},
    tags: p.tags || []
  }))
}

export function ensureStock(db) {
  if (!db.stock || typeof db.stock !== 'object') db.stock = {}
  return db
}

/** Live stock for a product id (base + override, never below 0). */
export function liveStockOf(db, productId) {
  ensureStock(db)
  const base = PRODUCTS.find((p) => p.id === productId)
  const baseStock = base ? Number(base.stock) || 0 : 0
  if (Object.prototype.hasOwnProperty.call(db.stock, productId)) {
    return Math.max(0, Number(db.stock[productId]) || 0)
  }
  return Math.max(0, baseStock)
}

export function setStock(db, productId, qty) {
  ensureStock(db)
  db.stock[productId] = Math.max(0, Math.floor(Number(qty) || 0))
}

/**
 * Prix de référence d'un produit, côté serveur uniquement :
 * override master (productOverrides) > produit master (extraProducts) > catalogue de base.
 * Retourne null si l'id est inconnu.
 */
export function priceOf(db, productId) {
  const ov = db.meta?.productOverrides?.[productId]
  if (ov && ov.price != null) return Math.max(0, Number(ov.price) || 0)
  const extra = (db.meta?.extraProducts || []).find((p) => p.id === productId)
  if (extra) return Math.max(0, Number(extra.price) || 0)
  const base = PRODUCTS.find((p) => p.id === productId)
  if (base) return Math.max(0, Number(base.price) || 0)
  return null
}

/**
 * Try to reserve items atomically. Returns { ok, order?, error?, shortages? }.
 * Decrements stock only when every line is available.
 */
export function placeOrder(db, body, { userId = null } = {}) {
  ensureStock(db)
  if (!db.orders) db.orders = []

  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) return { ok: false, error: 'order' }

  // Prix recalculés côté serveur depuis le catalogue (le prix/total envoyé
  // par le client n'est jamais fait confiance).
  const normalized = items.map((i) => {
    const id = String(i.id || '')
    const price = priceOf(db, id)
    return {
      id,
      sku: String(i.sku || ''),
      name: String(i.name || ''),
      qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
      price: price == null ? 0 : price
    }
  })

  const shortages = []
  for (const line of normalized) {
    if (!line.id) {
      shortages.push({ id: line.id, need: line.qty, left: 0 })
      continue
    }
    const left = liveStockOf(db, line.id)
    if (left < line.qty) shortages.push({ id: line.id, name: line.name, need: line.qty, left })
  }
  if (shortages.length) return { ok: false, error: 'stock', shortages }

  // Commit stock
  for (const line of normalized) {
    const left = liveStockOf(db, line.id)
    setStock(db, line.id, left - line.qty)
  }

  const total = normalized.reduce((s, i) => s + i.qty * i.price, 0)

  const order = {
    code: makeOrderCode(db),
    name: String(body.name || '').trim(),
    phone: String(body.phone || ''),
    carrier: body.carrier || null,
    wilaya: body.wilaya || 'Oran',
    payment: 'cash',
    slot: body.slot || '',
    items: normalized,
    total,
    userId: userId || null,
    at: new Date().toISOString(),
    status: 'new'
  }
  db.orders = [order, ...db.orders].slice(0, 500)
  return { ok: true, order }
}

export function makeOrderCode(db) {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const prefix = `PS-${y}${m}${day}-`
  const sameDay = (db.orders || []).filter((o) => String(o.code || '').startsWith(prefix)).length
  const seq = String(sameDay + 1).padStart(4, '0')
  return `${prefix}${seq}`
}

/** Restore stock when cancelling a reserved order. */
export function cancelOrder(db, code) {
  ensureStock(db)
  const order = (db.orders || []).find((o) => o.code === code)
  if (!order) return { ok: false, error: 'not_found' }
  if (order.status === 'cancelled') return { ok: true, order }
  if (order.status === 'picked') return { ok: false, error: 'picked' }

  if (order.status === 'new' || order.status === 'preparing' || order.status === 'ready' || order.status === 'pending') {
    for (const line of order.items || []) {
      const left = liveStockOf(db, line.id)
      setStock(db, line.id, left + (line.qty || 0))
    }
  }
  order.status = 'cancelled'
  order.cancelledAt = new Date().toISOString()
  return { ok: true, order }
}

export function setOrderStatus(db, code, status) {
  if (!ORDER_STATUSES.includes(status)) return { ok: false, error: 'status' }
  const order = (db.orders || []).find((o) => o.code === code)
  if (!order) return { ok: false, error: 'not_found' }

  if (status === 'cancelled' && order.status !== 'cancelled') {
    return cancelOrder(db, code)
  }
  // Re-cancel guard
  if (order.status === 'cancelled' && status !== 'cancelled') {
    return { ok: false, error: 'cancelled' }
  }
  order.status = status
  order.updatedAt = new Date().toISOString()
  return { ok: true, order }
}

/**
 * Suppression d'un client : retire l'utilisateur, purge ses sessions
 * (tokens invalidés) et délie ses commandes (nom/télé sont déjà snapshotés
 * dans la commande, userId passe à null — l'historique reste lisible).
 * Renvoie { ok: false } si introuvable ou master.
 */
export function purgeUser(db, id) {
  const target = db.users.find((u) => u.id === id)
  if (!target || target.role === 'master') return { ok: false }
  db.users = db.users.filter((u) => u.id !== id)
  for (const [token, s] of Object.entries(db.sessions || {})) {
    if (s && s.userId === id) delete db.sessions[token]
  }
  for (const o of db.orders || []) {
    if (o.userId === id) o.userId = null
  }
  return { ok: true }
}

/** Public catalog with live stock + meta hide/extra. */
export function publicCatalog(db) {
  ensureStock(db)
  const hidden = new Set(db.meta?.hiddenProductIds || [])
  const overrides = db.meta?.productOverrides || {}
  const base = PRODUCTS.filter((p) => !hidden.has(p.id)).map((p) => {
    const o = overrides[p.id] || {}
    return {
      ...p,
      ...o,
      stock: liveStockOf(db, p.id)
    }
  })
  const extras = (db.meta?.extraProducts || [])
    .filter((p) => !hidden.has(p.id))
    .map((p) => ({
      ...p,
      stock: liveStockOf(db, p.id)
    }))
  return [...base, ...extras]
}
