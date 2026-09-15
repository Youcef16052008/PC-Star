/**
 * API client — /api via Vite proxy → server :8787
 * Falls back to local mode if backend is down.
 */

const TOKEN_KEY = 'pcstar-api-token'

// Memory fallback: some embedded iframes block third-party localStorage —
// the token must still work for the lifetime of the page session.
let memoryToken = null

export function getToken(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return storage?.getItem?.(TOKEN_KEY) || memoryToken || null
}

export function setToken(token, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  memoryToken = token || null
  if (!token) storage?.removeItem?.(TOKEN_KEY)
  else storage?.setItem?.(TOKEN_KEY, token)
}

// P21 : délai maximal d'une requête. Sans lui, un fetch qui pend (proxy
// capricieux, cold start serverless, réseau mobile) ne résout JAMAIS. Comme le
// Desk n'avait qu'un seul état `busy` partagé, une seule requête bloquée
// désactivait les boutons de TOUTES les commandes jusqu'au rechargement de la
// page — le maître cliquait sur « préparer » / « prêt » sans aucun effet.
export const API_TIMEOUT_MS = 15000

async function req(path, { method = 'GET', body, token, timeoutMs = API_TIMEOUT_MS } = {}) {
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

export async function masterHideProduct(id, hidden = true) {
  return req(`/api/master/products/${encodeURIComponent(id)}/hide`, { method: 'POST', body: { hidden } })
}

export async function masterPhotos(id, photoDataUrls) {
  return req(`/api/master/products/${encodeURIComponent(id)}/photos`, {
    method: 'POST',
    body: { photoDataUrls }
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
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pcstar-orders${day ? '-' + day : ''}.csv`
  a.click()
  URL.revokeObjectURL(url)
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
