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
  return brut.replace(/\s+/g, ' ').trim().slice(0, VITRINE_LIMITS.label)
}

/** Un compteur entier ≥ 0, borné ; tout le reste devient 0, jamais `NaN`. */
export function clampVitrineCount(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 0 ? Math.min(n, VITRINE_LIMITS.count) : 0
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
