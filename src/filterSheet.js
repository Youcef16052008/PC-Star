/**
 * LOT P6 (S3) — la feuille de filtres, côté clavier.
 *
 * Les feuilles « Filtrer par marque » / « Filtrer par catalogue » sont posées dans
 * le flux de la page : ce ne sont pas des modales (pas de fond qui boit les clics,
 * pas d'`aria-modal`, pas de piège à focus). Mais elles portent un
 * `aria-expanded`, et un client au clavier qui les ouvre n'avait que le bouton « # »
 * à trouver à la souris pour les refermer — la touche Échap ne faisait rien (mesuré
 * sur la page rendue, sur les deux écrans : vitrine et recherche).
 *
 * Une seule implémentation pour les deux surfaces, comme `src/pager.js` : deux
 * écouteurs qui se ressemblent, c'est un des deux qui oubliera un jour Échap.
 */
import { useEffect, useRef } from 'react'

/**
 * Ferme la feuille sur Échap et rend le focus à ce qui l'avait ouverte.
 *
 * Le focus revient d'abord : une feuille qui se ferme sans rendre le focus laisse
 * le curseur du clavier sur `<body>`, et il faut re-tabber depuis le haut de la page
 * pour retrouver le bouton qu'on vient de quitter. Mais le focus ne revient que s'il
 * est effectivement perdu — pas question de le voler à un champ où le client écrit.
 *
 * @param {boolean} ouverte la feuille est-elle dépliée
 * @param {() => void} fermer ce qu'il faut faire sur Échap (l'appelant ferme son
 *                            état ; le hook rend ensuite le focus au déclencheur)
 */
export function useFeuilleFiltre(ouverte, fermer) {
  // Le callback vit dans une ref : l'écouteur ne doit pas se réabonner à chaque
  // rendu, et les composants rendent à chaque frappe dans le champ de recherche.
  const fermerRef = useRef(fermer)
  fermerRef.current = fermer
  const declencheur = useRef(null)

  useEffect(() => {
    if (!ouverte) return undefined
    // `document.activeElement` au moment où la feuille se monte : le bouton qui
    // l'a ouverte. Ce n'est pas une prop de plus à passer — les deux surfaces ont
    // chacune son bouton, et une prop de plus est une prop qu’on oublie.
    declencheur.current = document.activeElement
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      fermerRef.current?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ouverte])

  useEffect(() => {
    if (ouverte) return
    const cible = declencheur.current
    declencheur.current = null
    const focusPerdu = !document.activeElement || document.activeElement === document.body
    if (focusPerdu && cible && typeof cible.focus === 'function' && document.contains(cible)) cible.focus()
  }, [ouverte])
}
