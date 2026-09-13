/**
 * P19 — Notification d'une nouvelle commande au master.
 *
 * Deux canaux, indépendants et non bloquants :
 *  1. **WebSocket** vers les onglets Desk ouverts (le front bascule aussi une
 *     notification navigateur) — instantané, aucune dépendance externe.
 *  2. **WhatsApp Cloud API** (Meta) vers le numéro du magasin — le master reçoit
 *     les détails et peut rappeler le client pour confirmer.
 *
 * Aucune des deux ne doit jamais faire échouer la création de commande : tout
 * est attrapé et loggué.
 *
 * Configuration WhatsApp (variables d'environnement) :
 *   WHATSAPP_TOKEN             jeton permanent de l'app Meta
 *   WHATSAPP_PHONE_NUMBER_ID   identifiant du numéro émetteur
 *   WHATSAPP_RECIPIENT         numéro du master (défaut : STORE.whatsapp)
 *   WHATSAPP_API_VERSION       défaut v21.0
 */
import { STORE, money } from '../src/data.js'
// P14 (#3) : wa.me exige l'international 213XXXXXXXXX — jamais le 0 local.
import { waNumber } from '../src/orderLogic.js'

const GRAPH_BASE = 'https://graph.facebook.com'

/** Configuration WhatsApp courante. `enabled` = les 2 jetons obligatoires sont là. */
export function whatsappConfig(env = process.env) {
  const token = String(env.WHATSAPP_TOKEN || '').trim()
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  return {
    enabled: Boolean(token && phoneNumberId),
    token,
    phoneNumberId,
    recipient: String(env.WHATSAPP_RECIPIENT || STORE.whatsapp || '').replace(/\D/g, ''),
    apiVersion: String(env.WHATSAPP_API_VERSION || 'v21.0').trim()
  }
}

/**
 * Message WhatsApp lisible sur un téléphone : qui, quoi, combien, et un lien
 * direct pour rappeler le client.
 * Pur — testable sans réseau.
 */
export function formatOrderMessage(order, { lang = 'fr' } = {}) {
  if (!order) return ''
  const lines = order.items || []
  const items = lines
    .map((l) => `• ${Math.max(1, Number(l.qty) || 1)}× ${l.name || l.id} — ${money((Number(l.price) || 0) * Math.max(1, Number(l.qty) || 1))}`)
    .join('\n')
  // waNumber convertit le format stocké (0XXXXXXXXX) en E.164 ; sans lui le
  // lien serait mort, exactement comme le bug #3 de la page Desk.
  const waNum = waNumber(order.phone)
  const wa = waNum ? `\n\nRappeler le client : https://wa.me/${waNum}` : ''
  const parts = [
    `🔔 Nouvelle commande — ${order.code || ''}`,
    '',
    `Client : ${order.name || '—'}`,
    order.phone ? `Tél : ${order.phone}${order.carrier ? ` (${order.carrier})` : ''}` : null,
    order.wilaya ? `Wilaya : ${order.wilaya}` : null,
    order.slot ? `Créneau : ${order.slot}` : null,
    `Total : ${money(order.total || 0)}`,
    lines.length ? `\nArticles :\n${items}` : null
  ].filter(Boolean)
  return parts.join('\n') + wa
}

/**
 * Envoie un message texte via la WhatsApp Cloud API.
 * @returns {Promise<{ok:boolean, error?:string, skipped?:boolean}>} — ne rejette jamais.
 */
export async function sendWhatsApp(text, { env = process.env, fetchImpl } = {}) {
  const cfg = whatsappConfig(env)
  const body = String(text || '').trim()
  if (!cfg.enabled) return { ok: false, skipped: true, error: 'not_configured' }
  if (!body) return { ok: false, skipped: true, error: 'empty' }
  if (!cfg.recipient) return { ok: false, skipped: true, error: 'no_recipient' }
  const doFetch = fetchImpl || globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'no_fetch' }
  try {
    const res = await doFetch(`${GRAPH_BASE}/${encodeURIComponent(cfg.apiVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cfg.recipient,
        type: 'text',
        text: { preview_url: true, body: body.slice(0, 4000) }
      })
    })
    if (!res.ok) {
      let detail = ''
      try {
        detail = JSON.stringify(await res.json()).slice(0, 300)
      } catch {
        /* corps non-JSON */
      }
      return { ok: false, error: `http_${res.status}${detail ? ` ${detail}` : ''}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

/* ------------------------------------------------------------------ */
/* Registre WebSocket des onglets Desk (master uniquement)             */
/* ------------------------------------------------------------------ */

const deskClients = new Set()

export function deskClientCount() {
  return deskClients.size
}

export function addDeskClient(ws) {
  deskClients.add(ws)
  ws.on?.('close', () => deskClients.delete(ws))
  ws.on?.('error', () => deskClients.delete(ws))
}

export function removeDeskClient(ws) {
  deskClients.delete(ws)
}

/**
 * Diffuse un événement aux onglets Desk connectés.
 * @returns {number} nombre de clients touchés.
 */
export function broadcastDesk(event) {
  const payload = JSON.stringify(event || {})
  let sent = 0
  for (const ws of [...deskClients]) {
    try {
      if (ws.readyState === 1) {
        ws.send(payload)
        sent += 1
      } else {
        deskClients.delete(ws)
      }
    } catch {
      deskClients.delete(ws)
    }
  }
  return sent
}

/** Nettoyage pour les tests. */
export const __notifyInternals = { deskClients }
