import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'store.json')

const MASTER = {
  id: 'master-pcstar',
  role: 'master',
  email: 'pcstar.info31@gmail.com',
  passwordHash: hashPass('star31'),
  name: 'PC Star Desk',
  phone: '0770650387',
  avatar: 'star',
  accent: 'green',
  provider: 'email',
  links: { google: null, meta: null }
}

function hashPass(password) {
  return crypto.createHash('sha256').update(`pcstar:${password}`).digest('hex')
}

const DEMOS = [
  {
    id: 'demo-karim',
    role: 'customer',
    email: 'karim.oran@demo.dz',
    passwordHash: hashPass('karim31'),
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
    passwordHash: hashPass('amina31'),
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
    passwordHash: hashPass('yacine31'),
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
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8')
    const db = JSON.parse(raw)
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
  } catch {
    const db = emptyDb()
    writeDb(db)
    return db
  }
}

export function writeDb(db) {
  ensure()
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

export function updateDb(mutator) {
  const db = readDb()
  const next = mutator(db) || db
  writeDb(next)
  return next
}

export { hashPass, MASTER }

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
