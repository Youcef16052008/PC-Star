import { specOf } from './data.js'

/** Spec rows for PDP table (i18n keys via labelKey). */
export function specRows(product, t) {
  if (!product) return []
  const s = specOf(product)
  const rows = []
  const push = (label, value) => {
    if (value == null || value === '' || value === false) return
    rows.push({ label, value: String(value) })
  }
  push(t('specBrand'), product.brand)
  push(t('specSku'), product.sku)
  push(t('specCategory'), t(`cat_${product.category}`) !== `cat_${product.category}` ? t(`cat_${product.category}`) : product.category)
  if (s.socket) push(t('specSocket'), Array.isArray(s.socket) ? s.socket.join(' / ') : s.socket)
  if (s.memory) push(t('specMemory'), s.memory)
  if (s.form) push(t('specForm'), s.form)
  if (s.tdp) push(t('specTdp'), `${s.tdp} W`)
  if (s.vrm) push(t('specVrm'), `${s.vrm} W`)
  if (s.psuWatts) push(t('specPsu'), `${s.psuWatts} W`)
  if (s.psuMin) push(t('specPsuMin'), `≥ ${s.psuMin} W`)
  if (s.cool) push(t('specCool'), `${s.cool} W`)
  if (s.pcie) push('PCIe', `x${s.pcie}`)
  if (s.slots) push(t('specSlots'), String(s.slots))
  if (product.tags?.length) push(t('specTags'), product.tags.join(', '))
  return rows
}

/**
 * Related products: prefer declared related, then same socket/memory/category in stock.
 */
export function relatedProducts(product, catalog, limit = 4) {
  if (!product) return []
  const byId = new Map((catalog || []).map((p) => [p.id, p]))
  const out = []
  const seen = new Set([product.id])
  for (const id of product.related || []) {
    const p = byId.get(id)
    if (p && !seen.has(p.id)) {
      out.push(p)
      seen.add(p.id)
    }
  }
  const c = product.compat || {}
  const score = (p) => {
    let s = 0
    const pc = p.compat || {}
    if (c.socket && pc.socket === c.socket) s += 5
    if (c.memory && pc.memory === c.memory) s += 4
    if (c.form && pc.form === c.form) s += 2
    if (p.category === product.category) s += 1
    if ((p.stock || 0) > 0) s += 2
    if ((p.tags || []).includes('dz-hit')) s += 1
    return s
  }
  const rest = (catalog || [])
    .filter((p) => !seen.has(p.id))
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  for (const { p } of rest) {
    if (out.length >= limit) break
    out.push(p)
    seen.add(p.id)
  }
  return out.slice(0, limit)
}

/** Skeleton placeholder class helper */
export function photoSkeletonClass(loading) {
  return loading ? 'photo-skeleton' : ''
}
