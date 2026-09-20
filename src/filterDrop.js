/**
 * LOT P6 (S4) — la marque qui ne vend rien dans le rayon choisi ne reste pas armée,
 * et le client le lit.
 *
 * Mesuré sur la page rendue, deux écrans, deux comportements pour le même geste :
 *
 *  · la page Recherche vidait `brands` en silence (un rayon ne se choisit pas avec une
 *    marque incompatible encore accrochée — sinon la liste tombe à zéro et le client
 *    croit le magasin vide) ;
 *  · la vitrine, elle, gardait `brandFilter` : choisir « Imprimantes » avec « Corsair »
 *    retenu affichait **0 fiche**, sans un mot, le bouton portant toujours la marque.
 *
 * Deux faces d'une même règle, c'est déjà comment le filtre « usage » est mort (P17).
 * La règle est donc écrite ici, et elle a deux moitiés : on retire ce qui ne peut rien
 * filtrer, **et on le dit** — un état qui change sous les yeux du client sans
 * explication est un bug poli, pas une faveur.
 */

/**
 * @param {string[]} retenues les marques que le client a retenues
 * @param {(marque: string) => boolean} vendueDans la marque a-t-elle encore des fiches
 *        dans la catégorie / le rayon qui vient d'être choisi
 * @returns {{gardees: string[], retirees: string[]}}
 */
export function filtresRetires(retenues, vendueDans) {
  const liste = Array.isArray(retenues) ? retenues.filter(Boolean) : []
  const gardees = []
  const retirees = []
  for (const marque of liste) {
    if (vendueDans(marque)) gardees.push(marque)
    else retirees.push(marque)
  }
  return { gardees, retirees }
}

/**
 * La phrase qui va avec : courte, nominative, et sans promettre une action que l'écran
 * ne fait pas (« retiriez la marque » alors que l'écran vient de le faire serait une
 * deuxième faute posée sur la première).
 */
export function noteRetrait(t, retirees, ligne) {
  if (!retirees || retirees.length === 0) return ''
  return t('filterDrop', { brands: retirees.join(', '), line: ligne })
}
