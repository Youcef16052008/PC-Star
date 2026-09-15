/**
 * P19 — Flux Desk en temps réel, avec repli automatique sur le polling.
 *
 * Comportement demandé : une commande doit arriver au comptoir sans attendre
 * la fenêtre de 20 s du `setInterval`. On ouvre donc un WebSocket
 * (`/api/desk-stream?token=…`), et **si le socket n'est pas disponible on
 * retombe sur le polling** — c'est le cas sur Vercel, où les WebSockets
 * n'existent pas en serverless. Le repli est automatique et invisible :
 * aucune configuration à faire selon l'hébergement.
 *
 * Le polling n'est jamais arrêté complètement : il reste la source de vérité
 * (une commande poussée peut se perdre si l'onglet était en veille), le socket
 * ne fait que déclencher un rafraîchissement immédiat.
 */

const POLL_MS = 20000 // inchangé : filet de sécurité
const LIVE_POLL_MS = 5 * 60 * 1000 // socket vivant : le polling ne sert que de filet
const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 30000
// LOT 3.10 (B14) : plafond de tentatives CONSÉCUTIVES. Sur Vercel il n'existe
// pas de WebSocket en serverless : l'upgrade échoue à chaque fois, pour toujours.
// Retenter indéfiniment ne fait que consommer du réseau et du CPU pour rien (et
// noie la console). Après ce nombre d'échecs d'affilée, on ARRÊTE de retenter le
// socket et on reste sur le polling, qui est de toute façon la source de vérité.
const MAX_RECONNECT_FAILS = 8

/**
 * @param {object} opts
 * @param {() => string} opts.getToken        token de session master
 * @param {() => void} opts.onEvent           appelé à chaque évènement reçu
 * @param {() => void} opts.onRefresh         appelé pour rafraîchir la liste
 * @param {() => boolean} opts.enabled        actif seulement en mode master
 * @param {number} [opts.pollMs]              cadence du polling de repli
 * @param {number} [opts.livePollMs]          cadence du filet quand le socket vit
 * @param {number} [opts.maxReconnectFails]   tentatives consécutives avant abandon (0 = illimité)
 * @param {(info: {fails: number}) => void} [opts.onGiveUp] appelé quand le socket est abandonné
 * @returns {{ close: () => void, isLive: () => boolean, refreshNow: () => void }}
 */
