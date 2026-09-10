export const MASTER = {
  email: 'pcstar.info31@gmail.com',
  password: 'star31',
  name: 'PC Star Desk'
}

export const ACCENTS = [
  { id: 'green', hex: '#22c55e', on: '#052e16' },
  { id: 'blue', hex: '#38bdf8', on: '#082f49' },
  { id: 'red', hex: '#f87171', on: '#450a0a' },
  { id: 'gold', hex: '#fbbf24', on: '#422006' }
]

export const AVATARS = [
  { id: 'chip', label: 'CPU', mark: 'CPU' },
  { id: 'card', label: 'GPU', mark: 'GPU' },
  { id: 'board', label: 'Board', mark: 'MB' },
  { id: 'stick', label: 'RAM', mark: 'RAM' },
  { id: 'disk', label: 'SSD', mark: 'SSD' },
  { id: 'pad', label: 'Pad', mark: 'PAD' },
  { id: 'star', label: 'Star', mark: 'PS' },
  { id: 'case', label: 'Case', mark: 'PC' }
]

const KEY_USERS = 'pcstar-users'
const KEY_META = 'pcstar-catalog'
const KEY_SESSION = 'pcstar-session'

export function hashPass(password) {
  let h = 2166136261
  const s = String(password || '')
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `h${(h >>> 0).toString(16)}`
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

export function normalizePhone(value) {
  let d = String(value || '').replace(/\D/g, '')
  if (d.startsWith('213')) d = `0${d.slice(3)}`
  if (d.length === 9 && /^[567]/.test(d)) d = `0${d}`
  return d
}

export function isDzPhone(value) {
  const p = normalizePhone(value)
  return /^0[567]\d{8}$/.test(p)
}

export function createMemoryStorage(seed = {}) {
  const map = { ...seed }
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
    },
    setItem(key, value) {
      map[key] = String(value)
    },
    removeItem(key) {
      delete map[key]
    }
  }
}

function nowId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function masterUser() {
  return {
    id: 'master-pcstar',
    role: 'master',
    email: MASTER.email,
    password: hashPass(MASTER.password),
    name: MASTER.name,
    phone: '0770650387',
    avatar: 'star',
    accent: 'green',
    provider: 'email'
  }
}

function emptyMeta() {
  return {
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: []
  }
}

export const DEMO_CUSTOMERS = [
  {
    id: 'demo-karim',
    role: 'customer',
    email: 'karim.oran@demo.dz',
    passwordPlain: 'karim31',
    name: 'Karim B.',
    phone: '0550123456',
    avatar: 'chip',
    accent: 'blue',
    provider: 'email',
    demo: true
  },
  {
    id: 'demo-amina',
    role: 'customer',
    email: 'amina.castors@demo.dz',
    passwordPlain: 'amina31',
    name: 'Amina K.',
    phone: '0669174617',
    avatar: 'card',
    accent: 'gold',
    provider: 'email',
    demo: true
  },
  {
    id: 'demo-yacine',
    role: 'customer',
    email: 'yacine.pc@demo.dz',
    passwordPlain: 'yacine31',
    name: 'Yacine M.',
    phone: '0770650387',
    avatar: 'pad',
    accent: 'red',
    provider: 'email',
    demo: true
  }
]

function demoUser(seed) {
  const { passwordPlain, ...rest } = seed
  return { ...rest, password: hashPass(passwordPlain) }
}

export function loadUsers(storage) {
  const raw = storage?.getItem?.(KEY_USERS)
  let list = []
  if (raw) {
    try {
      list = JSON.parse(raw)
      if (!Array.isArray(list)) list = []
    } catch {
      list = []
    }
  }
  let changed = false
  if (!list.some((u) => u.role === 'master')) {
    list = [masterUser(), ...list]
    changed = true
  }
  DEMO_CUSTOMERS.forEach((d) => {
    if (!list.some((u) => u.id === d.id || (d.email && u.email === d.email))) {
      list = [...list, demoUser(d)]
      changed = true
    }
  })
  if (changed) saveUsers(storage, list)
  return list
}

