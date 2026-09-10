const KEY_LANG = 'pcstar-lang'
const KEY_THEME = 'pcstar-theme'
const KEY_ORDERS = 'pcstar-orders'

export function loadLang(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const v = storage?.getItem?.(KEY_LANG)
  if (v === 'ar' || v === 'fr' || v === 'en') return v
  return 'ar'
}

export function saveLang(storage, lang) {
  storage?.setItem?.(KEY_LANG, lang)
}

/** @returns {'light'|'dark'|'system'} */
export function loadTheme(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const v = storage?.getItem?.(KEY_THEME)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export function saveTheme(storage, theme) {
  storage?.setItem?.(KEY_THEME, theme)
}

export function resolveTheme(pref, mqlDark = null) {
  if (pref === 'light' || pref === 'dark') return pref
  if (mqlDark != null) return mqlDark ? 'dark' : 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

export function loadOrders(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  const raw = storage?.getItem?.(KEY_ORDERS)
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveOrders(storage, orders) {
  storage?.setItem?.(KEY_ORDERS, JSON.stringify(orders || []))
}

export function applyDocumentChrome({ lang, dir, theme }) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.lang = lang
  root.dir = dir
  root.dataset.theme = theme
  root.style.colorScheme = theme
}
