// P16 (#16) : `.env` lu AVANT tout le reste — les modules serveur lisent
// process.env au chargement (PORT, DATABASE_URL, FRONT_ORIGIN, TRUST_PROXY…).
import './env.js'
import http from 'node:http'
import { URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  dbPaths,
  dbUrlDiagnostics,
  hashPass,
  MASTER,
  newId,
  newToken,
  publicUser,
  readDbAsync,
  readDbSafe,
  updateDbAsync,
  verifyPass
} from './db.js'
import {
  completeDemo,
  demoConsentHtml,
  oauthConfig,
  safeReturnUrl,
  startOAuth,
  unlinkProvider
} from './oauth.js'
import {
  cancelOrder,
  liveStockOf,
  placeOrder,
  publicCatalog,
  purgeUser,
  setOrderStatus,
  deleteOrder
} from './catalog.js'
import { rateLimit, clientKey } from './rateLimit.js'
// P10 (P7-18) : liste connue des wilayas servies par le shop (source partagée
// src/data.js, déjà importée côté master via PRODUCTS).
import { PRODUCTS, WILAYAS_NEAR } from '../src/data.js'
// P19 : notification du master (WhatsApp Cloud API + socket Desk).
import { broadcastDesk, formatOrderMessage, sendWhatsApp, whatsappConfig } from './notify.js'
import { attachDeskSocket } from './deskSocket.js'
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
// P16 (#25) : plus de `*` par défaut. En same-origin (proxy Vite en dev,
// front+API sur le même domaine Vercel) aucun en-tête CORS n'est nécessaire ;
// si le front est vraiment sur un autre domaine, on le déclare explicitement.
// Avant, toute la réponse de l'API était lisible par n'importe quel site.
const FRONT_ORIGIN =
  process.env.FRONT_ORIGIN ||
  process.env.FRONT_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

