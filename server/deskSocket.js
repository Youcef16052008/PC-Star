/**
 * P19 — Socket Desk : pousse les nouvelles commandes aux onglets du comptoir.
 *
 * Pourquoi un socket et pas seulement le polling : le Desk se rafraîchissait
 * toutes les 20 s (`setInterval(pull, 20000)` dans src/App.jsx). Une commande
 * posée à la seconde 1 n'apparaissait qu'à la seconde 20 — trop tard pour
 * rappeler un client qui attend une confirmation.
 *
 * Sécurité (LOT 3.18 / R14) : la connexion n'est acceptée que pour un **token
 * de session master** valide, et ce token n'est plus transporté dans l'URL
 * d'upgrade — il arrivait dans les journaux d'accès du proxy et dans
 * l'historique des caches intermédiaires. Le client s'authentifie désormais par
 * son PREMIER message (`{type:'auth',token}`) ; sans authentification dans les
 * `AUTH_TIMEOUT_MS`, le socket est fermé. Tant qu'il n'est pas authentifié, il
 * n'est PAS enregistré dans le registre de diffusion : il ne reçoit aucune
 * commande.
 *
 * Robustesse (LOT 3.10 / B15) : heartbeat `ping`/`pong` côté serveur. Une
 * connexion TCP à moitié morte (onglet mis en veille, coupure réseau sans FIN)
 * restait `readyState === OPEN` pour toujours : le comptoir se croyait en direct
 * et `deskClientCount()` comptait des fantômes. Un client qui ne répond pas au
 * ping est terminé au cycle suivant.
 *
 * Vercel ne supporte pas les WebSockets en serverless : `attachDeskSocket`
 * n'est appelé que par `startLocalServer()`. Le front, lui, retombe
 * automatiquement sur le polling quand le socket est indisponible.
 */
import { WebSocketServer } from 'ws'
import { addDeskClient, removeDeskClient, deskClientCount } from './notify.js'

const envMs = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** Délai accordé au client pour envoyer son message d'authentification. */
const AUTH_TIMEOUT_MS = envMs('DESK_WS_AUTH_TIMEOUT_MS', 5000)
/** Cadence du heartbeat serveur. */
const HEARTBEAT_MS = envMs('DESK_WS_HEARTBEAT_MS', 30000)
/** Nombre maximal de sockets en attente d'authentification (anti-abus). */
const MAX_PENDING = 32
/** Codes de fermeture applicatifs (4000-4999 = réservés à l'application). */
export const WS_CLOSE = {
  AUTH_REQUIRED: 4401,
  FORBIDDEN: 4403,
  AUTH_TIMEOUT: 4408,
  TOO_MANY_PENDING: 4429
}

let wss = null
let heartbeatId = null
let pending = 0
/**
 * LOT P5 — l'ecoute `upgrade` appartient a l'attache qui l'a installee.
 *
 * Deux defauts mesures dans l'ancienne forme, tous deux mortels pour le
 * processus et non pour la requete :
 *  · l'ecouteur lisait la variable de MODULE `wss`, que `closeDeskSocket()` met
 *    a `null`. Un `upgrade` arrive-t-il apres une fermeture (rechargement a chaud
 *    en dev, redemarrage gracele) que le handler levait `TypeError: Cannot read
 *    properties of null` DANS l'evenement — une exception synchrone d'un
 *    emetteur `EventEmitter` n'est rattrapee par aucun `try/catch` d'appelant :
 *    le serveur tombe.
 *  · rappeler `attachDeskSocket` sur le meme serveur empilait deux ecouteurs
 *    sur `upgrade` : `handleUpgrade` etait appele deux fois sur la meme socket,
 *    et la premiere reponse de la table d'attente 429 partait sur un socket deja
 *    ameliore.
 * Chaque attache est donc enregistree (serveur, ecouteur, instance) et retiree a
 * la fermeture ; une re-attache sur le meme serveur remplace l'ancienne.
 */
