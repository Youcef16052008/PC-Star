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

// LOT 6.2 (Q2) : l'implémentation canonique est partagée avec le front dans
// `src/phoneLogic.js` (aucun DOM, aucun stockage : importable des deux côtés,
// comme `src/data.js` et `src/orderLogic.js` le sont déjà). Ce module reste le
// point d'entrée côté serveur — `index.js` et `db.js` l'importent — et
// ré-exporte aussi `phoneCarrier`, dont `index.js` avait sa propre copie.
export { normalizePhone, isDzPhone, phoneCarrier } from '../src/phoneLogic.js'
