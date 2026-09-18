/**
 * LOT 1.1 — plus AUCUN compte maître côté client.
 *
 * Cet export contenait auparavant l'e-mail et le mot de passe du compte maître
 * EN CLAIR : Vite les incluait dans le bundle JS public, et ces valeurs
 * ouvraient une vraie session `role: 'master'` sur l'API (reproduit à
 * l'époque : `POST /api/auth/login` -> 200 + token).
 *
 * Le compte maître est désormais défini côté serveur uniquement, depuis
 * `MASTER_EMAIL` / `MASTER_PASSWORD` (voir `masterAccount()` dans
 * `server/db.js`). Les anciennes valeurs sont considérées comme compromises :
 * elles doivent être changées, pas seulement retirées du code.
 *
 * Ce commentaire ne répète volontairement aucune des valeurs exposées — elles
 * resteraient lisibles dans les sources, donc dans le dépôt.
 *
 * Conséquence assumée : le mode 100 % local (aucune API) n'a plus de comptoir —
 * les pages Desk/Master exigent une session maître, qui ne peut venir que du
 * serveur. C'est cohérent avec leur conception (elles étaient déjà vides en
 * l'absence d'API).
 */

const KEY_USERS = 'pcstar-users'
const KEY_META = 'pcstar-catalog'
const KEY_SESSION = 'pcstar-session'
const KEY_SAVED_SEARCHES = 'pcstar-saved-searches'
const MAX_SAVED_SEARCHES = 10

// LOT 3.1 (F7 + F8) : accès au stockage qui ne lève jamais + repli mémoire.
// `loadUsers` / `loadSession` / `loadMeta` étaient appelés dans les
// initializers de `useState` d'`App.jsx` : avec un `localStorage` bloqué
// (cookies tiers refusés, navigation privée, quota dépassé), ils levaient un
// `SecurityError` pendant le rendu.
import { asSafeStorage, safeStorage } from './safeStorage.js'

export function hashPass(password) {
  let h = 2166136261
  const s = String(password || '')
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `h${(h >>> 0).toString(16)}`
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

/**
 * P22 (bug A) : le préfixe de sortie international `00` n'était pas retiré.
 * `00 213 550 123 456` — la façon la plus courante de dicter un numéro
 * algérien à l'international — restait `00213550123456` et était refusé par
 * `isDzPhone`, alors que `+213 550 123 456` passait. Le client voyait
 * « numéro invalide » pour un numéro correct. Un mobile algérien ne commence
 * jamais par `00` (05/06/07), retirer ce préfixe est donc sans risque.
 */
// LOT 6.2 (Q2) : la règle vit dans `src/phoneLogic.js`, partagée avec le
// serveur. Ré-exportée ici : `App.jsx`, `AuthPanel.jsx`, `ProfilePage.jsx` et
// les tests l'importent depuis `shopStore.js` depuis toujours.
//
// Import PUIS export, et non `export ... from` : la forme `export { x } from
// './y'` ne crée AUCUNE liaison locale — `registerEmail()` (plus bas) appelle
// `normalizePhone` et tombait en `ReferenceError` dès qu'un compte e-mail était
// créé. Le module a donc besoin des deux lignes.
import { normalizePhone, isDzPhone, phoneCarrier } from './phoneLogic.js'
export { normalizePhone, isDzPhone, phoneCarrier }

// LOT 8.10 (A10) : les valeurs autorisées pour `category` / `kind` et la règle
// de dérivation du `kind` viennent de `data.js` — les mêmes que le serveur
// (`server/masterApi.js`). Le mode local appliquait déjà la règle de dérivation
// (une ternaire inline) mais ne validait PAS la catégorie : hors ligne, un
// produit `category: "SSD"` était enregistré et disparaissait de tous les
// filtres, exactement comme avant le correctif côté API.
import { isKnownCategory, isKnownCondition, isKnownUse, kindForCategory } from './data.js'
import {
  BARCODE_LIMIT,
  CONDITION_NOTE_LIMIT,
  DESCRIPTION_LIMIT,
  MODEL_LIMIT,
  cleanProductText,
  isValidBarcode,
  normalizeProductCompat,
  normalizeProductDetails,
  normalizeProductTags
} from './productMeta.js'

export function createMemoryStorage(seed = {}) {
  const map = { ...seed }
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
    },
    setItem(key, value) {
      map[key] = String(value)
    },
    removeItem(key) {
      delete map[key]
    }
  }
}

