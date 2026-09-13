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
 *   WHATSAPP_RECIPIENT         destinataire(s), séparés par virgule ou espace.
 *                              Défaut : les DEUX numéros du magasin
 *                              (STORE_WHATSAPP) — le 07… et le 06….
 *   WHATSAPP_API_VERSION       défaut v21.0
 *
 * P20 : le second numéro (06…) est tout aussi important que le premier. Une
 * commande déclenche donc **trois** notifications pour le maître : une dans le
 * navigateur (Desk) et deux WhatsApp, une par numéro.
 */
import { STORE, STORE_WHATSAPP, money } from '../src/data.js'
// P14 (#3) : wa.me exige l'international 213XXXXXXXXX — jamais le 0 local.
import { waNumber } from '../src/orderLogic.js'

const GRAPH_BASE = 'https://graph.facebook.com'

/**
 * Liste des destinataires, dédupliquée et nettoyée.
 *
 * `WHATSAPP_RECIPIENT` accepte plusieurs numéros (virgule, espace ou
 * point-virgule) ; sans la variable, on prend **les deux numéros du magasin**
 * définis dans `src/data.js` — source unique partagée avec les boutons de la
 * page « À propos ».
 */
export function whatsappRecipients(env = process.env) {
  const raw = String(env.WHATSAPP_RECIPIENT || '').trim()
  const source = raw ? raw.split(/[,;]+/) : STORE_WHATSAPP.map((n) => n.number)
  const out = []
  const push = (value) => {
    const num = String(value || '').replace(/\D/g, '')
    // Un numéro fait 9 chiffres en local ou 11 à 13 en international ; on borne
    // largement pour accepter les indicatifs tout en refusant les résidus.
    if (num.length >= 8 && num.length <= 15 && !out.includes(num)) out.push(num)
  }
  for (const part of source) {
    const joined = String(part || '').replace(/\D/g, '')
    // Un SEUL numéro peut contenir des espaces (« 213 550 123 456 ») : on le
    // recolle d'abord. Si le résultat dépasse 15 chiffres, c'est en réalité
    // plusieurs numéros séparés par des espaces → on les prend un par un.
    if (joined.length <= 15) push(joined)
    else for (const token of String(part || '').trim().split(/\s+/)) push(token)
  }
  return out
}

/** Configuration WhatsApp courante. `enabled` = les 2 jetons obligatoires sont là. */
export function whatsappConfig(env = process.env) {
  const token = String(env.WHATSAPP_TOKEN || '').trim()
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  const recipients = whatsappRecipients(env)
  return {
    enabled: Boolean(token && phoneNumberId),
    token,
    phoneNumberId,
    // P20 : `recipients` est la liste réelle ; `recipient` reste le premier
    // numéro pour compatibilité (logs, anciens appels).
    recipients,
    recipient: recipients[0] || '',
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

/** Envoi unitaire vers un numéro. Ne rejette jamais. */
async function sendToOne(cfg, to, body, doFetch) {
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
        to,
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
      return { ok: false, to, error: `http_${res.status}${detail ? ` ${detail}` : ''}` }
    }
    return { ok: true, to }
  } catch (err) {
    return { ok: false, to, error: String(err?.message || err) }
  }
}

/**
 * Envoie un message texte via la WhatsApp Cloud API, **à chaque destinataire**.
 *
 * P20 : les deux numéros du magasin sont servis. Les envois sont indépendants —
 * si le premier échoue (numéro non enregistré sur WhatsApp, quota…), le second
 * part quand même : le maître ne perd pas l'alerte. `ok` n'est vrai que si tous
 * les envois ont réussi, et `error` rapporte le premier échec.
 *
 * @returns {Promise<{ok:boolean, sent?:number, total?:number, results?:Array, error?:string, skipped?:boolean}>}
 *          — ne rejette jamais.
 */
export async function sendWhatsApp(text, { env = process.env, fetchImpl } = {}) {
  const cfg = whatsappConfig(env)
  const body = String(text || '').trim()
  if (!cfg.enabled) return { ok: false, skipped: true, error: 'not_configured' }
  if (!body) return { ok: false, skipped: true, error: 'empty' }
  if (!cfg.recipients.length) return { ok: false, skipped: true, error: 'no_recipient' }
  const doFetch = fetchImpl || globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'no_fetch' }

  // Séquentiel volontaire : deux appels parallèles vers la même app Meta
  // risquent un refus pour limite de débit, et l'ordre d'arrivée n'a aucune
  // importance ici.
  const results = []
  for (const to of cfg.recipients) {
    results.push(await sendToOne(cfg, to, body, doFetch))
  }
  const failures = results.filter((r) => !r.ok)
  const out = { ok: failures.length === 0, sent: results.length - failures.length, total: results.length, results }
  if (failures.length) out.error = failures[0].error
  return out
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