export function createDeskStream({
  getToken,
  onEvent,
  onRefresh,
  pollMs = POLL_MS,
  livePollMs = LIVE_POLL_MS,
  reconnectMinMs = RECONNECT_MIN_MS,
  reconnectMaxMs = RECONNECT_MAX_MS,
  maxReconnectFails = MAX_RECONNECT_FAILS,
  onGiveUp,
}) {
  let ws = null
  let pollId = null
  let reconnectDelay = reconnectMinMs
  let reconnectId = null
  let closed = false
  let live = false
  let connecting = false
  let pollTick = 0
  let failStreak = 0 // échecs consécutifs d'ouverture (LOT 3.10 / B14)
  let gaveUp = false // socket définitivement abandonné → polling seul

  function startPolling() {
    if (pollId !== null || closed) return
    pollId = setInterval(() => {
      pollTick += 1
      // Sans socket on garde la cadence de 20 s (filet de sécurité).
      try {
        onRefresh?.()
      } catch {
        /* ignore */
      }
    }, pollMs)
  }

  function stopPolling() {
    if (pollId !== null) {
      clearInterval(pollId)
      pollId = null
    }
  }

  /** LOT 3.10 (B14) : comptabilise un échec et décide si on retente encore. */
  function noteFailure() {
    failStreak += 1
    if (maxReconnectFails > 0 && failStreak >= maxReconnectFails) {
      gaveUp = true
      try {
        onGiveUp?.({ fails: failStreak })
      } catch {
        /* ignore */
      }
      return false
    }
    return true
  }

  function scheduleReconnect() {
    if (closed || reconnectId !== null || gaveUp) return
    reconnectId = setTimeout(() => {
      reconnectId = null
      open()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs)
  }

  function open() {
    if (closed || connecting || live || gaveUp) return
    const token = getToken?.()
    if (!token) {
      // Sans token, pas de socket : polling seul.
      startPolling()
      return
    }
    // WebSocket n'existe pas dans certains environnements (Node, vieux
    // navigateurs) : polling seul.
    if (typeof WebSocket === 'undefined') {
      startPolling()
      return
    }
    // L'URL d'un WebSocket doit être absolue : sans `location` (SSR, tests) on
    // ne peut pas la construire — on retombe sur le polling au lieu de lever.
    const loc = typeof location !== 'undefined' ? location : undefined
    if (!loc?.host) {
      startPolling()
      return
    }
    connecting = true
    let sock = null
    try {
      // Origine courante : fonctionne derrière le proxy Vite comme en prod.
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
      // LOT 3.18 (R14) : le token n'est PLUS dans l'URL. Il passait dans les
      // journaux d'accès du proxy, dans l'historique des caches et dans les
      // outils de diagnostic ; l'authentification se fait par le premier
      // message envoyé juste après l'ouverture (voir `onopen`).
      sock = new WebSocket(`${proto}//${loc.host}/api/desk-stream`)
    } catch {
      connecting = false
      startPolling()
      if (noteFailure()) scheduleReconnect()
      return
    }
    ws = sock

    sock.onopen = () => {
      connecting = false
      live = true
      reconnectDelay = reconnectMinMs
      failStreak = 0
      // LOT 3.18 (R14) : premier message = authentification. Le serveur ferme le
      // socket (code 4401/4403/4408) si le token manque, est invalide, ou
      // n'arrive pas dans les 5 s — et `onclose` nous replie sur le polling.
      try {
        sock.send(JSON.stringify({ type: 'auth', token }))
      } catch {
        /* la fermeture qui suit déclenche le repli */
      }
      // Socket vivant : on garde le polling mais seulement en filet, à cadence
      // réduite (5 min) — le socket fait le travail.
      stopPolling()
      pollId = setInterval(() => {
        pollTick += 1
        try {
          onRefresh?.()
        } catch {
          /* ignore */
        }
      }, livePollMs)
      // Après une coupure, rafraîchir tout de suite : une commande peut être
      // arrivée pendant que le socket était fermé.
      try {
        onRefresh?.()
      } catch {
        /* ignore */
      }
    }

    sock.onmessage = (ev) => {
      let msg = null
      try {
        msg = JSON.parse(String(ev?.data))
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      try {
        onEvent?.(msg)
      } catch {
        /* ignore */
      }
      // Toute commande (nouvelle ou supprimée) déclenche un rafraîchissement.
      if (msg.type === 'order:new' || msg.type === 'order:deleted') {
        try {
          onRefresh?.()
        } catch {
          /* ignore */
        }
      }
    }

    sock.onerror = () => {
      // onclose suit : on y traite la reconnexion.
    }

    sock.onclose = () => {
      connecting = false
      live = false
      ws = null
      // Repli : le polling reprend immédiatement, puis on retente le socket —
      // sauf si le plafond d'échecs consécutifs est atteint (LOT 3.10 / B14) :
      // dans un environnement sans WebSocket, retenter ne sert à rien.
      stopPolling()
      startPolling()
      if (noteFailure()) scheduleReconnect()
    }
  }

  open()

  return {
    close() {
      closed = true
      stopPolling()
      if (reconnectId !== null) {
        clearTimeout(reconnectId)
        reconnectId = null
      }
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        ws = null
      }
      live = false
    },
    isLive: () => live,
    /** LOT 3.10 (B14) : vrai quand le socket a été abandonné (polling seul). */
    socketGaveUp: () => gaveUp,
    reconnectFails: () => failStreak,
    refreshNow() {
      pollTick += 1
      try {
        onRefresh?.()
      } catch {
        /* ignore */
      }
    },
    pollCount: () => pollTick,
  }
}
