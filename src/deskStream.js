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

/**
 * @param {object} opts
 * @param {() => string} opts.getToken        token de session master
 * @param {() => void} opts.onEvent           appelé à chaque évènement reçu
 * @param {() => void} opts.onRefresh         appelé pour rafraîchir la liste
 * @param {() => boolean} opts.enabled        actif seulement en mode master
 * @param {number} [opts.pollMs]              cadence du polling de repli
 * @param {number} [opts.livePollMs]          cadence du filet quand le socket vit
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
}) {
  let ws = null
  let pollId = null
  let reconnectDelay = reconnectMinMs
  let reconnectId = null
  let closed = false
  let live = false
  let connecting = false
  let pollTick = 0

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

  function scheduleReconnect() {
    if (closed || reconnectId !== null) return
    reconnectId = setTimeout(() => {
      reconnectId = null
      open()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs)
  }

  function open() {
    if (closed || connecting || live) return
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
      sock = new WebSocket(`${proto}//${loc.host}/api/desk-stream?token=${encodeURIComponent(token)}`)
    } catch {
      connecting = false
      startPolling()
      scheduleReconnect()
      return
    }
    ws = sock

    sock.onopen = () => {
      connecting = false
      live = true
      reconnectDelay = reconnectMinMs
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
      // Repli : le polling reprend immédiatement, puis on retente le socket.
      stopPolling()
      startPolling()
      scheduleReconnect()
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
