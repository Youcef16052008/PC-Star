/**
 * Métadonnées commerciales et techniques communes au client et à l'API.
 *
 * Elles ne vivent pas dans le composant admin : un produit créé hors ligne et
 * le même produit créé via l'API gardent donc le même format, les mêmes bornes
 * et les mêmes champs visibles sur la fiche publique.
 */
export const DETAIL_LIMIT = 12
export const DETAIL_LABEL_LIMIT = 48
export const DETAIL_VALUE_LIMIT = 160
export const DESCRIPTION_LIMIT = 2000
export const CONDITION_NOTE_LIMIT = 500
export const MODEL_LIMIT = 80
export const BARCODE_LIMIT = 48
export const TAG_LIMIT = 16
export const TAG_TEXT_LIMIT = 32
export const COMPAT_SOCKETS = ['AM4', 'AM5', 'LGA1700', 'LGA1851']
export const COMPAT_MEMORY = ['DDR3', 'DDR4', 'DDR5']
export const COMPAT_FORMS = ['ATX', 'mATX', 'Mini-ITX']

export function cleanProductText(value, limit) {
  return String(value ?? '').trim().slice(0, limit)
}

/** Une liste libre mais propre : sans doublon, sans tags vides ou démesurés. */
export function normalizeProductTags(value) {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const tags = []
  for (const raw of value) {
    const tag = cleanProductText(raw, TAG_TEXT_LIMIT)
    if (!tag) continue
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= TAG_LIMIT) break
  }
  return tags
}

/** Détails lisibles par le client : « Écran — 15,6 pouces FHD », etc. */
export function normalizeProductDetails(value) {
  if (value == null) return []
  if (!Array.isArray(value)) return null
  const details = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const label = cleanProductText(raw.label, DETAIL_LABEL_LIMIT)
    const detailValue = cleanProductText(raw.value, DETAIL_VALUE_LIMIT)
    // Une ligne vide du formulaire est ignorée. Une demi-ligne ne devient pas
    // une spécification incomplète dans la fiche produit.
    if (!label || !detailValue) continue
    details.push({ label, value: detailValue })
    if (details.length >= DETAIL_LIMIT) break
  }
  return details
}

/** Compatibilité utilisable par le configurateur, limitée aux valeurs connues. */
export function normalizeProductCompat(value) {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const compat = {}
  const socket = cleanProductText(value.socket, 16)
  const memory = cleanProductText(value.memory, 16)
  const form = cleanProductText(value.form, 16)
  if (socket) {
    if (!COMPAT_SOCKETS.includes(socket)) return null
    compat.socket = socket
  }
  if (memory) {
    if (!COMPAT_MEMORY.includes(memory)) return null
    compat.memory = memory
  }
  if (form) {
    if (!COMPAT_FORMS.includes(form)) return null
    compat.form = form
  }
  for (const key of ['psuWatts', 'psuMin']) {
    if (value[key] == null || value[key] === '') continue
    const watts = Number(value[key])
    if (!Number.isFinite(watts) || watts < 100 || watts > 2500) return null
    compat[key] = Math.floor(watts)
  }
  return compat
}

export function isValidBarcode(value) {
  const barcode = cleanProductText(value, BARCODE_LIMIT)
  return !barcode || /^[A-Za-z0-9-]{4,48}$/.test(barcode)
}

export function hasSale(product) {
  const price = Number(product?.price)
  const compareAtPrice = Number(product?.compareAtPrice)
  return Number.isFinite(price) && Number.isFinite(compareAtPrice) && compareAtPrice > price && price > 0
}

export function discountPercent(product) {
  if (!hasSale(product)) return 0
  return Math.round(((Number(product.compareAtPrice) - Number(product.price)) / Number(product.compareAtPrice)) * 100)
}
