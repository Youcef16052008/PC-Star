import { isKnownCategory } from './data.js'

/** Contrat partagé des panneaux personnalisés API/local. */
export const MAX_EXTRA_PANELS = 12
export const MAX_PANEL_CATEGORIES = 4
export const MAX_PANEL_TITLE_LENGTH = 80
const PANEL_ID_RE = /^panel-[a-z0-9][a-z0-9-]{0,46}$/

function cleanTitle(value) {
  if (typeof value !== 'string') return null
  const title = value.trim()
  return title && title.length <= MAX_PANEL_TITLE_LENGTH ? title : null
}

/**
 * Rend un panneau sûr pour `buildShopView`, ou `null` si le contrat est rompu.
 * Une catégorie inconnue ferait apparaître un filtre sans aucun produit; elle
 * est donc refusée plutôt que persistée comme un panneau fantôme.
 */
export function normalizeCustomPanel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!PANEL_ID_RE.test(id)) return null
  const titles = value.titles && typeof value.titles === 'object' && !Array.isArray(value.titles) ? value.titles : null
  const ar = cleanTitle(titles?.ar)
  const fr = cleanTitle(titles?.fr)
  const en = cleanTitle(titles?.en)
  if (!ar || !fr || !en) return null
  if (!Array.isArray(value.categories) || !value.categories.length || value.categories.length > MAX_PANEL_CATEGORIES) return null
  const categories = value.categories.map((category) => (typeof category === 'string' ? category.trim() : ''))
  if (categories.some((category) => !category || category === 'all' || !isKnownCategory(category))) return null
  if (new Set(categories).size !== categories.length) return null
  return { id, titles: { ar, fr, en }, categories, custom: true }
}

/** Normalise toute la collection, ou échoue sans troncature silencieuse. */
export function normalizeCustomPanels(value) {
  if (!Array.isArray(value) || value.length > MAX_EXTRA_PANELS) return null
  const panels = value.map(normalizeCustomPanel)
  if (panels.some((panel) => !panel)) return null
  if (new Set(panels.map((panel) => panel.id)).size !== panels.length) return null
  return panels
}

/** Migration tolérante : garde les panneaux historiques encore valides. */
export function sanitizeLegacyCustomPanels(value) {
  if (!Array.isArray(value)) return []
  const ids = new Set()
  const panels = []
  for (const raw of value) {
    const panel = normalizeCustomPanel(raw)
    if (!panel || ids.has(panel.id)) continue
    ids.add(panel.id)
    panels.push(panel)
    if (panels.length === MAX_EXTRA_PANELS) break
  }
  return panels
}

/** Seuls les panneaux présents dans la navigation de base peuvent être masqués. */
export function normalizeHiddenPanelIds(value, basePanels = []) {
  if (!Array.isArray(value)) return null
  const known = new Set((basePanels || []).map((panel) => panel?.id).filter(Boolean))
  const ids = value.map((id) => (typeof id === 'string' ? id.trim() : ''))
  if (ids.some((id) => !id || !known.has(id))) return null
  return [...new Set(ids)]
}

/** Migration tolérante des masques historiques : ignore uniquement les ids morts. */
export function sanitizeLegacyHiddenPanelIds(value, basePanels = []) {
  const known = new Set((basePanels || []).map((panel) => panel?.id).filter(Boolean))
  return [...new Set((Array.isArray(value) ? value : []).filter((id) => typeof id === 'string' && known.has(id.trim())).map((id) => id.trim()))]
}
