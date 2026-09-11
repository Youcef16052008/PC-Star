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
  purgeUser,
  setOrderStatus
} from './catalog.js'
import { rateLimit, clientKey } from './rateLimit.js'
// P10 (P7-18) : liste connue des wilayas servies par le shop (source partagée
// src/data.js, déjà importée côté master via PRODUCTS).
import { WILAYAS_NEAR } from '../src/data.js'
import {
  backupStore,
  createProduct,
  hideProductMaster,
  listMasterProducts,
  ordersToCsv,
  savePhotoDataUrls,
  unlinkUpload,
  updateProduct
} from './masterApi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const FRONT_ORIGIN =
  process.env.FRONT_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '*')

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

// P10 (P7-10) : corps de requête borné (~6 photos compressées en base64 +
// marge). Sans limite, un corps de plusieurs centaines de Mo = OOM en local
// (Vercel impose ses propres limites d'entrée).
const MAX_BODY_BYTES = 15 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Vercel / some adapters may already parse JSON
    if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return resolve(req.body)
    }
    if (typeof req.body === 'string' && req.body) {
      try {
        return resolve(JSON.parse(req.body))
      } catch {
        /* fall through */
      }
    }
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      total += c.length
      if (total > MAX_BODY_BYTES) {
        aborted = true
        const err = new Error('body too large')
        err.code = 'BODY_TOO_LARGE'
        reject(err)
        req.resume() // drainer sans destroy (pas d'erreur en cascade)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (aborted) return
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

export async function handler(req, res) {
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
      // P10 (P7-18) : wilaya bornée — liste connue (le select client ne propose
      // que ces valeurs) + troncature 32 ; sinon on garde l'existant/'Oran'.
      // Avant : n'importe quelle chaîne libre était stockée.
      const rawWilaya = body.wilaya == null ? null : String(body.wilaya).trim().slice(0, 32)
      let user = null
      updateDb((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (!u) return db
        if (body.name != null) u.name = String(body.name).trim() || u.name
        if (body.phone != null) u.phone = body.phone ? normalizePhone(body.phone) : ''
        if (body.avatar) u.avatar = body.avatar
        if (body.accent) u.accent = body.accent
        if (rawWilaya != null) {
          u.wilaya = WILAYAS_NEAR.includes(rawWilaya) ? rawWilaya : (u.wilaya || 'Oran')
        }
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
      // P10 (P7-15) : le match par téléphone ne s'applique qu'aux commandes
      // GUEST (userId null) — avant, deux comptes au même numéro voyaient (et
      // annulaient) les commandes de l'autre.
      const orders = (db.orders || []).filter(
        (o) => o.userId === uid || (o.userId == null && phone && o.phone === phone)
      )
      return send(res, 200, { ok: true, orders })
    }

    // Customer cancels ONE of his own orders (new/pending only) → restock.
    if (req.method === 'POST' && pathname.startsWith('/api/me/orders/') && pathname.endsWith('/cancel')) {
      const auth = userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const code = decodeURIComponent(pathname.split('/').slice(-2, -1)[0])
      const db0 = readDb()
      const uid = auth.user.id
      const phone = auth.user.phone || ''
      // P10 (P7-15) : même règle que GET — guest (userId null) ou propriétaire
      const mine = (db0.orders || []).find(
        (o) => o.code === code && (o.userId === uid || (o.userId == null && phone && o.phone === phone))
      )
      if (!mine) return send(res, 404, { ok: false, error: 'not_found' })
      if (mine.status !== 'new' && mine.status !== 'pending') {
        return send(res, 409, { ok: false, error: 'status' })
      }
      let result = null
      updateDb((db) => {
        result = cancelOrder(db, code)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, order: result.order })
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

    // Serve ephemeral uploads (Vercel /tmp) — not durable; use Blob later for prod photos
    if (req.method === 'GET' && pathname === '/api/upload-file') {
      const name = path.basename(String(url.searchParams.get('name') || ''))
      if (!name || name.includes('..')) return send(res, 400, { ok: false, error: 'name' })
      const dir = process.env.VERCEL
        ? path.join('/tmp', 'pcstar-uploads')
        : path.join(__dirname, '../public/photos/uploads')
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) return send(res, 404, { ok: false, error: 'not_found' })
      const ext = path.extname(name).toLowerCase()
      const type =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const buf = fs.readFileSync(file)
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': FRONT_ORIGIN
      })
      return res.end(buf)
    }

    // Catalog with live stock — objets complets (rating/needs/related/compat…)
    // : le front consomme directement cette liste (mode API), il ne lit plus
    // seulement le stock.
    if (req.method === 'GET' && pathname === '/api/catalog') {
      const db = readDb()
      const products = publicCatalog(db)
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
            // P9 (P7-4) : « journée » locale du client (validée dans placeOrder)
            day: body.day || '',
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
      // P5 (B12) : id pré-généré UNE fois → photos sauvées directement sous le
      // vrai id du produit. Plus de double-écriture `tmp-*` ni d'orphelins.
      const hasDataUrls = Array.isArray(body.photoDataUrls) && body.photoDataUrls.length > 0
      const newProductId = hasDataUrls ? newId('sku') : null
      const saved = hasDataUrls ? savePhotoDataUrls(newProductId, body.photoDataUrls) : []
      updateDb((db) => {
        if (saved.length) body.photos = [...(body.photos || []), ...saved].slice(0, 6)
        result = createProduct(db, body, newProductId)
        return db
      })
      if (!result?.ok) {
        // échec de création → ne pas laisser les fichiers orphelins
        for (const p of saved) unlinkUpload(p)
        return send(res, 400, { ok: false, error: result?.error || 'invalid' })
      }
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

    // Panels (master) : persiste extraPanels + hiddenPanelIds dans db.meta —
    // les panneaux du shop sont alors cohérents sur TOUS les appareils
    // (avant : sauvegarde locale uniquement, invisibles avec le serveur).
    if (req.method === 'PUT' && pathname === '/api/master/panels') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      let error = null
      let out = null
      updateDb((db) => {
        if (body.hiddenPanelIds != null) {
          if (!Array.isArray(body.hiddenPanelIds) || body.hiddenPanelIds.some((x) => typeof x !== 'string')) {
            error = 'panels'
            return db
          }
          db.meta.hiddenPanelIds = [...new Set(body.hiddenPanelIds)]
        }
        if (body.extraPanels != null) {
          const okPanels = Array.isArray(body.extraPanels) &&
            body.extraPanels.every((p) => p && typeof p.id === 'string' && p.id &&
              p.titles && typeof p.titles === 'object' &&
              Array.isArray(p.categories) && p.categories.every((c) => typeof c === 'string'))
          if (!okPanels) {
            error = 'panels'
            return db
          }
          db.meta.extraPanels = body.extraPanels.slice(0, 12)
        }
        out = { hiddenPanelIds: db.meta.hiddenPanelIds || [], extraPanels: db.meta.extraPanels || [] }
        return db
      })
      if (error) return send(res, 400, { ok: false, error })
      return send(res, 200, { ok: true, meta: out })
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
      // P10 (P7-12) : BOM UTF-8 — sans lui, Excel (Windows) lit en ANSI et
      // les accents FR/AR deviennent illisibles sur le comptoir.
      return res.end('\uFEFF' + csv)
    }

    // Manual backup
    if (req.method === 'POST' && pathname === '/api/master/backup') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const dbPath = path.join(__dirname, 'data', 'store.json')
      const dest = backupStore(dbPath, path.join(__dirname, 'data', 'backups'))
      return send(res, 200, { ok: true, file: dest ? path.basename(dest) : null })
    }

    // Catalog meta — P9 (P7-5) : route PUBLIQUE réduite aux seuls champs que
    // le shop consomme (panneaux). Avant : tout le meta était public
    // (extraProducts = fiches des produits masqués, productOverrides…).
    if (req.method === 'GET' && pathname === '/api/meta') {
      const meta = readDb().meta || {}
      return send(res, 200, {
        ok: true,
        meta: {
          extraPanels: meta.extraPanels || [],
          hiddenPanelIds: meta.hiddenPanelIds || []
        }
      })
    }

    // P9 (P7-5) : méta complète = master uniquement.
    if (req.method === 'GET' && pathname === '/api/master/meta') {
      const auth = userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, meta: readDb().meta })
    }

    // P9 (P7-8) : PUT /api/meta SUPPRIMÉ — l'écriture `db.meta = {...db.meta,
    // ...body.meta}` sans validation permettait d'écraser extraProducts /
    // productOverrides d'un coup. Les panneaux passent par
    // PUT /api/master/panels (validé, borné) ; les produits par
    // /api/master/products.

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
        ok = purgeUser(db, id).ok
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
    // P10 (P7-10) : corps trop gros → 413 explicite (pas un 500/OOM)
    if (err && err.code === 'BODY_TOO_LARGE') {
      return send(res, 413, { ok: false, error: 'too_large' })
    }
    console.error(err)
    return send(res, 500, { ok: false, error: 'server', message: String(err.message || err) })
  }
}

function startLocalServer() {
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
    setInterval(() => {
      try {
        backupStore(path.join(__dirname, 'data', 'store.json'), path.join(__dirname, 'data', 'backups'))
      } catch {
        /* ignore */
      }
    }, 6 * 60 * 60 * 1000).unref?.()
  })
  return server
}

// Local / long-running only — Vercel imports { handler } without listen
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain && !process.env.VERCEL) {
  startLocalServer()
}

export default handler
export { startLocalServer }
