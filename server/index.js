import http from 'node:http'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hashPass,
  MASTER,
  newId,
  newToken,
  publicUser,
  readDb,
  updateDb,
  verifyPass
} from './db.js'
import { completeDemo, demoConsentHtml, oauthConfig, startOAuth, unlinkProvider } from './oauth.js'
import {
  cancelOrder,
  liveStockOf,
  placeOrder,
  publicCatalog,
  setOrderStatus
} from './catalog.js'
import { rateLimit, clientKey } from './rateLimit.js'
import {
  backupStore,
  createProduct,
  hideProductMaster,
  listMasterProducts,
  ordersToCsv,
  savePhotoDataUrls,
  updateProduct
} from './masterApi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const FRONT_ORIGIN = process.env.FRONT_ORIGIN || '*'

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const isJson = typeof body !== 'string'
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': FRONT_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      const ct = req.headers['content-type'] || ''
      if (ct.includes('application/json')) {
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve({})
        }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(raw)
        const obj = {}
        for (const [k, v] of params) obj[k] = v
        resolve(obj)
      } else {
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve({ raw })
        }
      }
    })
    req.on('error', reject)
  })
}

function bearer(req) {
  const h = req.headers.authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

function userFromReq(req) {
  const token = bearer(req)
  if (!token) return null
  const db = readDb()
  const sess = db.sessions[token]
  if (!sess) return null
  const user = db.users.find((u) => u.id === sess.userId)
  return user ? { token, user } : null
}

function isDzPhone(value) {
  let d = String(value || '').replace(/\D/g, '')
  if (d.startsWith('213')) d = `0${d.slice(3)}`
  if (d.length === 9 && /^[567]/.test(d)) d = `0${d}`
  return /^0[567]\d{8}$/.test(d)
}

function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '')
  if (d.startsWith('213')) d = `0${d.slice(3)}`
  if (d.length === 9 && /^[567]/.test(d)) d = `0${d}`
  return d
}

