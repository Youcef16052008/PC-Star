#!/usr/bin/env node
/** API smoke: health → catalog → login → order → me/orders → legal pages via front */
const API = process.env.API || 'http://127.0.0.1:8787'
const FRONT = process.env.FRONT || 'http://127.0.0.1:5173'

async function j(url, opts = {}) {
  const r = await fetch(url, opts)
  const data = await r.json().catch(() => null)
  return { status: r.status, ok: r.ok, data }
}

const fails = []
function ok(name, cond, extra = '') {
  if (cond) console.log('OK', name, extra)
  else {
    console.error('FAIL', name, extra)
    fails.push(name)
  }
}

const h = await j(`${API}/api/health`)
ok('health', h.ok && h.data?.ok)

const cat = await j(`${API}/api/catalog`)
ok('catalog', cat.ok && cat.data?.count >= 250, cat.data?.count)

const login = await j(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'karim.oran@demo.dz', password: 'karim31' })
})
ok('login-customer', login.ok && login.data?.token)
const token = login.data?.token

const order = await j(`${API}/api/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    name: 'Karim B.',
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '16:00',
    items: [{ id: 'mousepad', sku: 'G640', name: 'Pad', qty: 1, price: 7500 }],
    total: 7500
  })
})
ok('order', order.ok && order.data?.order?.code, order.data?.order?.code || order.data?.error)

const mine = await j(`${API}/api/me/orders`, {
  headers: { Authorization: `Bearer ${token}` }
})
ok('me-orders', mine.ok && Array.isArray(mine.data?.orders) && mine.data.orders.length >= 1, mine.data?.orders?.length)

const master = await j(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'pcstar.info31@gmail.com', password: 'star31' })
})
ok('login-master', master.ok && master.data?.token)

const oauth = await j(`${API}/api/oauth/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'google', intent: 'login' })
})
ok('oauth-start', oauth.ok && oauth.data?.authorizeUrl, oauth.data?.authorizeUrl)

const front = await fetch(FRONT)
ok('front', front.ok, front.status)

const robots = await fetch(`${FRONT}/robots.txt`)
ok('robots', robots.ok && (await robots.text()).includes('Sitemap'))

if (fails.length) {
  console.error('SMOKE FAILED', fails)
  process.exit(1)
}
console.log('SMOKE OK')
