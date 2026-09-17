/**
 * Catalog stock helpers — base stock from src/data.js + server overrides.
 */
import crypto from 'node:crypto'
import { PRODUCTS } from '../src/data.js'
// P22 (bug G) : table des transitions partagée avec le client.
// LOT 2.2 (F3 + F4) : algorithme du code de commande partagé lui aussi.
import { ORDER_TRANSITIONS, nextOrderCode } from '../src/orderLogic.js'

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'picked', 'cancelled']

// P16 (#20) : borne de l'historique en mémoire, et plafond absolu au-delà
// duquel une nouvelle commande est refusée plutôt que de silently écraser.
export const MAX_ORDERS = 500
export const MAX_ORDERS_HARD = 2000

// Un identifiant de réservation est opaque, aléatoire côté client et borné. On
// ne conserve que son empreinte afin qu'une fuite de store/backup ne donne pas
// de clé de rejeu. UUID v4 ou 192 bits hex produits par le front sont admis.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/

function hashReservationValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function reservationIdentity(userId, idempotencyKey, body) {
  if (!idempotencyKey) return null
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) return { error: 'idempotency' }
  const scope = userId ? `user:${userId}` : 'guest'
  // Inclure le contenu métier dans la signature : réutiliser accidentellement
  // une même clé pour un panier différent renvoie un conflit, jamais l'ancienne
  // commande silencieusement. Les prix client n'en font pas partie (ils sont
  // volontairement recalculés côté serveur).
  const payload = JSON.stringify({
    scope,
    name: String(body.name || '').trim(),
    phone: String(body.phone || ''),
    wilaya: String(body.wilaya || ''),
    slot: String(body.slot || ''),
    items: (Array.isArray(body.items) ? body.items : []).map((item) => ({ id: String(item?.id || ''), qty: item?.qty }))
  })
  return { scope, keyHash: hashReservationValue(idempotencyKey), requestHash: hashReservationValue(payload) }
}

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
    photoMode: p.photoMode,
    short: p.short,
    model: p.model || '',
    barcode: p.barcode || '',
    description: p.description || '',
    condition: p.condition || 'new',
    conditionNote: p.conditionNote || '',
    uses: p.uses || [],
    warrantyMonths: Number(p.warrantyMonths) || 0,
    compareAtPrice: Number(p.compareAtPrice) || 0,
    lowStockAt: Number(p.lowStockAt) || 0,
    details: Array.isArray(p.details) ? p.details : [],
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
 * Référence catalogue canonique pour une ligne de commande : l'identifiant,
 * SKU et nom envoyés par un navigateur ne sont jamais une source de vérité.
 * Les overrides Master s'appliquent aux produits de base, comme dans la vue
 * publique; un produit ajouté porte déjà son propre libellé à jour.
 */
export function productForOrder(db, productId) {
  const id = String(productId || '')
  const extra = (db.meta?.extraProducts || []).find((product) => product?.id === id)
  if (extra) return extra
  const base = PRODUCTS.find((product) => product.id === id)
  if (!base) return null
  return { ...base, ...(db.meta?.productOverrides?.[id] || {}) }
}

