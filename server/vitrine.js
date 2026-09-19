/**
 * LOT P4 (V1) — la vitrine, côté serveur : projection publique et écriture.
 *
 * Le bornage des valeurs vit dans `src/vitrine.js` (partagé avec le front, pour
 * qu'une seule borne existe) ; ce module n'ajoute que ce qui ne peut pas être
 * partagé : la projection de `db.meta` et la règle « le maître écrit le libellé
 * et les réparations, le compteur de commandes ne s'écrit pas à la main ».
 *
 * Pourquoi un module à part plutôt que `server/db.js` : ces trois champs sont
 * touchés par `server/catalog.js` au moment où une commande passe « prête ». Le
 * mettre dans `db.js` obligerait `catalog.js` — donc chaque test de transitions
 * de commande — à importer le module qui résout `DATA_DIR` et le compte maître :
 * c'est exactement la cascade d'échecs que le LOT 1.20 a fermée
 * (`src/lot1BaseScripts.test.js`).
 */
import { clampVitrine, estCompteurVitrine } from '../src/vitrine.js'

export { VITRINE_LIMITS, clampVitrine, clampVitrineCount, clampVitrineLabel } from '../src/vitrine.js'
export { estCompteurVitrine } from '../src/vitrine.js'

/** Ce que le public a le droit de lire : les trois valeurs, rien d'autre. */
export function vitrineView(db) {
  return clampVitrine(db?.meta?.vitrine)
}

/**
 * Écriture du maître : le libellé et le nombre de réparations. `readyTally`
 * n'est PAS atteignable ici — il est la conséquence d'une commande passée à
 * « prête » (`setOrderStatus`), pas une vanité qu'on se fixe au clavier. Un
 * `readyTally` envoyé par le navigateur est donc ignoré, et le nombre affiché
 * sous « commandes » reste une trace de ce qui s'est vraiment passé au
 * comptoir.
 */
export function applyVitrineEdit(db, body) {
  const label = body?.repairsLabel
  const done = body?.repairsDone
  if (label != null && typeof label !== 'string') return { ok: false, error: 'vitrine_label' }
  // LOT P5 : la garde etait `Number.isFinite(Number(done))`, qui validait donc
  // tout ce que JS sait convertir — mesurée le 19/09/2026 : `true` enregistrait
  // 1, `[12]` enregistrait 12, `'1e3'` enregistrait 1000, et une valeur au-dessus
  // du plafond était ramenée à 9 999 999 sans un mot. `estCompteurVitrine` est la
  // règle du contrat (nombre fini ou chaîne de chiffres, dans la borne) : ce qui
  // ne la respecte pas est REFUSÉ, et le maître voit ce qu'il a tapé.
  if (done != null && !estCompteurVitrine(done)) return { ok: false, error: 'vitrine_count' }
  const current = clampVitrine(db.meta?.vitrine)
  const next = clampVitrine({
    ...current,
    ...(label != null ? { repairsLabel: label } : {}),
    ...(done != null ? { repairsDone: Number(done) } : {})
  })
  db.meta.vitrine = { ...next, readyTally: current.readyTally }
  return { ok: true, vitrine: db.meta.vitrine }
}

/** +1 à l'entrée dans « prêt pour retrait » — et jamais de retour en arrière. */
export function bumpReadyTally(db) {
  db.meta = db.meta && typeof db.meta === 'object' ? db.meta : {}
  const v = clampVitrine(db.meta.vitrine)
  db.meta.vitrine = { ...v, readyTally: clampVitrine({ readyTally: v.readyTally + 1 }).readyTally }
  return db.meta.vitrine.readyTally
}