const attaches = new Map() // http.Server -> { wss, onUpgrade, ferme }

/**
 * LOT 3.10 (B15) : un cycle de heartbeat.
 *
 * Un client qui n'a pas répondu au ping précédent (`isAlive === false`) est
 * considéré mort : il est retiré du registre de diffusion puis terminé. Les
 * autres reçoivent un ping et repassent à `isAlive = false` en attendant leur
 * pong. C'est ce qui empêche `deskClientCount()` de compter des fantômes
 * (onglet en veille, coupure réseau sans FIN) — un socket TCP à moitié mort
 * reste `readyState === OPEN` indéfiniment.
 */
export function heartbeatOnce() {
  if (!wss) return { terminated: 0, pinged: 0 }
  let terminated = 0
  let pinged = 0
  for (const client of [...wss.clients]) {
    if (client.isAlive === false) {
      removeDeskClient(client)
      try {
        client.terminate()
      } catch {
        /* déjà mort */
      }
      terminated += 1
      continue
    }
    client.isAlive = false
    try {
      client.ping()
      pinged += 1
    } catch {
      /* fermé entre-temps */
    }
  }
  return { terminated, pinged }
}

function safeSend(ws, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason)
  } catch {
    try {
      ws.terminate()
    } catch {
      /* déjà mort */
    }
  }
}

/**
 * @param {import('node:http').Server} server
 * @param {(token: string) => Promise<boolean>} isMasterToken
 */
