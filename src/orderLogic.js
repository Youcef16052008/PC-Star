import { STORE, money, specOf } from './data.js'

/**
 * Pure order helpers (shared client tests + local fallback).
 */

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'picked', 'cancelled']

export function makeOrderCode(date = new Date(), seq = 1) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `PS-${y}${m}${day}-${String(seq).padStart(4, '0')}`
}

/** Check cart lines against a stock map { id: qty }. */
export function checkStock(items, stockMap) {
  const shortages = []
  for (const line of items || []) {
    const left = Math.max(0, Number(stockMap[line.id] ?? 0))
    const need = Math.max(1, Math.floor(Number(line.qty) || 1))
    if (left < need) shortages.push({ id: line.id, name: line.name, need, left })
  }
  return { ok: shortages.length === 0, shortages }
}

/**
 * Quantité réellement comptée pour une ligne de panier.
 *
 * P22 (bug C) : le décrément utilisait `Math.max(1, … || 1)` et la
 * restauration `Math.max(0, … || 0)`. Une ligne sans `qty` retirait donc 1
 * unité mais n'en rendait aucune : mesuré, stock 5 → 4 après commande → 4
 * après annulation. Les deux fonctions partagent désormais la même règle.
 */
export function lineQty(line) {
  return Math.max(1, Math.floor(Number(line?.qty) || 1))
}

/** Apply reservation decrement (immutable). */
export function applyStockDecrement(stockMap, items) {
  const next = { ...stockMap }
  for (const line of items || []) {
    const id = line.id
    next[id] = Math.max(0, (Number(next[id]) || 0) - lineQty(line))
  }
  return next
}

/** Restore stock on cancel (immutable). */
export function applyStockRestore(stockMap, items) {
  const next = { ...stockMap }
  for (const line of items || []) {
    const id = line.id
    next[id] = Math.max(0, (Number(next[id]) || 0) + lineQty(line))
  }
  return next
}

/**
 * P22 (bug G) — Table unique des transitions de statut.
 *
 * Le client (`canTransition`) et le serveur (`setOrderStatus`) appliquaient
 * chacun leur règle, et elles divergeaient : le serveur autorisait
 * `preparing → new` et `ready → preparing` (vérifié en direct, HTTP 200), le
 * client les interdisait. Comme `canTransition` n'a aujourd'hui aucun appelant
 * hors tests, rien ne se voyait — mais brancher le client sur sa propre table
 * aurait masqué des transitions que le backend accepte.
 *
 * La table vit ici et `server/catalog.js` l'importe : une seule définition,
 * donc plus de divergence possible.
 */
export const ORDER_TRANSITIONS = {
  new: ['preparing', 'ready', 'picked', 'cancelled'],
  pending: ['preparing', 'ready', 'picked', 'cancelled'],
  preparing: ['new', 'ready', 'picked', 'cancelled'],
  ready: ['preparing', 'picked', 'cancelled'],
  picked: [],
  cancelled: []
}

export function canTransition(from, to) {
  if (!ORDER_STATUSES.includes(to)) return false
  // `pending` (héritage) a sa propre entrée dans la table : aucun remapping.
  const allowed = ORDER_TRANSITIONS[from]
  // Statut inconnu : seule l'annulation reste possible (comportement historique,
  // couvert par src/p22Audit.test.js).
  if (!allowed) return to === 'cancelled'
  return allowed.includes(to)
}

/**
 * LOT 8.3 (A3) — une commande est-elle annulable **depuis cet écran** ?
 *
 * Deux conditions, une seule règle (la même pour le bouton de la page
 * « Commandes » et pour le garde locale de `cancelMyOrder`) :
 *  · le statut doit être `new`/`pending` — la règle historique, côté serveur
 *    comme client (`ORDER_TRANSITIONS` n'autorise plus l'annulation au-delà) ;
 *  · la commande doit être **revendicable**. Depuis le lot 4.4 (R20), une
 *    commande guest déposée au numéro d'un compte existant est marquée
 *    `claimable: false` : le serveur l'écarte de `GET /api/me/orders` ET répond
 *    **404** à son annulation. Le client recevait ce drapeau, le persistait dans
 *    sa copie locale, puis l'ignorait — la page affichait un bouton « Annuler »
 *    qui échouait à tous les coups avec un message générique
 *    (« L'annulation a échoué »), sans dire ni pourquoi ni quoi faire.
 *
 * `claimable` absent veut dire revendicable (commandes antérieures au lot 4.4,
 * commandes locales hors-ligne, commandes du titulaire du compte) : le
 * comportement habituel est préservé.
 *
 * @param {{status?: string, claimable?: boolean}} order
 * @returns {boolean}
 */