/** En-têtes CORS : présents uniquement si une origine autorisée est déclarée. */
function corsHeaders() {
  return FRONT_ORIGIN ? { 'Access-Control-Allow-Origin': FRONT_ORIGIN, Vary: 'Origin' } : {}
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const isJson = typeof body !== 'string'
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    ...corsHeaders(),
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

async function userFromReq(req) {
  const token = bearer(req)
  if (!token) return null
  const db = await readDbAsync()
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
      // P12 (B25) : health reste sans sonde DB (il doit répondre même base
      // morte — c'est justement ce qui distingue « API down » de « base down »),
      // mais il annonce le driver configuré. La sonde réelle est dans
      // GET /api/db/status (master) et `npm run db:doctor`.
      const dbInfo = dbUrlDiagnostics()
      return send(res, 200, {
        ok: true,
        oauth: oauthConfig(),
        master: MASTER.email,
        cors: FRONT_ORIGIN,
        payments: ['cash'],
        db: {
          driver: process.env.DATABASE_URL ? 'neon' : 'file',
          configured: Boolean(dbInfo.configured),
          // `pooler: false` avec `configured: true` = DATABASE_URL pointe sur
          // l'endpoint direct → les lectures (driver HTTP) échouent.
          pooler: dbInfo.configured ? dbInfo.pooler === true : null
        }
      })
    }

    // session
    if (req.method === 'GET' && pathname === '/api/me') {
      const auth = await userFromReq(req)
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
      // P14 (#1) : l'erreur passe par une variable de closure. Avant, elle
      // était posée sur l'objet base (`db._err`) donc PERSISTÉE : toute
      // inscription suivante ressortait en 409 « exists » alors que
      // l'utilisateur était quand même créé en silence.
      let exists = false
      await updateDbAsync((db) => {
        if (db.users.some((u) => u.email === email)) {
          exists = true
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
      if (exists) return send(res, 409, { ok: false, error: 'exists' })
      return send(res, 201, { ok: true, token, user: publicUser(user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const rl = rateLimit({ windowMs: 60_000, max: 20, key: clientKey(req, 'login') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          // P16 : l'en-tête standard manquait — seul le corps le disait.
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const body = await readBody(req)
      const email = String(body.email || '')
        .trim()
        .toLowerCase()
      const password = String(body.password || '')
      const db = await readDbAsync()
      const user = db.users.find((u) => u.email === email)
      if (!user || !verifyPass(password, user.passwordHash)) {
        return send(res, 401, { ok: false, error: 'auth' })
      }
      const token = newToken()
      await updateDbAsync((d) => {
        d.sessions[token] = { userId: user.id, at: Date.now() }
        return d
      })
      return send(res, 200, { ok: true, token, user: publicUser(user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const token = bearer(req)
      if (token) {
        await updateDbAsync((db) => {
          delete db.sessions[token]
          return db
        })
      }
      return send(res, 200, { ok: true })
    }

    if (req.method === 'PUT' && pathname === '/api/me') {
      const auth = await userFromReq(req)
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
      await updateDbAsync((db) => {
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
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const db = await readDbAsync()
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
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const code = decodeURIComponent(pathname.split('/').slice(-2, -1)[0])
      const db0 = await readDbAsync()
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
      await updateDbAsync((db) => {
        result = cancelOrder(db, code)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, order: result.order })
    }

    // Password change (authenticated)
    if (req.method === 'POST' && pathname === '/api/me/password') {
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      const next = String(body.password || '')
      if (next.length < 6) return send(res, 400, { ok: false, error: 'password' })
      // P16 (#13) : le mot de passe ACTUEL est exigé. Avant, un token de
      // session seul suffisait : un token volé (XSS, URL partagée, ou
      // `_lastAuth` recopié dans un backup de store.json) permettait de
      // verrouiller le compte. Le master garde sa voie dédiée (reset-password).
      if (!verifyPass(String(body.current || ''), auth.user.passwordHash)) {
        return send(res, 403, { ok: false, error: 'current_password' })
      }
      await updateDbAsync((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (u) u.passwordHash = hashPass(next)
        return db
      })
      return send(res, 200, { ok: true })
    }

    // Master reset customer password (demo/store desk)
    if (req.method === 'POST' && pathname.startsWith('/api/master/customers/') && pathname.endsWith('/reset-password')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      // P16 (#14) : plus de valeur par défaut. Avant, un corps vide remettait
      // le mot de passe du client à `client31` — devinable, et le master ne
      // savait même pas ce qu'il venait de poser. Le nouveau mot de passe doit
      // être fourni explicitement (≥ 6 caractères).
      const next = String(body.password || '')
      if (next.length < 6) return send(res, 400, { ok: false, error: 'password' })
      let ok = false
      await updateDbAsync((db) => {
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
      const auth = await userFromReq(req)
      const resStart = await startOAuth(body.provider, {
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
      const done = await completeDemo(provider, body.state, { name: body.name, email: body.email })
      if (!done.ok) {
        // P13 (S1/S2) : refus explicite — l'écran de consentement est un
        // formulaire HTML, on répond en HTML lisible (pas un blob JSON).
        const msg =
          done.error === 'master_email'
            ? 'Cet e-mail est le compte du magasin : il se connecte uniquement par mot de passe.'
            : done.error === 'demo_email'
              ? 'Mode démo : seuls les comptes de démonstration peuvent être ouverts par OAuth.'
              : 'Session de consentement expirée ou invalide.'
        return send(
          res,
          done.error === 'state' ? 400 : 403,
          `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Connexion refusée · PC Star</title></head><body style="font-family:system-ui,sans-serif;background:#0b1220;color:#f1c0c0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#151d2e;border:1px solid #4c2a36;border-radius:16px;padding:24px;max-width:420px;width:92%"><h1 style="font-size:18px;margin:0 0 8px;color:#f8fafc">Connexion refusée</h1><p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0">${msg}</p></div></body></html>`
        )
      }
      // P13 (S2) : re-validation au moment de la redirection (défense en
      // profondeur) — jamais de token envoyé vers une origine tierce.
      const front = safeReturnUrl(done.returnUrl) || process.env.FRONT_URL || 'http://127.0.0.1:5173'
      const redir = `${String(front).replace(/\/$/, '')}/?oauth_token=${encodeURIComponent(done.token)}&oauth_provider=${provider}`
      res.writeHead(302, { Location: redir, ...corsHeaders() })
      return res.end()
    }

    if (req.method === 'POST' && pathname === '/api/oauth/unlink') {
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      const out = await unlinkProvider(auth.user.id, body.provider)
      if (!out.ok) return send(res, 400, out)
      return send(res, 200, out)
    }

    // Serve uploads: filesystem (local / Vercel /tmp fallback) or redirect to
    // Vercel Blob CDN when the file was uploaded there.
    if (req.method === 'GET' && pathname === '/api/upload-file') {
      const name = path.basename(String(url.searchParams.get('name') || ''))
      if (!name || name.includes('..')) return send(res, 400, { ok: false, error: 'name' })
      const dir = process.env.VERCEL
        ? path.join('/tmp', 'pcstar-uploads')
        : path.join(__dirname, '../public/photos/uploads')
      const file = path.join(dir, name)
      if (fs.existsSync(file)) {
        const ext = path.extname(name).toLowerCase()
        const type =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        const buf = fs.readFileSync(file)
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=3600',
          ...corsHeaders()
        })
        return res.end(buf)
      }
      // Filesystem miss — try Vercel Blob (photos uploaded to Blob, not /tmp)
      const { resolveBlobUrl } = await import('./blobStore.js')
      const blobUrl = await resolveBlobUrl(name)
      if (blobUrl) {
        return res.writeHead(302, { Location: blobUrl, 'Cache-Control': 'public, max-age=3600' }), res.end()
      }
      return send(res, 404, { ok: false, error: 'not_found' })
    }

    // Catalog with live stock — objets complets (rating/needs/related/compat…)
    // : le front consomme directement cette liste (mode API), il ne lit plus
    // seulement le stock.
    if (req.method === 'GET' && pathname === '/api/catalog') {
      // P12 (B25) : lecture tolérante. Une base injoignable renvoyait avant un
      // 500, que le front interprétait comme « le catalogue serveur est la
      // vérité, même vide » → vitrine sans AUCUN produit alors que la base
      // contenait tout. On sert maintenant le catalogue de base (250 SKU,
      // stock d'origine, sans overrides/masquages master) et on marque la
      // réponse `degraded` + `db` pour que l'UI le dise explicitement.
      const { db, ok, driver, error } = await readDbSafe()
      const products = publicCatalog(db)
      return send(res, 200, {
        ok: true,
        products,
        count: products.length,
        degraded: !ok,
        db: { driver, reachable: ok, error }
      })
    }

    if (req.method === 'GET' && pathname.startsWith('/api/stock/')) {
      const id = pathname.split('/').pop()
      const { db, ok } = await readDbSafe()
      return send(res, 200, { ok: true, id, stock: liveStockOf(db, id), degraded: !ok })
    }

    // P12 (B25) : sonde de base réservée au master — distingue
    // « base injoignable » de « base vide » sans ouvrir un terminal SQL.
    if (req.method === 'GET' && pathname === '/api/db/status') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const startedAt = Date.now()
      const { db, ok, driver, error } = await readDbSafe()
      const stock = db.stock || {}
      const zeroStock = Object.values(stock).filter((v) => (Number(v) || 0) <= 0).length
      const products = publicCatalog(db)
      return send(res, 200, {
        ok: true,
        db: { driver, reachable: ok, error, ms: Date.now() - startedAt, ...dbUrlDiagnostics() },
        counts: {
          baseProducts: PRODUCTS.length,
          publicProducts: products.length,
          extraProducts: (db.meta?.extraProducts || []).length,
          hiddenProducts: (db.meta?.hiddenProductIds || []).length,
          stockOverrides: Object.keys(stock).length,
          zeroStockOverrides: zeroStock,
          orders: (db.orders || []).length,
          users: (db.users || []).length
        }
      })
    }

    // Orders
    if (req.method === 'GET' && pathname === '/api/orders') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const db = await readDbAsync()
      const orders = (db.orders || []).map((o) => ({
        ...o,
        status: o.status === 'pending' ? 'new' : o.status || 'new'
      }))
      return send(res, 200, { ok: true, orders })
    }

    if (req.method === 'POST' && pathname === '/api/orders') {
      const rl = rateLimit({ windowMs: 60_000, max: 15, key: clientKey(req, 'order') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          // P16 : l'en-tête standard manquait — seul le corps le disait.
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const body = await readBody(req)
      if (!body.name || !Array.isArray(body.items) || !body.items.length) {
        return send(res, 400, { ok: false, error: 'order' })
      }
      if (!isDzPhone(body.phone)) return send(res, 400, { ok: false, error: 'phone' })
      const auth = await userFromReq(req)
      let result = null
      await updateDbAsync((db) => {
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
      // P19 — notifier le master. Jamais bloquant : une panne WhatsApp ou un
      // socket fermé ne doit pas faire échouer une commande client.
      const order = result.order
      broadcastDesk({ type: 'order:new', order })
      const wa = whatsappConfig()
      if (wa.enabled) {
        // P20 : les DEUX numéros du magasin sont notifiés. `sent/total` dit
        // combien sont partis — un échec partiel ne bloque pas la commande.
        sendWhatsApp(formatOrderMessage(order))
          .then((r) => {
            if (r.ok) console.log(`[pcstar-notify] WhatsApp envoyé à ${r.sent}/${r.total} numéro(s)`)
            else console.warn(`[pcstar-notify] WhatsApp ${r.sent ?? 0}/${r.total ?? 0} numéro(s) :`, r.error)
          })
          .catch((err) => console.warn('[pcstar-notify] WhatsApp erreur :', String(err?.message || err)))
      }
      return send(res, 201, { ok: true, order })
    }

    // PATCH /api/orders/:code  { status }
    if (req.method === 'PATCH' && pathname.startsWith('/api/orders/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const code = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      const status = String(body.status || '')
      let result = null
      await updateDbAsync((db) => {
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
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const code = decodeURIComponent(parts[parts.length - 2])
      let result = null
      await updateDbAsync((db) => {
        result = cancelOrder(db, code)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, order: result.order })
    }

    // P19 — DELETE /api/orders/:code (master uniquement) : suppression
    // définitive. Distincte de /cancel : l'annulation garde la trace dans
    // l'historique et le CSV, la suppression retire la ligne (et rend le stock).
    if (req.method === 'DELETE' && pathname.startsWith('/api/orders/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const code = decodeURIComponent(pathname.split('/').pop())
      let result = null
      await updateDbAsync((db) => {
        result = deleteOrder(db, code)
        return db
      })
      if (!result?.ok) return send(res, result?.error === 'not_found' ? 404 : 400, { ok: false, error: result?.error })
      broadcastDesk({ type: 'order:deleted', code })
      return send(res, 200, { ok: true, code, restocked: result.restocked })
    }

    // Master products CRUD
    if (req.method === 'GET' && pathname === '/api/master/products') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      // P12 (B25) : vue master tolérante — base morte ⇒ catalogue de base +
      // `degraded`, au lieu d'un 500 qui vide aussi le panneau master.
      const { db, ok } = await readDbSafe()
      return send(res, 200, { ok: true, degraded: !ok, products: listMasterProducts(db) })
    }

    if (req.method === 'POST' && pathname === '/api/master/products') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      let result = null
      // P5 (B12) : id pré-généré UNE fois → photos sauvées directement sous le
      // vrai id du produit. Plus de double-écriture `tmp-*` ni d'orphelins.
      const hasDataUrls = Array.isArray(body.photoDataUrls) && body.photoDataUrls.length > 0
      const newProductId = hasDataUrls ? newId('sku') : null
      const saved = hasDataUrls ? await savePhotoDataUrls(newProductId, body.photoDataUrls) : []
      try {
        await updateDbAsync((db) => {
          if (saved.length) body.photos = [...(body.photos || []), ...saved].slice(0, 6)
          result = createProduct(db, body, newProductId)
          return db
        })
      } catch {
        // P10 (B12) : échec DB (ex: outage Neon) → compensation : supprimer
        // les photos déjà uploadées pour ne pas créer d'orphelins.
        if (saved.length) for (const p of saved) await unlinkUpload(p)
        return send(res, 500, { ok: false, error: 'server' })
      }
      if (!result?.ok) {
        // échec de création → ne pas laisser les fichiers orphelins
        if (saved.length) for (const p of saved) await unlinkUpload(p)
        return send(res, 400, { ok: false, error: result?.error || 'invalid' })
      }
      return send(res, 201, { ok: true, product: result.product })
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/master/products/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      const newPaths = Array.isArray(body.photoDataUrls) && body.photoDataUrls.length
        ? await savePhotoDataUrls(id, body.photoDataUrls)
        : []
      let result = null
      try {
        await updateDbAsync((db) => {
          if (newPaths.length) body.photos = [...(body.photos || []), ...newPaths].slice(0, 6)
          result = updateProduct(db, id, body)
          return db
        })
      } catch {
        // compensation : rollback des photos uploadées si la persistance a échoué
        if (newPaths.length) for (const p of newPaths) await unlinkUpload(p)
        return send(res, 500, { ok: false, error: 'server' })
      }
      if (!result?.ok) return send(res, result?.error === 'not_found' ? 404 : 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, product: result.product })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/master/products/') && pathname.endsWith('/hide')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      let result = null
      await updateDbAsync((db) => {
        result = hideProductMaster(db, id, body.hidden !== false)
        return db
      })
      if (!result?.ok) return send(res, 400, { ok: false, error: result?.error })
      return send(res, 200, { ok: true, product: result.product })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/master/products/') && pathname.endsWith('/photos')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      const paths = await savePhotoDataUrls(id, body.photoDataUrls || body.photos || [])
      if (!paths.length && !Array.isArray(body.photos)) return send(res, 400, { ok: false, error: 'photos' })
      let result = null
      try {
        await updateDbAsync((db) => {
          const photos = paths.length ? paths : body.photos
          result = updateProduct(db, id, { photos })
          return db
        })
      } catch {
        // compensation : rollback des photos uploadées si la persistance a échoué
        if (paths.length) for (const p of paths) await unlinkUpload(p)
        return send(res, 500, { ok: false, error: 'server' })
      }
      if (!result?.ok) {
        if (paths.length) for (const p of paths) await unlinkUpload(p)
        return send(res, 400, { ok: false, error: result?.error })
      }
      return send(res, 200, { ok: true, product: result.product })
    }

    // Panels (master) : persiste extraPanels + hiddenPanelIds dans db.meta —
    // les panneaux du shop sont alors cohérents sur TOUS les appareils
    // (avant : sauvegarde locale uniquement, invisibles avec le serveur).
    if (req.method === 'PUT' && pathname === '/api/master/panels') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      let error = null
      let out = null
      await updateDbAsync((db) => {
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

    // Archive des commandes terminées (Neon only) — déplace les commandes
    // 'picked'/'cancelled' plus anciennes que `days` vers pcstar_archived_orders
    // pour garder le document JSONB chaud (pcstar_state) léger.
    if (req.method === 'POST' && pathname === '/api/master/archive') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const body = await readBody(req)
      const days = Math.max(0, Number(body.days || 30))
      let result
      try {
        const { archiveOrders } = await import('./neonStore.js')
        result = await archiveOrders(
          (orders) => {
            const cutoff = Date.now() - days * 86400000
            const archived = (orders || []).filter(
              (o) => ['picked', 'cancelled'].includes(o.status) && Date.parse(o.at || '') < cutoff
            )
            const codes = new Set(archived.map((o) => o.code))
            const remaining = (orders || []).filter((o) => !codes.has(o.code))
            return { archived, remaining }
          },
          () => ({ archived: 0, via: 'store-json', message: 'archive is a Neon-only feature' })
        )
      } catch (err) {
        console.error('[pcstar-archive]', err)
        return send(res, 500, { ok: false, error: 'archive' })
      }
      return send(res, 200, { ok: result.via === 'neon', archived: result.archived, message: result.message })
    }

    // Orders CSV export (master)
    if (req.method === 'GET' && pathname === '/api/orders/export.csv') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      // P16 : `day` finit dans Content-Disposition — sans validation, un CRLF
      // injectait un en-tête (et faisait tomber la route en 500).
      const rawDay = url.searchParams.get('day') // YYYY-MM-DD optional
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDay || '')) ? String(rawDay) : ''
      const csv = ordersToCsv((await readDbAsync()).orders || [], { day })
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
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      // P16 : le chemin était figé sur `server/data/…`, donc avec
      // PCSTAR_DATA_DIR (tests, conteneur, instance locale) on sauvegardait un
      // fichier qui n'est PAS la base en cours.
      const { dbFile, dataDir } = dbPaths()
      const dest = backupStore(dbFile, path.join(dataDir, 'backups'))
      return send(res, 200, { ok: true, file: dest ? path.basename(dest) : null })
    }

    // Catalog meta — P9 (P7-5) : route PUBLIQUE réduite aux seuls champs que
    // le shop consomme (panneaux). Avant : tout le meta était public
    // (extraProducts = fiches des produits masqués, productOverrides…).
    if (req.method === 'GET' && pathname === '/api/meta') {
      // P12 (B25) : lecture tolérante — panneaux de base si la base est morte.
      const { db, ok } = await readDbSafe()
      const meta = db.meta || {}
      return send(res, 200, {
        ok: true,
        degraded: !ok,
        meta: {
          extraPanels: meta.extraPanels || [],
          hiddenPanelIds: meta.hiddenPanelIds || []
        }
      })
    }

    // P9 (P7-5) : méta complète = master uniquement.
    if (req.method === 'GET' && pathname === '/api/master/meta') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      return send(res, 200, { ok: true, meta: (await readDbAsync()).meta })
    }

    // P9 (P7-8) : PUT /api/meta SUPPRIMÉ — l'écriture `db.meta = {...db.meta,
    // ...body.meta}` sans validation permettait d'écraser extraProducts /
    // productOverrides d'un coup. Les panneaux passent par
    // PUT /api/master/panels (validé, borné) ; les produits par
    // /api/master/products.

    // Customers (master)
    if (req.method === 'GET' && pathname === '/api/customers') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const users = (await readDbAsync()).users.filter((u) => u.role !== 'master').map(publicUser)
      return send(res, 200, { ok: true, customers: users })
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/customers/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = pathname.split('/').pop()
      let ok = false
      await updateDbAsync((db) => {
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
  // P19 : socket Desk — connexion acceptée uniquement pour un token de session
  // master. Non branché sous Vercel (les WebSockets n'y existent pas en
  // serverless) : le front retombe alors sur le polling.
  attachDeskSocket(server, async (token) => {
    try {
      const db = await readDbAsync()
      const sess = db.sessions?.[token]
      if (!sess) return false
      return db.users.some((u) => u.id === sess.userId && u.role === 'master')
    } catch {
      return false
    }
  })
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PC Star API on http://0.0.0.0:${PORT}`)
    {
      const wa = whatsappConfig()
      console.log(
        'WhatsApp master:',
        wa.enabled ? `configuré → ${wa.recipients.join(', ')}` : 'non configuré (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)',
        `| destinataires par défaut : ${whatsappConfig({}).recipients.join(', ')}`
      )
    }
    console.log('OAuth:', oauthConfig())
    // P16 : mêmes chemins que le reste de l'API (dbPaths respecte
    // PCSTAR_DATA_DIR) — sinon le backup local copiait un fichier qui n'est
    // pas la base en cours.
    const { dbFile, dataDir } = dbPaths()
    try {
      const dest = backupStore(dbFile, path.join(dataDir, 'backups'))
      if (dest) console.log('Backup:', dest)
    } catch (e) {
      console.warn('Backup skipped', e.message)
    }
    setInterval(() => {
      try {
        backupStore(dbFile, path.join(dataDir, 'backups'))
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
