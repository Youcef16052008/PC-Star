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
    if (p.category === 'cpu' && p.tdp) tdp += p.tdp
    else if (typeof c.tdp === 'number') tdp += c.tdp
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
      motherboard: 'mb-b450m',
      cpu: 'cpu-5600',
      ram: 'mag-ddr4-16',
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
      ram: 'mag-ddr4-16',
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