export function canCancelHere(order) {
  // Pas d'objet → pas d'annulation : un `undefined` qui traîne (commande
  // supprimée entre-temps) ne doit pas être traité comme une commande neuve.
  if (!order || typeof order !== 'object') return false
  const status = order?.status || 'new'
  if (status !== 'new' && status !== 'pending') return false
  return order?.claimable !== false
}

export function statusLabelKey(status) {
  const s = status === 'pending' ? 'new' : status
  return `orderStatus_${s}`
}

/**
 * P14 (#3) — Numéro au format attendu par `wa.me` : international sans « + »
 * et sans le 0 local (`213XXXXXXXXX`).
 *
 * La base stocke le format local `0[567]XXXXXXXX` (`normalizePhone` côté
 * serveur). L'ancienne fonction locale du Desk ne traitait que le cas 9
 * chiffres : **chaque** bouton WhatsApp du comptoir partait donc sur
 * `wa.me/0550123456`, invalide. Partagée ici pour être testée sans DOM.
 *
 * @returns {string} le numéro international, ou `''` si inexploitable
 *   (le Desk n'affiche alors aucun bouton plutôt qu'un lien mort).
 */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('213')) d = d.slice(3)
  // Format local stocké : 0 + 9 chiffres.
  if (d.length === 10 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 9 && /^[567]/.test(d)) return `213${d}`
  return ''
}

/**
 * P9 (P7-4) : date LOCALE (YYYY-MM-DD) de `date` — unique référence de la
 * « journée » du shop (création de commande + export CSV). Avant : le client
 * envoyait la date UTC (toISOString) → décalage d'une heure par jour en Oran.
 */
