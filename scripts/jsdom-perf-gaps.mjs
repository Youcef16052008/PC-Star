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
  if (!window || window.__pcstarPerfGaps) return false
  const ajoute = combler(window)
  // Un realm enfant n'hérite d'aucun shim : chaque fenêtre imbriquée (l'iframe
  // Google Maps de la page « about », par exemple) a SON objet `performance`,
  // avec les mêmes trous. Le harnais ne mesure aucune performance — il vérifie
  // des erreurs — donc un realm non comblé fabrique une faute que aucun
  // navigateur n'afficherait, et le collecteur de rejections, branché sur le
  // processus, ne peut pas savoir qu'elle vient d'un trou du harnais.
  const drapele = comblerLesRealmsEnfants(window)
  if (ajoute || drapele) {
    try {
      window.__pcstarPerfGaps = true
    } catch {
      /* fenêtre gelée : le shim reste posé, c'est l'essentiel */
    }
  }
  return ajoute || drapele
}

/**
 * Comble les méthodes manquantes sur l'objet `performance` d'une fenêtre.
 * @returns {boolean} true si au moins une méthode a été ajoutée
 */
function combler(window) {
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

/**
 * Evene les frames deja la, puis regarde le document : une iframe inseree plus
 * tard (le cas reel : la carte de la page « a propos », montee par React apres
 * le premier rendu) est comblee a son apparition, pas au souvenir du harnais.
 */
function comblerLesRealmsEnfants(window) {
  let fait = false
  const voir = (doc) => {
    if (!doc) return false
    let touche = false
    for (const f of [...doc.querySelectorAll?.('iframe') || []]) {
      let w = null
      try {
        w = f.contentWindow
      } catch {
        /* realm inatteignable (origine croisee) : rien a combler ici */
      }
      if (w && !w.__pcstarPerfGaps) {
        combler(w)
        try {
          w.__pcstarPerfGaps = true
        } catch {
          /* gelé apres close() */
        }
        touche = true
      }
    }
    return touche
  }
  voir(window.document)
  if (typeof window.MutationObserver === 'function' && window.document) {
    try {
      new window.MutationObserver(() => voir(window.document)).observe(window.document, { childList: true, subtree: true })
      fait = true
    } catch {
      /* pas d'observateur (document detache) : les frames existantes sont quand meme combles */
    }
  }
  return fait
}

/** Le prototype de l'objet `performance` de la fenêtre, s'il est exploitable. */
function prototypeShim(perf) {
  const p = Object.getPrototypeOf(perf)
  return p && p !== Object.prototype ? p : perf
}
