import { specOf } from './data.js'

/**
 * Pure order helpers (shared client tests + local fallback).
 */

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'picked', 'cancelled']

export function makeOrderCode(date = new Date(), seq = 1) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `PS-${y}${m}${day}-${String(seq).padStart(4, '0')}`
}

/** Check cart lines against a stock map { id: qty }. */
export function checkStock(items, stockMap) {
  const shortages = []
  for (const line of items || []) {
    const left = Math.max(0, Number(stockMap[line.id] ?? 0))
    const need = Math.max(1, Math.floor(Number(line.qty) || 1))
    if (left < need) shortages.push({ id: line.id, name: line.name, need, left })
  }
  return { ok: shortages.length === 0, shortages }
}

/** Apply reservation decrement (immutable). */
export function applyStockDecrement(stockMap, items) {
  const next = { ...stockMap }
  for (const line of items || []) {
    const id = line.id
    const need = Math.max(1, Math.floor(Number(line.qty) || 1))
    next[id] = Math.max(0, (Number(next[id]) || 0) - need)
  }
  return next
}

/** Restore stock on cancel (immutable). */
export function applyStockRestore(stockMap, items) {
  const next = { ...stockMap }
  for (const line of items || []) {
    const id = line.id
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    next[id] = Math.max(0, (Number(next[id]) || 0) + qty)
  }
  return next
}

export function canTransition(from, to) {
  if (!ORDER_STATUSES.includes(to)) return false
  if (from === 'cancelled' || from === 'picked') return to === from
  if (to === 'cancelled') return true
  const order = ['new', 'preparing', 'ready', 'picked']
  // allow pending legacy → new path
  const f = from === 'pending' ? 'new' : from
  if (!order.includes(f) || !order.includes(to)) return to === 'cancelled'
  return order.indexOf(to) >= order.indexOf(f)
}

export function statusLabelKey(status) {
  const s = status === 'pending' ? 'new' : status
  return `orderStatus_${s}`
}

/**
 * P14 (#3) — Numéro au format attendu par `wa.me` : international sans « + »
 * et sans le 0 local (`213XXXXXXXXX`).
 *
 * La base stocke le format local `0[567]XXXXXXXX` (`normalizePhone` côté
 * serveur). L'ancienne fonction locale du Desk ne traitait que le cas 9
 * chiffres : **chaque** bouton WhatsApp du comptoir partait donc sur
 * `wa.me/0550123456`, invalide. Partagée ici pour être testée sans DOM.
 *
 * @returns {string} le numéro international, ou `''` si inexploitable
 *   (le Desk n'affiche alors aucun bouton plutôt qu'un lien mort).
 */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = d.slice(3)
  // Format local stocké : 0 + 9 chiffres.
  if (d.length === 10 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 9 && /^[567]/.test(d)) return `213${d}`
  return ''
}

/**
 * P9 (P7-4) : date LOCALE (YYYY-MM-DD) de `date` — unique référence de la
 * « journée » du shop (création de commande + export CSV). Avant : le client
 * envoyait la date UTC (toISOString) → décalage d'une heure par jour en Oran.
 */