export function localDay(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * P8 (P7-2) : classification d'un échec de `api.postOrder`.
 * - 'offline'     : backend injoignable → SEUL cas où le repli local est légitime.
 * - 'unavailable' : 409 — produit retiré de la vente par le maître (LOT 8.1 / A1).
 * - 'unknown'     : 400 — id inconnu du catalogue serveur (LOT 8.2 / A2).
 * - 'stock'       : 409/rupture → message stock, stock actualisé.
 * - 'rate'        : 429 → message d'attente (retryAfter s), panier conservé.
 * - 'server'      : 5xx/autre → message erreur serveur, panier conservé.
 * (un succès est géré avant l'appel — ne pas passer un r.ok.)
 *
 * LOT 8.1 + 8.2 : les deux nouveaux refus sont testés AVANT la rupture, parce
 * qu'ils partagent son statut 409 (`unavailable`) ou un corps `error` distinct :
 * sans cet ordre, un produit retiré de la vente aurait été annoncé comme une
 * simple rupture — donc « réessayez plus tard » pour un article qui ne
 * reviendra pas, et le panier aurait été conservé tel quel.
 */
export function orderApiFailure(r) {
  if (!r || r.offline) return { kind: 'offline' }
  const err = r.data?.error
  if (err === 'unavailable') return { kind: 'unavailable', lines: r.data?.unavailable || [] }
  if (err === 'unknown_product') return { kind: 'unknown', lines: r.data?.unknown || [] }
  if (r.status === 409 || err === 'stock') {
    return { kind: 'stock', shortages: r.data?.shortages || [] }
  }
  if (r.status === 429) return { kind: 'rate', retryAfter: r.data?.retryAfter || null }
  return { kind: 'server' }
}

/**
 * LOT 8.1 (A1) + LOT 8.2 (A2) — message qui NOMME les lignes refusées.
 *
 * Le serveur renvoie les lignes en cause (`{ id, name }`) : un produit retiré
 * de la vente par le maître, ou un id qu'il ne connaît pas (catalogue changé
 * depuis l'ouverture de l'onglet, commande rejouée). Un message générique
 * laisserait l'utilisateur renvoyer exactement la même commande, indéfiniment.
 * Comme `shortageMessage`, la liste est bornée (`max`, 3) pour rester lisible.
 *
 * @param {Array<{id?: string, name?: string}>} lines
 * @param {(key: string, vars?: object) => string} t
 * @param {'unavailable'|'unknown'} kind
 */
export function orderBlockedMessage(lines, t, kind = 'unavailable', { max = 3 } = {}) {
  const list = (Array.isArray(lines) ? lines : []).filter(Boolean)
  const detail = kind === 'unknown' ? 'orderUnknownDetail' : 'orderUnavailableDetail'
  if (!list.length) return t(kind === 'unknown' ? 'orderUnknown' : 'orderUnavailable')
  const shown = list.slice(0, Math.max(1, max)).map((l) => l.name || l.id || '?')
  if (list.length > shown.length) shown.push(t('stockShortMore', { n: list.length - shown.length }))
  return t(detail, { lines: shown.join(' · ') })
}

/**
 * LOT 8.1 (A1) + LOT 8.2 (A2) — retire du panier les lignes refusées.
 *
 * Le refus serveur est définitif pour ces lignes : les laisser dans le panier
 * ferait échouer chaque tentative suivante (et le repli hors-ligne finirait par
 * créer une commande locale sur un article qui n'existe plus). Le reste du
 * panier est conservé — l'utilisateur peut commander les autres lignes.
 *
 * @param {Array<{id: string}>} cart
 * @param {Array<{id?: string}|string>} lines lignes refusées (ou simples ids)
 * @returns {Array} nouveau panier, sans les lignes refusées
 */
export function dropCartLines(cart, lines) {
  const list = Array.isArray(cart) ? cart : []
  const ids = new Set(
    (Array.isArray(lines) ? lines : [])
      .map((l) => String(l?.id ?? l ?? ''))
      .filter(Boolean)
  )
  if (!ids.size) return list
  return list.filter((c) => !ids.has(String(c?.id || '')))
}

/**
 * LOT 2.2 (F3 + F4) — prochain code de commande, dérivé du **max** des
 * séquences du jour. Fonction PARTAGÉE : le client (repli hors-ligne) et le
 * serveur (`server/catalog.js`) appellent exactement le même algorithme.
 *
 * Avant :
 *  · le client dérivait déjà du max (P8 / P7-2) ;
 *  · le serveur comptait les commandes du jour (`sameDay.length + 1`).
 *
 * Le comptage produisait des collisions dès qu'une commande du jour était
 * supprimée (`DELETE /api/orders/:code`, P19) : 0001, 0002, 0003 créées, 0002
 * supprimée → la suivante recomptait 2 + 1 = **0003, déjà attribué**. Deux
 * `PS-20260915-0003` ont été observés en base pendant l'audit. Le code est la
 * clé affichée au comptoir, reprise dans l'export CSV, le message WhatsApp et
 * `PATCH /api/orders/:code` (qui ne traite que la première occurrence trouvée) :
 * un doublon rend la commande ambiguë partout.
 *
 * `day` : 'YYYY-MM-DD'. Toute autre valeur → journée locale courante.
 */
/**
 * LOT 5.2 (U2) — message d'échec de stock qui nomme les lignes en cause.
 *
 * Le serveur renvoie `shortages` avec le 409 (`{ id, name, need, left }`) :
 * quelle pièce manque, combien étaient demandées, combien il en reste. Le front
 * jetait tout cela et affichait « Stock insuffisant » — à l'utilisateur de
 * deviner quelle ligne de son panier posait problème, puis de tester des
 * quantités au hasard. Les lignes sont bornées à `max` (3) pour que le toast
 * reste lisible ; le reliquat est annoncé (« et N autres lignes »).
 *
 * @param {Array<{id?: string, name?: string, need?: number, left?: number}>} shortages
 * @param {(key: string, vars?: object) => string} t
 */
export function shortageMessage(shortages, t, { max = 3 } = {}) {
  const list = (Array.isArray(shortages) ? shortages : []).filter(Boolean)
  if (!list.length) return t('stockShort')
  const shown = list.slice(0, Math.max(1, max)).map((s) =>
    t('stockShortLine', { name: s.name || s.id || '?', need: s.need ?? '?', left: s.left ?? 0 })
  )
  if (list.length > shown.length) shown.push(t('stockShortMore', { n: list.length - shown.length }))
  return t('stockShortDetail', { lines: shown.join(' · ') })
}

/**
 * Limite pratique du texte d'un lien `wa.me`.
 *
 * LOT 5.7 (U7) : WhatsApp/`wa.me` tronque les URL très longues (de l'ordre de
 * 4 Ko une fois le texte encodé) — et la troncature tombe où elle veut, en
 * général au milieu du récapitulatif, sans aucun avertissement. Un panier de
 * 40 lignes dépassait cette limite : le commerçant recevait un message coupé
 * **sans le savoir**, et le total pouvait disparaître avec. On garde une marge
 * sous les 4 Ko (le texte est ensuite `encodeURIComponent`-é, ce qui gonfle les
 * accents et l'arabe).
 */
export const WA_TEXT_LIMIT = 3800

/**
 * Message WhatsApp du panier — composition + garde de longueur.
 *
 * Seules les LIGNES DE PANIER sont bornées (c'est la partie non bornée du
 * message) : l'en-tête, l'adresse, le total et les coordonnées restent
 * intacts, et une mention dit combien de lignes ont été retirées. Un message
 * plus court mais complet vaut mieux qu'un message long coupé au hasard.
 *
 * @param {Array<{qty:number,name:string,sku:string}>} cart
 * @param {number} total
 * @param {{name?:string,phone?:string,slot?:string}} pickup
 * @param {(key: string, vars?: object) => string} t
 * @param {{ limit?: number }} [opts]
 */
export function buildWaMessage(cart, total, pickup, t, { limit = WA_TEXT_LIMIT } = {}) {
  const lines = (Array.isArray(cart) ? cart : []).map((i) => `${i.qty} x ${i.name} (${i.sku})`)
  const who = pickup?.name ? `${t('waName')}: ${pickup.name}\n` : ''
  const tel = pickup?.phone ? `${t('waPhone')}: ${pickup.phone}\n` : ''
  const when = pickup?.slot ? `${t('waSlot')}: ${pickup.slot}\n` : ''
  const compose = (kept, note = '') =>
    t('waMessage', {
      address: STORE.address,
      who,
      tel,
      when,
      items: [...lines.slice(0, kept), ...(note ? [note] : [])].join('\n'),
      total: money(total)
    })

  let kept = lines.length
  let msg = compose(kept)
  while (msg.length > limit && kept > 1) {
    kept -= 1
    msg = compose(kept)
  }
  if (kept < lines.length) {
    // La mention « N lignes retirées » est ce qui rend la troncature honnête :
    // on lui fait de la place en retirant une ligne de plus, plutôt que de
    // l'abandonner. Elle ne doit en revanche JAMAIS pousser le message hors
    // limite — la troncature brute qui suivrait mangerait le TOTAL (dernière
    // ligne du modèle), donc en dernier recours on s'en passe.
    const note = (n) => t('waTruncated', { n })
    let noted = compose(kept, note(lines.length - kept))
    while (noted.length > limit && kept > 1) {
      kept -= 1
      noted = compose(kept, note(lines.length - kept))
    }
    msg = noted.length <= limit ? noted : compose(kept)
  }
  // Cas pathologique : une seule ligne dépasse déjà (nom de produit énorme).
  // On tronque alors brutalement — un message coupé et signalé vaut mieux qu'un
  // lien `wa.me` qui ne s'ouvre pas.
  if (msg.length > limit) msg = `${msg.slice(0, Math.max(0, limit - 1))}…`
  return msg
}

export function nextOrderCode(existingCodes = [], day) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))
    ? // Les composants sont passés un par un : `new Date('YYYY-MM-DD')` serait
      // interprété en UTC et reculerait d'un jour avant 1 h à Oran (UTC+1).
      new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12)
    : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const re = new RegExp(`^PS-${y}${m}${dd}-(\\d+)$`)
  let max = 0
  for (const raw of existingCodes || []) {
    const mt = re.exec(String(raw?.code || raw || ''))
    if (mt) max = Math.max(max, parseInt(mt[1], 10))
  }
  return makeOrderCode(d, max + 1)
}

