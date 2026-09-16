/**
 * Étiquette de stock — UNE seule définition, UNE seule famille de classes.
 *
 * LOT 6.1 (Q1) : `stockLabel` était dupliqué **quatre fois** (`App.jsx`,
 * `BuilderPage.jsx`, `SearchPage.jsx`, `ProductPage.jsx`) avec **deux
 * conventions** de classes :
 *
 *  · `App.jsx` / `ProductPage.jsx` renvoyaient `stock-out` / `stock-low` /
 *    `stock-ok` — des classes qui n'existent dans AUCUNE feuille de style — puis
 *    les retraduisaient en `text-bg-danger|warning|success` par un ternaire
 *    recopié deux fois ;
 *  · `BuilderPage.jsx` / `SearchPage.jsx` renvoyaient directement `danger` /
 *    `warning` / `success`, interpolés en `text-bg-${cls}`.
 *
 * Même rendu final, quatre sources de vérité : un seuil modifié dans un fichier
 * (les « 3 dernières pièces ») ne se voyait pas dans les trois autres, et une
 * classe inventée pouvait passer inaperçue puisqu'un ternaire la rattrapait.
 *
 * La fonction renvoie maintenant la classe Bootstrap **complète** : aucun
 * appelant n'a plus rien à traduire, et le seuil comme les libellés n'existent
 * qu'ici.
 *
 * @param {number} n stock disponible (déjà amputé du panier par l'appelant)
 * @param {(key: string, vars?: object) => string} t traducteur bound
 * @returns {{ text: string, cls: 'text-bg-danger'|'text-bg-warning'|'text-bg-success', level: 'out'|'low'|'ok' }}
 */
export const STOCK_LOW_THRESHOLD = 3

export function stockLabel(n, t) {
  const qty = Math.max(0, Math.floor(Number(n) || 0))
  if (qty <= 0) return { text: t('outOfStock'), cls: 'text-bg-danger', level: 'out' }
  if (qty <= STOCK_LOW_THRESHOLD) return { text: `${qty} ${t('left')}`, cls: 'text-bg-warning', level: 'low' }
  return { text: `${qty} ${t('inStore')}`, cls: 'text-bg-success', level: 'ok' }
}
