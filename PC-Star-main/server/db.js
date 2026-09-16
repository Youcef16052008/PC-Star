import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** On Vercel serverless the bundle FS is read-only — persist under /tmp (ephemeral per instance). */
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
const DATA_DIR = process.env.PCSTAR_DATA_DIR
  ? path.resolve(process.env.PCSTAR_DATA_DIR)
  : IS_SERVERLESS
    ? path.join('/tmp', 'pcstar-data')
    : path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'store.json')
const DB_TMP_FILE = path.join(DATA_DIR, 'store.json.tmp')
const MAX_CORRUPT_BACKUPS = 3

const MASTER = {
  id: 'master-pcstar',
  role: 'master',
  email: 'pcstar.info31@gmail.com',
  passwordHash: hashPassLegacy('Czyx8f9g2jK3mWZ5R2Tn'),
  name: 'PC Star Desk',
  phone: '0770650387',
  avatar: 'star',
  accent: 'green',
  provider: 'email',
  links: { google: null, meta: null }
}

function hashPass(password) {
  const salt = crypto.randomBytes(8).toString('hex')
  const hash = crypto.scryptSync(String(password), `pcstar:${salt}`, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function hashPassLegacy(password) {
  return crypto.createHash('sha256').update(`pcstar:${password}`).digest('hex')
}

export function verifyPass(password, stored) {
  if (!stored) return false
  const s = String(stored)
  if (s.startsWith('scrypt$')) {
    const parts = s.split('$')
    const salt = parts[1]
    const hash = parts[2]
    const check = crypto.scryptSync(String(password), `pcstar:${salt}`, 32)
    const expect = Buffer.from(hash, 'hex')
    if (check.length !== expect.length) return false
    return crypto.timingSafeEqual(check, expect)
  }
  if (s.startsWith('sha256$pcstar:')) {
    const expected = `sha256$pcstar:${String(password)}`
    const actual = Buffer.from(s)
    const expectedBuffer = Buffer.from(expected)
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer)
  }
  return s === hashPassLegacy(password)
}

const CUSTOMERS = [
  {
    id: 'customer-karim',
    role: 'customer',
    email: 'karim.oran@demo.dz',
    passwordHash: hashPassLegacy('Qw3nt9zKp7mL2jX8vNb'),
    name: 'Karim B.',
    phone: '0550123456',
    avatar: 'chip',
    accent: 'blue',
    provider: 'email',
    wilaya: 'Oran',
    links: { google: null, meta: null }
  },
  {
    id: 'customer-amina',
    role: 'customer',
    email: 'amina.castors@demo.dz',
    passwordHash: hashPassLegacy('Yx4nBst8mP3kL7jR2vWz'),
    name: 'Amina K.',
    phone: '0669174617',
    avatar: 'card',
    accent: 'gold',
    provider: 'email',
    wilaya: 'Oran',
    links: { google: null, meta: null }
  },
  {
    id: 'customer-yacine',
    role: 'customer',
    email: 'yacine.pc@demo.dz',
    passwordHash: hashPassLegacy('Wz6kLm9pN3tQ8jX2cYvB'),
    name: 'Yacine M.',
    phone: '0770650388',
    avatar: 'pad',
    accent: 'red',
    provider: 'email',
    wilaya: 'Mostaganem',
    links: { google: null, meta: null }
  }
]

export function emptyDb() {
  return {
    users: [MASTER, ...CUSTOMERS],
    orders: [],
    stock: {},
    meta: {
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: []
    },
    sessions: {},
    oauthPending: {}
  }
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2))
  }
}

