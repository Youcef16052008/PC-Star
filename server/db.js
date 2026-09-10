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
  passwordHash: hashPassLegacy('star31'),
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
  return s === hashPassLegacy(password)
}

const DEMOS = [
  {
    id: 'demo-karim',
    role: 'customer',
    email: 'karim.oran@demo.dz',
    passwordHash: hashPassLegacy('karim31'),
    name: 'Karim B.',
    phone: '0550123456',
    avatar: 'chip',
    accent: 'blue',
    provider: 'email',
    wilaya: 'Oran',
    links: { google: null, meta: null },
    demo: true
  },
  {
    id: 'demo-amina',
    role: 'customer',
    email: 'amina.castors@demo.dz',
    passwordHash: hashPassLegacy('amina31'),
    name: 'Amina K.',
    phone: '0669174617',
    avatar: 'card',
    accent: 'gold',
    provider: 'email',
    wilaya: 'Oran',
    links: { google: null, meta: null },
    demo: true
  },
  {
    id: 'demo-yacine',
    role: 'customer',
    email: 'yacine.pc@demo.dz',
    passwordHash: hashPassLegacy('yacine31'),
    name: 'Yacine M.',
    phone: '0770650387',
    avatar: 'pad',
    accent: 'red',
    provider: 'email',
    wilaya: 'Mostaganem',
    links: { google: null, meta: null },
    demo: true
  }
]

function emptyDb() {
  return {
    users: [MASTER, ...DEMOS],
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
  DEMOS.forEach((d) => {
    if (!db.users.some((u) => u.id === d.id || u.email === d.email)) db.users.push({ ...d })
  })
  if (!Array.isArray(db.orders)) db.orders = []
  if (!db.stock || typeof db.stock !== 'object') db.stock = {}
  if (!db.meta) db.meta = emptyDb().meta
  if (!db.sessions) db.sessions = {}
  if (!db.oauthPending) db.oauthPending = {}
  return db
}

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
