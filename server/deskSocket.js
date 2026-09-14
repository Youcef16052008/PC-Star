/**
 * P19 — Socket Desk : pousse les nouvelles commandes aux onglets du comptoir.
 *
 * Pourquoi un socket et pas seulement le polling : le Desk se rafraîchissait
 * toutes les 20 s (`setInterval(pull, 20000)` dans src/App.jsx). Une commande
 * posée à la seconde 1 n'apparaissait qu'à la seconde 20 — trop tard pour
 * rappeler un client qui attend une confirmation.
 *
 * Sécurité : la connexion n'est acceptée que pour un **token de session master**
 * valide. Tout le reste est détruit avant l'upgrade, donc un client non
 * autorisé n'obtient jamais de socket (et ne reçoit aucune commande).
 *
 * Vercel ne supporte pas les WebSockets en serverless : `attachDeskSocket`
 * n'est appelé que par `startLocalServer()`. Le front, lui, retombe
 * automatiquement sur le polling quand le socket est indisponible.
 */
import { WebSocketServer } from 'ws'
import { addDeskClient, deskClientCount } from './notify.js'

let wss = null

/**
 * @param {import('node:http').Server} server
 * @param {(token: string) => Promise<boolean>} isMasterToken
 */
export function attachDeskSocket(server, isMasterToken) {
  wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws) => {
    addDeskClient(ws)
    try {
      ws.send(JSON.stringify({ type: 'hello', desk: true, clients: deskClientCount() }))
    } catch {
      /* déjà fermé */
    }
    // P19 : le client peut demander un état immédiat (utile après une
    // reconnexion, pour ne pas rater une commande arrivée pendant la coupure).
    ws.on('message', (raw) => {
      let msg = null
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      if (msg?.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong', at: Date.now(), clients: deskClientCount() }))
        } catch {
          /* fermé */
        }
      }
    })
  })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/desk-stream') {
      socket.destroy()
      return
    }
    const token = String(url.searchParams.get('token') || '')
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    // Vérification AVANT l'upgrade : un non-master n'obtient jamais de socket.
    Promise.resolve()
      .then(() => isMasterToken(token))
      .then((ok) => {
        if (!ok || socket.destroyed) {
          if (!socket.destroyed) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
            socket.destroy()
          }
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      })
      .catch(() => {
        if (!socket.destroyed) socket.destroy()
      })
  })

  return wss
}

export function deskSocketClientCount() {
  return deskClientCount()
}

export function closeDeskSocket() {
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
}