function phoneCarrier(value) {
  const p = normalizePhone(value)
  if (!isDzPhone(p)) return null
  if (p.startsWith('05')) return 'ooredoo'
  if (p.startsWith('06')) return 'mobilis'
  if (p.startsWith('07')) return 'djezzy'
  return null
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
  const { pathname } = url

  if (req.method === 'OPTIONS') return send(res, 204, '')

  try {
    // health
    if (req.method === 'GET' && pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        oauth: oauthConfig(),
        master: MASTER.email,
        cors: FRONT_ORIGIN,
        payments: ['cash']
      })
    }

    // session
    if (req.method === 'GET' && pathname === '/api/me') {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      return send(res, 200, { ok: true, user: publicUser(auth.user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody(req)
      const email = String(body.email || '')
        .trim()
        .toLowerCase()
      const password = String(body.password || '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { ok: false, error: 'email' })
      if (password.length < 6) return send(res, 400, { ok: false, error: 'password' })
      if (body.phone && !isDzPhone(body.phone)) return send(res, 400, { ok: false, error: 'phone' })
      let token = null
      let user = null
      const result = updateDb((db) => {
        if (db.users.some((u) => u.email === email)) {
          db._err = 'exists'
          return db
        }
        user = {
          id: newId('u'),
          role: 'customer',
          email,
          passwordHash: hashPass(password),
          name: String(body.name || email.split('@')[0]).trim(),
          phone: body.phone ? normalizePhone(body.phone) : '',
          avatar: 'chip',
          accent: 'green',
          provider: 'email',
          links: { google: null, meta: null },
          wilaya: body.wilaya || 'Oran'
        }
        db.users.push(user)
        token = newToken()
        db.sessions[token] = { userId: user.id, at: Date.now() }
        return db
      })
      if (result._err === 'exists') return send(res, 409, { ok: false, error: 'exists' })
      return send(res, 201, { ok: true, token, user: publicUser(user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const rl = rateLimit({ windowMs: 60_000, max: 20, key: clientKey(req, 'login') })
      if (!rl.ok) return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter })
      const body = await readBody(req)
      const email = String(body.email || '')
        .trim()
        .toLowerCase()
      const password = String(body.password || '')
      const db = readDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || !verifyPass(password, user.passwordHash)) {
        return send(res, 401, { ok: false, error: 'auth' })
      }
      const token = newToken()
      updateDb((d) => {
        d.sessions[token] = { userId: user.id, at: Date.now() }
        return d
      })
      return send(res, 200, { ok: true, token, user: publicUser(user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const token = bearer(req)
      if (token) {
        updateDb((db) => {
          delete db.sessions[token]
          return db
        })
      }
      return send(res, 200, { ok: true })
    }

    if (req.method === 'PUT' && pathname === '/api/me') {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      if (body.phone && String(body.phone).trim() && !isDzPhone(body.phone)) {
        return send(res, 400, { ok: false, error: 'phone' })
      }
      let user = null
      updateDb((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (!u) return db
        if (body.name != null) u.name = String(body.name).trim() || u.name
        if (body.phone != null) u.phone = body.phone ? normalizePhone(body.phone) : ''
        if (body.avatar) u.avatar = body.avatar
        if (body.accent) u.accent = body.accent
        if (body.wilaya) u.wilaya = String(body.wilaya)
        user = u
        return db
      })
      return send(res, 200, { ok: true, user: publicUser(user) })
    }

    // Customer own orders
    if (req.method === 'GET' && pathname === '/api/me/orders') {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const db = readDb()
      const uid = auth.user.id
      const phone = auth.user.phone || ''
      const orders = (db.orders || []).filter(
        (o) => o.userId === uid || (phone && o.phone === phone)
      )
      return send(res, 200, { ok: true, orders })
    }

    // Password change (authenticated)
    if (req.method === 'POST' && pathname === '/api/me/password') {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      const next = String(body.password || '')
      if (next.length < 6) return send(res, 400, { ok: false, error: 'password' })
      updateDb((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (u) u.passwordHash = hashPass(next)
        return db
      })
      return send(res, 200, { ok: true })
    }

    // Master reset customer password (demo/store desk)
    if (req.method === 'POST' && pathname.startsWith('/api/master/customers/') && pathname.endsWith('/reset-password')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      const next = String(body.password || 'client31')
      if (next.length < 6) return send(res, 400, { ok: false, error: 'password' })
      let ok = false
      updateDb((db) => {
        const u = db.users.find((x) => x.id === id && x.role !== 'master')
        if (u) {
          u.passwordHash = hashPass(next)
          ok = true
        }
        return db
      })
      return send(res, ok ? 200 : 404, { ok })
    }

    // OAuth start
    if (req.method === 'POST' && pathname === '/api/oauth/start') {
      const body = await readBody(req)
      const auth = userFromReq(req)
      const resStart = startOAuth(body.provider, {
        userId: body.intent === 'link' ? auth?.user?.id : null,
        intent: body.intent === 'link' ? 'link' : 'login',
        returnUrl: body.returnUrl || null
      })
      if (!resStart.ok) return send(res, 400, resStart)
      return send(res, 200, resStart)
    }

    // OAuth demo consent page
    if (req.method === 'GET' && /^\/api\/oauth\/(google|meta)\/demo$/.test(pathname)) {
      const provider = pathname.includes('google') ? 'google' : 'meta'
      const state = url.searchParams.get('state')
      return send(res, 200, demoConsentHtml(provider, state))
    }

    if (req.method === 'POST' && /^\/api\/oauth\/(google|meta)\/demo$/.test(pathname)) {
      const provider = pathname.includes('google') ? 'google' : 'meta'
      const body = await readBody(req)
      const done = completeDemo(provider, body.state, { name: body.name, email: body.email })
      if (!done.ok) return send(res, 400, done)
      const front = done.returnUrl || process.env.FRONT_URL || 'http://127.0.0.1:5173'
      const redir = `${String(front).replace(/\/$/, '')}/?oauth_token=${encodeURIComponent(done.token)}&oauth_provider=${provider}`
      res.writeHead(302, { Location: redir, 'Access-Control-Allow-Origin': FRONT_ORIGIN })
      return res.end()
    }

    if (req.method === 'POST' && pathname === '/api/oauth/unlink') {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      const out = unlinkProvider(auth.user.id, body.provider)
      if (!out.ok) return send(res, 400, out)
      return send(res, 200, out)
    }

    // Catalog with live stock
    if (req.method === 'GET' && pathname === '/api/catalog') {
      const db = readDb()
      const products = publicCatalog(db).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        category: p.category,
        price: p.price,
        stock: p.stock,
        photos: p.photos,
        short: p.short,
        tags: p.tags,
        compat: p.compat
      }))
      return send(res, 200, { ok: true, products, count: products.length })
    }

    if (req.method === 'GET' && pathname.startsWith('/api/stock/')) {
      const id = pathname.split('/').pop()
      const db = readDb()
      return send(res, 200, { ok: true, id, stock: liveStockOf(db, id) })
    }

    // Orders
    if (req.method === 'GET' && pathname === '/api/orders') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const db = readDb()
      const orders = (db.orders || []).map((o) => ({
        ...o,
        status: o.status === 'pending' ? 'new' : o.status || 'new'
      }))
      return send(res, 200, { ok: true, orders })
    }

    if (req.method === 'POST' && pathname === '/api/orders') {
      const rl = rateLimit({ windowMs: 60_000, max: 15, key: clientKey(req, 'order') })
      if (!rl.ok) return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter })
      const body = await readBody(req)
      if (!body.name || !Array.isArray(body.items) || !body.items.length) {
        return send(res, 400, { ok: false, error: 'order' })
      }
      if (!isDzPhone(body.phone)) return send(res, 400, { ok: false, error: 'phone' })
      const auth = userFromReq(req)
      let result = null
      updateDb((db) => {
        result = placeOrder(
          db,
          {
            name: String(body.name).trim(),
            phone: normalizePhone(body.phone),
            carrier: phoneCarrier(body.phone),
            wilaya: body.wilaya || 'Oran',
            payment: 'cash',
            slot: body.slot || '',
            items: body.items,
            total: body.total
          },
          { userId: auth?.user?.id || null }
        )
        return db
      })
      if (!result?.ok) {
        if (result?.error === 'stock') return send(res, 409, { ok: false, error: 'stock', shortages: result.shortages })
        return send(res, 400, { ok: false, error: result?.error || 'order' })
      }
      return send(res, 201, { ok: true, order: result.order })
    }

    // PATCH /api/orders/:code  { status }
    if (req.method === 'PATCH' && pathname.startsWith('/api/orders/')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const code = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      const status = String(body.status || '')
      let result = null
      updateDb((db) => {
        result = setOrderStatus(db, code, status)
        return db
      })
      if (!result?.ok) {
        const codeHttp = result?.error === 'not_found' ? 404 : 400
        return send(res, codeHttp, { ok: false, error: result?.error || 'status' })
      }
      return send(res, 200, { ok: true, order: result.order })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/orders/') && pathname.endsWith('/cancel')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const code = decodeURIComponent(parts[parts.length - 2])
      let result = null
      updateDb((db) => {
        result = cancelOrder(db, code)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, order: result.order })
    }

    // Master products CRUD
    if (req.method === 'GET' && pathname === '/api/master/products') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, products: listMasterProducts(readDb()) })
    }

    if (req.method === 'POST' && pathname === '/api/master/products') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      let result = null
      updateDb((db) => {
        // optional dataURL photos
        if (Array.isArray(body.photoDataUrls) && body.photoDataUrls.length) {
          const idHint = 'tmp'
          const paths = savePhotoDataUrls(idHint, body.photoDataUrls)
          body.photos = [...(body.photos || []), ...paths].slice(0, 6)
        }
        result = createProduct(db, body)
        if (result.ok && Array.isArray(body.photoDataUrls) && body.photoDataUrls.length) {
          // re-save under real id
          const paths = savePhotoDataUrls(result.product.id, body.photoDataUrls)
          if (paths.length) {
            result.product.photos = paths
            const extras = db.meta.extraProducts
            const i = extras.findIndex((x) => x.id === result.product.id)
            if (i >= 0) extras[i].photos = paths
          }
        }
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error || 'invalid' })
      return send(res, 201, { ok: true, product: result.product })
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/master/products/')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      let result = null
      updateDb((db) => {
        if (Array.isArray(body.photoDataUrls) && body.photoDataUrls.length) {
          const paths = savePhotoDataUrls(id, body.photoDataUrls)
          body.photos = [...(body.photos || []), ...paths].slice(0, 6)
        }
        result = updateProduct(db, id, body)
        return db
      })
      if (!result?.ok) return send(res, result?.error === 'not_found' ? 404 : 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, product: result.product })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/master/products/') && pathname.endsWith('/hide')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      let result = null
      updateDb((db) => {
        result = hideProductMaster(db, id, body.hidden !== false)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, product: result.product })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/master/products/') && pathname.endsWith('/photos')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      const paths = savePhotoDataUrls(id, body.photoDataUrls || body.photos || [])
      if (!paths.length && !Array.isArray(body.photos)) return send(res, 400, { ok: false, error: 'photos' })
      let result = null
      updateDb((db) => {
        const photos = paths.length ? paths : body.photos
        result = updateProduct(db, id, { photos })
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, product: result.product })
    }

    // Orders CSV export (master)
    if (req.method === 'GET' && pathname === '/api/orders/export.csv') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const day = url.searchParams.get('day') // YYYY-MM-DD optional
      const csv = ordersToCsv(readDb().orders || [], { day })
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pcstar-orders${day ? '-' + day : ''}.csv"`,
        'Access-Control-Allow-Origin': FRONT_ORIGIN
      })
      return res.end(csv)
    }

    // Manual backup
    if (req.method === 'POST' && pathname === '/api/master/backup') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const dbPath = path.join(__dirname, 'data', 'store.json')
      const dest = backupStore(dbPath, path.join(__dirname, 'data', 'backups'))
      return send(res, 200, { ok: true, file: dest ? path.basename(dest) : null })
    }

        // Catalog meta (master)
    if (req.method === 'GET' && pathname === '/api/meta') {
      return send(res, 200, { ok: true, meta: readDb().meta })
    }

    if (req.method === 'PUT' && pathname === '/api/meta') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      updateDb((db) => {
        db.meta = { ...db.meta, ...body.meta }
        return db
      })
      return send(res, 200, { ok: true, meta: readDb().meta })
    }

    // Customers (master)
    if (req.method === 'GET' && pathname === '/api/customers') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const users = readDb().users.filter((u) => u.role !== 'master').map(publicUser)
      return send(res, 200, { ok: true, customers: users })
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/customers/')) {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = pathname.split('/').pop()
      let ok = false
      updateDb((db) => {
        const t = db.users.find((u) => u.id === id)
        if (!t || t.role === 'master') return db
        db.users = db.users.filter((u) => u.id !== id)
        ok = true
        return db
      })
      return send(res, ok ? 200 : 400, { ok })
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      return send(res, 200, {
        ok: true,
        store: {
          name: 'PC Star Informatique',
          city: 'Oran',
          address: 'Rue Mimoune Bouadjimi, El Makari Les Castors, Oran',
          phones: ['0770650387', '0669174617'],
          payments: ['cash'],
          carriers: ['mobilis', 'ooredoo', 'djezzy']
        },
        oauth: oauthConfig()
      })
    }

    return send(res, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    console.error(err)
    return send(res, 500, { ok: false, error: 'server', message: String(err.message || err) })
  }
}

const server = http.createServer(handler)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`PC Star API on http://0.0.0.0:${PORT}`)
  console.log('OAuth:', oauthConfig())
  try {
    const dbPath = path.join(__dirname, 'data', 'store.json')
    const dest = backupStore(dbPath, path.join(__dirname, 'data', 'backups'))
    if (dest) console.log('Backup:', dest)
  } catch (e) {
    console.warn('Backup skipped', e.message)
  }
  // rolling backup every 6h
  setInterval(() => {
    try {
      backupStore(path.join(__dirname, 'data', 'store.json'), path.join(__dirname, 'data', 'backups'))
    } catch {
      /* ignore */
    }
  }, 6 * 60 * 60 * 1000).unref?.()
})
