/**
 * LOT P6 (S5) — la taille de page est une préférence, pas un état de la page.
 *
 * Mesuré sur la page rendue (`SearchPage` montée, jsdom) : choisir quarante-huit affichait
 * bien « 301 résultat(s) · page 1 sur 7 », mais le stockage ne portait **aucune** clé —
 * et au remontage (aller à l'accueil puis revenir, ou recharger : la page Recherche est
 * démontée dans les deux cas) le sélecteur retombait sur douze. Sur un catalogue de trois
 * cents fiches, « douze » n'est pas un neutre : c'est vingt-cinq clics que le client vient
 * de refaire pour rien. L'écran du comptoir, lui, garde sa fenêtre ouverte des heures ;
 * lui imposer de re-choisir sa taille à chaque navigation est une corvée inventée.
 *
 * Deux écrans, un seul choix : la préférence est stockée une fois, sous une clé à elle,
 * et lue par les deux. Elle ne vit pas dans `meta` (la cle `pcstar-catalog`) : `meta` est
 * l'état du catalogue, synchronisé avec le serveur, et une préférence d'affichage n'a
 * rien à faire dans une écriture de maître.
 *
 * Deux disciplines reprises ici, parce que c'est là qu'elles mordent :
 *  · la lecture se fait dans l'initializer de `useState` — l'endroit exact où F7 faisait
 *    tomber tout le site dans l'ErrorBoundary (le getter de `localStorage` lève
 *    `SecurityError` pendant le rendu). `asSafeStorage` ne lève jamais, `chargerTaille`
 *    non plus ;
 *  · la valeur relue repasse par `tailleSure` : une clé éditée à la main, un vieux format,
 *    un « 99 » laissé par un autre build, et la page retombe sur douze au lieu de
 *    s'appuyer sur un `slice` faux. Borer plutôt que refuser, comme partout depuis le lot P5.
 */
import { useState } from 'react'
import { asSafeStorage, safeStorage } from './safeStorage.js'
import { PAGE_TAILLE, tailleSure } from './pager.js'

/** Une clé par sujet : `pcstar-catalog` reste l'affaire du maître. */
export const CLE_PAGER = 'pcstar-pager'

/**
 * La taille retenue à la dernière visite, toujours valide pour l'interface.
 * Jamais de lever : un stockage bloqué ou corrompu se lit « douze ».
 */
export function chargerTaille(storage = safeStorage) {
  const brut = asSafeStorage(storage).getItem(CLE_PAGER)
  if (!brut) return PAGE_TAILLE
  let valeur
  try {
    const analyse = JSON.parse(brut)
    valeur = analyse && typeof analyse === 'object' ? analyse.taille : analyse
  } catch {
    return PAGE_TAILLE
  }
  return tailleSure(valeur)
}

/** Écrire ne doit jamais faire échouer un clic : `safeStorage` replie en mémoire. */
export function garderTaille(storage = safeStorage, taille) {
  asSafeStorage(storage).setItem(CLE_PAGER, JSON.stringify({ taille: tailleSure(taille) }))
}

/**
 * Le sélecteur des deux écrans : même lecture au montage, même écriture au choix.
 * Un composant qui rendrait `<select>` sans passer par là redeviendrait amnésique —
 * c'est ce que verrouille `p6SearchSurface.test.js`.
 */
export function useTaille(storage = safeStorage) {
  const [taille, setTaille] = useState(() => chargerTaille(storage))
  // Un seul point d'ecriture : le select ne peut pas porter une valeur que le
  // stockage ignorerait, et le stockage ne peut pas porter une valeur que le
  // select refuserait — les deux passent par `tailleSure`.
  function choisir(n) {
    const prochaine = tailleSure(n)
    setTaille(prochaine)
    garderTaille(storage, prochaine)
  }
  return [taille, choisir]
}
