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
  hashPassAsync,
  hashToken,
  initDb,
  createSession,
  deleteSession,
  findSession,
  masterAccount,
  newId,
  putSession,
  newToken,
  publicUser,
  readDbAsync,
  readDbSafe,
  updateDbAsync,
  verifyPass
} from './db.js'
import {
  completeDemo,
  completeOAuthCallback,
  configuredFrontUrl,
  demoConsentHtml,
  oauthConfig,
  oauthDemo,
  safeReturnUrl,
  startOAuth,
  unlinkProvider
} from './oauth.js'
import {
  cancelOrder,
  cancelOwnOrder,
  claimGuestOrder,
  issueClaimCode,
  liveStockOf,
  ordersForUser,
  placeOrder,
  publicCatalog,
  purgeUser,
  setOrderPickupDate,
  setOrderStatus,
  deleteOrder
} from './catalog.js'
import { rateLimit, clientKey } from './rateLimit.js'
import { normalizePhone, isDzPhone, phoneCarrier } from './phone.js'
// P10 (P7-18) : liste connue des wilayas servies par le shop (source partagée
// src/data.js, déjà importée côté master via PRODUCTS).
import { PRODUCTS, SLOTS, WILAYAS_NEAR } from '../src/data.js'
// P19 : notification du master (WhatsApp Cloud API + socket Desk).
import { broadcastDesk, formatOrderMessage, sendWhatsApp, whatsappConfig } from './notify.js'
// LOT 8.4 (A4) : budgets d'octets partagés avec le client (compression, garde
// d'envoi) et détection de l'environnement serverless.
import { LOCAL_MAX_BODY_BYTES, MAX_UPLOAD_BODY_BYTES, VERCEL_MAX_BODY_BYTES } from '../src/limits.js'
import { IS_SERVERLESS, safeUploadName } from './blobStore.js'
import { attachDeskSocket } from './deskSocket.js'
import {
  backupStore,
  cleanupUnreferencedUploads,
  createProduct,
  currentProductPhotos,
  mergeProductPhotos,
  deleteProductMaster,
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
/**
 * LOT 6.8 (Q8) : UN seul jeu d'en-têtes CORS, exporté pour être testé.
 *
 * Avant : `Allow-Origin` + `Vary` sortaient d'ici (conditionnés à FRONT_ORIGIN),
 * tandis que `Allow-Headers` et `Allow-Methods` n'étaient ajoutés **que** dans
 * `send()`. Conséquence : les réponses qui n'utilisent pas `send()` — les
 * redirections OAuth (302) et les aperçus d'upload — partaient sans
 * `Allow-Methods`, donc un navigateur en contexte cross-origin pouvait refuser
 * une réponse que le reste de l'API autorisait. Deux listes d'en-têtes
 * légèrement différentes pour le même service, c'est le genre d'écart qui se
 * paie en incident intermittent.
 *
 * Le tout reste conditionné à `FRONT_ORIGIN` : sans origine déclarée, l'API est
 * servie en même-origine et n'a aucun en-tête CORS à poser (rien à autoriser).
 */
export function corsHeaders() {
  if (!FRONT_ORIGIN) return {}
  return {
    'Access-Control-Allow-Origin': FRONT_ORIGIN,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const isJson = typeof body !== 'string'
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    ...corsHeaders(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // P22 (item 2) — aucune CSP n'était posée. Celle-ci couvre les pages HTML
    // servies par l'API (refus OAuth, aperçus d'upload). Les pages d'erreur
    // utilisent des attributs style="…" : 'unsafe-inline' reste nécessaire pour
    // les styles, mais PAS pour les scripts — c'est là qu'est l'essentiel de la
    // protection XSS. La CSP de l'application elle-même est dans vercel.json.
    'Content-Security-Policy':
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; " +
      // La redirection /api/upload-file vers le CDN Blob est elle aussi évaluée
      // par la directive des images : l'autoriser strictement évite les photos
      // cassées après un cold start tout en ne permettant aucun autre hôte.
      "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com; " +
      "connect-src 'self'; form-action 'self'",
    ...headers
  })
  res.end(payload)
}

/** Réponse HTML sans détail fournisseur ni secret pour les retours OAuth. */
function sendOAuthFailure(res, error) {
  const messages = {
    // Les trois refus suivants ne distinguent ni le rôle ni l'existence d'un
    // compte local : un callback ne doit pas devenir un oracle d'identités.
    master_email: 'Le compte du magasin reste un compte à mot de passe : cette connexion ne peut pas être associée à ce compte.',
    master_oauth_forbidden: 'Le compte du magasin reste un compte à mot de passe : cette connexion ne peut pas être associée à ce compte.',
    identity_linked: 'Cette connexion ne peut pas être associée à ce compte.',
    demo_email: 'Mode démo : seuls les comptes de démonstration peuvent être ouverts par OAuth.',
    provider_cancelled: 'La connexion a été annulée chez le fournisseur.',
    oauth_provider: 'Le fournisseur n’a pas pu confirmer votre identité. Recommencez la connexion.',
    no_email: 'Le fournisseur n’a pas transmis l’e-mail requis pour cette connexion.',
    provider_not_configured: 'Ce fournisseur de connexion n’est pas configuré.',
    demo_enabled: 'La connexion réelle est désactivée tant que le mode démo est actif.'
  }
  const message = messages[error] || 'Session de consentement expirée ou invalide.'
  const status = error === 'state' ? 400 : error === 'oauth_provider' ? 502 : 403
  return send(
    res,
    status,
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Connexion refusée · PC Star</title></head><body style="font-family:system-ui,sans-serif;background:#0b1220;color:#f1c0c0;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#151d2e;border:1px solid #4c2a36;border-radius:16px;padding:24px;max-width:420px;width:92%"><h1 style="font-size:18px;margin:0 0 8px;color:#f8fafc">Connexion refusée</h1><p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0">${message}</p></div></body></html>`
  )
}

/** Retourne la session OAuth par fragment afin qu'elle ne circule pas dans les logs/Referer. */
function redirectOAuthSuccess(res, done, provider) {
  // P13 (S2) : re-validation au moment de la redirection (défense en
  // profondeur) — jamais de token envoyé vers une origine tierce.
  const front = safeReturnUrl(done.returnUrl) || configuredFrontUrl()
  const tok = encodeURIComponent(done.token)
  const prov = encodeURIComponent(provider)
  let redir
  try {
    const u = new URL(String(front))
    u.search = ''
    u.hash = `#oauth_token=${tok}&oauth_provider=${prov}`
    redir = u.toString()
  } catch {
    // `configuredFrontUrl()` est normalement absolue. Ce dernier repli conserve
    // néanmoins le fragment (jamais un paramètre de requête) si une ancienne
    // configuration locale est invalide.
    redir = `${String(front).replace(/\/$/, '')}/#oauth_token=${tok}&oauth_provider=${prov}`
  }
  res.writeHead(302, { Location: redir, ...corsHeaders() })
  return res.end()
}

// P10 (P7-10) : corps de requête borné (~6 photos compressées en base64 +
// marge). Sans limite, un corps de plusieurs centaines de Mo = OOM en local.
//
// LOT 8.4 (A4) : la borne était de 15 Mo **partout**, alors que sur Vercel le
// corps d'une fonction serverless est limité par la plateforme à **4,5 Mo** —
// refusé AVANT que le handler ne s'exécute (`FUNCTION_PAYLOAD_TOO_LARGE`), et
// non relevable (Hobby comme Pro). Annoncer 15 Mo sur Vercel était donc une
// valeur inaccessible : entre 4,5 et 15 Mo, ce n'est pas notre 413 JSON que le
// maître reçoit mais une page d'erreur de la plateforme. La borne suit
// désormais l'environnement, et reste sous la limite plateforme pour que le
// refus vienne de l'application (avec son message) chaque fois que c'est elle
// qui peut encore répondre.
export const MAX_BODY_BYTES = IS_SERVERLESS ? MAX_UPLOAD_BODY_BYTES : LOCAL_MAX_BODY_BYTES

/**
 * LOT 8.4 (A4) — corps du 413 : la borne réellement appliquée est annoncée.
 *
 * Un client (ou un `curl` de diagnostic) sait alors quelle taille viser, au
 * lieu de deviner entre les 4,5 Mo de la plateforme et les 15 Mo d'un serveur
 * local. `platformLimit` n'est renseigné que sous Vercel : ailleurs, aucune
 * limite extérieure ne s'applique.
 */
export function bodyTooLargePayload() {
  return {
    ok: false,
    error: 'too_large',
    maxBytes: MAX_BODY_BYTES,
    platformLimit: IS_SERVERLESS ? VERCEL_MAX_BODY_BYTES : null
  }
}

// Exportée pour les tests de borne (LOT 8.4) : refuser un corps trop gros se
// vérifie sans pousser 15 Mo dans un socket.
export function readBody(req) {
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
  // Durcissement des jetons : la base ne contient que des EMPREINTES sha256.
  const sess = findSession(db, token)
  if (!sess) return null
  const user = db.users.find((u) => u.id === sess.userId)
  return user ? { token, user } : null
}

// P22 (bug A) / LOT 4.4 (R20) : `normalizePhone` et `isDzPhone` vivent dans
// `server/phone.js` — une seule règle côté serveur, partagée avec `db.js`
// (migration R20) au lieu d'une troisième copie.

/**
 * LOT 4.2 (F15) — enregistre les photos d'un produit, sans jamais laisser une
 * exception d'upload remonter en 500 générique.
 *
 * Les trois routes photo appelaient `savePhotoDataUrls` HORS de tout `try` :
 * un échec de stockage (Blob injoignable, ou — depuis ce lot — repli
 * filesystem refusé sous Vercel parce que `/tmp` est éphémère) partait dans le
 * gestionnaire global et le master voyait « server » sans savoir quoi faire.
 * On traduit l'absence de stockage durable en code d'erreur explicite
 * (`upload_storage`), que le front sait nommer, et on journalise la cause.
 *
 * @returns {{ paths: string[] } | { paths: [], error: string, status: number }}
 */
async function savePhotoDataUrlsSafe(productId, dataUrls) {
  try {
    return { paths: await savePhotoDataUrls(productId, dataUrls) }
  } catch (err) {
    if (err && err.code === 'UPLOAD_STORAGE_UNAVAILABLE') {
      console.error('[pcstar] upload photo refusé — aucun stockage durable :', err.message)
      return { paths: [], error: 'upload_storage', status: 500 }
    }
    console.error('[pcstar] échec upload photo :', String((err && err.message) || err))
    return { paths: [], error: 'server', status: 500 }
  }
}

/** Journalise une suppression différée sans défaire la fiche déjà persistée. */
async function cleanupProductUploads(before, after, uploaded = []) {
  const remaining = await cleanupUnreferencedUploads(before, after, uploaded)
  for (const photo of remaining) console.warn(`[pcstar] suppression photo différée : ${photo}`)
}

/**
 * Sauvegarde suivant le driver réellement utilisé. Une copie de `store.json`
 * n'est pas une sauvegarde lorsque DATABASE_URL sélectionne Neon : en Vercel,
 * ce fichier n'est même pas l'état courant. Le driver Neon crée donc un
 * snapshot transactionnel persistant dans `pcstar_backups`.
 */
async function backupCurrentState(source = 'manual') {
  if (process.env.DATABASE_URL) {
    const { createNeonBackup } = await import('./neonStore.js')
    const backup = await createNeonBackup(source)
    return { driver: 'neon', ...backup }
  }
  const { dbFile, dataDir } = dbPaths()
  const dest = backupStore(dbFile, path.join(dataDir, 'backups'))
  if (!dest) throw new Error('local database file is unavailable')
  return { driver: 'file', file: path.basename(dest) }
}

// AUDIT-2026-09-17 / phase 3 — aucune correspondance téléphone → compte.
// Sans OTP/SMS effectivement livré et vérifié, le numéro déclaré au checkout
// n'est pas une preuve de possession. Les routes client ne servent donc que les
// commandes dont `userId` est déjà celui de la session.
// LOT 6.2 (Q2) : `phoneCarrier` vient de `server/phone.js` (implémentation
// partagée avec le front dans `src/phoneLogic.js`) — plus de copie serveur.

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
        // LOT 1.1 : l'e-mail du maître n'est plus divulgué ici (rapport
        // d'audit #27). Cette route est publique : elle donnait l'identifiant
        // du compte maître sans authentification — ce qui, combiné au mot de
        // passe présent dans le bundle, livrait l'accès complet sans aucun
        // outil. `cors` reste (utile au diagnostic navigateur) mais plus
        // aucune identité.
        oauth: oauthConfig(),
        cors: FRONT_ORIGIN,
        payments: ['cash'],
        // LOT 8.6 (A6) : état du canal d'alerte du maître — des COMPTEURS, pas
        // les numéros : cette route est publique et `WHATSAPP_RECIPIENT` peut
        // être un numéro privé (les numéros du magasin, eux, sont déjà affichés
        // sur le site). `invalid > 0` signifie qu'une partie des alertes ne
        // partira pas : c'est visible sans attendre la première commande.
        whatsapp: (() => {
          const wa = whatsappConfig()
          return {
            configured: wa.enabled,
            recipients: wa.recipients.length,
            invalid: wa.invalidRecipients.length
          }
        })(),
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
      // LOT 1.6 : limité — la route appelait `readDbAsync()` à chaque requête
      // sans aucun garde-fou (rapport d'audit #12).
      // Le contrôle est placé AVANT `userFromReq` à dessein : la limite doit
      // aussi couper un flot de requêtes NON authentifiées, qui coûteraient
      // sinon chacune une lecture de base avant de répondre 401.
      const rl = rateLimit({ windowMs: 60_000, max: 120, key: clientKey(req, 'me') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      return send(res, 200, { ok: true, user: publicUser(auth.user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      // LOT 1.6 : la route était SANS rate-limit alors que `/api/auth/login`
      // était à 20/min. Reproduit à l'audit : 25 inscriptions d'affilée →
      // 25 × 201 en 985 ms, sans authentification, avec énumération d'e-mails
      // illimitée via le 409 `exists`.
      //
      // Fenêtre longue (10 min) : une inscription est un acte rare et coûteux
      // (scrypt), pas un clic de navigation — le compteur ne doit pas se
      // réinitialiser en une minute.
      // Seuil 20 : aligné sur `/api/auth/login`. Un seuil plus bas (10)
      // pénaliserait les foyers et établissements partagés derrière une seule
      // IP publique, cas courant en Algérie où plusieurs clients sortent par la
      // même adresse — et c'est précisément ce que le 429 `Retry-After`
      // signalerait à tort comme une attaque.
      const rl = rateLimit({ windowMs: 600_000, max: 20, key: clientKey(req, 'register') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const body = await readBody(req)
      const email = String(body.email || '')
        .trim()
        .toLowerCase()
      const password = String(body.password || '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { ok: false, error: 'email' })
      if (password.length < 6) return send(res, 400, { ok: false, error: 'password' })
      if (body.phone && !isDzPhone(body.phone)) return send(res, 400, { ok: false, error: 'phone' })
      // LOT 1.9 : le nom n'avait aucune borne — le `maxlength` client n'est
      // qu'indicatif, un `fetch` direct l'ignore. Même plafond que les
      // commandes (64) : c'est le même nom, affiché aux mêmes endroits
      // (comptoir, export CSV, WhatsApp).
      const regName = String(body.name || '').trim()
      if (regName.length > 64) return send(res, 400, { ok: false, error: 'name_too_long' })
      let token = null
      let user = null
      // P14 (#1) : l'erreur passe par une variable de closure. Avant, elle
      // était posée sur l'objet base (`db._err`) donc PERSISTÉE : toute
      // inscription suivante ressortait en 409 « exists » alors que
      // l'utilisateur était quand même créé en silence.
      let exists = false
      // LOT 1.6 : hash calculé HORS du mutateur. `hashPass` était synchrone
      // (`scryptSync`, mesuré à 30,8–43,0 ms) et tournait DANS la mutation :
      // sur une route sans authentification ni limite, 25 inscriptions
      // bloquaient le thread principal ~770 ms. Le rate-limit seul ne suffisait
      // pas — chaque requête acceptée restait un blocage.
      const passwordHash = await hashPassAsync(password)
      await updateDbAsync((db) => {
        if (db.users.some((u) => u.email === email)) {
          exists = true
          return db
        }
        user = {
          id: newId('u'),
          role: 'customer',
          email,
          passwordHash,
          name: regName || email.split('@')[0].trim(),
          phone: body.phone ? normalizePhone(body.phone) : '',
          avatar: 'chip',
          accent: 'green',
          provider: 'email',
          links: { google: null, meta: null },
          // LOT 1.9 : comme `PUT /api/me` (P10), la wilaya d'inscription doit
          // appartenir à la liste connue — avant, n'importe quelle chaîne
          // libre était stockée puis réinjectée dans les commandes du compte.
          wilaya: (() => {
            const w = String(body.wilaya || '').trim()
            return WILAYAS_NEAR.includes(w) ? w : 'Oran'
          })()
        }
        db.users.push(user)
        // `createSession` génère le jeton et n'en stocke que l'empreinte.
        token = createSession(db, user.id)
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
        // LOT 1.19 : un compte de démonstration **verrouillé** (aucun
        // `DEMO_PASSWORD` posé) répond un code dédié. Sans lui, l'exploitant
        // voit un 401 « identifiants incorrects » et cherche un mot de passe qui
        // n'existe nulle part — alors que l'état est voulu. Ces adresses sont
        // déjà publiées dans les guides : le code ne révèle rien de nouveau.
        if (user && user.demo === true && !user.passwordHash) {
          return send(res, 401, { ok: false, error: 'demo_locked' })
        }
        return send(res, 401, { ok: false, error: 'auth' })
      }
      const token = newToken()
      // LOT 1.6 : la migration de hash ci-dessous (P22 item 1) appelait
      // `hashPass` — donc `scryptSync` — DANS le mutateur : le verrou
      // d'écriture de la base était tenu ~35 ms de plus à chaque connexion
      // d'un compte seedé, et le thread principal était bloqué. Le hash est
      // calculé avant, et seulement quand la migration est réellement utile.
      const needsRehash = !String(user.passwordHash || '').startsWith('scrypt$')
      const migratedHash = needsRehash ? await hashPassAsync(password) : null
      await updateDbAsync((d) => {
        putSession(d, token, user.id)
        // P22 (item 1) — migration transparente du hash de mot de passe.
        //
        // Les comptes seedés (master + 3 démos) sont créés avec
        // `hashPassLegacy` : un sha256 non salé de `pcstar:<mot de passe>`.
        // `verifyPass` sait le lire, mais rien ne le remplaçait : un compte
        // seedé restait non salé indéfiniment, y compris après des mois
        // d'usage. Un dump de store.json (ou d'un backup — voir
        // server/data/backups/) exposait alors des hashes cassables par table
        // précalculée.
        //
        // On profite de l'instant où le mot de passe en clair est en main —
        // la connexion vient de réussir — pour le re-saler en scrypt. Aucun
        // changement visible pour l'utilisateur.
        const u = d.users.find((x) => x.id === user.id)
        if (u && migratedHash && !String(u.passwordHash || '').startsWith('scrypt$')) {
          u.passwordHash = migratedHash
        }
        return d
      })
      return send(res, 200, { ok: true, token, user: publicUser(user) })
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const token = bearer(req)
      if (token) {
        await updateDbAsync((db) => {
          deleteSession(db, token)
          return db
        })
      }
      return send(res, 200, { ok: true })
    }

    if (req.method === 'PUT' && pathname === '/api/me') {
      // LOT 1.6 : limité (lecture + écriture de base à chaque appel), avant
      // l'authentification pour la même raison que sur GET /api/me.
      const rl = rateLimit({ windowMs: 60_000, max: 30, key: clientKey(req, 'me-write') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
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
      // LOT 1.9 : borne identique à l'inscription et aux commandes.
      const meName = body.name == null ? null : String(body.name).trim()
      if (meName != null && meName.length > 64) return send(res, 400, { ok: false, error: 'name_too_long' })
      let user = null
      await updateDbAsync((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (!u) return db
        if (meName != null) u.name = meName || u.name
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

    // Customer own orders. Une session n'accède qu'aux lignes explicitement
    // rattachées à son userId : un numéro de téléphone n'est jamais une preuve.
    if (req.method === 'GET' && pathname === '/api/me/orders') {
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const db = await readDbAsync()
      return send(res, 200, { ok: true, orders: ordersForUser(db, auth.user.id) })
    }

    // Customer cancels one of HIS OWN new orders. L'autorisation ET l'état
    // annulable sont relus dans updateDbAsync : une lecture préalable seule
    // permettait un TOCTOU avec une suppression ou un changement de statut.
    if (req.method === 'POST' && pathname.startsWith('/api/me/orders/') && pathname.endsWith('/cancel')) {
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const code = decodeURIComponent(pathname.split('/').slice(-2, -1)[0])
      const uid = auth.user.id
      let result = null
      await updateDbAsync((db) => {
        // Revalidation métier dans la même mutation que le restock : le
        // callback ne peut jamais annuler une commande devenue preparing/ready.
        result = cancelOwnOrder(db, code, uid)
        return db
      })
      if (!result?.ok) {
        const status = result?.error === 'not_found' ? 404 : result?.error === 'status' ? 409 : 400
        return send(res, status, { ok: false, error: result?.error || 'not_found' })
      }
      return send(res, 200, { ok: true, order: result.order })
    }

    // Phase 3 — rattachement d'une commande guest via le code à usage unique
    // remis au comptoir. Le téléphone ne fait jamais partie de la preuve.
    if (req.method === 'POST' && pathname === '/api/me/orders/claim') {
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const rl = rateLimit({ windowMs: 600_000, max: 10, key: clientKey(req, 'claim') })
      if (!rl.ok) return send(res, 429, { ok: false, error: 'rate_limited' })
      const body = await readBody(req)
      let result = null
      await updateDbAsync((db) => {
        result = claimGuestOrder(db, body?.code, auth.user.id)
        return db
      })
      if (!result?.ok) {
        const status = result?.error === 'taken' ? 409 : result?.error === 'status' ? 409 : 404
        return send(res, status, { ok: false, error: result?.error || 'not_found' })
      }
      return send(res, 200, { ok: true, order: result.order })
    }

    // Le comptoir émet un code de retrait pour une commande guest : preuve
    // remise en main propre, unique, et jamais renvoyée par cette route.
    if (req.method === 'POST' && pathname.startsWith('/api/orders/') && pathname.endsWith('/claim-code')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const rl = rateLimit({ windowMs: 60_000, max: 30, key: clientKey(req, 'claim-code') })
      if (!rl.ok) return send(res, 429, { ok: false, error: 'rate_limited' })
      const code = decodeURIComponent(pathname.split('/').slice(-2, -1)[0])
      let result = null
      await updateDbAsync((db) => {
        result = issueClaimCode(db, code)
        return db
      })
      if (!result?.ok) {
        const status = result?.error === 'not_found' ? 404 : result?.error === 'status' ? 409 : 400
        return send(res, status, { ok: false, error: result?.error || 'not_found' })
      }
      return send(res, 200, { ok: true, claimCode: result.claimCode })
    }

    // Password change (authenticated)
    if (req.method === 'POST' && pathname === '/api/me/password') {
      // LOT 1.6 : limité — chaque appel coûte un scrypt et une écriture.
      const rl = rateLimit({ windowMs: 600_000, max: 5, key: clientKey(req, 'password') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const auth = await userFromReq(req)
      if (!auth) return send(res, 401, { ok: false, error: 'auth' })
      const body = await readBody(req)
      const next = String(body.password || '')
      if (next.length < 6) return send(res, 400, { ok: false, error: 'password' })
      // P16 (#13) : le mot de passe ACTUEL est exigé. Avant, un token de
      // session seul suffisait : un token volé (XSS, URL partagée, ou
      // `_lastAuth` recopié dans un backup de store.json) permettait de
      // verrouiller le compte. Le master garde sa voie dédiée (reset-password).
      //
      // LOT 1.4 : le client n'envoyait JAMAIS ce champ (`api.changePassword`
      // ne transmettait que `{ password }`, et `ProfilePage` n'avait aucun
      // champ « mot de passe actuel ») → 403 systématique, fonctionnalité
      // morte pour 100 % des utilisateurs. Le serveur, lui, était correct :
      // c'est le client qui a été aligné.
      if (!verifyPass(String(body.current || ''), auth.user.passwordHash)) {
        return send(res, 403, { ok: false, error: 'current_password' })
      }
      // LOT 1.6 : hash asynchrone, hors du mutateur (voir /api/auth/register).
      const nextHash = await hashPassAsync(next)
      // LOT 1.5 : les sessions existantes sont INVALIDÉES. Reproduit à
      // l'audit : après un changement de mot de passe réussi, l'ANCIEN token
      // renvoyait encore 200 sur /api/me. Un attaquant en possession d'un token
      // volé conservait donc l'accès après que la victime avait changé son mot
      // de passe — ce qui vidait de son sens la réaction à une compromission.
      // `purgeUser` le faisait déjà pour les suppressions de compte ; le
      // changement de mot de passe, non.
      // `userFromReq` renvoie déjà le token de la session en cours : on le
      // conserve, tout le reste est révoqué.
      const currentToken = auth.token
      // Les clés sont des empreintes : la comparaison porte sur l'empreinte du
      // jeton courant, jamais sur le jeton lui-même.
      const currentKey = hashToken(currentToken || '')
      // LOT 1.19 : un compte de démonstration dont le titulaire choisit son
      // propre mot de passe cesse d'être une fixture — le mutateur ci-dessous
      // retire le marqueur `demo`. Sans ce retrait, `normalizeDb` réalignait
      // l'empreinte sur `DEMO_PASSWORD` à la lecture suivante : la réponse
      // annonçait 200 et le nouveau mot de passe cessait de fonctionner
      // (régression mesurée par P16 #13). Effet de bord assumé et souhaitable :
      // la garde S2 (`server/oauth.js`) refuse dès lors qu'un fournisseur non
      // vérifié s'approprie ce compte par simple coïncidence d'e-mail.
      let revoked = 0
      await updateDbAsync((db) => {
        const u = db.users.find((x) => x.id === auth.user.id)
        if (u) {
          u.passwordHash = nextHash
          if (u.demo === true) u.demo = false
        }
        for (const [key, sess] of Object.entries(db.sessions || {})) {
          if (sess && sess.userId === auth.user.id && key !== currentKey) {
            delete db.sessions[key]
            revoked += 1
          }
        }
        return db
      })
      // La session COURANTE est conservée : l'utilisateur vient de saisir son
      // mot de passe, le déconnecter dans la foulée serait inutilement punitif.
      return send(res, 200, { ok: true, revoked })
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
      // LOT 1.6 : hash asynchrone, hors du mutateur.
      const nextHash = await hashPassAsync(next)
      // LOT 1.19 : même règle que /api/me/password — un mot de passe posé
      // explicitement (par le titulaire ou par le maître) n'est plus la valeur
      // d'environnement des fixtures, donc l'alignement de `normalizeDb` ne doit
      // plus s'y appliquer. Sans le retrait du marqueur `demo` dans le mutateur,
      // le reset annoncé 200 était annulé à la lecture suivante (P16 #14).
      let ok = false
      let revoked = 0
      await updateDbAsync((db) => {
        const u = db.users.find((x) => x.id === id && x.role !== 'master')
        if (u) {
          u.passwordHash = nextHash
          if (u.demo === true) u.demo = false
          ok = true
          // LOT 1.5 : même raison que /api/me/password — un reset maître sert
          // typiquement à reprendre la main sur un compte compromis ; laisser
          // les sessions ouvertes annulerait l'opération.
          for (const [key, sess] of Object.entries(db.sessions || {})) {
            if (sess && sess.userId === id) {
              delete db.sessions[key]
              revoked += 1
            }
          }
        }
        return db
      })
      return send(res, ok ? 200 : 404, { ok, revoked })
    }

    // OAuth start
    if (req.method === 'POST' && pathname === '/api/oauth/start') {
      // LOT 1.15 : la route était publique et sans limite. Reproduit à
      // l'audit : 12 appels d'affilée → 12 entrées `oauthPending` en base
      // (purgées à 15 min, mais remplissables en continu).
      const rl = rateLimit({ windowMs: 60_000, max: 10, key: clientKey(req, 'oauth-start') })
      if (!rl.ok)
        return send(res, 429, { ok: false, error: 'rate', retryAfter: rl.retryAfter }, {
          'Retry-After': String(Math.max(1, rl.retryAfter || 1))
        })
      const body = await readBody(req)
      const auth = await userFromReq(req)
      // LOT 1.15 : `intent: 'link'` SANS session était accepté et stocké avec
      // `userId: null`. `finishIdentity` exige `intent === 'link' && userId`,
      // donc le flux retombait silencieusement sur la branche login : le
      // paramètre du client était ignoré sans erreur. On refuse maintenant
      // explicitement plutôt que de mentir sur l'opération demandée.
      if (body.intent === 'link' && !auth) {
        return send(res, 400, { ok: false, error: 'auth_required' })
      }
      const resStart = await startOAuth(body.provider, {
        userId: body.intent === 'link' ? auth?.user?.id : null,
        intent: body.intent === 'link' ? 'link' : 'login',
        returnUrl: body.returnUrl || null
      })
      if (!resStart.ok) return send(res, 400, resStart)
      return send(res, 200, resStart)
    }

    // OAuth réel : seul le fournisseur appelle ce callback avec le code. Le
    // code reste côté serveur et `completeOAuthCallback` vérifie/consomme le
    // state sous verrou avant toute session.
    if (req.method === 'GET' && /^\/api\/oauth\/(google|meta)\/callback$/.test(pathname)) {
      const provider = pathname.includes('google') ? 'google' : 'meta'
      const done = await completeOAuthCallback(provider, {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error')
      })
      if (!done.ok) return sendOAuthFailure(res, done.error)
      return redirectOAuthSuccess(res, done, provider)
    }

    // OAuth demo consent page. AUDIT-2026-09-17 / phase 1 (P0) : les deux
    // méthodes doivent disparaître entièrement hors démo. Une simple absence
    // de lien dans le client ne protégeait pas la route : un attaquant pouvait
    // démarrer un state public puis POSTer directement l'e-mail d'un client.
    if ((req.method === 'GET' || req.method === 'POST') && /^\/api\/oauth\/(google|meta)\/demo$/.test(pathname)) {
      if (!oauthDemo()) return send(res, 404, { ok: false, error: 'not_found' })

      const provider = pathname.includes('google') ? 'google' : 'meta'
      if (req.method === 'GET') {
        const state = url.searchParams.get('state')
        return send(res, 200, demoConsentHtml(provider, state))
      }

      const body = await readBody(req)
      const done = await completeDemo(provider, body.state, { name: body.name, email: body.email })
      if (!done.ok) return sendOAuthFailure(res, done.error)
      return redirectOAuthSuccess(res, done, provider)
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
      const suppliedName = String(url.searchParams.get('name') || '')
      const name = safeUploadName(suppliedName)
      // Ne jamais normaliser silencieusement une tentative de traversée en un
      // nom de fichier valide (`../../x` → `x`) : le chemin doit être exactement
      // celui qui a été émis par l'upload.
      if (!name || name !== suppliedName) return send(res, 400, { ok: false, error: 'name' })
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
        // LOT 6.8 (Q8) : la redirection Blob porte les mêmes en-têtes CORS que
        // la photo servie en local juste au-dessus (sinon un front cross-origin
        // qui suit la réponse en `fetch()` voyait deux comportements).
        return (
          res.writeHead(302, { Location: blobUrl, 'Cache-Control': 'public, max-age=3600', ...corsHeaders() }),
          res.end()
        )
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
      const { db, ok, driver, error, asOf, source } = await readDbSafe()
      const products = publicCatalog(db)
      return send(res, 200, {
        ok: true,
        products,
        count: products.length,
        degraded: !ok,
        // LOT 3.16 (B19) : le repli est DATÉ. `asOf` = horodatage de la
        // dernière lecture réussie (`source: 'cache'`), `null` quand aucune
        // lecture n'a jamais abouti (`source: 'static'` = catalogue du build).
        // Le front affiche l'âge au lieu de laisser deviner.
        db: { driver, reachable: ok, error, asOf: asOf ?? null, source: source || (ok ? 'db' : 'static') }
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
      // LOT 4.5 (U11) : plus de remapping `pending → new` à l'affichage.
      // `readDb` migre les lignes legacy (normalizeDb), donc le statut servi est
      // le statut RÉEL — le même que celui sur lequel travaillent `PATCH`
      // (transitions) et `DELETE`. Avant, le comptoir voyait `new` pendant que
      // la base disait `pending` : une commande pouvait être refusée en
      // transition sans raison visible, et le filtre « nouvelles » du Desk
      // mentait sur son contenu.
      const orders = (db.orders || []).map((o) => ({ ...o, status: o.status || 'new' }))
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
      // LOT 1.9 : validation serveur des champs de commande.
      //
      // Reproduit à l'audit : `POST /api/orders` avec `wilaya:"XXXX"` et
      // `slot:"<script>"` → **201**, valeurs stockées telles quelles (CSV, Desk,
      // WhatsApp, page « Mes commandes »). Le nom, lui, n'avait AUCUNE borne
      // de longueur.
      //
      // Corrections :
      // · `name` : non vide après trim, ≤ 64 caractères (le `<input maxlength>`
      //   client n'est qu'indicatif — `fetch` direct l'ignore).
      // · `wilaya` : doit appartenir à `WILAYAS_NEAR` (même liste que le select
      //   du panier/profil et que `PUT /api/me`, déjà borné depuis P10).
      //   Absente/vide → « Oran », le défaut historique.
      // · `slot` : doit appartenir à `SLOTS`, ou être vide (retrait sans
      //   créneau — le comptoir et le message WhatsApp gèrent déjà ce cas).
      //
      // Non corrigé volontairement : `carrier`. Le rapport le listait comme
      // libre, mais la route le **recalcule** déjà côté serveur
      // (`phoneCarrier(body.phone)`) et ignore la valeur envoyée — le champ
      // client n'a jamais atteint la base.
      const orderName = String(body.name || '').trim()
      if (!orderName || orderName.length > 64) return send(res, 400, { ok: false, error: 'name' })
      const rawOrderWilaya = body.wilaya == null ? '' : String(body.wilaya).trim()
      const orderWilaya = rawOrderWilaya ? (WILAYAS_NEAR.includes(rawOrderWilaya) ? rawOrderWilaya : null) : 'Oran'
      if (orderWilaya == null) return send(res, 400, { ok: false, error: 'wilaya' })
      const rawSlot = body.slot == null ? '' : String(body.slot).trim()
      if (rawSlot && !SLOTS.includes(rawSlot)) return send(res, 400, { ok: false, error: 'slot' })
      const auth = await userFromReq(req)
      const orderPhone = normalizePhone(body.phone)
      let result = null
      await updateDbAsync((db) => {
        // Le téléphone reste l'information de retrait du comptoir, pas une
        // preuve d'identité web. Seule une session présente au checkout attache
        // la ligne à un compte; une commande guest n'est pas récupérable par
        // simple ajout de ce numéro dans un profil ultérieur.
        const requesterId = auth?.user?.id || null
        result = placeOrder(
          db,
          {
            name: orderName,
            phone: orderPhone,
            carrier: phoneCarrier(orderPhone),
            wilaya: orderWilaya,
            // P9 (P7-4) : « journée » locale du client (validée dans placeOrder)
            day: body.day || '',
            // Date de retrait choisie au checkout (validée dans placeOrder)
            pickupDate: body.pickupDate,
            payment: 'cash',
            slot: rawSlot,
            // Clé opaque créée par le navigateur avant l'envoi; sa validation et
            // son empreinte sont faites dans placeOrder sous le verrou DB.
            idempotencyKey: body.idempotencyKey,
            items: body.items,
            total: body.total
          },
          { userId: requesterId }
        )
        return db
      })
      if (!result?.ok) {
        if (result?.error === 'stock') return send(res, 409, { ok: false, error: 'stock', shortages: result.shortages })
        // LOT 8.1 (A1) : produit retiré de la vente par le maître. Conflit avec
        // l'état actuel du catalogue (409, comme la rupture) et les lignes en
        // cause sont nommées — le client les retire du panier au lieu de
        // renvoyer la même commande en boucle.
        if (result?.error === 'unavailable')
          return send(res, 409, { ok: false, error: 'unavailable', unavailable: result.unavailable })
        // LOT 8.2 (A2) : id inconnu du serveur (ni catalogue, ni produit maître,
        // ni override). Requête invalide → 400. Avant ce correctif la ligne
        // était tarifée 0 DA et la commande acceptée en 201.
        if (result?.error === 'unknown_product')
          return send(res, 400, { ok: false, error: 'unknown_product', unknown: result.unknown })
        if (result?.error === 'idempotency_conflict') return send(res, 409, { ok: false, error: 'idempotency_conflict' })
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

    // PATCH /api/orders/:code  { status?, pickupDate? } — au moins un des deux.
    if (req.method === 'PATCH' && pathname.startsWith('/api/orders/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const code = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      const status = String(body.status || '')
      const hasPickup = body.pickupDate != null
      if (!status && !hasPickup) return send(res, 400, { ok: false, error: 'status' })
      let result = null
      await updateDbAsync((db) => {
        result = null
        if (status) {
          result = setOrderStatus(db, code, status)
          // Statut + date en un seul aller-retour (le « prêt » annonce la date).
          if (result?.ok && hasPickup) {
            const pd = setOrderPickupDate(db, code, String(body.pickupDate))
            if (!pd.ok) result = pd
          }
        } else {
          result = setOrderPickupDate(db, code, String(body.pickupDate))
        }
        return db
      })
      if (!result?.ok) {
        const codeHttp = result?.error === 'not_found' ? 404 : 400
        return send(res, codeHttp, { ok: false, error: result?.error || 'status' })
      }
      // Le comptoir d'un autre écran met à jour sa carte sans attendre le poll.
      broadcastDesk({ type: 'order:updated', order: result.order })
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
      const photoSave = hasDataUrls ? await savePhotoDataUrlsSafe(newProductId, body.photoDataUrls) : { paths: [] }
      if (photoSave.error) return send(res, photoSave.status, { ok: false, error: photoSave.error })
      const saved = photoSave.paths
      // Une galerie qui contient des data URLs mais dont aucune n'est une image
      // valide ne doit pas produire un 201 silencieux sans photo.
      if (hasDataUrls && !saved.length) return send(res, 400, { ok: false, error: 'photos' })
      try {
        await updateDbAsync((db) => {
          // Les chemins reçus sont la galerie voulue; les nouveaux uploads y
          // sont ajoutés sans jamais dépasser la capacité. Les uploads écartés
          // par la borne seront supprimés après la création réussie.
          if (saved.length) body.photos = mergeProductPhotos([], Array.isArray(body.photos) ? body.photos : [], saved)
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
      await cleanupProductUploads([], result.product?.photos, saved)
      return send(res, 201, { ok: true, product: result.product })
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/master/products/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = decodeURIComponent(pathname.split('/').pop())
      const body = await readBody(req)
      const hasDataUrls = Array.isArray(body.photoDataUrls) && body.photoDataUrls.length > 0
      const putSave = hasDataUrls ? await savePhotoDataUrlsSafe(id, body.photoDataUrls) : { paths: [] }
      if (putSave.error) return send(res, putSave.status, { ok: false, error: putSave.error })
      const newPaths = putSave.paths
      if (hasDataUrls && !newPaths.length) return send(res, 400, { ok: false, error: 'photos' })
      const photoPatch = newPaths.length > 0 || Array.isArray(body.photos)
      const suppliedPaths = Array.isArray(body.photos) ? body.photos : null
      let previousPhotos = []
      let result = null
      try {
        await updateDbAsync((db) => {
          if (photoPatch) {
            previousPhotos = currentProductPhotos(db, id) || []
            // `photos` représente toujours la galerie finale. Si un ancien
            // client n'envoie que photoDataUrls, conserver l'existant plutôt
            // que le remplacer accidentellement; une liste vide explicite
            // permet en revanche de repartir de zéro.
            body.photos = mergeProductPhotos(previousPhotos, suppliedPaths, newPaths)
          }
          result = updateProduct(db, id, body)
          return db
        })
      } catch {
        // compensation : rollback des photos uploadées si la persistance a échoué
        if (newPaths.length) for (const p of newPaths) await unlinkUpload(p)
        return send(res, 500, { ok: false, error: 'server' })
      }
      if (!result?.ok) return send(res, result?.error === 'not_found' ? 404 : 400, { ok: false, error: result?.error })
      if (photoPatch) await cleanupProductUploads(previousPhotos, result.product?.photos, newPaths)
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

    // DELETE /api/master/products/:id — suppression DÉFINITIVE d'un produit
    // créé par le maître (les produits de base se masquent, ils ne se
    // suppriment pas). Les photos gérées sont nettoyées APRÈS le commit.
    if (req.method === 'DELETE' && pathname.startsWith('/api/master/products/')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const id = decodeURIComponent(pathname.split('/').pop())
      let result = null
      await updateDbAsync((db) => {
        result = deleteProductMaster(db, id)
        return db
      })
      if (!result?.ok) {
        const st = result?.error === 'not_found' ? 404 : result?.error === 'base' ? 409 : 400
        return send(res, st, { ok: false, error: result?.error })
      }
      // Phase 4 : ne jamais supprimer un chemin qui n'est pas un upload géré.
      for (const p of result.photos || []) {
        try {
          await unlinkUpload(p)
        } catch {
          /* best effort : l'objet orphelin éventuel sera repris au cleanup */
        }
      }
      broadcastDesk({ type: 'catalog:changed' })
      return send(res, 200, { ok: true, id: result.id })
    }

    if (req.method === 'POST' && pathname.startsWith('/api/master/products/') && pathname.endsWith('/photos')) {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      const parts = pathname.split('/')
      const id = decodeURIComponent(parts[parts.length - 2])
      const body = await readBody(req)
      // Compatibilité : l'ancienne API acceptait les data URLs dans `photos`;
      // la liste de chemins (hors data:) est désormais la galerie à conserver.
      const uploadSource = Array.isArray(body.photoDataUrls)
        ? body.photoDataUrls
        : Array.isArray(body.photos)
          ? body.photos.filter((photo) => String(photo).startsWith('data:'))
          : []
      const photoOnly = await savePhotoDataUrlsSafe(id, uploadSource)
      if (photoOnly.error) return send(res, photoOnly.status, { ok: false, error: photoOnly.error })
      const paths = photoOnly.paths
      const hasDesiredPaths = Array.isArray(body.photos)
      if (uploadSource.length && !paths.length) return send(res, 400, { ok: false, error: 'photos' })
      if (!paths.length && !hasDesiredPaths) return send(res, 400, { ok: false, error: 'photos' })
      let previousPhotos = []
      let result = null
      try {
        await updateDbAsync((db) => {
          previousPhotos = currentProductPhotos(db, id) || []
          const retainedPaths = hasDesiredPaths
            ? body.photos.filter((photo) => !String(photo).startsWith('data:'))
            : null
          const photos = mergeProductPhotos(previousPhotos, retainedPaths, paths)
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
        return send(res, result?.error === 'not_found' ? 404 : 400, { ok: false, error: result?.error })
      }
      await cleanupProductUploads(previousPhotos, result.product?.photos, paths)
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
        // LOT 6.8 (Q8) : `...corsHeaders()` et non `'Access-Control-Allow-Origin':
        // FRONT_ORIGIN` à la main — sans origine déclarée, FRONT_ORIGIN vaut ''
        // et le serveur émettait un en-tête VIDE (invalide, et parfois interprété
        // comme une origine nulle). C'était la troisième écriture de CORS du
        // fichier ; il n'en reste qu'une.
        ...corsHeaders()
      })
      // P10 (P7-12) : BOM UTF-8 — sans lui, Excel (Windows) lit en ANSI et
      // les accents FR/AR deviennent illisibles sur le comptoir.
      return res.end('\uFEFF' + csv)
    }

    // Manual backup
    if (req.method === 'POST' && pathname === '/api/master/backup') {
      const auth = await userFromReq(req)
      if (!auth || auth.user.role !== 'master') return send(res, 403, { ok: false, error: 'forbidden' })
      try {
        const backup = await backupCurrentState('master-manual')
        // Le snapshot ne quitte jamais le serveur : l'identifiant est seulement
        // une référence opérateur, sans données clients ni chaîne DATABASE_URL.
        return send(res, 200, { ok: true, backup })
      } catch (error) {
        console.error('[pcstar-backup] sauvegarde manuelle échouée :', String((error && error.message) || error))
        return send(res, 503, { ok: false, error: 'backup_failed' })
      }
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
      // LOT 4.3 (F16) : `purgeUser` annule désormais les commandes en cours du
      // compte (le stock réservé est rendu) et renvoie le détail. La réponse le
      // transmet : le master voit ce que la suppression a entraîné au lieu d'un
      // `{ok:true}` muet laissant des pièces réservées pour personne.
      let purged = { ok: false }
      await updateDbAsync((db) => {
        purged = purgeUser(db, id)
        return db
      })
      if (!purged.ok) return send(res, 400, { ok: false })
      return send(res, 200, {
        ok: true,
        cancelled: purged.cancelled || [],
        releasedLines: purged.releasedLines || 0,
        left: purged.left || []
      })
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
      // LOT 3.12 (B17) : on a refusé le corps AVANT de l'avoir lu jusqu'au bout.
      // Répondre sur une connexion keep-alive pendant que le client envoie
      // encore ses octets, c'est prendre deux risques : la réponse n'est pas lue
      // (le client attend de pouvoir écrire) et la requête SUIVANTE, sur le même
      // socket, commence au milieu d'un corps abandonné → délimitation cassée.
      // On répond donc avec `Connection: close` et on ferme le socket dès que la
      // réponse est partie : le client renverra une requête propre.
      res.once('finish', () => {
        try {
          req.socket?.destroySoon?.()
        } catch {
          /* déjà fermé */
        }
      })
      // LOT 8.4 (A4) : la borne appliquée est dite dans la réponse — un client
      // (ou un curl de diagnostic) sait alors quelle taille viser, au lieu de
      // deviner entre les 4,5 Mo de Vercel et les 15 Mo d'un serveur local.
      return send(res, 413, bodyTooLargePayload(), { Connection: 'close' })
    }
    console.error(err)
    return send(res, 500, { ok: false, error: 'server', message: String(err.message || err) })
  }
}

function startLocalServer() {
  // LOT 3.2 (B2) : la normalisation de la base (seed des démos, synchronisation
  // du maître sur l'environnement, purge des sessions expirées, clés internes)
  // est persistée UNE fois au démarrage. Avant, `readDb()` écrivait pendant la
  // lecture : n'importe quel GET pouvait provoquer une écriture disque.
  try {
    if (!process.env.DATABASE_URL) initDb()
  } catch (err) {
    console.error('[pcstar-db] initialisation au démarrage échouée — les lectures réessaieront.', {
      message: String((err && err.message) || err)
    })
  }
  const server = http.createServer(handler)
  // P19 : socket Desk — connexion acceptée uniquement pour un token de session
  // master. Non branché sous Vercel (les WebSockets n'y existent pas en
  // serverless) : le front retombe alors sur le polling.
  attachDeskSocket(server, async (token) => {
    try {
      const db = await readDbAsync()
      const sess = findSession(db, token)
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
      // LOT 8.6 (A6) : une entrée de WHATSAPP_RECIPIENT non normalisable est
      // écartée — donc une alerte de commande qui ne partira jamais. Le dire AU
      // DÉMARRAGE (et pas seulement dans le log de la première commande) :
      // c'est une faute de configuration, pas un incident d'envoi.
      if (wa.invalidRecipients.length) {
        console.warn(
          `[pcstar-notify] WHATSAPP_RECIPIENT : ${wa.invalidRecipients.length} entrée(s) écartée(s), ` +
            `numéro non normalisable → ${wa.invalidRecipients.map((r) => r.raw).join(', ')}. ` +
            'Format attendu : international sans « + » (213770650387) ; le format local (0770650387) est accepté et converti.'
        )
      }
      if (wa.enabled && !wa.recipients.length) {
        console.error(
          '[pcstar-notify] WhatsApp CONFIGURÉ mais AUCUN destinataire valide : les alertes de commande ne partiront pas. ' +
            'Renseignez WHATSAPP_RECIPIENT au format international (213XXXXXXXXX).'
        )
      }
    }
    console.log('OAuth:', oauthConfig())
    // Même driver que les écritures métier : avec Neon, un backup est un
    // snapshot JSONB durable et non une copie inutile de /tmp/store.json.
    const scheduledBackup = async () => {
      try {
        const backup = await backupCurrentState('scheduled')
        console.log('Backup:', backup.driver === 'neon' ? backup.id : backup.file)
      } catch (error) {
        console.warn('Backup skipped', String((error && error.message) || error))
      }
    }
    void scheduledBackup()
    setInterval(() => {
      void scheduledBackup()
    }, 6 * 60 * 60 * 1000).unref?.()
  })
  return server
}

/**
 * LOT 1.1 — démarrage local : échec EXPLICITE si le compte maître n'est pas
 * configuré. En pratique `server/db.js` lève déjà au chargement du module (donc
 * avant d'arriver ici) ; ce garde couvre le cas où l'import est différé et
 * garantit un code de sortie non nul avec le message plutôt qu'une pile brute.
 * Sous Vercel le module est importé par invocation : la même erreur remonte
 * dans les logs de fonction, ce qui est préférable à un repli sur un secret
 * codé en dur.
 */
function assertMasterConfigured() {
  try {
    masterAccount()
  } catch (err) {
    console.error(`\n${err.message}\n`)
    process.exit(1)
  }
}

// Local / long-running only — Vercel imports { handler } without listen
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain && !process.env.VERCEL) {
  assertMasterConfigured()
  startLocalServer()
}

export default handler
export { startLocalServer }
