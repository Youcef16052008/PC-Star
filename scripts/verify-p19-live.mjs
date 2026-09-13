/**
 * Vérification P19 en direct contre le serveur lancé (:8787).
 * 1. connexion WebSocket master  → hello
 * 2. POST /api/orders            → poussée `order:new` sur le socket
 * 3. DELETE /api/orders/:code    → poussée `order:deleted` + stock rendu
 * 4. socket sans token / non-master → refusé
 */
import WebSocket from 'ws'

const BASE = 'http://127.0.0.1:8787'
const out = []
const ok = (label, cond, extra = '') => {
  out.push(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' ' + extra : ''}`)
  return cond
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

const login = await call('POST', '/api/auth/login', { body: { email: 'pcstar.info31@gmail.com', password: 'star31' } })
const token = login.data?.token
ok('login master', !!token, token ? '(token obtenu)' : JSON.stringify(login.data))
if (!token) { console.log(out.join('\n')); process.exit(1) }

// --- 1) socket master ---
const wsUrl = `ws://127.0.0.1:8787/api/desk-stream?token=${encodeURIComponent(token)}`
const ws = new WebSocket(wsUrl)
const events = []
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout ouverture socket')), 8000)
  ws.on('open', () => { clearTimeout(to); resolve() })
  ws.on('error', (e) => { clearTimeout(to); reject(e) })
})
ws.on('message', (raw) => { try { events.push(JSON.parse(String(raw))) } catch { /* ignore */ } })
await new Promise((r) => setTimeout(r, 400))
ok('socket master ouvert + hello', events.some((e) => e.type === 'hello'), JSON.stringify(events[0] || null))

// --- 2) commande → poussée order:new ---
const stock0 = (await call('GET', '/api/catalog')).data.products.find((p) => p.id === 'cpu-7800x3d')?.stock
const created = await call('POST', '/api/orders', {
  body: { items: [{ id: 'cpu-7800x3d', qty: 1 }], name: 'Client P19 direct', phone: '0550123456', wilaya: 'Oran', slot: '14h-16h' },
  token
})
const code = created.data?.order?.code
ok('POST /api/orders', created.status === 201, `${created.status} ${code || JSON.stringify(created.data)}`)

const stockResa = (await call('GET', '/api/catalog')).data.products.find((p) => p.id === 'cpu-7800x3d')?.stock
ok('stock réservé', stockResa === stock0 - 1, `${stock0} → ${stockResa}`)

await new Promise((r) => setTimeout(r, 700))
const push = events.find((e) => e.type === 'order:new' && e.order?.code === code)
ok('poussée WebSocket order:new', !!push, push ? `reçue pour ${push.order.code} (${push.order.name})` : `événements: ${JSON.stringify(events.map((e) => e.type))}`)

// --- 3) suppression → poussée order:deleted + stock rendu ---
const del = await call('DELETE', `/api/orders/${code}`, { token })
ok('DELETE /api/orders/:code', del.status === 200, `${del.status} ${JSON.stringify(del.data)}`)
await new Promise((r) => setTimeout(r, 700))
const delPush = events.find((e) => e.type === 'order:deleted' && e.code === code)
ok('poussée WebSocket order:deleted', !!delPush, JSON.stringify(delPush || null))

const stockFin = (await call('GET', '/api/catalog')).data.products.find((p) => p.id === 'cpu-7800x3d')?.stock
ok('stock rendu après suppression', stockFin === stock0, `${stockResa} → ${stockFin} (attendu ${stock0})`)

const listed = await call('GET', '/api/orders', { token })
ok('commande absente de la liste', !listed.data.orders.some((o) => o.code === code))

// --- 4) refus sans token / non-master ---
const anon = await call('DELETE', '/api/orders/PS-PEUIMPORTE')
ok('DELETE anonyme refusé', anon.status === 403, `HTTP ${anon.status}`)

const noTok = await new Promise((resolve) => {
  const s = new WebSocket('ws://127.0.0.1:8787/api/desk-stream')
  const to = setTimeout(() => { try { s.close() } catch { /* */ }; resolve('timeout') }, 5000)
  s.on('unexpected-response', (_req, res) => { clearTimeout(to); resolve(res.statusCode) })
  s.on('open', () => { clearTimeout(to); try { s.close() } catch { /* */ }; resolve('ouvert(!)') })
  s.on('error', () => { clearTimeout(to); resolve('erreur-connexion') })
})
ok('socket sans token refusé', noTok === 401, `réponse: ${noTok}`)

const client = await call('POST', '/api/auth/register', { body: { email: `p19.direct.${Date.now()}@example.dz`, password: 'motdepasse123', name: 'Client' } })
const cTok = client.data?.token
const badSock = await new Promise((resolve) => {
  if (!cTok) return resolve('pas-de-token-client')
  const s = new WebSocket(`ws://127.0.0.1:8787/api/desk-stream?token=${encodeURIComponent(cTok)}`)
  const to = setTimeout(() => { try { s.close() } catch { /* */ }; resolve('timeout') }, 5000)
  s.on('unexpected-response', (_req, res) => { clearTimeout(to); resolve(res.statusCode) })
  s.on('open', () => { clearTimeout(to); try { s.close() } catch { /* */ }; resolve('ouvert(!)') })
  s.on('error', () => { clearTimeout(to); resolve('erreur-connexion') })
})
ok('socket non-master refusé', badSock === 403, `réponse: ${badSock}`)

ws.close()
console.log(out.join('\n'))
const fails = out.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${out.length - fails}/${out.length} vérifications directes OK`)
process.exit(fails ? 1 : 0)
