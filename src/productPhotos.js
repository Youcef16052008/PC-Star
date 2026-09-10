/**
 * Assign 3 catalog photos per product from /photos/lib (real product-type shots)
 * + legacy /photos/*.png for core SKUs.
 * Deterministic rotation by product id so neighboring SKUs don't share the same trio order.
 */

const LIB = (name) => `/photos/lib/${name}.jpg`

/** Pools of 3+ paths per visual family */
const POOLS = {
  cpu: ['cpu-1', 'cpu-2', 'cpu-3', 'cpu-local-1', 'cpu-local-2', 'cpu-local-3'].map(LIB),
  gpu: ['gpu-1', 'gpu-2', 'gpu-3', 'gpu-local-1', 'gpu-local-2', 'gpu-local-3'].map(LIB),
  mb: ['mb-1', 'mb-2', 'mb-3', 'mb-local-1', 'mb-local-2', 'mb-local-3'].map(LIB),
  ram: ['ram-1', 'ram-2', 'ram-3', 'ram-local-1', 'ram-local-2'].map(LIB),
  ssd: ['ssd-1', 'ssd-2', 'ssd-3', 'ssd-local-1', 'ssd-local-2'].map(LIB),
  hdd: ['hdd-1', 'hdd-2', 'hdd-3', 'ssd-local-1'].map(LIB),
  case: ['case-1', 'case-2', 'case-3', 'case-local-1', 'case-local-2', 'pc-1'].map(LIB),
  psu: ['psu-1', 'psu-2', 'psu-3', 'psu-local-1', 'psu-local-2'].map(LIB),
  cooler: ['cooler-1', 'cooler-2', 'cooler-3', 'cooler-local-1', 'fan-1'].map(LIB),
  fan: ['fan-1', 'fan-2', 'fan-3', 'cooler-1'].map(LIB),
  kb: ['kb-1', 'kb-2', 'kb-3', 'kb-local-1', 'mouse-1'].map(LIB),
  mouse: ['mouse-1', 'mouse-2', 'mouse-3', 'mouse-local-1', 'mousepad-1'].map(LIB),
  headset: ['headset-1', 'headset-2', 'headset-3', 'headset-local-1', 'mic-1'].map(LIB),
  monitor: ['monitor-1', 'monitor-2', 'monitor-3', 'monitor-local-1'].map(LIB),
  webcam: ['webcam-1', 'webcam-2', 'webcam-3', 'webcam-local-1'].map(LIB),
  mic: ['mic-1', 'mic-2', 'mic-3', 'mic-local-1', 'headset-2'].map(LIB),
  mousepad: ['mousepad-1', 'mousepad-2', 'mousepad-3', 'mousepad-local-1'].map(LIB),
  speakers: ['speakers-1', 'speakers-2', 'speakers-3', 'speakers-local-1'].map(LIB),
  controller: ['controller-1', 'controller-2', 'controller-3', 'controller-local-1', 'console-1'].map(LIB),
  laptop: ['laptop-1', 'laptop-2', 'laptop-3', 'pc-2'].map(LIB),
  pc: ['pc-1', 'pc-2', 'pc-3', 'case-1', 'case-2'].map(LIB),
  usb: ['usb-1', 'usb-2', 'usb-3', 'ssd-1'].map(LIB),
  router: ['router-1', 'router-2', 'router-3', 'usb-1'].map(LIB),
  console: ['console-1', 'console-2', 'console-3', 'controller-1'].map(LIB),
  chair: ['chair-1', 'chair-2', 'chair-3', 'chair-local-1'].map(LIB),
  cable: ['cable-1', 'cable-2', 'usb-1', 'usb-2'].map(LIB),
  repair: ['cable-1', 'cooler-1', 'ssd-1', 'usb-2', 'fan-1'].map(LIB),
  accessories: ['kb-1', 'mouse-1', 'headset-1', 'usb-1', 'mousepad-1'].map(LIB)
}