/** Prix de référence d'un produit, côté serveur uniquement. */
export function priceOf(db, productId) {
  const product = productForOrder(db, productId)
  return product ? Math.max(0, Number(product.price) || 0) : null
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

  // Idempotence de réservation : une perte de réponse ou un double clic avec
  // la même clé ne peut ni créer une deuxième commande ni décrémenter le stock
  // une deuxième fois. Ce test précède tous les contrôles/effets de bord.
  const reservation = reservationIdentity(userId, String(body.idempotencyKey || ''), body)
  if (reservation?.error) return { ok: false, error: reservation.error }
  if (reservation) {
    const existing = (db.orders || []).find(
      (order) => order?.idempotencyScope === reservation.scope && order?.idempotencyKeyHash === reservation.keyHash
    )
    if (existing) {
      if (existing.idempotencyRequestHash !== reservation.requestHash) return { ok: false, error: 'idempotency_conflict' }
      return { ok: true, order: existing, trimmed: [], idempotent: true }
    }
  }

  // Prix recalculés côté serveur depuis le catalogue (le prix/total envoyé
  // par le client n'est jamais fait confiance).
  //
  // LOT 8.1 (A1) + LOT 8.2 (A2) : deux refus ajoutés ICI, avant tout
  // décrément, donc dans la transaction de la route — l'état persisté ne peut
  // plus contenir ni commande sur produit masqué, ni commande à 0 DA.
  //
  // · A2 — `priceOf` renvoie `null` pour un id que le serveur ne connaît pas
  //   (ni catalogue de base, ni produit maître, ni override). L'ancienne
  //   normalisation écrivait `price: 0` : la commande passait, son total
  //   valait 0 DA et le stock de l'id fantôme était décrémenté. Reproduit à
  //   l'audit (`produit-fantome` → `PS-20260916-0001`, total 0). On refuse la
  //   ligne au lieu de l'offrir.
  // · A1 — `publicCatalog` exclut les produits masqués par le maître
  //   (`hiddenProductIds`), mais `placeOrder` ne les consultait jamais : un
  //   visiteur anonyme pouvait commander un produit retiré de la vente en
  //   visant son id (reproduit en direct → HTTP 201). Le masquage est une
  //   décision du maître, elle doit valoir aussi à la commande.
  const hidden = new Set(Array.isArray(db.meta?.hiddenProductIds) ? db.meta.hiddenProductIds : [])
  // Une commande peut contenir le même SKU plusieurs fois (fusion de panier,
  // double clic, client malveillant). Les quantités doivent être consolidées
  // AVANT le contrôle de stock : vérifier deux fois « reste 1 » puis décrémenter
  // deux lignes donnait deux articles pour une seule unité réservée.
  const byProductId = new Map()
  const unknown = []
  const unavailable = []
  for (const i of items) {
    const id = String(i.id || '')
    const product = productForOrder(db, id)
    const price = product ? Math.max(0, Number(product.price) || 0) : null
    const rawQty = Number(i.qty)
    const qty = Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1
    // Le client ne choisit que l'id et la quantité. Conserver son `name`/`sku`
    // rendait le ticket, le CSV et WhatsApp falsifiables (« RTX 4090 » pour une
    // souris) et incohérents après un renommage Master.
    const line = {
      id,
      sku: String(product?.sku || id),
      name: String(product?.name || id),
      qty,
      price: price == null ? 0 : price
    }
    // Ligne sans id ou id inconnu du serveur : jamais tarifée 0 DA (A2).
    if (!id || price == null) {
      // Ce nom ne sert qu'au message de refus (la ligne ne sera jamais
      // persistée); le garder rend l'erreur compréhensible au client.
      unknown.push({ id, name: String(i?.name || id) })
      continue
    }
    // Produit retiré de la vente par le maître : pas commandable (A1).
    if (hidden.has(id)) {
      unavailable.push({ id, name: line.name })
      continue
    }
    const existing = byProductId.get(id)
    if (existing) {
      existing.qty += line.qty
    } else {
      byProductId.set(id, line)
    }
  }
  const normalized = [...byProductId.values()]
  // Rien n'est décrémenté tant qu'un refus est levé — et une seule ligne
  // douteuse suffit à refuser TOUTE la commande (atomicité déjà exigée par le
  // contrôle de stock ci-dessous).
  if (unknown.length) return { ok: false, error: 'unknown_product', unknown }
  if (unavailable.length) return { ok: false, error: 'unavailable', unavailable }

  const shortages = []
  for (const line of normalized) {
    // LOT 8.2 (A2) : la branche `if (!line.id)` qui poussait une « rupture »
    // pour une ligne sans identifiant est devenue morte — ces lignes sont
    // refusées plus haut (`unknown_product`). Toute ligne ici a un id connu
    // du serveur et donc un prix de référence.
    const left = liveStockOf(db, line.id)
    if (left < line.qty) shortages.push({ id: line.id, name: line.name, need: line.qty, left })
  }
  if (shortages.length) return { ok: false, error: 'stock', shortages }

  const total = normalized.reduce((s, i) => s + i.qty * i.price, 0)

  // La journée d'une commande est une donnée serveur, pas un champ du panier.
  // Un client pouvait auparavant choisir n'importe quel YYYY-MM-DD (2099,
  // historique, ou une journée déjà exportée) et fausser les codes/exports.
  // Le fuseau du magasin est explicite, car Vercel tourne généralement en UTC.
  const day = serverDay()

  const order = {
    code: makeOrderCode(db, day),
    day,
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
  if (reservation) {
    order.idempotencyScope = reservation.scope
    order.idempotencyKeyHash = reservation.keyHash
    order.idempotencyRequestHash = reservation.requestHash
  }
  // AUDIT-2026-09-17 / phase 3 : un numéro simplement déclaré ne prouve pas
  // qu'un compte le contrôle. En l'absence d'un canal OTP/SMS vérifié, les
  // commandes guest restent accessibles sur l'appareil qui les a créées mais
  // ne sont JAMAIS récupérées par correspondance de téléphone sur le serveur.
  // Cela vaut aussi pour les numéros encore « libres » au moment de l'achat.
  if (!userId) order.claimable = false

  // Préparer l'historique AVANT toute écriture de stock. L'ancien code refusait
  // `orders_full` après les décréments : la commande n'était pas enregistrée,
  // mais les pièces restaient indisponibles. `next` reste local tant que la
  // capacité n'est pas validée.
  const next = [order, ...(db.orders || [])]
  const trimmed = []
  while (next.length > MAX_ORDERS) {
    let victim = -1
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].status === 'picked' || next[i].status === 'cancelled') {
        victim = i
        break
      }
    }
    if (victim < 0) break
    trimmed.push(next.splice(victim, 1)[0].code)
  }
  if (next.length > MAX_ORDERS_HARD) return { ok: false, error: 'orders_full' }

  // Commit final : uniquement après validation agrégée du stock ET de la
  // capacité. Sous `updateDbAsync`, stock et commande sont écrits ensemble.
  for (const line of normalized) {
    const left = liveStockOf(db, line.id)
    setStock(db, line.id, left - line.qty)
  }
  db.orders = next
  if (trimmed.length) {
    console.warn(`[pcstar-orders] historique borné à ${MAX_ORDERS} — commandes terminées retirées : ${trimmed.join(', ')}`)
  }
  return { ok: true, order, trimmed }
}

