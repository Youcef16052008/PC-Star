/**
 * Les trous d'API de jsdom, comblés avant que le harnais ne rende quoi que ce
 * soit — pour que « une erreur » veuille dire « une erreur de l'application ».
 *
 * Motif réel (CI, 19/09/2026, run 35446572476, étape « Audit boutons ») :
 *
 *     ✗ rejection non gérée : performance.getEntriesByType is not a function
 *
 * et, sur le run précédent, la même classe de bruit tuait l'étape « Crawl » à la
 * 16ᵉ seconde. `window.performance` de jsdom n'expose que `now`, `toJSON`,
 * `timeOrigin` ( vérifié : `Object.getOwnPropertyNames(Object.getPrototypeOf(...))`)
 * : pas de Resource Timing, pas de `mark`/`measure`. Or le harnais lance le
 * VRAI bundle, dont react-dom sonde les entrées de ressource pour suivre le
 * chargement des `<link>`; et le harnais collecte `process.on('unhandledRejection')`
 * comme une FAUTE. Un trou du harnais est donc imputé à l'application — d'autant
 * qu'il n'est reproductible que selon le rythme des requêtes (deux rejouaisons
 * locales, base vide et base pleine, ne le montrent pas).
 *
 * Deux façons de régler ça, et une seule est honnête :
 *  · amollir le collecteur de rejections (le rendre « soft » comme `isSoft()`
 *    l'est pour `alert`/`confirm`) — NON : c'est exactement le mécanisme qui a
 *    laissé passer des clics muets pendant des lots entiers ;
 *  · combler l'API manquante, inertement — OUI : le harnais ne mesure aucune
 *    performance, il vérifie des erreurs. Une liste vide et des marques sans
 *    effet rendent le comportement de react-dom celui d'un navigateur qui n'aurait
 *    rien à mesurer, et toute vraie rejection reste fatale.
 */
const GAPS = {
  getEntriesByType: () => [],
  getEntriesByName: () => [],
  getEntries: () => [],
  clearEntries: () => {},
  mark: (name) => ({ name, entryType: 'mark', startTime: 0, duration: 0 }),
  measure: (name) => ({ name, entryType: 'measure', startTime: 0, duration: 0 }),
  clearMarks: () => {},
  clearMeasures: () => {}
}

/**
 * @param {Window} window la fenêtre jsdom, en `beforeParse`
 * @returns {boolean} true si au moins une méthode a été ajoutée (pour le test)
 */
export function patchPerformanceGaps(window) {
  const perf = window?.performance
  if (!perf || typeof perf.now !== 'function') return false
  let ajouté = 0
  for (const [nom, valeur] of Object.entries(GAPS)) {
    if (typeof perf[nom] !== 'function') {
      try {
        perf[nom] = valeur
        ajouté++
      } catch {
        /* propriété en lecture seule sur une version future de jsdom : inutile de casser l'audit */
      }
    }
  }
  return ajouté > 0
}
