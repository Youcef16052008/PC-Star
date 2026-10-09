// LOT 3.1 (F7 + F8) : TOUT accès au stockage passe par `safeStorage` — il ne
// lève jamais (stockage bloqué : cookies tiers refusés, navigation privée, quota
// dépassé) et retombe sur un repli mémoire. Avant, `loadLang` / `loadOrders` pouvaient lever un `SecurityError`
// depuis les initializers de `useState` d'`App.jsx`, donc pendant le rendu :
// ErrorBoundary pour tout le site. Le paramètre `storage` reste accepté (tests,
// memory storage) mais est ramené à un wrapper sûr par `asSafeStorage`.
import { asSafeStorage, safeStorage } from './safeStorage.js'

const KEY_LANG = 'pcstar-lang'
const KEY_ORDERS = 'pcstar-orders'

// LOT 6.3 (Q3 + Q4) : `KEY_THEME`, `loadTheme`, `saveTheme` et `resolveTheme`
// sont supprimés — code mort. Le thème sombre a été retiré sur demande client
// (`App.jsx` : `const theme = 'light'`, `public/theme-boot.js` : « le site est
// définitivement en thème clair »), et rien n'importait ces trois fonctions hors
// de ce fichier : elles n'étaient donc ni appelées ni testées, seulement lues par
// qui cherchait où se règle le thème.
//
// Q4 au passage : `applyDocumentChrome` posait `theme-color` à `#f2f5f8` alors
// qu'`index.html` et `theme-boot.js` annoncent `#f4f6fb` — la barre du navigateur
// changeait de teinte au montage de React. Une seule constante désormais, et un
// test vérifie que les trois fichiers disent la même chose.

export function loadLang(storage = safeStorage) {
  const v = asSafeStorage(storage).getItem(KEY_LANG)
  if (v === 'fr' || v === 'en') return v
  // L'arabe a été retiré de l'interface : un ancien choix `ar` retombe
  // proprement sur le français, qui est aussi la valeur par défaut.
  return 'fr'
}

export function saveLang(storage = safeStorage, lang) {
  asSafeStorage(storage).setItem(KEY_LANG, lang)
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

/**
 * LOT 6.3 (Q4) : la seule teinte de barre du navigateur. `index.html`
 * (`<meta name="theme-color">`) et `public/theme-boot.js` (avant le premier
 * paint) annoncent `#f4f6fb` ; `applyDocumentChrome` écrivait `#f2f5f8`, donc la
 * teinte changeait au montage de React. Les trois disent désormais la même
 * chose, et `src/prefs.test`-style : un test compare les trois sources.
 */
export const THEME_COLOR_LIGHT = '#f4f6fb'

/**
 * Pose la langue, le sens de lecture et le thème sur `<html>`.
 *
 * Seul `light` existe (thème sombre retiré sur demande client) ; le paramètre
 * reste pour que l'appel d'`App.jsx` dise explicitement ce qu'il applique.
 */
export function applyDocumentChrome({ lang, dir, theme }) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.lang = lang
  root.dir = dir
  root.dataset.theme = theme
  root.style.colorScheme = theme
  // L0 : theme-color suit le thème (miroir du script inline d'index.html).
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR_LIGHT)
}