/**
 * Journée opérationnelle du magasin au fuseau d'Oran. `Date#getDate()` suit
 * le fuseau du processus (UTC sur Vercel), donc ne doit pas servir aux codes
 * de commande. PCSTAR_TIME_ZONE permet une installation dans une autre ville,
 * sans accepter qu'un navigateur impose sa date.
 */
export function serverDay(date = new Date(), timeZone = process.env.PCSTAR_TIME_ZONE || 'Africa/Algiers') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    return `${fields.year}-${fields.month}-${fields.day}`
  } catch {
    // Une valeur PCSTAR_TIME_ZONE mal configurée ne rend pas la réservation
    // impossible : le repli reste la date du SERVEUR, jamais body.day.
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}

/**
 * P9 (P7-4) : code PS-YYYYMMDD-NNNN daté à la « journée » de la commande
 * (date opérationnelle du serveur, fuseau du magasin). `dayStr` :
 * 'YYYY-MM-DD' valide.
 *
 * LOT 2.2 (F3 + F4) : la séquence n'est plus `sameDay.length + 1` mais le
 * **max** des séquences du jour + 1, via `nextOrderCode` — la fonction partagée
 * avec le repli hors-ligne du client (`src/orderLogic.js`). Le comptage
 * produisait un doublon dès qu'une commande du jour était supprimée :
 * 0001/0002/0003 créées, 0002 supprimée → la suivante recomptait 2 + 1 = 0003,
 * déjà attribué. Deux `PS-20260915-0003` ont été observés en base à l'audit.
 */