export function phoneCarrier(value) {
  const p = normalizePhone(value)
  if (!isDzPhone(p)) return null
  if (p.startsWith('05')) return 'ooredoo'
  if (p.startsWith('06')) return 'mobilis'
  if (p.startsWith('07')) return 'djezzy'
  return null
}

export function saveUsers(storage, users) {
  storage?.setItem?.(KEY_USERS, JSON.stringify(users))
}

export function loadSession(storage) {
  const raw = storage?.getItem?.(KEY_SESSION)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSession(storage, session) {
  if (!session) storage?.removeItem?.(KEY_SESSION)
  else storage?.setItem?.(KEY_SESSION, JSON.stringify(session))
}

export function loadMeta(storage) {
  const raw = storage?.getItem?.(KEY_META)
  if (!raw) return emptyMeta()
  try {
    const parsed = JSON.parse(raw)
    return { ...emptyMeta(), ...parsed }
  } catch {
    return emptyMeta()
  }
}

export function saveMeta(storage, meta) {
  storage?.setItem?.(KEY_META, JSON.stringify(meta))
}

export function registerEmail(users, { email, password, name, phone } = {}) {
  const mail = String(email || '').trim().toLowerCase()
  if (!isEmail(mail)) return { ok: false, error: 'email' }
  if (String(password || '').length < 6) return { ok: false, error: 'password' }
  if (users.some((u) => u.email === mail)) return { ok: false, error: 'exists' }
  const user = {
    id: nowId('u'),
    role: 'customer',
    email: mail,
    password: hashPass(password),
    name: String(name || mail.split('@')[0]).trim() || 'Customer',
    phone: phone ? normalizePhone(phone) : '',
    avatar: 'chip',
    accent: 'green',
    provider: 'email'
  }
  return { ok: true, user, users: [...users, user] }
}

export function loginEmail(users, { email, password } = {}) {
  const mail = String(email || '').trim().toLowerCase()
  const user = users.find((u) => u.email === mail)
  if (!user || user.password !== hashPass(password)) return { ok: false, error: 'auth' }
  return { ok: true, user }
}

export function startSms(users, { phone } = {}) {
  const p = normalizePhone(phone)
  if (!isDzPhone(p)) return { ok: false, error: 'phone' }
  const code = String(100000 + Math.floor(Math.random() * 900000))
  return {
    ok: true,
    code,
    users,
    pending: { phone: p, code, until: Date.now() + 10 * 60 * 1000 }
  }
}

export function verifySms(users, { phone, code, pending } = {}) {
  const p = normalizePhone(phone)
  if (!pending || pending.phone !== p || String(code) !== String(pending.code)) {
    return { ok: false, error: 'code' }
  }
  let user = users.find((u) => u.phone === p)
  let next = users
  if (!user) {
    user = {
      id: nowId('u'),
      role: 'customer',
      email: '',
      password: '',
      name: `0${p.slice(1, 4)}…`,
      phone: p,
      avatar: 'pad',
      accent: 'green',
      provider: 'sms'
    }
    next = [...users, user]
  }
  return { ok: true, user, users: next }
}

export function loginGoogle(users) {
  const email = 'google.demo@pcstar.dz'
  let user = users.find((u) => u.email === email)
  let next = users
  if (!user) {
    user = {
      id: nowId('g'),
      role: 'customer',
      email,
      password: '',
      name: 'Google Demo',
      phone: '',
      avatar: 'star',
      accent: 'green',
      provider: 'google'
    }
    next = [...users, user]
  }
  return { ok: true, user, users: next }
}

export function updateUser(users, id, patch) {
  const idx = users.findIndex((u) => u.id === id)
  if (idx < 0) return { ok: false, error: 'missing' }
  const allowed = {}
  if (patch.name != null) allowed.name = String(patch.name).trim() || users[idx].name
  if (patch.phone != null) {
    const p = String(patch.phone).trim()
    allowed.phone = p ? normalizePhone(p) : ''
  }
  if (patch.avatar && AVATARS.some((a) => a.id === patch.avatar)) allowed.avatar = patch.avatar
  if (patch.accent && ACCENTS.some((a) => a.id === patch.accent)) allowed.accent = patch.accent
  const user = { ...users[idx], ...allowed }
  const next = users.slice()
  next[idx] = user
  return { ok: true, user, users: next }
}

export function deleteCustomer(users, actor, id) {
  if (!actor || actor.role !== 'master') return { ok: false, error: 'forbidden' }
  const target = users.find((u) => u.id === id)
  if (!target) return { ok: false, error: 'missing' }
  if (target.role === 'master' || target.id === actor.id) return { ok: false, error: 'master' }
  return { ok: true, users: users.filter((u) => u.id !== id) }
}

export function hideProduct(meta, id) {
  const hidden = new Set(meta.hiddenProductIds || [])
  hidden.add(id)
  return {
    ...meta,
    extraProducts: (meta.extraProducts || []).filter((p) => p.id !== id),
    hiddenProductIds: [...hidden]
  }
}

export function addProduct(meta, { name, price, category, brand, stock, short } = {}) {
  const title = String(name || '').trim()
  const n = Number(price)
  if (!title || !Number.isFinite(n) || n < 0) return { ok: false, error: 'product' }
  const cat = String(category || 'accessories')
  const product = {
    id: nowId('sku'),
    sku: `PS-${title.slice(0, 8).toUpperCase().replace(/\s+/g, '')}`,
    name: title,
    short: String(short || title),
    brand: String(brand || 'PC Star'),
    category: cat,
    kind: cat === 'repair' ? 'service' : cat === 'laptop' || cat === 'ready' ? 'machine' : cat === 'accessories' ? 'accessory' : 'part',
    price: Math.round(n),
    stock: Math.max(0, Math.round(Number(stock) || 0)),
    rating: 0,
    reviews: 0,
    photos: [],
    needs: '',
    related: [],
    custom: true
  }
  return {
    ok: true,
    product,
    meta: {
      ...meta,
      extraProducts: [...(meta.extraProducts || []), product],
      hiddenProductIds: (meta.hiddenProductIds || []).filter((id) => id !== product.id)
    }
  }
}

export function addPanel(meta, { titles, categories } = {}) {
  const cats = (categories || []).filter(Boolean)
  if (!cats.length) return { ok: false, error: 'panel' }
  const titlesSafe = {
    ar: String(titles?.ar || titles?.fr || titles?.en || 'لوحة').trim(),
    fr: String(titles?.fr || titles?.en || titles?.ar || 'Panneau').trim(),
    en: String(titles?.en || titles?.fr || titles?.ar || 'Panel').trim()
  }
  const panel = {
    id: nowId('panel'),
    titles: titlesSafe,
    categories: cats,
    custom: true
  }
  return {
    ok: true,
    panel,
    meta: { ...meta, extraPanels: [...(meta.extraPanels || []), panel] }
  }
}

export function togglePanel(meta, id, on) {
  const hidden = new Set(meta.hiddenPanelIds || [])
  if (on) hidden.delete(id)
  else hidden.add(id)
  return { ...meta, hiddenPanelIds: [...hidden] }
}

export function buildShopView(baseProducts, baseLines, basePanels, meta) {
  const hiddenIds = new Set(meta.hiddenProductIds || [])
  const products = [
    ...baseProducts.filter((p) => !hiddenIds.has(p.id)),
    ...(meta.extraProducts || []).filter((p) => !hiddenIds.has(p.id))
  ]
  const hiddenPanels = new Set(meta.hiddenPanelIds || [])
  const extraLines = (meta.extraPanels || []).flatMap((panel) =>
    panel.categories.map((cat) => ({
      id: `${panel.id}-${cat}`,
      label: cat,
      group: panel.id,
      match: (p) => p.category === cat
    }))
  )
  const extraPanels = (meta.extraPanels || []).map((panel) => ({
    id: panel.id,
    titleKey: null,
    titles: panel.titles,
    custom: true
  }))
  return {
    products,
    lines: [...baseLines, ...extraLines],
    panels: [...basePanels.filter((p) => !hiddenPanels.has(p.id)), ...extraPanels]
  }
}