function hashId(id) {
  let h = 0
  const s = String(id || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function pick3(pool, seed) {
  const list = pool && pool.length ? pool : POOLS.accessories
  const n = list.length
  const a = seed % n
  const b = (seed + 1 + Math.floor(seed / 3)) % n
  let c = (seed + 2 + Math.floor(seed / 5)) % n
  if (c === a) c = (c + 1) % n
  if (c === b) c = (c + 1) % n
  if (b === a) {
    const bb = (a + 1) % n
    return [list[a], list[bb], list[(bb + 1) % n]]
  }
  return [list[a], list[b], list[c]]
}

/** Guess visual family from id / name / category / short */
export function photoFamily(product) {
  const id = (product.id || '').toLowerCase()
  const name = `${product.name || ''} ${product.short || ''} ${product.brand || ''}`.toLowerCase()
  const cat = (product.category || '').toLowerCase()
  const blob = `${id} ${name} ${cat}`

  if (/\b(cpu|ryzen|core i|core ultra|processor|processeur)\b/.test(blob) || cat === 'cpu') return 'cpu'
  if (/\b(gpu|rtx|radeon|geforce|graphics|carte graphique)\b/.test(blob) || cat === 'gpu') return 'gpu'
  if (/\b(motherboard|mainboard|carte m[eè]re|\bmb-|\bb[45678][0-9]0|\bz[789][0-9]0|\bx[678][0-9]0)\b/.test(blob) || cat === 'motherboard')
    return 'mb'
  if (/\b(hdd|barracuda|hard disk|disque dur)\b/.test(blob)) return 'hdd'
  if (/\b(ssd|nvme|sn770|990 pro|kc3000|firecuda|m\.2)\b/.test(blob)) return 'ssd'
  if (/\b(ram|ddr[45]|vengeance|trident|fury|m[eé]moire)\b/.test(blob) || (cat === 'memory' && !/ssd|hdd|nvme/.test(blob)))
    return 'ram'
  if (cat === 'memory') {
    if (/ssd|nvme|hdd|barracuda|sn\d|pro \d/.test(blob)) return /hdd|barracuda|wd blue|ezaz|dm008/.test(blob) ? 'hdd' : 'ssd'
    return 'ram'
  }
  if (/\b(psu|alimentation|power supply|watts?\b|80\+|modulaire)\b/.test(blob) || id.includes('psu')) return 'psu'
  if (/\b(cooler|ventirad|aio|watercooling|dissipateur|nh-d|peerless|assassin)\b/.test(blob) || id.includes('cooler'))
    return 'cooler'
  if (/\b(fan|ventilateur|argb fan)\b/.test(blob) && !/cooler/.test(blob)) return 'fan'
  if (/\b(case|bo[iî]tier|chassis|ghost|rogue|deathmatch|h5 flow|mesh tower)\b/.test(blob) || cat === 'case')
    return 'case'
  if (/\b(keyboard|clavier|m[eé]ca)\b/.test(blob) || /\bkb-|\bk\d{3}/.test(id)) return 'kb'
  if (/\b(mouse|souris)\b/.test(blob) && !/pad|tapis/.test(blob)) return 'mouse'
  if (/\b(headset|casque|headphone)\b/.test(blob)) return 'headset'
  if (/\b(monitor|moniteur|écran|ecran)\b/.test(blob)) return 'monitor'
  if (/\b(webcam|cam[eé]ra)\b/.test(blob)) return 'webcam'
  if (/\b(mic|microphone|micro)\b/.test(blob)) return 'mic'
  if (/\b(mousepad|tapis|desk mat)\b/.test(blob)) return 'mousepad'
  if (/\b(speaker|enceinte|haut-parleur)\b/.test(blob)) return 'speakers'
  if (/\b(controller|manette|dualsense|dualshock|gamepad|xbox.*pad)\b/.test(blob)) return 'controller'
  if (/\b(laptop|notebook|portable)\b/.test(blob) || cat === 'laptop') return 'laptop'
  if (/\b(console|playstation|xbox series|ps5|ps4)\b/.test(blob) || cat === 'console') return 'console'
  if (/\b(router|wifi|tenda|tp-link|r[eé]seau|switch ethernet)\b/.test(blob)) return 'router'
  if (/\b(usb|flash|clé usb|pendrive|hub usb)\b/.test(blob) || cat === 'usb') return 'usb'
  if (/\b(chair|si[eè]ge|fauteuil|desk chair)\b/.test(blob)) return 'chair'
  if (/\b(cable|câble|hdmi|displayport)\b/.test(blob)) return 'cable'
  if (cat === 'ready' || /\b(pc gamer|tour ready|prebuilt|config mont[eé]e|desktop tower)\b/.test(blob)) return 'pc'
  if (cat === 'repair' || /\b(r[eé]paration|repair|service|p[aâ]te thermique|montage)\b/.test(blob)) return 'repair'
  if (cat === 'accessories') {
    if (/pack|combo|4en1|mkh/.test(blob)) return 'kb'
    return 'accessories'
  }
  return cat === 'case' ? 'case' : 'accessories'
}

/** Exact per-SKU shots: /photos/sku/{id}-1|2|3.jpg (shipped for full catalog). */
function skuPhotoPaths(productId) {
  const id = String(productId || '').trim()
  if (!id) return null
  return [1, 2, 3].map((n) => `/photos/sku/${id}-${n}.jpg`)
}

/** True when path is a catalog default (legacy PNG / family lib), not a master upload. */
function isCatalogDefaultPhoto(path) {
  const p = String(path || '')
  if (!p) return true
  if (p.startsWith('/photos/sku/')) return true
  if (p.startsWith('/photos/lib/')) return true
  // Legacy static PNGs under /photos/*.png (not uploads/)
  if (/^\/photos\/[^/]+\.(png|jpg|jpeg|webp)$/i.test(p)) return true
  return false
}

export function photosForProduct(product) {
  const existing = Array.isArray(product.photos) ? product.photos.filter(Boolean) : []
  const sku = skuPhotoPaths(product.id)

  // Master / runtime overrides: keep non-catalog paths (data URLs, /uploads/, http…)
  const custom = existing.filter((p) => !isCatalogDefaultPhoto(p))
  if (custom.length >= 3) return custom.slice(0, 12)
  if (custom.length > 0 && sku) {
    const out = [...custom]
    for (const p of sku) {
      if (out.length >= 3) break
      if (!out.includes(p)) out.push(p)
    }
    return out.slice(0, 12)
  }

  // Full catalog: prefer exact SKU trio over family pools / legacy PNGs
  if (sku) return sku

  const family = photoFamily(product)
  const pool = POOLS[family] || POOLS.accessories
  const trio = pick3(pool, hashId(product.id))
  if (existing.length === 0) return trio
  const out = [...existing]
  for (const p of trio) {
    if (out.length >= 3) break
    if (!out.includes(p)) out.push(p)
  }
  while (out.length < 3) out.push(trio[out.length % trio.length])
  return out.slice(0, 12)
}

export function ensureProductPhotos(product) {
  return { ...product, photos: photosForProduct(product) }
}
