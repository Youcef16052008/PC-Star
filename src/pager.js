/**
 * LOT P6 (S2) — la règle de pagination du catalogue, UNE fois.
 *
 * La vitrine paginait ses fiches depuis le LOT P4 (V3) : douze cartes, puis « page 1
 * sur N », la page 2 étant une autre coupe du MÊME catalogue — pas un mur de 301
 * fiches. La page Recherche, elle, rendait TOUT : 301 cartes, 301 vignettes, 301
 * `PartThumb` avec leur logique d'erreur de chargement, dans un seul DOM. Sur le parc
 * de téléphones du comptoir, ce n'est pas lent : c'est une page qui ne s'affiche pas.
 *
 * Deux listes paginées qui calculent chacune sa taille de page, c'est deux listes qui
 * finissent par se contredire (numérotation différente d'un écran à l'autre, un lien
 * « page 3 » qui mène dans le décor quand la seconde liste n'a que deux pages). D'où
 * ce module : la taille, le nombre de pages et la tranche se décrètent ici.
 *
 * Aucun effet de bord, aucune lecture d'environnement : un verrou de bornage n'ouvre
 * ni fichier ni base (c'est le LOT 1.20 qui l'exige).
 */

/** Fiches par page — douze, autant dire une écran et demi sur un téléphone. */
export const PAGE_TAILLE = 12

/** Combien de pages pour `total` fiches (toujours au moins une : une liste vide a une page vide). */
export function pagesPour(total, taille = PAGE_TAILLE) {
  const n = Math.max(0, Math.floor(Number(total) || 0))
  return Math.max(1, Math.ceil(n / taille))
}

/**
 * La page NUMÉROTÉE à afficher.
 *
 * Bornée à la LECTURE, pas à l'écriture : un filtre qui réduit la liste pendant
 * qu'on est page 4 doit ramener page 1 sans que l'appelant ait pensé à
 * réinitialiser l'état — c'est exactement la règle du lot P5 (le refus est pour la
 * saisie, la borne pour la lecture), appliquée à un numéro de page.
 */
export function pageCourante(page, pages) {
  const n = Math.floor(Number(page))
  const voulu = Number.isFinite(n) ? n : 1
  return Math.min(Math.max(1, voulu), Math.max(1, pages))
}

/** La tranche de la liste à rendre, pour la page demandée. */
export function tranche(list, page, taille = PAGE_TAILLE) {
  const items = Array.isArray(list) ? list : []
  const n = pageCourante(page, pagesPour(items.length, taille))
  return items.slice((n - 1) * taille, n * taille)
}
