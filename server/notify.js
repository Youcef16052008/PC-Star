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
 *   WHATSAPP_RECIPIENT         destinataire(s), séparés par virgule, espace ou
 *                              point-virgule. Format international recommandé
 *                              (`213770650387`) ; le format local algérien
 *                              (`0770650387`) est **normalisé** automatiquement
 *                              (LOT 8.6 / A6). Défaut : les DEUX numéros du
 *                              magasin (STORE_WHATSAPP) — le 07… et le 06….
 *                              Une entrée non normalisable est écartée et
 *                              signalée (démarrage + /api/health).
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
 * LOT 8.6 (A6) — normalisation d'UN destinataire WhatsApp.
 *
 * L'API Cloud de Meta exige le format international **sans « + »**
 * (`213770650387`). Or `WHATSAPP_RECIPIENT` était passé tel quel après un
 * simple `replace(/\D/g, '')` : un numéro saisi au format local algérien
 * (`0770650387`, celui que le site affiche partout et que la documentation de
 * déploiement donnait en exemple) partait vers Meta sous cette forme et était
 * **refusé** — donc aucune alerte de commande, en silence, jusqu'à ce que le
 * maître regarde les logs. Vérifié à l'audit :
 * `whatsappRecipients({ WHATSAPP_RECIPIENT: '0770650387' })` renvoyait
 * `['0770650387']` alors que `waNumber('0770650387')` — déjà présent dans le
 * dépôt pour les liens `wa.me` (P14) — donne `213770650387`.
 *
 * Règles, dans l'ordre :
 *  1. `waNumber()` traite tous les formats algériens : `0XXXXXXXXX`,
 *     `XXXXXXXXX`, `213XXXXXXXXX`, `00213…`, `+213 …` ;
 *  2. sinon, un numéro de 8 à 15 chiffres ne commençant pas par 0 est gardé
 *     tel quel : c'est un destinataire étranger déjà international (un
 *     fournisseur au `+33…` reste joignable — le magasin n'a pas à être
 *     limité à l'Algérie) ;
 *  3. sinon l'entrée est **invalide** : elle est écartée et remontée dans
 *     `invalid` pour être journalisée au démarrage et dans `/api/health`.
 *     Un numéro qui commence par 0 après retrait du préfixe `00` n'est pas
 *     international (ex. `0123456789`) : l'envoyer serait un échec garanti.
 *
 * Une entrée sans AUCUN chiffre (mot résiduel, champ vide) est ignorée en
 * silence : ce n'est pas un numéro mal écrit, c'est du bruit de saisie.
 *
 * @returns {{ok: true, number: string} | {ok: false, digits: string}}
 */
function normalizeRecipient(value) {
  const text = String(value == null ? '' : value).trim()
  let digits = text.replace(/\D/g, '')
  if (!digits) return { ok: false, digits: '', silent: true }
  // `00` est le préfixe international écrit à la main (« 00213… », « 0033… »).
  if (digits.startsWith('00')) digits = digits.slice(2)
  const dz = waNumber(digits)
  if (dz) return { ok: true, number: dz }
  if (digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) return { ok: true, number: digits }
  return { ok: false, digits }
}

/**
 * Liste des destinataires **normalisés**, avec les entrées rejetées.
 *
 * `WHATSAPP_RECIPIENT` accepte plusieurs numéros (virgule, point-virgule ou
 * espace) ; sans la variable, on prend **les deux numéros du magasin** définis
 * dans `src/data.js` — source unique partagée avec les boutons de la page
 * « À propos ». Chaque numéro passe par `normalizeRecipient` (LOT 8.6 / A6) :
 * la liste renvoyée est donc directement envoyable à Meta, et un même numéro
 * écrit au format local puis au format international n'apparaît qu'une fois.
 *
 * @returns {{valid: string[], invalid: Array<{raw: string, digits: string}>}}
 */
function resolveRecipients(env) {
  const raw = String(env.WHATSAPP_RECIPIENT || '').trim()
  const source = raw ? raw.split(/[,;]+/) : STORE_WHATSAPP.map((n) => n.number)
  const valid = []
  const invalid = []
  const push = (value) => {
    const r = normalizeRecipient(value)
    if (!r.ok) {
      // Le bruit sans chiffres n'est pas signalé (voir `normalizeRecipient`).
      if (!r.silent) invalid.push({ raw: String(value == null ? '' : value).trim(), digits: r.digits })
      return
    }
    if (!valid.includes(r.number)) valid.push(r.number)
  }
  for (const part of source) {
    const joined = String(part || '').replace(/\D/g, '')
    // Un SEUL numéro peut contenir des espaces (« 213 550 123 456 ») : on le
    // recolle d'abord. Si le résultat dépasse 15 chiffres, c'est en réalité
    // plusieurs numéros séparés par des espaces → on les prend un par un.
    if (joined.length <= 15) push(part)
    else for (const token of String(part || '').trim().split(/\s+/)) push(token)
  }
  return { valid, invalid }
}

/**
 * Destinataires prêts à envoyer (format international, dédupliqués).
 * Voir `resolveRecipients` pour les entrées rejetées.
 */
export function whatsappRecipients(env = process.env) {
  return resolveRecipients(env).valid
}

/**
 * LOT 8.6 (A6) — entrées de `WHATSAPP_RECIPIENT` qui ne sont pas des numéros
 * exploitables. Vide en régime normal ; sert au démarrage et à `/api/health`
 * pour qu'une faute de frappe ne se traduise plus par une alerte perdue.
 */
export function whatsappRecipientIssues(env = process.env) {
  return resolveRecipients(env).invalid
}

/** Configuration WhatsApp courante. `enabled` = les 2 jetons obligatoires sont là. */
export function whatsappConfig(env = process.env) {
  const token = String(env.WHATSAPP_TOKEN || '').trim()
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
  const resolved = resolveRecipients(env)
  const recipients = resolved.valid
  return {
    enabled: Boolean(token && phoneNumberId),
    token,
    phoneNumberId,
    // P20 : `recipients` est la liste réelle ; `recipient` reste le premier
    // numéro pour compatibilité (logs, anciens appels).
    recipients,
    recipient: recipients[0] || '',
    // LOT 8.6 (A6) : entrées de WHATSAPP_RECIPIENT écartées (numéro non
    // normalisable). Une configuration invalide doit se voir AU DÉMARRAGE, pas
    // à la première commande perdue.
    invalidRecipients: resolved.invalid,
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