/**
 * P8 (P7-2) : prochain code LOCAL de commande pour `date` — dérivé du max des
 * codes existants du jour (jamais `length + 1`) : plus de collision quand la
 * liste client ne contient pas toutes les commandes du jour.
 *
 * LOT 2.2 : simple adaptation de `nextOrderCode` au paramètre `Date` historique
 * (les appelants et les tests existants passent une Date, pas une chaîne).
 */
export function nextLocalOrderCode(existingCodes = [], date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return nextOrderCode(existingCodes, `${y}-${m}-${d}`)
}

/**
 * P8 (P7-3) : état du formulaire de retrait pour un compte donné.
 * - pas de compte (logout/visiteur) : retour aux valeurs vides `defaults`
 *   — les infos du client précédent ne doivent jamais rester pré-remplies ;
 * - avec compte : reprise nom/tél/wilaya du profil (le reste — slot, payment —
 *   est conservé depuis `prev`).
 */
export function pickupForUser(user, prev = {}, defaults = {}) {
  if (!user) return { ...defaults }
  return {
    ...prev,
    name: user.name || prev.name || defaults.name || '',
    phone: user.phone || prev.phone || defaults.phone || '',
    wilaya: user.wilaya || prev.wilaya || defaults.wilaya || 'Oran'
  }
}