export function readDb() {
  ensure()
  let db
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8')
    db = JSON.parse(raw)
  } catch (err) {
    // Base corrompue (écriture tronquée, disque plein…) : on ne l'écrase PAS
    // silencieusement. On la quarantaine pour diagnostic, on log, et on
    // repart propre.
    const backup = quarantineDb()
    console.error('[pcstar-db] store.json illisible — base réinitialisée.', {
      reason: String(err && err.message ? err.message : err),
      backup: backup || null
    })
    db = emptyDb()
    writeDb(db)
    return db
  }
  if (!Array.isArray(db.users)) db.users = [MASTER, ...DEMOS]
  if (!db.users.some((u) => u.role === 'master')) db.users.unshift(MASTER)
  if (!Array.isArray(db.orders)) db.orders = []
  if (!db.stock || typeof db.stock !== 'object') db.stock = {}
  if (!db.meta) db.meta = emptyDb().meta
  // P16 (#8) : les démos sont injectées UNE fois, au premier démarrage, puis
  // marquées. Avant, ce `forEach` tournait à chaque lecture : un
  // `DELETE /api/customers/demo-karim` renvoyait 200 et le compte revenait à la
  // requête suivante (le client croyait la suppression faite). Le master, lui,
  // reste réinjecté : sans lui, plus personne ne peut se connecter au comptoir.
  let seeded = false
  if (db.meta.demoSeeded !== true) {
    DEMOS.forEach((d) => {
      if (!db.users.some((u) => u.id === d.id || u.email === d.email)) db.users.push({ ...d })
    })
    db.meta.demoSeeded = true
    seeded = true
  }
  if (!db.sessions) db.sessions = {}
  if (!db.oauthPending) db.oauthPending = {}
  // P13 (S3) : clés internes de transit — elles n'ont rien à faire dans la
  // base persistante. `_lastAuth` contenait un TOKEN DE SESSION valide,
  // recopié tel quel dans chaque backup de store.json. `_err` empoisonnait
  // les inscriptions suivantes. Les deux sont retirées à chaque lecture (et
  // la base est réécrite pour purger les copies déjà présentes sur disque).
  const stripped = stripInternalKeys(db)
  // P5 (B11) : bornes de croissance — sessions > 7 j, consentements OAuth
  // abandonnés > 15 min. Écriture si quelque chose a été purgé… ou si le
  // marqueur de seed (#8) vient d'être posé.
  if (purgeExpired(db) || stripped || seeded) writeDb(db)
  return db
}

/**
 * P13 (S3) : retire les clés de transit posées sur l'objet base par les
 * handlers. @returns {boolean} true si une clé a été retirée.
 */
export function stripInternalKeys(db) {
  let changed = false
  for (const key of ['_lastAuth', '_err']) {
    if (db && Object.prototype.hasOwnProperty.call(db, key)) {
      delete db[key]
      changed = true
    }
  }
  return changed
}

/**
 * P5 (B11) : purge les sessions expirées (> 7 jours) et les entrées
 * `oauthPending` orphelines (consentement abandonné, > 15 min).
 * @returns {boolean} true si quelque chose a été supprimé
 */
export function purgeExpired(db) {
  const now = Date.now()
  let changed = false
  for (const [tok, s] of Object.entries(db.sessions || {})) {
    if (!s || typeof s.at !== 'number' || now - s.at > SESSION_TTL_MS) {
      delete db.sessions[tok]
      changed = true
    }
  }
  for (const [st, p] of Object.entries(db.oauthPending || {})) {
    if (!p || typeof p.createdAt !== 'number' || now - p.createdAt > PENDING_TTL_MS) {
      delete db.oauthPending[st]
      changed = true
    }
  }
  return changed
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_TTL_MS = 15 * 60 * 1000

/** Déplace un store.json illisible sous .corrupt-<stamp> (garde les MAX derniers). */
function quarantineDb() {
  if (!fs.existsSync(DB_FILE)) return null
  // Horodatage + aléatoire : deux corruptions la même milliseconde ne doivent
  // pas s'écraser l'une l'autre.
  const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const dest = `${DB_FILE}.corrupt-${stamp}`
  try {
    fs.copyFileSync(DB_FILE, dest)
    const stale = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('store.json.corrupt-'))
      .sort()
    while (stale.length > MAX_CORRUPT_BACKUPS) fs.unlinkSync(path.join(DATA_DIR, stale.shift()))
    return dest
  } catch {
    return null
  }
}

export async function readDbAsync() {
  if (!process.env.DATABASE_URL) return readDb()
  const { readNeonState } = await import('./neonStore.js')
  return readNeonState(emptyDb)
}

