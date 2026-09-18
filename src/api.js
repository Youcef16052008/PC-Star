/**
 * API client — /api via Vite proxy → server :8787
 * Falls back to local mode if backend is down.
 */

const TOKEN_KEY = 'pcstar-api-token'

/** LOT 5.11 (U12) : délai avant révocation d'une `blob:` URL de téléchargement. */
export const REVOKE_DELAY_MS = 4000

// LOT 3.1 (F7 + F8) : le jeton passe par `safeStorage`. Le stockage peut être
// bloqué (SecurityError : cookies tiers refusés, navigation privée, quota
// dépassé, contexte intégré) — le jeton doit rester utilisable pour la durée de
// la page, et surtout `getToken()` ne doit pas lever dans un initializer de
// `useState`.
// LOT 5.10 (U10) : l'encadrement par un tiers n'est PAS un scénario supporté —
// `X-Frame-Options: SAMEORIGIN` et `frame-ancestors 'self'` l'interdisent en
// production (voir `docs/DEPLOY-VERCEL.md`, §Encadrement). Le repli mémoire
// couvre les autres cas de stockage indisponible, qui sont réels.
import { asSafeStorage, safeStorage } from './safeStorage.js'

// Repli mémoire historique, conservé : il couvre aussi le cas où l'appelant
// passe un stockage explicite (test) puis lit sans argument.
let memoryToken = null

export function getToken(storage = safeStorage) {
  return asSafeStorage(storage).getItem(TOKEN_KEY) || memoryToken || null
}

export function setToken(token, storage = safeStorage) {
  memoryToken = token || null
  const st = asSafeStorage(storage)
  if (!token) st.removeItem(TOKEN_KEY)
  else st.setItem(TOKEN_KEY, token)
}

// P21 : délai maximal d'une requête. Sans lui, un fetch qui pend (proxy
// capricieux, cold start serverless, réseau mobile) ne résout JAMAIS. Comme le
// Desk n'avait qu'un seul état `busy` partagé, une seule requête bloquée
// désactivait les boutons de TOUTES les commandes jusqu'au rechargement de la
// page — le maître cliquait sur « préparer » / « prêt » sans aucun effet.
export const API_TIMEOUT_MS = 15000

/**
 * LOT 3.8/3.9 (B11 + B13) — point d'entrée unique pour « la session est morte ».
 * `App.jsx` y branche la purge du jeton, le retour en mode local et le message
 * `sessionExpired`. `null` désactive la notification.
 */
let unauthorizedHandler = null

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null
}

export function clearUnauthorizedHandler() {
  unauthorizedHandler = null
}

async function req(path, { method = 'GET', body, token, timeoutMs = API_TIMEOUT_MS, skip401 = false } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const t = token ?? getToken()
  if (t) headers.Authorization = `Bearer ${t}`
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    })
  } catch {
    // Erreur réseau (backend down, proxy, timeout) : on signale offline au
    // lieu de rejeter — chaque appelant gère alors son repli local.
    return { ok: false, status: 0, data: null, offline: true }
  } finally {
    if (timer) clearTimeout(timer)
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  // LOT 3.8/3.9 (B11 + B13) : un 401 sur une route authentifiée signifie que la
  // session est morte (TTL serveur de 7 jours, révocation après changement de
  // mot de passe, reset maître). Avant, chaque appelant réagissait à sa façon —
  // le polling du Desk se contentait de `return`, en silence, toutes les 20 s
  // jusqu'à la fermeture de l'onglet. Un seul point de notification ici ; les
  // routes d'authentification sont exclues : un 401 de `login` est une réponse
  // normale (« identifiants incorrects »), pas une session expirée.
  if (res.status === 401 && unauthorizedHandler && !skip401 && !/^\/api\/auth\//.test(path)) {
    try {
      unauthorizedHandler({ path, status: 401, data })
    } catch {
      /* un handler défaillant ne doit pas casser la réponse */
    }
  }
  return { ok: res.ok, status: res.status, data }
}


export async function health() {
  try {
    const r = await req('/api/health')
    return r.ok ? r.data : { ok: false, offline: Boolean(r.offline) }
  } catch {
    return { ok: false, offline: true }
  }
}

export async function login(email, password) {
  const r = await req('/api/auth/login', { method: 'POST', body: { email, password } })
  if (r.ok && r.data?.token) setToken(r.data.token)
  return r
}

export async function register(payload) {
  const r = await req('/api/auth/register', { method: 'POST', body: payload })
  if (r.ok && r.data?.token) setToken(r.data.token)
  return r
}

export async function logout() {
  try {
    await req('/api/auth/logout', { method: 'POST' })
  } catch {
    /* ignore */
  }
  setToken(null)
}

export async function me() {
  return req('/api/me')
}

export async function updateMe(patch) {
  return req('/api/me', { method: 'PUT', body: patch })
}

export async function postOrder(order) {
  return req('/api/orders', { method: 'POST', body: order })
}

export async function listOrders() {
  return req('/api/orders')
}

export async function patchOrder(code, status) {
  return req(`/api/orders/${encodeURIComponent(code)}`, { method: 'PATCH', body: { status } })
}

// Le comptoir fixe ou décale la date de retrait (sans toucher au statut).
export async function patchOrderPickup(code, pickupDate) {
  return req(`/api/orders/${encodeURIComponent(code)}`, { method: 'PATCH', body: { pickupDate } })
}

