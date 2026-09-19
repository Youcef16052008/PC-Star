/**
 * LOT P4 (V1) — les trois compteurs de la vitrine, et leur bornage.
 *
 * Partagé front ↔ serveur (même raison d'être que `src/orderLogic.js` ou
 * `src/data.js`, que `server/` importe déjà) : une règle de validation écrite
 * deux fois finit par avoir deux bornes, et le premier symptôme est un
 * formulaire qui réécrit la base à chaque sauvegarde — le client voit un nombre
 * qui n'est jamais celui qu'il a tapé.
 *
 * `src/vitrine.js` ne connaît QUE ces trois valeurs : aucun effet de bord,
 * aucune lecture d'environnement, donc un test de bornage n'ouvre ni fichier ni
 * base (c'est le LOT 1.20 qui l'exige, voir `src/lot1BaseScripts.test.js`).
 */
import { clipChars, repairPaires } from './textClip.js'

/**
 * LOT P5 : les deux bornes comptent des **caracteres** (points de code), pas des
 * unites UTF-16 — voir `src/textClip.js`. Un libelle de 48 emoji vaut 48, pas 24.
 */
export const VITRINE_LIMITS = { label: 48, count: 9_999_999 }

/**
 * Un texte plat, court, sans saut de ligne : la tuile tient sur une ligne.
 *
 * `String(value ?? '')` aurait suffi — il rendait `[object Object]` sur un objet
 * et `true` sur un booléen, soit un affichage absurde sur une vitrine publique
 * pour une clé tapée à la main dans le stockage. Seuls les primitifs
 * (chaîne, nombre fini) sont donc du texte ; tout le reste devient vide, et
 * le vide se traduit par le libellé par défaut côté affichage.
 */
export function clampVitrineLabel(value) {
  const brut =
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  // `clipChars` et non `.slice` : la mesure du 19/09/2026 a montre qu'un libelle
  // « a » + 48 🧰 etait stocke en 48 UNITES, soit 25 caracteres dont le dernier
  // etait une moitie de paire (U+D83E seul) — affiche ? sur le site public.
  // `repairPaires` d'abord, `clipChars` ensuite : une base ecrite avant le
  // correctif portait une moitie de paire en fin de libelle, et la recouper ne
  // l'otait pas.
  return clipChars(repairPaires(brut.replace(/\s+/g, ' ').trim()), VITRINE_LIMITS.label)
}

/**
 * Un compteur entier ≥ 0, borné ; tout le reste devient 0, jamais `NaN`.
 *
 * LOT P5 : `Number(value)` acceptait n'importe quoi qui *se convertit* —
 * mesuré le 19/09/2026, `{repairsDone: true}` enregistrait **1**, `[12]`
 * enregistrait **12** et `'1e3'` enregistrait **1000**. Un booléen n'est pas un
 * compteur : les seules formes admises sont un nombre fini et une chaîne
 * d'entière décimale (`'12'`, `' 12 '`), qui est ce que produit un
 * `input type=number`. Tout le reste devient 0 — et la route du maître, elle,
 * refuse (`estCompteurVitrine`).
 */
export function clampVitrineCount(value) {
  const n = formeCompteur(value)
  return n == null ? 0 : Math.min(n, VITRINE_LIMITS.count)
}

/**
 * Forme admise d'un compteur saisi : chiffres, éventuellement décimaux (le
 * modèle `Math.floor` ensuite — c'est la borne du champ `step=1` qui refuse
 * 12,7 dans le navigateur, la règle est déjà verrouillée côté API). Ni exposant
 * (`'1e3'`), ni signe, ni blanc à l'intérieur : un `Number()` qui les digérait
 * silencieusement est précisément le trou mesuré.
 */
const NOMBRE_DECIMAL = /^\d+(?:\.\d+)?$/

/**
 * La valeur réduite à un entier ≥ 0, ou `null` si ce n'est pas une forme de
 * compteur. Partagée : la route s'en sert pour REFUSER (le maître doit savoir ce
 * qu'il a tapé) là où l'affichage doit se CONTENTER (une base ancienne peut
 * porter n'importe quoi, et le site public ne doit jamais planter pour ça).
 */
export function formeCompteur(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const net = value.trim()
    if (!NOMBRE_DECIMAL.test(net)) return null
    const n = Math.floor(Number(net))
    return Number.isSafeInteger(n) && n >= 0 ? n : null
  }
  return null // booleen, objet, tableau, null, undefined : ce n'est pas un nombre
}

/** `true` quand `value` est une forme de compteur admise, dans la borne. */
export function estCompteurVitrine(value) {
  const n = formeCompteur(value)
  return n != null && n <= VITRINE_LIMITS.count
}

/** Les trois valeurs, sous leur forme affichable. */
export function clampVitrine(input) {
  const v = input && typeof input === 'object' ? input : {}
  return {
    repairsLabel: clampVitrineLabel(v.repairsLabel),
    repairsDone: clampVitrineCount(v.repairsDone),
    readyTally: clampVitrineCount(v.readyTally)
  }
}

export const EMPTY_VITRINE = clampVitrine({})
