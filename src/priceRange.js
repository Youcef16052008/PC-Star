/**
 * LOT P25 (S6) — le prix se TAPE, il ne se coche plus.
 *
 * Ce que le client a demandé, mot pour mot : « le prix écrit par le client au
 * clavier — minimum 100 DA, maximum 10 000 000 DA ». La page Recherche proposait
 * six cases (`Moins de 15 000 DA`, `15 000 – 30 000`, …, `100 000 DA+`) : six
 * tranches décidées par le magasin, dont aucune ne sait dire « entre 42 000 et
 * 137 000 ». Un client qui cherche une carte à 90 000 DA devait donc choisir
 * entre deux tranches fausses.
 *
 * Les règles vivent ici, une fois, et surtout PAS dans le JSX : ce qu'on garde
 * du clavier, ce qu'on borne, ce qu'on annonce quand la saisie est incohérente
 * sont trois décisions testables sans monter un écran.
 */

/** La borne basse : sous 100 DA, il n'y a pas de fiche — on ne laisse pas descendre. */
export const PRIX_MIN = 100
/** La borne haute : 10 000 000 DA. */
export const PRIX_MAX = 10000000

/**
 * Ce que le clavier a le droit d'écrire : des chiffres, et rien d'autre.
 *
 * On garde le TEXTE (pas un nombre) pour que ce que le client voit dans le champ
 * soit exactement ce qu'il a tapé : « 12 000 DA » collé depuis WhatsApp donne
 * `12000`, une lettre ne s'installe pas, et le champ vide veut dire « pas de
 * borne de ce côté » — pas « 0 », qui filtrerait tout.
 */
export function textePrix(valeur) {
  if (valeur == null) return ''
  return String(valeur).replace(/\D/g, '').slice(0, 10)
}

/** Le nombre tapé, ou `null` quand le champ est vide. */
export function nombrePrix(texte) {
  const chiffres = textePrix(texte)
  if (!chiffres) return null
  const n = Number(chiffres)
  return Number.isFinite(n) ? n : null
}

/** Le nombre ramené dans la fenêtre autorisée (100 … 10 000 000). */
export function bornePrix(nombre) {
  if (nombre == null) return null
  return Math.min(PRIX_MAX, Math.max(PRIX_MIN, Math.round(nombre)))
}

/**
 * Les bornes réellement appliquées au filtre.
 *
 * `inverse` est le cas que le client provoque en tapant : un minimum au-dessus du
 * maximum. On ne le corrige pas en silence (échanger les deux bornes sous les
 * yeux du client, c'est lui reprendre sa saisie) — la liste se vide, et l'écran
 * DIT pourquoi (`priceInverted`).
 *
 * @returns {{min: number|null, max: number|null, actif: boolean, inverse: boolean}}
 */
export function bornesPrix(texteMin, texteMax) {
  const min = bornePrix(nombrePrix(texteMin))
  const max = bornePrix(nombrePrix(texteMax))
  return {
    min,
    max,
    actif: min != null || max != null,
    inverse: min != null && max != null && min > max
  }
}

/**
 * Ce que le champ affiche quand la saisie est terminée : le nombre APPLIQUÉ.
 * Une borne tapée hors fenêtre (« 50 ») est corrigée à la sortie du champ — le
 * client ne peut donc pas croire qu'il filtre sur 50 DA alors que la liste part
 * de 100.
 */
export function texteBorne(texte) {
  const nombre = bornePrix(nombrePrix(texte))
  return nombre == null ? '' : String(nombre)
}

/** La fiche passe-t-elle les bornes retenues ? */
export function prixRetenu(prix, bornes) {
  if (bornes?.min != null && prix < bornes.min) return false
  if (bornes?.max != null && prix > bornes.max) return false
  return true
}