/** Builder power recap from picked parts. */
export function buildPowerRecap(parts) {
  const list = (parts || []).filter(Boolean)
  let tdp = 0
  let psuMinGpu = 0
  let psuWatts = 0
  let socket = null
  let memory = null
  let form = null
  for (const p of list) {
    const c = p.compat || {}
    if (c.socket && !Array.isArray(c.socket)) socket = c.socket
    if (c.memory) memory = c.memory
    if (c.form) form = c.form
    if (c.psuMin) psuMinGpu = Math.max(psuMinGpu, c.psuMin)
    if (c.psuWatts) psuWatts = Math.max(psuWatts, c.psuWatts)
    // P17 (rapport #6, mais la cause est autre) : le TDP n'est JAMAIS un champ
    // du produit — il est dérivé par `specOf()` (motifs sur id/nom/SKU).
    // `p.tdp` était donc toujours `undefined` et `c.tdp` jamais posé :
    // l'estimation ignorait complètement le CPU et retombait sur un plancher
    // de 150 W. Mesuré avant correctif : 14700K + Z790 → 150 W
    // (`specOf(cpu-14700k).tdp` vaut pourtant 125, donc ~275 W attendus).
    const explicitTdp = Number(c.tdp)
    if (Number.isFinite(explicitTdp)) {
      tdp += explicitTdp
    } else if (p.category === 'cpu' || p.category === 'gpu') {
      const derived = Number(specOf(p).tdp)
      if (Number.isFinite(derived)) tdp += derived
    }
  }
  const estimate = Math.max(tdp + 150, psuMinGpu || 0)
  return {
    socket,
    memory,
    form,
    estimateWatts: estimate,
    psuWatts,
    psuOk: !psuWatts || psuWatts >= estimate,
    psuMinSuggested: Math.ceil(estimate / 50) * 50
  }
}

/** Star builder presets — ids must exist in catalog. */
export const BUILD_PRESETS = [
  {
    id: 'student',
    titleKey: 'presetStudent',
    bodyKey: 'presetStudentBody',
    slots: {
      // P21 : `cpu-5600` et `mag-ddr4-16` ont été retirés du catalogue avec la
      // section « dz-hit ». Remplacés par des références toujours vendues et
      // strictement compatibles (socket AM4, mémoire DDR4).
      motherboard: 'mb-b450m',
      cpu: 'cpu-5500',
      ram: 'team-ddr4-16',
      ssd: 'ssd-1t',
      psu: 'psu-650-cm',
      case: 'case-atx'
    }
  },
  {
    id: 'gaming1080',
    titleKey: 'presetGaming',
    bodyKey: 'presetGamingBody',
    slots: {
      motherboard: 'mb-b650',
      cpu: 'cpu-7600',
      ram: 'ram-32',
      gpu: 'gpu-4060',
      ssd: 'ssd-1t',
      psu: 'psu-750',
      case: 'case-atx',
      cooler: 'cooler'
    }
  },
  {
    id: 'office',
    titleKey: 'presetOffice',
    bodyKey: 'presetOfficeBody',
    slots: {
      motherboard: 'mb-a520m',
      cpu: 'cpu-5500',
      ram: 'team-ddr4-16', // P21 : `mag-ddr4-16` retiré du catalogue
      ssd: 'ssd-1t',
      psu: 'psu-550-evga',
      case: 'case-atx'
    }
  }
]