export function localDay(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * P8 (P7-2) : classification d'un échec de `api.postOrder`.
 * - 'offline'  : backend injoignable → SEUL cas où le repli local est légitime.
 * - 'stock'    : 409/rupture → message stock, stock actualisé.
 * - 'rate'     : 429 → message d'attente (retryAfter s), panier conservé.
 * - 'server'   : 5xx/autre → message erreur serveur, panier conservé.
 * (un succès est géré avant l'appel — ne pas passer un r.ok.)
 */
export function orderApiFailure(r) {
  if (!r || r.offline) return { kind: 'offline' }
  if (r.status === 409 || r.data?.error === 'stock') {
    return { kind: 'stock', shortages: r.data?.shortages || [] }
  }
  if (r.status === 429) return { kind: 'rate', retryAfter: r.data?.retryAfter || null }
  return { kind: 'server' }
}

/**
 * P8 (P7-2) : prochain code local de commande pour `date` — dérivé du max des
 * codes existants du jour (jamais `length + 1`) : plus de collision quand la
 * liste client ne contient pas toutes les commandes du jour.
 */
export function nextLocalOrderCode(existingCodes = [], date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const re = new RegExp(`^PS-${y}${m}${day}-(\\d+)$`)
  let max = 0
  for (const raw of existingCodes) {
    const mt = re.exec(String(raw || ''))
    if (mt) max = Math.max(max, parseInt(mt[1], 10))
  }
  return makeOrderCode(date, max + 1)
}

/**
 * P8 (P7-3) : état du formulaire de retrait pour un compte donné.
 * - pas de compte (logout/visiteur) : retour aux valeurs vides `defaults`
 *   — les infos du client précédent ne doivent jamais rester pré-remplies ;
 * - avec compte : reprise nom/tél/wilaya du profil (le reste — slot, payment —
 *   est conservé depuis `prev`).
 */
export function pickupForUser(user, prev = {}, defaults = {}) {
  if (!user) return { ...defaults }
  return {
    ...prev,
    name: user.name || prev.name || defaults.name || '',
    phone: user.phone || prev.phone || defaults.phone || '',
    wilaya: user.wilaya || prev.wilaya || defaults.wilaya || 'Oran'
  }
}

/** Builder power recap from picked parts. */
export function buildPowerRecap(parts) {
  const list = (parts || []).filter(Boolean)
  let tdp = 0
  let psuMinGpu = 0
  let psuWatts = 0
  let socket = null
  let memory = null
  let form = null
  for (const p of list) {
    const c = p.compat || {}
    if (c.socket && !Array.isArray(c.socket)) socket = c.socket
    if (c.memory) memory = c.memory
    if (c.form) form = c.form
    if (c.psuMin) psuMinGpu = Math.max(psuMinGpu, c.psuMin)
    if (c.psuWatts) psuWatts = Math.max(psuWatts, c.psuWatts)
    // P17 (rapport #6, mais la cause est autre) : le TDP n'est JAMAIS un champ
    // du produit — il est dérivé par `specOf()` (motifs sur id/nom/SKU).
    // `p.tdp` était donc toujours `undefined` et `c.tdp` jamais posé :
    // l'estimation ignorait complètement le CPU et retombait sur un plancher
    // de 150 W. Mesuré avant correctif : 14700K + Z790 → 150 W
    // (`specOf(cpu-14700k).tdp` vaut pourtant 125, donc ~275 W attendus).
    const explicitTdp = Number(c.tdp)
    if (Number.isFinite(explicitTdp)) {
      tdp += explicitTdp
    } else if (p.category === 'cpu' || p.category === 'gpu') {
      const derived = Number(specOf(p).tdp)
      if (Number.isFinite(derived)) tdp += derived
    }
  }
  const estimate = Math.max(tdp + 150, psuMinGpu || 0)
  return {
    socket,
    memory,
    form,
    estimateWatts: estimate,
    psuWatts,
    psuOk: !psuWatts || psuWatts >= estimate,
    psuMinSuggested: Math.ceil(estimate / 50) * 50
  }
}

/** Star builder presets — ids must exist in catalog. */
export const BUILD_PRESETS = [
  {
    id: 'student',
    titleKey: 'presetStudent',
    bodyKey: 'presetStudentBody',
    slots: {
      // P21 : `cpu-5600` et `mag-ddr4-16` ont été retirés du catalogue avec la
      // section « dz-hit ». Remplacés par des références toujours vendues et
      // strictement compatibles (socket AM4, mémoire DDR4).
      motherboard: 'mb-b450m',
      cpu: 'cpu-5500',
      ram: 'team-ddr4-16',
      ssd: 'ssd-1t',
      psu: 'psu-650-cm',
      case: 'case-atx'
    }
  },
  {
    id: 'gaming1080',
    titleKey: 'presetGaming',
    bodyKey: 'presetGamingBody',
    slots: {
      motherboard: 'mb-b650',
      cpu: 'cpu-7600',
      ram: 'ram-32',
      gpu: 'gpu-4060',
      ssd: 'ssd-1t',
      psu: 'psu-750',
      case: 'case-atx',
      cooler: 'cooler'
    }
  },
  {
    id: 'office',
    titleKey: 'presetOffice',
    bodyKey: 'presetOfficeBody',
    slots: {
      motherboard: 'mb-a520m',
      cpu: 'cpu-5500',
      ram: 'team-ddr4-16', // P21 : `mag-ddr4-16` retiré du catalogue
      ssd: 'ssd-1t',
      psu: 'psu-550-evga',
      case: 'case-atx'
    }
  }
]

export function applyPreset(catalog, preset) {
  const build = {}
  if (!preset?.slots) return build
  for (const [slot, id] of Object.entries(preset.slots)) {
    const p = catalog.find((x) => x.id === id)
    if (p) build[slot] = p
  }
  return build
}

/**
 * P21 — Fusionne une liste de commandes venant du serveur avec l'état local.
 *
 * Le bug : `pull()` envoie `GET /api/orders` à T0 et applique la réponse à T2
 * via `setReservations(next)`, sans condition. Si le maître clique sur
 * « préparer » entre les deux, le `PATCH` aboutit à T1 et met l'état local à
 * jour — puis la réponse du polling, qui a été *produite avant* le PATCH,
 * arrive et remet l'ancien statut. À l'écran le badge revient en arrière, ce
 * qui se lit exactement comme « je clique, rien ne change ».
 *
 * Règle appliquée : une commande modifiée localement après le départ de la
 * requête (`editedAfter`) garde son statut local ; toutes les autres prennent
 * la valeur du serveur, qui reste la source de vérité.
 *
 * @param {Array}  serverOrders  commandes renvoyées par GET /api/orders
 * @param {Array}  localOrders   état local courant
 * @param {number} editedAfter   horodatage du départ de la requête (ms)
 * @param {Map}    editedAt      code → horodatage de la dernière édition locale
 * @returns {Array} liste fusionnée
 */
export function mergeServerOrders(serverOrders, localOrders, editedAfter, editedAt) {
  const server = Array.isArray(serverOrders) ? serverOrders : []
  const local = Array.isArray(localOrders) ? localOrders : []
  if (!editedAt || typeof editedAt.get !== 'function') return server

  const localByCode = new Map(local.map((o) => [o?.code, o]))
  return server.map((o) => {
    const at = editedAt.get(o?.code)
    // Non édité localement, ou édité AVANT le départ de la requête : la réponse
    // du serveur est postérieure au changement, on la prend.
    if (!at || at <= editedAfter) return o
    const mine = localByCode.get(o?.code)
    // Le serveur ne connaît pas encore notre changement : on garde le statut
    // local (et l'objet serveur pour tout le reste).
    return mine ? { ...o, status: mine.status } : o
  })
}
