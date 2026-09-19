/**
 * Métadonnées commerciales et techniques communes au client et à l'API.
 *
 * Elles ne vivent pas dans le composant admin : un produit créé hors ligne et
 * le même produit créé via l'API gardent donc le même format, les mêmes bornes
 * et les mêmes champs visibles sur la fiche publique.
 */
// LOT P2 (B12) — les trois champs qui portaient encore leur borne en DUR dans
// `sanitizeProductPatch` (120 / 60 / 200) et aucune borne du tout à la création.
// Une fiche `POST /api/master/products` avec un nom de 5 000 caractères passait,
// puis le MÊME produit refusait `PUT` avec `name_too_long` : la règle doit vivre
// un seul endroit, sinon le chemin d'entrée décide de la validité.
// `name` se REFUSE (une tronquer changerait l'identité de la fiche), `brand` et
// `short` se TRONQUENT (des champs descriptifs, jamais une clé).
export const NAME_LIMIT = 120
export const BRAND_LIMIT = 60
export const SHORT_LIMIT = 200

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

/**
 * LOT P1 (audit 19/09/2026, B11) — un champ de compatibilité accepte UNE
 * VALEUR, UNE LISTE, ou une chaîne séparée par des virgules.
 *
 * `normalizeProductCompat` ne retenait qu'une chaîne exacte :
 * `normalizeProductCompat({ socket: ['AM5', 'LGA1700'] })` renvoyait `null`,
 * donc `sanitizeProductPatch` répondait `error: 'compat'`. Or le FORMAT TABLEAU
 * est déjà la norme ailleurs dans le projet : les ventirads du catalogue
 * (`src/data.js`) portent `compat.socket` en liste de supports,
 * `socketsMatch()` sait l'interpréter, le configurateur filtre dessus. Le
 * panneau maître refusait donc d'enregistrer une fiche au format qu'il lit
 * partout ailleurs — un ventirad édité perdait ses supports, et un CPU double
 * socket (AM5 **et** LGA1700) restait impossible à saisir.
 */
export function compatValues(value) {
  if (value == null) return []
  const raw = Array.isArray(value) ? value : String(value).split(',')
  const out = []
  for (const item of raw) {
    const token = cleanProductText(item, 16)
    if (token && !out.includes(token)) out.push(token)
  }
  return out
}

/**
 * Normalise un champ en respectant la liste des valeurs connues. Renvoie
 * `{ ok: false }` dès qu'un terme est inconnu (le produit entier est refusé,
 * comme avant), sinon la valeur canonique : une chaîne quand il n'y a qu'un
 * terme — format historique des données et des comparaisons —, sinon un
 * tableau trié dans l'ordre de la liste de référence (stable, donc un
 * enregistrement pour rien ne modifie plus le store).
 */
function normalizeCompatField(value, allowed) {
  const given = compatValues(value)
  if (!given.length) return { ok: true, value: '' }
  const canon = []
  for (const token of given) {
    const known = allowed.find((a) => a.toLowerCase() === token.toLowerCase())
    if (!known) return { ok: false }
    if (!canon.includes(known)) canon.push(known)
  }
  const ordered = allowed.filter((a) => canon.includes(a))
  return { ok: true, value: ordered.length === 1 ? ordered[0] : ordered }
}

/** Rendu lisible d'un champ de compatibilité : « AM5 », « AM4 · AM5 ». */
export function compatLabel(value, separator = ' · ') {
  return compatValues(value).join(separator)
}

/**
 * Deux fiches sont compatibles quand elles déclarent chacune au moins une
 * valeur et que ces valeurs se recoupent. Comme `socketsMatch` (qui ne connaît
 * que les sockets), mais pour n'importe quel champ : mémoire, format…
 * Un côté non déclaré renvoie `false` — le même appelant décide alors s'il faut
 * laisser passer (contrainte absente) ou refuser (produit sans étiquette).
 */
export function compatIntersects(a, b) {
  const left = compatValues(a)
  const right = compatValues(b)
  if (!left.length || !right.length) return false
  return left.some((v) => right.includes(v))
}

/** Compatibilité utilisable par le configurateur, limitée aux valeurs connues. */
export function normalizeProductCompat(value) {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const compat = {}
  const socket = normalizeCompatField(value.socket, COMPAT_SOCKETS)
  const memory = normalizeCompatField(value.memory, COMPAT_MEMORY)
  const form = normalizeCompatField(value.form, COMPAT_FORMS)
  if (!socket.ok || !memory.ok || !form.ok) return null
  if (socket.value) compat.socket = socket.value
  if (memory.value) compat.memory = memory.value
  if (form.value) compat.form = form.value
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