function nowId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function emptyMeta() {
  return {
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: [],
    photoOverrides: {}
  }
}

/**
 * LOT 1.19 — le mot de passe des comptes de démonstration **en mode local**.
 *
 * Les trois comptes ci-dessous portaient chacun un mot de passe en clair — ce
 * commentaire ne répète volontairement aucune des trois valeurs, comme en tête
 * de fichier pour le compte maître : elles sont embarquées dans le bundle public
 * par Vite, et surtout elles étaient **identiques aux empreintes seedées côté
 * serveur**, donc valables sur l'API déployée. Depuis ce lot, le serveur ne seed plus aucune
 * valeur publiée : il suit `DEMO_PASSWORD` et verrouille les comptes si la
 * variable est absente (`server/db.js`, `demoAccounts()`).
 *
 * Ce qui reste ici ne concerne **que le mode local** : un bac à sable dans ce
 * navigateur, sans serveur, sans sauvegarde, avec un hachage FNV-1a assumé comme
 * faible (encart `demoModeNote` de `AuthPanel`). Une valeur unique, explicite,
 * documentée — et qui n'ouvre rien d'autre que ce bac à sable.
 *
 * ⚠️ À ne jamais choisir comme `DEMO_PASSWORD` côté serveur : cette chaîne est
 * dans le bundle public.
 */
export const DEMO_LOCAL_PASSWORD = 'demo-local'

export const DEMO_CUSTOMERS = [
  {
    id: 'demo-karim',
    role: 'customer',
    email: 'karim.oran@demo.dz',
    name: 'Karim B.',
    phone: '0550123456',
    avatar: 'chip',
    accent: 'blue',
    provider: 'email',
    demo: true
  },
  {
    id: 'demo-amina',
    role: 'customer',
    email: 'amina.castors@demo.dz',
    name: 'Amina K.',
    phone: '0669174617',
    avatar: 'card',
    accent: 'gold',
    provider: 'email',
    demo: true
  },
  {
    id: 'demo-yacine',
    role: 'customer',
    email: 'yacine.pc@demo.dz',
    name: 'Yacine M.',
    phone: '0770650388',
    avatar: 'pad',
    accent: 'red',
    provider: 'email',
    demo: true
  }
]

function demoUser(seed) {
  // LOT 1.19 : plus de mot de passe par compte — une seule valeur locale,
  // partagée par les trois fixtures (voir `DEMO_LOCAL_PASSWORD`).
  return { ...seed, password: hashPass(DEMO_LOCAL_PASSWORD) }
}

export function loadUsers(storage = safeStorage) {
  const raw = asSafeStorage(storage).getItem(KEY_USERS)
  let list = []
  if (raw) {
    try {
      list = JSON.parse(raw)
      if (!Array.isArray(list)) list = []
    } catch {
      list = []
    }
  }
  let changed = false
  // LOT 1.1 : le maître n'est plus seedé en local (voir le commentaire en tête
  // de fichier). Un `master` déjà présent dans un `localStorage` antérieur est
  // conservé tel quel — il ne donne accès à rien que le mode local.
  DEMO_CUSTOMERS.forEach((d) => {
    if (!list.some((u) => u.id === d.id || (d.email && u.email === d.email))) {
      list = [...list, demoUser(d)]
      changed = true
    }
  })
  if (changed) saveUsers(storage, list)
  return list
}

// `phoneCarrier` : ré-exporté plus haut (LOT 6.2 / Q2).

export function saveUsers(storage = safeStorage, users) {
  asSafeStorage(storage).setItem(KEY_USERS, JSON.stringify(users))
}

/** P10 (P7-14) : recherches sauvées persistées (bornées à 10). */
export function loadSavedSearches(storage = safeStorage) {
  try {
    const raw = asSafeStorage(storage).getItem(KEY_SAVED_SEARCHES)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.slice(0, MAX_SAVED_SEARCHES) : []
  } catch {
    return []
  }
}

export function saveSavedSearches(storage = safeStorage, list = []) {
  // P15 (#5) : `null` explicite (c'était l'appel de SearchPage) écrasait le
  // paramètre par défaut → AUCUNE persistance, toute la feature P7-14 était
  // inopérante. On retombe sur localStorage quand aucun storage n'est fourni.
  // `asSafeStorage` couvre le quota et le stockage bloqué : les recherches sauvées
  // restent en mémoire pour la page, sans `try/catch` local.
  asSafeStorage(storage).setItem(KEY_SAVED_SEARCHES, JSON.stringify((list || []).slice(0, MAX_SAVED_SEARCHES)))
}