export async function cancelOrder(code) {
  return req(`/api/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST' })
}

// P19 : suppression définitive (master). Distincte de cancelOrder —
// l'annulation garde la trace dans l'historique et le CSV, la suppression
// retire la ligne et rend le stock.
export async function deleteOrder(code) {
  return req(`/api/orders/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function getCatalog() {
  return req('/api/catalog')
}

export async function listCustomers() {
  return req('/api/customers')
}

export async function deleteCustomer(id) {
  return req(`/api/customers/${id}`, { method: 'DELETE' })
}

export async function getMeta() {
  return req('/api/meta')
}

// P9 (P7-8) : putMeta supprimé — PUT /api/meta (écrasement total du meta
// sans validation) n'existait plus ; rien ne l'appelait.

export async function putPanels(meta) {
  return req('/api/master/panels', { method: 'PUT', body: meta })
}

export async function masterProducts() {
  return req('/api/master/products')
}

export async function masterCreateProduct(body) {
  return req('/api/master/products', { method: 'POST', body })
}

export async function masterUpdateProduct(id, body) {
  return req(`/api/master/products/${encodeURIComponent(id)}`, { method: 'PUT', body })
}

// Suppression définitive d'un produit créé par le maître (base → masquer seulement).
export async function masterDeleteProduct(id) {
  return req(`/api/master/products/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function masterHideProduct(id, hidden = true) {
  return req(`/api/master/products/${encodeURIComponent(id)}/hide`, { method: 'POST', body: { hidden } })
}

export async function masterPhotos(id, photoDataUrls, photos = undefined) {
  return req(`/api/master/products/${encodeURIComponent(id)}/photos`, {
    method: 'POST',
    // `photos` est la galerie existante que le master a choisi de conserver;
    // les data URLs sont ajoutées côté serveur puis la liste complète remplace
    // l'ancienne. Ainsi un retrait local ne ressuscite pas au prochain upload.
    body: { photoDataUrls, ...(Array.isArray(photos) ? { photos } : {}) }
  })
}

export async function masterBackup() {
  return req('/api/master/backup', { method: 'POST' })
}

export function ordersExportUrl(day) {
  const q = day ? `?day=${encodeURIComponent(day)}` : ''
  return `/api/orders/export.csv${q}`
}

export async function downloadOrdersCsv(day) {
  const token = getToken()
  let res
  try {
    res = await fetch(ordersExportUrl(day), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
  } catch {
    return { ok: false, status: 0, offline: true }
  }
  if (!res.ok) return { ok: false, status: res.status }
  const blob = await res.blob()
  // `URL.createObjectURL` manque dans quelques environnements (webviews anciennes,
  // jsdom des tests) : un repli `data:` évite un crash sec sur le clic « CSV ».
  let url
  try {
    url = URL.createObjectURL(blob)
  } catch {
    url = `data:text/csv;charset=utf-8,${encodeURIComponent(await blob.text())}`
  }
  const a = document.createElement('a')
  a.href = url
  a.download = `pcstar-orders${day ? '-' + day : ''}.csv`
  a.click()
  // LOT 5.11 (U12) : révocation DIFFÉRÉE. `a.click()` ne fait que demander le
  // téléchargement — la lecture du blob démarre après le retour de cet appel.
  // Révoquer l'URL dans la foulée la coupait donc parfois en plein vol :
  // export CSV vide ou téléchargement annulé, de façon intermittente (plus
  // visible sur les gros exports et les machines lentes). On laisse le
  // téléchargement s'amorcer, puis on libère la mémoire.
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* déjà libérée */
    }
  }, REVOKE_DELAY_MS)
  return { ok: true }
}

export async function oauthStart(provider, { intent = 'login', returnUrl } = {}) {
  return req('/api/oauth/start', { method: 'POST', body: { provider, intent, returnUrl } })
}

export async function oauthUnlink(provider) {
  return req('/api/oauth/unlink', { method: 'POST', body: { provider } })
}

export async function myOrders() {
  return req('/api/me/orders')
}

export async function cancelMyOrder(code) {
  return req(`/api/me/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST' })
}

// Phase 3 : rattache au compte une commande passée sans compte, via le code
// à usage unique remis au comptoir. Le téléphone n'est jamais la preuve.
export async function claimMyOrder(claimCode) {
  return req('/api/me/orders/claim', { method: 'POST', body: { code: claimCode } })
}

// Phase 3 (comptoir) : émet le code de retrait d'une commande guest. Le code
// en clair n'est renvoyé qu'une fois, dans la réponse de cet appel.
export async function issueClaimCode(code) {
  return req(`/api/orders/${encodeURIComponent(code)}/claim-code`, { method: 'POST' })
}

/**
 * LOT 1.4 : `current` est OBLIGATOIRE.
 *
 * Le serveur exige le mot de passe actuel depuis P16 (#13) — sinon un token de
 * session volé suffisait à verrouiller le compte. Mais cette fonction
 * n'envoyait que `{ password }` : la route répondait 403 `current_password` à
 * chaque appel, et le changement de mot de passe était mort pour 100 % des
 * utilisateurs (aucun test ne couvrait le chemin client → serveur).
 *
 * `current` est transmis tel quel : c'est le serveur qui le compare au hash
 * stocké (`verifyPass`), jamais le client.
 */
export async function changePassword(password, current) {
  return req('/api/me/password', { method: 'POST', body: { password, current } })
}