export function makeOrderCode(db, dayStr) {
  return nextOrderCode((db.orders || []).map((o) => o?.code), dayStr)
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

/** Commandes auxquelles une session client a explicitement droit. */
export function ordersForUser(db, userId) {
  if (!userId) return []
  // Le numéro de retrait n'est pas un identifiant d'accès : une ligne guest ne
  // revient donc jamais simplement parce qu'un profil a saisi le même numéro.
  return (db.orders || []).filter((order) => order?.userId === userId)
}

/**
 * Annulation client atomique : propriété et état sont vérifiés dans le même
 * mutateur que `cancelOrder`, qui effectue le restock. À appeler sous
 * updateDb/updateDbAsync, jamais après une prélecture indépendante.
 */
export function cancelOwnOrder(db, code, userId) {
  const current = (db.orders || []).find((order) => order?.code === code)
  if (!current || !userId || current.userId !== userId) return { ok: false, error: 'not_found' }
  if (current.status !== 'new' && current.status !== 'pending') return { ok: false, error: 'status' }
  return cancelOrder(db, code)
}

// P16 (#19) : avant, seul le statut `cancelled` était gardé — on pouvait
// passer une commande `picked` (retirée, stock consommé) en `new` et la
// revendre, ou faire remonter une commande annulée. Les transitions autorisées
// sont explicites.
// P22 (bug G) : la table vit dans src/orderLogic.js et est partagée avec
// `canTransition` côté client — voir le commentaire là-bas.

/**
 * P19 — suppression définitive d'une commande (master uniquement).
 *
 * Distincte de `cancelOrder` : l'annulation garde la trace (historique, CSV,
 * statistiques) alors que la suppression retire la ligne. Le stock est rendu
 * comme pour une annulation, sinon supprimer une commande « new » perdrait
 * définitivement les pièces réservées.
 */
export function deleteOrder(db, code) {
  ensureStock(db)
  const orders = db.orders || []
  const idx = orders.findIndex((o) => o.code === code)
  if (idx < 0) return { ok: false, error: 'not_found' }
  const order = orders[idx]
  // Une commande déjà annulée a déjà rendu son stock — ne pas le rendre deux fois.
  if (order.status !== 'cancelled' && order.status !== 'picked') {
    for (const line of order.items || []) {
      const left = liveStockOf(db, line.id)
      setStock(db, line.id, left + (line.qty || 0))
    }
  }
  orders.splice(idx, 1)
  db.orders = orders
  return { ok: true, code, status: order.status || 'new', restocked: order.status !== 'cancelled' && order.status !== 'picked' }
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
  const from = order.status || 'new'
  const allowed = ORDER_TRANSITIONS[from] || []
  if (!allowed.includes(status)) {
    return { ok: false, error: 'transition', from, to: status }
  }
  order.status = status
  order.updatedAt = new Date().toISOString()
  return { ok: true, order }
}

/** Statuts qui réservent encore du stock (donc à rendre si le compte saute). */
const ACTIVE_ORDER_STATUSES = ['new', 'pending', 'preparing', 'ready']

/**
 * Suppression d'un client : retire l'utilisateur, purge ses sessions
 * (tokens invalidés) et délie ses commandes (nom/télé sont déjà snapshotés
 * dans la commande, userId passe à null — l'historique reste lisible).
 * Renvoie { ok: false } si introuvable ou master.
 *
 * LOT 4.3 (F16) : ses commandes EN COURS sont annulées dans le même mouvement.
 * Avant, `placeOrder` avait décrémenté le stock et la suppression du compte
 * laissait la commande debout, sans propriétaire : des pièces réservées pour
 * personne, invisibles depuis la fiche client (qui n'existe plus) et jamais
 * rendues. `cancelOrder` rend le stock et garde la trace (statut `cancelled`,
 * `cancelledAt`, nom/télé snapshotés) — le comptoir voit toujours ce qui s'est
 * passé. Les commandes `picked` (retirées, stock consommé) et déjà `cancelled`
 * ne bougent pas.
 *
 * Le résumé (`cancelled`, `releasedLines`, `left`) est renvoyé à la route, qui
 * le transmet au master : la suppression d'un compte n'est plus silencieuse.
 */
export function purgeUser(db, id) {
  const target = db.users.find((u) => u.id === id)
  if (!target || target.role === 'master') return { ok: false }
  db.users = db.users.filter((u) => u.id !== id)
  // Les clés sont des empreintes de jeton (durcissement) : la purge d'un compte
  // parcourt les VALEURS, elle est donc indépendante du format de clé.
  for (const [key, s] of Object.entries(db.sessions || {})) {
    if (s && s.userId === id) delete db.sessions[key]
  }
  const cancelled = []
  let releasedLines = 0
  const left = []
  for (const o of db.orders || []) {
    if (!o || o.userId !== id) continue
    const status = o.status || 'new'
    if (ACTIVE_ORDER_STATUSES.includes(status)) {
      const r = cancelOrder(db, o.code)
      if (r.ok) {
        releasedLines += (o.items || []).length
        cancelled.push({ code: o.code, status, items: (o.items || []).length })
      } else {
        // `cancelOrder` ne refuse que `picked` (déjà retirée) : on ne touche
        // alors ni au statut ni au stock, et on le dit au master.
        left.push({ code: o.code, status, reason: r.error || 'cancel_failed' })
      }
    } else {
      left.push({ code: o.code, status })
    }
    o.userId = null
  }
  return { ok: true, cancelled, releasedLines, left }
}

/** Public catalog with live stock + meta hide/extra. */
/**
 * Catalogue public (client) :
 * - produits masqués par le master (hiddenProductIds) exclus ;
 * - produits RUPTURE (stock live = 0) exclus automatiquement — seuls le
 *   comptoir et la vue master (`listMasterProducts`) restent les voir.
 */
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
  return [...base, ...extras].filter((p) => (Number(p.stock) || 0) > 0)
}
