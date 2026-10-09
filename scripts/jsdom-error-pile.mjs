/**
 * La pile d'une faute levée dans une page jsdom — celle de LA PAGE, pas celle du moteur.
 *
 * Pourquoi ce module existe : jsdom ne propage pas l'exception du bundle, il
 * l'emballe (`runtime-script-errors.js`) dans
 *
 *     new Error(`Uncaught [${nom}: ${message}]`, { cause: error })
 *
 * et émet CET emballage sur le `virtualConsole`. Sa pile à lui commence à
 * `reportException` — deux lignes qui ne disent ni où, ni quoi. La pile utile,
 * celle du `TypeError` d'origine, est sur `e.cause.stack`. Confondre les deux
 * coûte cher : la porte « UI audit » a rouge pendant cinq têtes consécutives sur
 * `✗ fr/orders : … reading 'querySelector'` sans qu'aucun journal ne donne le
 * frame, alors que l'information était à portée de main — et un rouge sans frame
 * ne se répare pas, il se devine.
 *
 * Le module est sans effet de bord et ne filtre rien : il ne fait que choisir la
 * meilleure pile disponible. Les harnais restent libres de leur liste d'excuses
 * (ici, aucune).
 */

/** Les frames qui citent le code testé — le bundle du crawl ou les sources. */
const UTILE = /dist-crawl|assets\/|src\/|scripts\//

/**
 * @param {Error} e l'erreur reçue par `virtualConsole.on('jsdomError')` (ou une
 *   rejection du processus) ; toute forme est tolérée, y compris une chaîne.
 * @param {{head?: number, utile?: number}} opts combien de frames de tête et de
 *   frames utiles on garde.
 * @returns {string} la pile compacte (` ← `-séparée), ou `''` si rien n'est lisible.
 */
export function pileDeFaute(e, { head = 2, utile = 3 } = {}) {
  const source = meilleureStack(e)
  if (!source) return ''
  const frames = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Error:') && !l.startsWith('TypeError:') && !/^at\s*$/.test(l))
  if (!frames.length) return ''
  // Les frames de jsdom (`reportException`, `processJavaScript`, `task_queues`)
  // ne disent rien de la faute : on les garde en tête — elles attestent que la
  // faute vient bien de l'évaluation d'un script — puis on ajoute les frames qui
  // touchent le code testé, dédupliqués et dans l'ordre d'apparition.
  const nôtres = frames.filter((l) => UTILE.test(l)).slice(0, utile)
  return [...new Set([...frames.slice(0, head), ...nôtres])].join(' ← ')
}

/** La pile de la page si elle existe, sinon celle reçue, sans dupliquer un message. */
function meilleureStack(e) {
  if (!e) return ''
  if (typeof e === 'string') return e
  for (const candidat of [e.cause, e.error, e.detail, e]) {
    const s = candidat && typeof candidat.stack === 'string' ? candidat.stack : ''
    // Une `cause` dont la pile ne serait pas exploitable (empty, ou égale au
    // message seul) est ignorée : on descend à la suivante.
    if (s.split('\n').filter((l) => l.trim().startsWith('at ')).length > 0) return s
  }
  return ''
}
