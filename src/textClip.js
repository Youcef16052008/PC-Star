/**
 * LOT P5 (audit 19/09/2026, relecture après P4) — couper et compter du texte
 * comme un humain compte des caractères, pas comme une surcouche UTF-16.
 *
 * LE DÉFAUT MESURÉ. Tous les bornages du dépôt comptaient des **unités de code
 * UTF-16** (`str.length`, `str.slice(0, N)`) et non des **points de code**. Pour
 * du texte latin, les deux se valent — c'est pour ça que le trou n'apparaissait
 * dans aucun test. Pour un emoji, chaque caractère compte double, et le slice
 * tombe pile entre les deux moitiés d'une paire de substituts. Reproduit en
 * direct sur la vitrine du comptoir (`PUT /api/master/vitrine`, libellé
 * « a » + 48 🧰, soit 49 caractères) :
 *
 *   stocké  : 48 unités / 25 caractères, dernier code = U+D83E  ← moitié de paire
 *   public  : `GET /api/meta` renvoie ce U+D83E seul → le navigateur affiche ?
 *
 * Deux conséquences distinctes : le maître qui colle des emoji dans un libellé
 * reçoit **la moitié** de ce qu'il a écrit, et le site public affiche un
 * caractère de remplacement — un texte corrompu dans la base, pas seulement un
 * affichage : `JSON.stringify` l'écrit `\ud83e`, il survit à `JSON.parse`, il est
 * resservi à chaque visiteur et il repasse dans l'export CSV et le message
 * WhatsApp.
 *
 * LA RÈGLE, EN UN SEUL ENDROIT. `countChars` compte des points de code,
 * `clipChars` coupe sur une frontière de paire. Un module sans effet de bord,
 * sans DOM, sans environnement — importable du front comme du serveur (mêmes
 * obligations que `src/orderLogic.js` et `src/data.js`, voir `lot1BaseScripts`).
 *
 * Ce que le module ne fait PAS : il ne tronque pas à la place du contrôle. Une
 * limite qui se dépasse se refuse (`name_too_long`, `vitrine_count`) ; lui
 * s'assure seulement que, quand une coupe est voulue, elle ne coupe pas un
 * caractère en deux.
 */

/**
 * Nombre de caractères (points de code) d'une chaîne — pas le nombre d'unités
 * UTF-16. Les refus de longueur passent par `excedeChars` (ci-dessous) ; ce
 * compte-là reste l'oracle des verrous, ceux qui vérifient que la réponse
 * « trop long » ne change pas entre les deux formes — et le seul moyen, pour un
 * test ou un diagnostic, de dire combien de signes il y a dans un texte.
 */
export function countChars(value) {
  const s = String(value ?? '')
  // Chemin rapide : en dessous de U+0800 il ne peut pas y avoir de paire de
  // substituts, donc les deux comptes coïncident — la moitié des appels viennent
  // de là (textes latin-courants du catalogue).
  if (s.length < 2) return s.length
  let n = 0
  for (const _ of s) n += 1 // itère sur les points de code, y compris émojis et CJK extension B
  return n
}

/**
 * Une chaîne nettoyée des **moitiés de paire orphelines** qu'elle pourrait
 * porter — c'est-à-dire du texte déjà corrompu par l'ancienne coupe en unités.
 *
 * Le clip ci-dessous empêche la corruption à l'écriture ; ceci la répare à la
 * lecture. Les deux sont nécessaires : une base écrite avant le correctif
 * contient encore un U+D83E seul en fin de libellé, et ce caractère repartait
 * tel quel dans `GET /api/meta`, le CSV et le message WhatsApp — un site public
 * qui affiche ? n'est pas réparé par la seule règle d'écriture.
 *
 * Une tête de substitut (U+D800–U+DBFF) sans queue qui la suit, ou une queue
 * (U+DC00–U+DFFF) sans tête, sont retirées. Le texte bien formé ressort inchangé
 * (identité stricte quand il n'y a rien à retirer).
 */
export function repairPaires(value) {
  const s = String(value ?? '')
  let corrompu = false
  for (let i = 0; i < s.length; i += 1) {
    const u = s.charCodeAt(i)
    if (u >= 0xd800 && u <= 0xdbff) {
      const suite = s.charCodeAt(i + 1)
      if (!(suite >= 0xdc00 && suite <= 0xdfff)) { corrompu = true; break }
      i += 1
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      corrompu = true
      break
    }
  }
  if (!corrompu) return s // chemin courant : rien de sale, aucune copie
  let out = ''
  for (const ch of s) {
    const u = ch.charCodeAt(0)
    if (u >= 0xd800 && u <= 0xdbff) {
      // Une tete n'est garde que si le point de code suivant est sa queue :
      // l'iteration sur la chaine donne des caracteres entiers, donc un emoji
      // valide tient dans `ch` (deux unites) et un orphelin dans une unite.
      if (ch.length !== 2) continue
      out += ch
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      continue // queue sans tete
    } else {
      out += ch
    }
  }
  return out
}

/**
 * `true` quand `value` dépasse `max` **caractères** (points de code).
 *
 * Le test d'usure du correctif P5 : refuser un texte trop long se fait avant
 * toute écriture, donc sur des entrées que l'attaquant choisit — mesurer la
 * longueur complète d'un nom de 4 Mo pour découvrir qu'il dépasse 64 signes
 * coûterait plus cher que le refus qu'il prépare. `s.length` (O(1)) écarte d'abord
 * les cas où il est mathématiquement impossible de dépasser (une chaîne de N
 * unités compte au plus N caractères), puis on s'arrête au premier caractère de
 * trop : le coût ne dépend plus que de `max`, jamais de la taille du corps reçu.
 */
export function excedeChars(value, max) {
  const s = String(value ?? '')
  const seuil = Math.floor(Number(max))
  if (!Number.isFinite(seuil)) return false
  if (s.length <= seuil) return false
  let n = 0
  for (let i = 0; i < s.length; ) {
    n += 1
    if (n > seuil) return true
    i += s.codePointAt(i) > 0xffff ? 2 : 1
  }
  return false
}

/**
 * La chaîne coupée à `max` caractères, sans jamais laisser une moitié de paire
 * de substituts en fin de chaîne.
 *
 * `max <= 0` → chaîne vide. Une chaîne déjà assez courte est rendue telle quelle
 * (identité stricte, pas une copie : `clipChars('abc', 10) === 'abc'`).
 */
export function clipChars(value, max) {
  const s = String(value ?? '')
  const budget = Math.floor(Number(max))
  if (!Number.isFinite(budget) || budget <= 0) return ''
  // `s.length` est un MAJORANT du nombre de points de code : s'il tient, rien à faire.
  if (s.length <= budget) return s
  let out = ''
  let pris = 0
  for (const ch of s) {
    if (pris >= budget) break
    out += ch
    pris += 1
  }
  return out
}