export function loadSession(storage = safeStorage) {
  const raw = asSafeStorage(storage).getItem(KEY_SESSION)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSession(storage = safeStorage, session) {
  const st = asSafeStorage(storage)
  if (!session) st.removeItem(KEY_SESSION)
  else st.setItem(KEY_SESSION, JSON.stringify(session))
}

export function loadMeta(storage = safeStorage) {
  const raw = asSafeStorage(storage).getItem(KEY_META)
  if (!raw) return emptyMeta()
  try {
    const parsed = JSON.parse(raw)
    return { ...emptyMeta(), ...parsed }
  } catch {
    return emptyMeta()
  }
}

export function saveMeta(storage = safeStorage, meta) {
  asSafeStorage(storage).setItem(KEY_META, JSON.stringify(meta))
}

export function registerEmail(users, { email, password, name, phone } = {}) {
  const mail = String(email || '').trim().toLowerCase()
  if (!isEmail(mail)) return { ok: false, error: 'email' }
  if (String(password || '').length < 6) return { ok: false, error: 'password' }
  if (users.some((u) => u.email === mail)) return { ok: false, error: 'exists' }
  const user = {
    id: nowId('u'),
    role: 'customer',
    email: mail,
    password: hashPass(password),
    name: String(name || mail.split('@')[0]).trim() || 'Customer',
    phone: phone ? normalizePhone(phone) : '',
    avatar: 'chip',
    accent: 'green',
    provider: 'email'
  }
  return { ok: true, user, users: [...users, user] }
}

export function loginEmail(users, { email, password } = {}) {
  const mail = String(email || '').trim().toLowerCase()
  const user = users.find((u) => u.email === mail)
  if (!user || user.password !== hashPass(password)) return { ok: false, error: 'auth' }
  return { ok: true, user }
}

export function updateUser(users, id, patch) {
  const idx = users.findIndex((u) => u.id === id)
  if (idx < 0) return { ok: false, error: 'missing' }
  const allowed = {}
  if (patch.name != null) allowed.name = String(patch.name).trim() || users[idx].name
  if (patch.phone != null) {
    const p = String(patch.phone).trim()
    allowed.phone = p ? normalizePhone(p) : ''
  }
  // P16 : longueur bornée — une « wilaya » de 100 000 caractères partait en
  // base et ressortait dans chaque export CSV du comptoir.
  if (patch.wilaya != null) allowed.wilaya = String(patch.wilaya).trim().slice(0, 40) || users[idx].wilaya || 'Oran'

  const user = { ...users[idx], ...allowed }
  const next = users.slice()
  next[idx] = user
  return { ok: true, user, users: next }
}

export function deleteCustomer(users, actor, id) {
  if (!actor || actor.role !== 'master') return { ok: false, error: 'forbidden' }
  const target = users.find((u) => u.id === id)
  if (!target) return { ok: false, error: 'missing' }
  if (target.role === 'master' || target.id === actor.id) return { ok: false, error: 'master' }
  return { ok: true, users: users.filter((u) => u.id !== id) }
}

export function hideProduct(meta, id) {
  const hidden = new Set(meta.hiddenProductIds || [])
  hidden.add(id)
  return {
    ...meta,
    extraProducts: (meta.extraProducts || []).filter((p) => p.id !== id),
    hiddenProductIds: [...hidden]
  }
}

function cleanPhotos(list) {
  const out = []
  for (const raw of list || []) {
    const s = String(raw || '').trim()
    if (!s) continue
    if (s.startsWith('data:image/') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) {
      out.push(s)
    }
  }
  return out.slice(0, 12)
}

/**
 * P17 (rapport #2) : slug SKU — 8 premiers caractères utiles du nom. Retourne
 * toujours une chaîne non vide (suffixe horodaté si le nom n'a que des
 * caractères invisibles).
 */
/**
 * P22 (bug B) : `skuSlug` ne garde que 8 caractères utiles, donc deux produits
 * dont le nom partage ce préfixe produisaient le même SKU — mesuré : trois
 * « Samsung SSD 870 / 980 / 860 » donnaient tous `PS-SAMSUNGS`. On suffixe
 * numériquement tant que le SKU existe déjà parmi les produits du master.
 */
function uniqueSku(base, existing) {
  const taken = new Set((existing || []).map((p) => String(p.sku || '')).filter(Boolean))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

function skuSlug(title) {
  const s = String(title || '')
    .slice(0, 12)
    .toUpperCase()
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]+/g, '')
    .slice(0, 8)
  return s || Date.now().toString(36).toUpperCase().slice(-6)
}

