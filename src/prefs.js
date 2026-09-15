// LOT 3.1 (F7 + F8) : TOUT accès au stockage passe par `safeStorage` — il ne
// lève jamais (iframe à stockage bloqué, quota dépassé) et retombe sur un repli
// mémoire. Avant, `loadLang` / `loadOrders` pouvaient lever un `SecurityError`
// depuis les initializers de `useState` d'`App.jsx`, donc pendant le rendu :
// ErrorBoundary pour tout le site. Le paramètre `storage` reste accepté (tests,
// memory storage) mais est ramené à un wrapper sûr par `asSafeStorage`.
import { asSafeStorage, safeStorage } from './safeStorage.js'

const KEY_LANG = 'pcstar-lang'
const KEY_THEME = 'pcstar-theme'
const KEY_ORDERS = 'pcstar-orders'

export function loadLang(storage = safeStorage) {
  const v = asSafeStorage(storage).getItem(KEY_LANG)
  if (v === 'ar' || v === 'fr' || v === 'en') return v
  return 'ar'
}

export function saveLang(storage = safeStorage, lang) {
  asSafeStorage(storage).setItem(KEY_LANG, lang)
}

/** @returns {'light'|'dark'|'system'} */
export function loadTheme(storage = safeStorage) {
  const v = asSafeStorage(storage).getItem(KEY_THEME)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export function saveTheme(storage = safeStorage, theme) {
  asSafeStorage(storage).setItem(KEY_THEME, theme)
}

export function resolveTheme(pref, mqlDark = null) {
  if (pref === 'light' || pref === 'dark') return pref
  if (mqlDark != null) return mqlDark ? 'dark' : 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

export function loadOrders(storage = safeStorage) {
  const raw = asSafeStorage(storage).getItem(KEY_ORDERS)
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveOrders(storage = safeStorage, orders) {
  asSafeStorage(storage).setItem(KEY_ORDERS, JSON.stringify(orders || []))
}

const KEY_DESK_SEEN = 'pcstar-desk-seen-at'

/**
 * LOT 3.11 (B16) — horodatage du dernier pull Desk réussi.
 *
 * `seenOrderCodes` est une `ref` : elle repart de zéro à chaque chargement de
 * page. Résultat, le premier pull après réouverture du comptoir n'annonçait
 * aucune des commandes arrivées pendant l'absence (navigateur fermé, onglet
 * rechargé) — elles apparaissaient dans la liste sans bip ni notification.
 * L'horodatage, lui, survit : ce qui est arrivé depuis est signalé.
 * @returns {number} 0 si inconnu.
 */
export function loadDeskSeenAt(storage = safeStorage) {
  const raw = asSafeStorage(storage).getItem(KEY_DESK_SEEN)
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function saveDeskSeenAt(storage = safeStorage, at) {
  const n = Number(at)
  if (!Number.isFinite(n) || n <= 0) return
  asSafeStorage(storage).setItem(KEY_DESK_SEEN, String(Math.floor(n)))
}

export function applyDocumentChrome({ lang, dir, theme }) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.lang = lang
  root.dir = dir
  root.dataset.theme = theme
  root.style.colorScheme = theme
  // L0 : theme-color suit le thème (miroir du script inline d'index.html).
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f2f5f8' : '#0d1116')
}
