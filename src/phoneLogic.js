/**
 * Numéros algériens — implémentation CANONIQUE, partagée client + serveur.
 *
 * LOT 6.2 (Q2) : `phoneCarrier` existait en deux copies strictement identiques
 * (`src/shopStore.js` et `server/index.js`), comme `normalizePhone` /
 * `isDzPhone` avant le lot 4. Deux copies d'une même règle, c'est deux endroits
 * où la corriger — et le bug A de P22 (préfixe international `00` non retiré)
 * était précisément présent dans les deux à la fois.
 *
 * Ce module est importable des deux côtés : il ne touche ni au DOM ni au
 * stockage (contrairement à `shopStore.js`), et le serveur importe déjà
 * `src/data.js` et `src/orderLogic.js`. `src/shopStore.js` et `server/phone.js`
 * ré-exportent ces fonctions : les appelants existants ne changent pas, la
 * règle n'existe plus qu'une fois.
 *
 * LIMITE ASSUMÉE — portabilité des numéros : le mapping 05/06/07 → opérateur
 * est celui des préfixes d'attribution historiques (Ooredoo / Mobilis / Djezzy).
 * Un numéro **porté** chez un autre opérateur reste étiqueté d'après son
 * préfixe d'origine : l'Algérie n'expose pas d'annuaire de portabilité, et le
 * transporteur n'est ici qu'une information d'affichage/statistique (le message
 * WhatsApp et la fiche commande), jamais une règle métier. Aucune correction
 * n'est donc tentée — elle serait fausse plus souvent qu'à son tour.
 */

/** Ramène un numéro au format local algérien `0[567]XXXXXXXX`. */
export function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = `0${d.slice(3)}`
  if (d.length === 9 && /^[567]/.test(d)) d = `0${d}`
  return d
}

/** True si la valeur normalisée est un mobile algérien valide. */
export function isDzPhone(value) {
  return /^0[567]\d{8}$/.test(normalizePhone(value))
}

/**
 * Opérateur déduit du préfixe (voir la limite « portabilité » en tête de
 * module). Retourne `null` pour un numéro invalide.
 */
export function phoneCarrier(value) {
  const p = normalizePhone(value)
  if (!isDzPhone(p)) return null
  if (p.startsWith('05')) return 'ooredoo'
  if (p.startsWith('06')) return 'mobilis'
  if (p.startsWith('07')) return 'djezzy'
  return null
}
