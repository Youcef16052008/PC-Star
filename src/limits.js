/**
 * LOT 8.4 (A4) + LOT 8.5 (A5) — les budgets d'octets, en UN seul endroit.
 *
 * Pourquoi ce module : trois valeurs vivaient chacune de leur côté et se
 * contredisaient.
 *
 *  · `api/index.js` exportait `config.api.bodyParser.sizeLimit = '10mb'` — une
 *    configuration **Next.js**, ignorée par `@vercel/node` (ce dépôt n'utilise
 *    pas Next.js). Elle ne relevait donc rien du tout.
 *  · `server/index.js` bornait le corps à **15 Mo** — inaccessible sur Vercel :
 *    la plateforme refuse au-delà de **4,5 Mo** avant même d'appeler la
 *    fonction (`FUNCTION_PAYLOAD_TOO_LARGE`), et cette limite n'est pas
 *    relevable (Hobby comme Pro).
 *  · `src/MasterPage.jsx` acceptait des fichiers de **10 Mo** en entrée tout en
 *    affichant « Image trop lourde (max 2,5 Mo) ».
 *  · `src/photoCompress.js` décidait de compresser sur les **dimensions**
 *    (`scale === 1` → image renvoyée telle quelle), jamais sur le poids : un
 *    PNG 800×800 de 2 Mo partait sans compression, et 6 photos de ce type
 *    faisaient ~12 Mo de base64 — au-delà de la limite plateforme.
 *
 * Les constantes ci-dessous sont partagées par le client (compression, garde
 * avant envoi, messages) et le serveur (borne du corps, refus par photo) : une
 * seule définition, donc plus de divergence possible entre ce qui est annoncé,
 * ce qui est accepté et ce qui passe réellement.
 *
 * **Le budget, en clair** (6 photos, le maximum accepté) :
 *   6 × 400 Ko décodés = 2,4 Mo → ~3,2 Mo une fois en base64 dans le JSON
 *   → sous la garde applicative de 4 Mo → sous les 4,5 Mo de la plateforme.
 */

/** Limite de Vercel pour le corps d'une fonction serverless — non relevable. */
export const VERCEL_MAX_BODY_BYTES = 4.5 * 1024 * 1024

/**
 * Garde applicative : ce que l'application accepte d'envoyer/recevoir sur
 * Vercel. Volontairement **sous** la limite plateforme (marge pour les autres
 * champs du JSON et pour l'arrondi base64), afin que le refus vienne de
 * l'application — avec un message lisible — et non d'une page d'erreur Vercel.
 */
export const MAX_UPLOAD_BODY_BYTES = 4 * 1024 * 1024

/** Borne du corps hors serverless (serveur Node longue durée) : pas de limite plateforme. */
export const LOCAL_MAX_BODY_BYTES = 15 * 1024 * 1024

/** Poids cible d'UNE photo après compression client (octets décodés). */
export const MAX_PHOTO_BYTES = 400 * 1024

/** Poids maximal d'UNE photo accepté par le serveur (octets décodés du blob). */
export const MAX_PHOTO_SERVER_BYTES = 2.5 * 1024 * 1024

/** Nombre maximal de photos par produit. */
export const MAX_PHOTOS = 6

/** Poids maximal du FICHIER choisi par le maître avant compression. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024

/** Planchers de la boucle de compression (qualité, puis dimensions). */
export const COMPRESS_FLOOR = { quality: 0.5, maxDim: 320, steps: 12 }

/**
 * LOT 8.5 (A5) — poids du corps qu'un lot de photos produirait.
 *
 * Les dataURL voyagent en base64 **dans le JSON** : c'est donc la longueur des
 * chaînes qui compte, pas le poids décodé. Un budget par photo ne suffit pas —
 * six photos acceptables individuellement peuvent ensemble dépasser la limite
 * de la plateforme (4,5 Mo sur Vercel, refus avant même d'entrer dans la
 * fonction, non relevable).
 *
 * @param {string[]} dataUrls
 * @returns {number} octets du corps produit par ces photos (0 si liste vide)
 */
export function payloadBytes(dataUrls) {
  return (Array.isArray(dataUrls) ? dataUrls : []).reduce((n, u) => n + String(u || '').length, 0)
}

/**
 * LOT 8.5 (A5) — le corps dépasserait-il le budget d'envoi ?
 *
 * @param {string[]} dataUrls
 * @returns {number} le poids en octets s'il dépasse {@link MAX_UPLOAD_BODY_BYTES}, sinon 0
 */
export function payloadOverBudget(dataUrls) {
  const bytes = payloadBytes(dataUrls)
  return bytes > MAX_UPLOAD_BODY_BYTES ? bytes : 0
}

/** Mo arrondi à une décimale, pour les messages. */
export function toMb(bytes) {
  return Math.round(((Number(bytes) || 0) / (1024 * 1024)) * 10) / 10
}