/**
 * @param {Array} knownSkus P22 (bug H) : SKU déjà pris ailleurs que dans
 *   `meta.extraProducts` — en pratique ceux du catalogue de base. Sans cette
 *   liste, un SKU saisi à la main pouvait doubler une référence existante
 *   (le serveur refuse désormais aussi, voir server/masterApi.js).
 */
export function addProduct(meta, { name, price, category, brand, stock, short, photos, sku, condition, uses, warrantyMonths, model, barcode, description, conditionNote, compareAtPrice, lowStockAt, details, tags, compat } = {}, knownSkus = []) {
  const title = String(name || '').trim()
  const n = Number(price)
  if (!title || !Number.isFinite(n) || n < 0) return { ok: false, error: 'product' }
  // Absent → repli `accessories` ; présent mais hors liste (chaîne vide
  // comprise) → refus, comme à l'API : la même règle des deux côtés.
  const cat = category == null ? 'accessories' : String(category)
  // LOT 8.10 (A10) : même refus qu'à l'API — `category` doit être un id de
  // `CATEGORIES` (hors `all`). Sans cela, le mode local enregistrait un produit
  // invisible dans tous les filtres de la vitrine et dans le Builder.
  if (!isKnownCategory(cat)) return { ok: false, error: 'category' }
  const productCondition = condition == null ? 'new' : String(condition)
  if (!isKnownCondition(productCondition)) return { ok: false, error: 'condition' }
  const productUses = uses == null ? [] : Array.isArray(uses) ? [...new Set(uses.map((use) => String(use)))] : null
  if (!productUses || productUses.length > 6 || productUses.some((use) => !isKnownUse(use))) return { ok: false, error: 'uses' }
  const months = warrantyMonths == null ? 0 : Number(warrantyMonths)
  if (!Number.isFinite(months) || months < 0 || months > 60) return { ok: false, error: 'warranty' }
  const productModel = cleanProductText(model, MODEL_LIMIT)
  const productBarcode = cleanProductText(barcode, BARCODE_LIMIT)
  if (!isValidBarcode(productBarcode)) return { ok: false, error: 'barcode' }
  const productDescription = cleanProductText(description, DESCRIPTION_LIMIT)
  const productConditionNote = cleanProductText(conditionNote, CONDITION_NOTE_LIMIT)
  const productCompareAtPrice = compareAtPrice == null || compareAtPrice === '' ? 0 : Number(compareAtPrice)
  if (!Number.isFinite(productCompareAtPrice) || productCompareAtPrice < 0 || (productCompareAtPrice > 0 && productCompareAtPrice < n)) return { ok: false, error: 'compare_at_price' }
  const productLowStockAt = lowStockAt == null || lowStockAt === '' ? 0 : Number(lowStockAt)
  if (!Number.isFinite(productLowStockAt) || productLowStockAt < 0 || productLowStockAt > 9999) return { ok: false, error: 'low_stock' }
  const productDetails = normalizeProductDetails(details)
  if (productDetails == null) return { ok: false, error: 'details' }
  const productTags = normalizeProductTags(tags)
  if (productTags == null) return { ok: false, error: 'tags' }
  const productCompat = normalizeProductCompat(compat)
  if (productCompat == null) return { ok: false, error: 'compat' }
  // P22 (bug H) : un SKU saisi doit être libre — dans les produits du master
  // comme dans le catalogue de base.
  const manualSku = String(sku || '').trim()
  if (manualSku) {
    const taken = new Set(
      [...(meta.extraProducts || []), ...knownSkus]
        .map((p) => String(p?.sku || '').trim())
        .filter(Boolean)
    )
    if (taken.has(manualSku)) return { ok: false, error: 'sku_taken' }
  }
  const product = {
    id: nowId('sku'),
    // P6 : numéro de produit (SKU) saisi par le master, sinon généré.
    // P17 (rapport #2) : le titre vide est déjà refusé plus haut, mais un nom
    // composé uniquement de caractères invisibles (BOM, zero-width, espaces
    // insécables) survivait à `trim()` et donnait un SKU illisible. On retire
    // ces caractères et on retombe sur un suffixe horodaté — jamais « PS- » seul.
    sku: manualSku || uniqueSku(`PS-${skuSlug(title)}`, [...(meta.extraProducts || []), ...knownSkus]),
    name: title,
    short: String(short || title),
    brand: String(brand || 'PC Star'),
    category: cat,
    condition: productCondition,
    uses: productUses,
    warrantyMonths: Math.floor(months),
    model: productModel,
    barcode: productBarcode,
    description: productDescription,
    conditionNote: productConditionNote,
    compareAtPrice: Math.round(productCompareAtPrice),
    lowStockAt: Math.floor(productLowStockAt),
    details: productDetails,
    tags: productTags,
    compat: productCompat,
    // LOT 8.10 (A10) : la règle inline (repair→service, laptop/ready→machine,
    // accessories→accessory, sinon part) est maintenant partagée avec le
    // serveur via `kindForCategory` — un produit créé via l'API et le même créé
    // hors ligne ne divergent plus.
    kind: kindForCategory(cat),
    price: Math.round(n),
    stock: Math.max(0, Math.round(Number(stock) || 0)),
    rating: 0,
    reviews: 0,
    photos: cleanPhotos(photos),
    needs: '',
    related: [],
    custom: true
  }
  return {
    ok: true,
    product,
    meta: {
      ...meta,
      extraProducts: [...(meta.extraProducts || []), product],
      hiddenProductIds: (meta.hiddenProductIds || []).filter((id) => id !== product.id)
    }
  }
}