export function applyPreset(catalog, preset) {
  const build = {}
  if (!preset?.slots) return build
  for (const [slot, id] of Object.entries(preset.slots)) {
    const p = catalog.find((x) => x.id === id)
    if (p) build[slot] = p
  }
  return build
}

/**
 * P21 — Fusionne une liste de commandes venant du serveur avec l'état local.
 *
 * Le bug : `pull()` envoie `GET /api/orders` à T0 et applique la réponse à T2
 * via `setReservations(next)`, sans condition. Si le maître clique sur
 * « préparer » entre les deux, le `PATCH` aboutit à T1 et met l'état local à
 * jour — puis la réponse du polling, qui a été *produite avant* le PATCH,
 * arrive et remet l'ancien statut. À l'écran le badge revient en arrière, ce
 * qui se lit exactement comme « je clique, rien ne change ».
 *
 * Règle appliquée : une commande modifiée localement après le départ de la
 * requête (`editedAfter`) garde son statut local ; toutes les autres prennent
 * la valeur du serveur, qui reste la source de vérité.
 *
 * LOT 2.3 (F5) : les commandes **locales-only** survivent à la fusion. Avant,
 * la fonction ne renvoyait que `server.map(...)` : une commande créée pendant
 * une coupure réseau (repli hors-ligne de `reserve()`, marquée `localOnly`)
 * disparaissait de l'écran au premier `pull()` réussi — définitivement, puisque
 * le serveur ne l'a jamais reçue. Elle restait dans `localStorage` mais plus
 * dans l'état, donc invisible au comptoir comme dans « Mes commandes ».
 *
 * Seules les commandes explicitement marquées `localOnly` à la création sont
 * réinjectées. Ce choix est délibéré : une copie locale d'une commande
 * supprimée côté serveur (par un autre appareil du maître) n'a PAS ce marqueur
 * et ne ressuscite donc pas. Si le serveur connaît finalement le même code
 * (collision de séquence, cf. `nextOrderCode`), c'est l'objet serveur qui gagne
 * et le marqueur tombe.
 *
 * @param {Array}  serverOrders  commandes renvoyées par GET /api/orders
 * @param {Array}  localOrders   état local courant
 * @param {number} editedAfter   horodatage du départ de la requête (ms)
 * @param {Map}    editedAt      code → horodatage de la dernière édition locale
 * @returns {Array} liste fusionnée
 */
export function mergeServerOrders(serverOrders, localOrders, editedAfter, editedAt) {
  const server = Array.isArray(serverOrders) ? serverOrders : []
  const local = Array.isArray(localOrders) ? localOrders : []
  if (!editedAt || typeof editedAt.get !== 'function') return server

  const localByCode = new Map(local.map((o) => [o?.code, o]))
  const merged = server.map((o) => {
    const at = editedAt.get(o?.code)
    // Non édité localement, ou édité AVANT le départ de la requête : la réponse
    // du serveur est postérieure au changement, on la prend.
    if (!at || at <= editedAfter) return o
    const mine = localByCode.get(o?.code)
    // Le serveur ne connaît pas encore notre changement : on garde le statut
    // local (et l'objet serveur pour tout le reste).
    return mine ? { ...o, status: mine.status } : o
  })

  const serverCodes = new Set(server.map((o) => o?.code))
  const orphans = local.filter((o) => o?.localOnly === true && o?.code && !serverCodes.has(o.code))
  // Les commandes locales-only sont les plus récentes (créées pendant la
  // coupure) : devant, comme le reste de la liste triée du plus récent au plus
  // ancien.
  return [...orphans, ...merged]
}
