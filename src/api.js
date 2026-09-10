/**
 * API client — /api via Vite proxy → server :8787
 * Falls back to local mode if backend is down.
 */

const TOKEN_KEY = 'pcstar-api-token'

export function getToken(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return storage?.getItem?.(TOKEN_KEY) || null
}

export function setToken(token, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!token) storage?.removeItem?.(TOKEN_KEY)
  else storage?.setItem?.(TOKEN_KEY, token)
}

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const t = token ?? getToken()
  if (t) headers.Authorization = `Bearer ${t}`
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
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
    return r.ok ? r.data : { ok: false }
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

export async function listCustomers() {
  return req('/api/customers')
}

export async function deleteCustomer(id) {
  return req(`/api/customers/${id}`, { method: 'DELETE' })
}

export async function getMeta() {
  return req('/api/meta')
}

export async function putMeta(meta) {
  return req('/api/meta', { method: 'PUT', body: { meta } })
}
