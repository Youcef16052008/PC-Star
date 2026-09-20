/**
 * LOT P6 (S2) — la règle de pagination, écrite UNE fois.
 *
 * Trouvé en relisant mes propres verrous de S1 : pour prouver que la barre de
 * filtres filtre, je comptais les cartes rendues. Sur la page Recherche, qui
 * rendait les 301 fiches d'un coup, ce compte ne disait rien. Sur la vitrine, la
 * règle vivait dans `App.jsx`, sous la forme `list.slice((page - 1) * SHOP_PAGE_SIZE)`
 * — donc le deuxième écran, lui, ne la connaissait pas. Deux listes, une seule
 * règle de tranchage.
 *
 * LOT P6 (S3) — la règle ne s'arrête plus au tranchage : la FENÊTRE de numéros et
 * la TAILLE de page sont décidées ici, pour les deux écrans. Un pager qui dresse
 * vingt-huit boutons n'a pas réparé le mur de pastilles, il l'a numéroté.
 *
 * Les bornes sont à la LECTURE, jamais à la saisie (règle du P5) : le numéro de
 * page et la taille viennent du monde extérieur (clic, URL, onglet restauré), ils
 * sont ramenés dans le domaine au moment où on s'en sert ; le champ, lui, reste
 * libre — un visiteur ne reçoit pas de refus pour avoir cliqué trop loin.
 */

/** Fiches par page, par défaut. C'est la valeur que verrouille `src/p3Vitrine.test.js`. */
export const PAGE_TAILLE = 12

/**
 * Tailles proposées au client (lot S3). Le choix est un choix de l'interface, pas
 * une saisie libre : tout ce qui n'est pas dans cette liste retombe sur
 * `PAGE_TAILLE`, y compris depuis une URL bidouillée.
 */
export const TAILLES = [PAGE_TAILLE, 24, 48]

/** Marqueur de trou dans la fenêtre de numéros (les points de suspension). */
export const POINT_DE_SUSPENSION = '…'

/**
 * Nombre de pages d'une liste. Une liste vide fait UNE page, pas zéro. La taille
 * est un parametre — depuis que le client peut choisir 12, 24 ou 48 fiches, un
 * compte de pages calcule a douze annoncerait « page 1 sur 26 » a une liste qui en
 * fait sept, et le pager dresserait dix-neuf numeros morts.
 */
export function pagesPour(total, taille = PAGE_TAILLE) {
  const n = Number(total)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.max(1, Math.ceil(n / pas(taille)))
}

/**
 * Le pas effectif d'une tranche. `tailleSure`, lui, ne répond qu'à une question
 * d'interface : « est-ce une des tailles qu'on propose ? ». Un autre appelant —
 * une liste compacte du comptoir, un export — a le droit de demander cinq fiches par
 * page ; lui répondre « douze » en silence serait un `slice` faux et muet. Ce qui
 * n'est pas un entier positif retombe quand même sur le défaut.
 */
export function pas(taille) {
  const n = Math.floor(Number(taille))
  return Number.isFinite(n) && n >= 1 ? n : PAGE_TAILLE
}

/**
 * Le numéro de page à utiliser. Borné dans les deux sens, et sourd aux valeurs
 * qui ne sont pas des nombres : `Math.min(1, NaN)` vaudrait `NaN`, et un `NaN`
 * dans un `slice` vide la liste sans jamais crier.
 */
export function pageCourante(page, pages) {
  const total = Math.max(1, Math.floor(Number(pages)) || 1)
  const n = Math.floor(Number(page))
  if (!Number.isFinite(n)) return 1
  return Math.min(total, Math.max(1, n))
}

/**
 * La taille de page sûre, pour l'INTERFACE : une des `TAILLES` proposées, sinon le
 * défaut. C'est le garde-fou du `<select>` (et de ce qu'une URL oserait y mettre) —
 * pas la loi du tranchage, qui accepte n'importe quel pas positif via `pas`.
 */
export function tailleSure(taille) {
  const n = Math.floor(Number(taille))
  return TAILLES.includes(n) ? n : PAGE_TAILLE
}

/**
 * La fenêtre de numéros à dresser : première et dernière pages toujours, le
 * voisinage du curseur, et des points de suspension dans le trou. Un seul numéro
 * sauté est affiché en clair plutôt qu'remplacé par « … » — deux clics pour
 * gagner une page, c'est un clic de trop.
 *
 * @returns {(number|'…')[]} par exemple [1, '…', 4, 5, 6, '…', 26]
 */
export function fenetrePages(page, pages, rayon = 1) {
  const total = Math.max(1, Math.floor(Number(pages)) || 1)
  const courant = pageCourante(page, total)
  const r = Math.max(0, Math.floor(Number(rayon)) || 0)
  // Listes courtes : la fenêtre ferait plus de marks que la liste entière.
  if (total <= 2 * r + 4) return Array.from({ length: total }, (_, k) => k + 1)
  const garde = new Set([1, total, courant])
  for (let n = courant - r; n <= courant + r; n += 1) {
    if (n >= 1 && n <= total) garde.add(n)
  }
  const triees = [...garde].sort((a, b) => a - b)
  const sortie = []
  let avant = 0
  for (const n of triees) {
    if (n - avant === 2) sortie.push(avant + 1)
    else if (n - avant > 1) sortie.push(POINT_DE_SUSPENSION)
    sortie.push(n)
    avant = n
  }
  return sortie
}

/** La tranche de la liste pour la page demandée. Jamais de trou, jamais de doublon. */
export function tranche(list, page, taille = PAGE_TAILLE) {
  const source = Array.isArray(list) ? list : []
  const en = pas(taille)
  const total = Math.max(1, Math.ceil(source.length / en))
  const n = pageCourante(page, total)
  const debut = (n - 1) * en
  return source.slice(debut, debut + en)
}