export function attachDeskSocket(server, isMasterToken) {
  const precedente = attaches.get(server)
  if (precedente) {
    server.removeListener('upgrade', precedente.onUpgrade)
    precedente.ferme = true
    try {
      precedente.wss.close()
    } catch {
      /* deja fermee */
    }
  }

  const etat = { wss: null, onUpgrade: null, ferme: false }
  wss = new WebSocketServer({ noServer: true })
  etat.wss = wss

  wss.on('connection', (ws, req) => {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    ws.on('error', () => {
      /* la fermeture suit ; rien à propager */
    })

    let authed = false
    let resolved = false // décision prise (accès accordé OU refus effectué)
    let verifying = false // une vérification de token est en cours

    const grant = () => {
      if (resolved) return
      resolved = true
      authed = true
      ws.authed = true
      pending = Math.max(0, pending - 1)
      try {
        clearTimeout(authTimer)
      } catch {
        /* minuteur pas encore créé (legacy token) */
      }
      addDeskClient(ws)
      // `hello` confirme l'authentification au client et lui donne le nombre
      // d'onglets Desk actuellement connectés.
      safeSend(ws, { type: 'hello', desk: true, authed: true, clients: deskClientCount() })
    }

    const deny = (code, reason) => {
      if (resolved) return
      resolved = true
      pending = Math.max(0, pending - 1)
      clearTimeout(authTimer)
      safeClose(ws, code, reason)
    }

    const checkToken = (token) => {
      if (verifying) return
      verifying = true
      return Promise.resolve()
        .then(() => isMasterToken(String(token || '')))
        .then((ok) => (ok ? grant() : deny(WS_CLOSE.FORBIDDEN, 'forbidden')))
        .catch(() => deny(WS_CLOSE.FORBIDDEN, 'forbidden'))
    }

    // LOT 3.18 (R14) : aucun token n'est exigé dans l'URL. Un ancien front en
    // cache peut encore en envoyer un — on l'accepte (même vérification, même
    // exigence master) le temps que le déploiement se propage.
    const url = new URL(req?.url || '/', 'http://localhost')
    const legacyToken = String(url.searchParams.get('token') || '')

    const authTimer = setTimeout(() => {
      if (!resolved) deny(WS_CLOSE.AUTH_TIMEOUT, 'auth_timeout')
    }, AUTH_TIMEOUT_MS)

    pending += 1
    if (legacyToken) checkToken(legacyToken)

    ws.on('message', (raw) => {
      let msg = null
      try {
        msg = JSON.parse(String(raw))
      } catch {
        if (!authed) deny(WS_CLOSE.AUTH_REQUIRED, 'auth_required')
        return
      }
      if (!authed) {
        // LOT 3.18 (R14) : le premier message DOIT être l'authentification.
        if (msg?.type !== 'auth') {
          deny(WS_CLOSE.AUTH_REQUIRED, 'auth_required')
          return
        }
        if (!msg?.token) {
          deny(WS_CLOSE.AUTH_REQUIRED, 'auth_required')
          return
        }
        // Token déjà en cours de vérification (ou décision déjà prise) : on
        // ignore le doublon plutôt que de lancer deux vérifications.
        if (verifying || resolved) return
        checkToken(msg.token)
        return
      }
      // P19 : le client peut demander un état immédiat (utile après une
      // reconnexion, pour ne pas rater une commande arrivée pendant la coupure).
      if (msg?.type === 'ping') {
        safeSend(ws, { type: 'pong', at: Date.now(), clients: deskClientCount() })
      }
    })

    ws.on('close', () => {
      if (!resolved) pending = Math.max(0, pending - 1)
      clearTimeout(authTimer)
      removeDeskClient(ws)
    })
  })

  etat.onUpgrade = (req, socket, head) => {
    // La garde n'est pas decoratif : c'est ce qui empeche un `upgrade` recu
    // apres `closeDeskSocket()` de jeter dans l'emetteur et de tuer le process.
    if (etat.ferme || !etat.wss) {
      try {
        socket.destroy()
      } catch {
        /* deja mort */
      }
      return
    }
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/desk-stream') {
      socket.destroy()
      return
    }
    // Anti-abus : sans WebSocket serverless ni file d'attente, un attaquant
    // pourrait ouvrir des milliers de sockets non authentifiés. On borne le
    // nombre de connexions EN ATTENTE d'authentification (les sockets
    // authentifiés ne sont pas concernés).
    if (pending >= MAX_PENDING) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
      socket.destroy()
      return
    }
    const monWss = etat.wss
    monWss.handleUpgrade(req, socket, head, (ws) => monWss.emit('connection', ws, req))
  }
  server.on('upgrade', etat.onUpgrade)
  attaches.set(server, etat)

  // LOT 3.10 (B15) : heartbeat. Un socket qui n'a pas répondu au ping précédent
  // est considéré mort et terminé — il sort du registre de diffusion, donc
  // `deskClientCount()` ne compte plus de fantômes.
  if (heartbeatId === null) {
    heartbeatId = setInterval(heartbeatOnce, HEARTBEAT_MS)
    heartbeatId.unref?.()
  }

  return wss
}

export function deskSocketClientCount() {
  return deskClientCount()
}

/** Nombre de sockets ouverts mais pas encore authentifiés (tests / diagnostic). */
export function deskPendingCount() {
  return pending
}

/** Accès interne pour les tests (heartbeat, sockets en attente). */
export const __deskSocketInternals = {
  attaches,
  heartbeatOnce,
  get wss() {
    return wss
  },
  get pending() {
    return pending
  },
  AUTH_TIMEOUT_MS,
  HEARTBEAT_MS
}

export function closeDeskSocket() {
  if (heartbeatId !== null) {
    clearInterval(heartbeatId)
    heartbeatId = null
  }
  // LOT P5 : toute attache enregistree est demontee (ecouteur ote du serveur),
  // sinon l'ecouteur orphelin survit a la fermeture et voit un `wss` null.
  for (const [serveur, etat] of attaches) {
    try {
      serveur.removeListener('upgrade', etat.onUpgrade)
    } catch {
      /* serveur deja detruit */
    }
    etat.ferme = true
  }
  attaches.clear()
  if (wss) {
    for (const c of wss.clients) {
      try {
        c.close()
      } catch {
        /* déjà fermé */
      }
    }
    wss.close()
    wss = null
  }
  pending = 0
}