/**
 * P12 (B25) : lecture d'état qui n'échoue JAMAIS.
 *
 * Une base distante injoignable (compute Neon suspendu, branche d'aperçu
 * supprimée, `DATABASE_URL` copié sur l'endpoint direct au lieu du `-pooler`,
 * IP allowlist…) faisait remonter une exception jusqu'au handler → 500 sur
 * `/api/catalog` → le front lisait « catalogue vide = vérité » → **boutique
 * sans aucun produit**. Les lectures publiques replient donc sur l'état de
 * base (catalogue statique, aucun override) et signalent `ok: false` pour que
 * l'UI le dise au lieu de le cacher.
 *
 * Les ÉCRITURES restent strictes (`updateDbAsync`) : on ne doit jamais faire
 * croire qu'une commande ou un stock a été enregistré alors que la base était
 * injoignable.
 *
 * @returns {Promise<{db: object, ok: boolean, driver: 'neon'|'file', error: string|null}>}
 */
export async function readDbSafe() {
  const driver = process.env.DATABASE_URL ? 'neon' : 'file'
  try {
    if (driver === 'neon') {
      const { readNeonState } = await import('./neonStore.js')
      return { db: await readNeonState(emptyDb), ok: true, driver, error: null }
    }
    return { db: readDb(), ok: true, driver, error: null }
  } catch (error) {
    const message = String((error && error.message) || error)
    console.error('[pcstar-db] lecture d\'état échouée — repli sur le catalogue de base.', {
      driver,
      message,
      hint: driver === 'neon' ? 'Vérifier DATABASE_URL (endpoint -pooler, branche existante, compute non suspendu).' : null
    })
    return { db: emptyDb(), ok: false, driver, error: message }
  }
}

/**
 * P12 (B25) : diagnostics lisibles de `DATABASE_URL` — SANS le mot de passe.
 * Sert à `/api/db/status` et à `npm run db:doctor` pour distinguer
 * « base injoignable » de « base vide ».
 */
export function dbUrlDiagnostics(rawUrl = process.env.DATABASE_URL) {
  if (!rawUrl) return { configured: false }
  try {
    const u = new URL(rawUrl)
    const host = u.hostname
    const firstLabel = host.split('.')[0] || ''
    return {
      configured: true,
      host,
      user: u.username || null,
      database: u.pathname.replace(/^\//, '') || null,
      // Le driver HTTP `neon()` ne parle qu'au pooler : `ep-xxx-pooler.<region>…`.
      // L'endpoint direct accepte uniquement le Pool TCP (`updateNeonState`) →
      // les lectures tombent alors que les écritures passent.
      pooler: firstLabel.endsWith('-pooler'),
      // Id d'endpoint sans le suffixe -pooler (ex: ep-cool-meadow-123456).
      endpoint: firstLabel.replace(/-pooler$/, '') || null,
      // ep-xxx-pooler.<region>.aws.neon.tech → « eu-central-1 »
      region: host.split('.')[1] || null,
      sslmode: u.searchParams.get('sslmode') || null
    }
  } catch {
    return { configured: true, parseError: true }
  }
}

export async function updateDbAsync(mutator) {
  if (!process.env.DATABASE_URL) return updateDb(mutator)
  const { updateNeonState } = await import('./neonStore.js')
  return updateNeonState(mutator, emptyDb)
}

export function writeDb(db) {
  ensure()
  // Écriture atomique : tmp puis rename (même FS) — un crash ne peut pas
  // laisser un store.json tronqué.
  fs.writeFileSync(DB_TMP_FILE, JSON.stringify(db, null, 2))
  fs.renameSync(DB_TMP_FILE, DB_FILE)
}

export function updateDb(mutator) {
  const db = readDb()
  const next = mutator(db) || db
  writeDb(next)
  return next
}

/** P16 : chemins réels de la base (respecte PCSTAR_DATA_DIR). */
export function dbPaths() {
  return { dbFile: DB_FILE, dataDir: DATA_DIR }
}

export { hashPass, hashPassLegacy, MASTER }

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

export function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

export function publicUser(u) {
  if (!u) return null
  const { passwordHash, ...rest } = u
  return {
    ...rest,
    links: {
      google: Boolean(u.links?.google),
      meta: Boolean(u.links?.meta),
      googleEmail: u.links?.google?.email || null,
      metaName: u.links?.meta?.name || null
    }
  }
}
