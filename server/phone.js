/**
 * Normalisation des numéros algériens — côté serveur.
 *
 * P22 (bug A) : `normalizePhone` et `isDzPhone` étaient dupliquées (front et
 * API) et partageaient donc le même trou — le préfixe de sortie international
 * `00` n'était pas retiré. `POST /api/orders` renvoyait 400 `{"error":"phone"}`
 * pour `00 213 550 123 456` alors que `+213 550 123 456` passait en 201.
 *
 * LOT 4.4 (R20) : une troisième copie aurait été nécessaire dans `server/db.js`
 * (la migration qui retire aux comptes les commandes guest passées à leur
 * numéro). Plutôt que d'ajouter une divergence de plus, la règle serveur vit
 * ici — `db.js` et `index.js` l'importent. Le front garde sa copie dans
 * `src/shopStore.js` (identique, couverte par ses propres tests) : un module
 * serveur n'a pas à tirer le stockage client, et l'inverse non plus.
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