/** Set / replace photos on a custom product, or store overrides for catalog SKUs. */
export function setProductPhotos(meta, id, photos) {
  if (!id) return { ok: false, error: 'product' }
  const nextPhotos = cleanPhotos(photos)
  const extras = [...(meta.extraProducts || [])]
  const idx = extras.findIndex((p) => p.id === id)
  if (idx >= 0) {
    extras[idx] = { ...extras[idx], photos: nextPhotos }
    return { ok: true, meta: { ...meta, extraProducts: extras } }
  }
  const overrides = { ...(meta.photoOverrides || {}), [id]: nextPhotos }
  return { ok: true, meta: { ...meta, photoOverrides: overrides } }
}

export function addPanel(meta, { titles, categories } = {}) {
  const cats = (categories || []).filter(Boolean)
  if (!cats.length) return { ok: false, error: 'panel' }
  const titlesSafe = {
    ar: String(titles?.ar || titles?.fr || titles?.en || 'لوحة').trim(),
    fr: String(titles?.fr || titles?.en || titles?.ar || 'Panneau').trim(),
    en: String(titles?.en || titles?.fr || titles?.ar || 'Panel').trim()
  }
  const panel = {
    id: nowId('panel'),
    titles: titlesSafe,
    categories: cats,
    custom: true
  }
  return {
    ok: true,
    panel,
    meta: { ...meta, extraPanels: [...(meta.extraPanels || []), panel] }
  }
}

export function togglePanel(meta, id, on) {
  const hidden = new Set(meta.hiddenPanelIds || [])
  if (on) hidden.delete(id)
  else hidden.add(id)
  return { ...meta, hiddenPanelIds: [...hidden] }
}

export function buildShopView(baseProducts, baseLines, basePanels, meta) {
  const hiddenIds = new Set(meta.hiddenProductIds || [])
  const overrides = meta.photoOverrides || {}
  const withPhotos = (p) => {
    // Une photo importée par le maître devient la photo de référence : on ne
    // garde pas l'avertissement « illustration de catégorie » après son
    // remplacement par un visuel réellement fourni par le magasin.
    if (overrides[p.id]?.length) return { ...p, photos: overrides[p.id], photoMode: 'custom' }
    return p
  }
  const products = [
    ...baseProducts.filter((p) => !hiddenIds.has(p.id)).map(withPhotos),
    ...(meta.extraProducts || []).filter((p) => !hiddenIds.has(p.id)).map(withPhotos)
  ]
  const hiddenPanels = new Set(meta.hiddenPanelIds || [])
  const extraLines = (meta.extraPanels || []).flatMap((panel) =>
    panel.categories.map((cat) => ({
      id: `${panel.id}-${cat}`,
      label: cat,
      group: panel.id,
      match: (p) => p.category === cat
    }))
  )
  const extraPanels = (meta.extraPanels || []).map((panel) => ({
    id: panel.id,
    titleKey: null,
    titles: panel.titles,
    custom: true
  }))
  return {
    products,
    lines: [...baseLines, ...extraLines],
    panels: [...basePanels.filter((p) => !hiddenPanels.has(p.id)), ...extraPanels]
  }
}
