/**
 * Assign 3 catalog photos per product from /photos/lib (real product-type shots)
 * + legacy /photos/*.png for core SKUs.
 * Deterministic rotation by product id so neighboring SKUs don't share the same trio order.
 */

const LIB = (name) => `/photos/lib/${name}.jpg`

/** Packshots studio homogènes (fond blanc, même éclairage) pour le
    catalogue cœur : une seule photo cohérente par produit, style unique. */
const STUDIO_IDS = [
  'cpu-7800x3d', 'cpu-14700k', 'gpu-4070s', 'gpu-7800xt', 'mb-b650',
  'mb-z790', 'ram-32', 'ssd-1t', 'case-atx', 'psu-750', 'cooler',
  'headset', 'controller', 'keyboard', 'mouse', 'monitor', 'webcam',
  'mic', 'mousepad', 'speakers'
]
const STUDIO = (id) => `/photos/studio/${id}.jpg`

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
  // P15 (#7) : ces fichiers ne sont livrés que pour le CATALOGUE statique.
  // Les produits créés par le master ont un id `sku-<ts36>-<hex>` (`newId('sku')`)
  // et aucun fichier correspondant : on renvoyait quand même le trio →
  // 3 × 404 par vignette (invisibles une fois combiné au bug de repli #6).
  // Aucun id du catalogue ne commence par `sku-` (vérifié par test), et le
  // repli « famille » ci-dessous pointe sur /photos/lib/*, qui existent.
  if (id.startsWith('sku-')) return null
  return [1, 2, 3].map((n) => `/photos/sku/${id}-${n}.jpg`)
}

/** True when path is a catalog default (legacy PNG / family lib), not a master upload. */
function isCatalogDefaultPhoto(path) {
  const p = String(path || '')
  if (!p) return true
  if (p.startsWith('/photos/sku/')) return true
  if (p.startsWith('/photos/lib/')) return true
  if (p.startsWith('/photos/studio/')) return true
  // P28 : les deux visuels livrés avec le catalogue élargi (packshot par
  // référence, illustration de rayon) sont des visuels du catalogue, pas des
  // photos montées par le maître.
  if (p.startsWith('/photos/pack/')) return true
  if (p.startsWith('/catalog/')) return true
  // Legacy static PNGs under /photos/*.png (not uploads/)
  if (/^\/photos\/[^/]+\.(png|jpg|jpeg|webp)$/i.test(p)) return true
  return false
}

/** Provenance d'une image livrée : une galerie peut mêler les deux sources. */
export function catalogPhotoKind(src) {
  if (/^\/photos\/(pack|studio)\//.test(String(src || ''))) return 'generated'
  if (/^\/photos\/sku\//.test(String(src || ''))) return 'catalog'
  return null // une photo du maître ne reçoit jamais de mention « générée »
}

export function photosForProduct(product) {
  // Rayons ajoutés sans photo fournie par le comptoir : ne jamais inventer une
  // illustration d'une autre référence. PartThumb affichera alors le repère de
  // catégorie, clair et honnête, jusqu'à ce qu'une vraie photo soit ajoutée.
  if (product?.photoMode === 'mark') return []
  const existing = Array.isArray(product.photos) ? product.photos.filter(Boolean) : []
  // Les visuels de famille générés pour les nouveaux rayons sont une vraie
  // illustration de rayon (pas un faux packshot SKU). On les conserve seuls :
  // ajouter les trois chemins /photos/sku/ inexistants causerait des 404 et
  // ferait croire que le magasin a fourni trois photos du même article.
  if (product?.photoMode === 'category') return existing.slice(0, 1)
  // P29 : la galerie du catalogue est déjà explicite : packshot + vues réelles
  // inventoriées sur disque, ou packshot seul si aucune vue réelle n'est livrée.
  // Ne rien lui ajouter ici ; les choix du maître restent régis par P28.
  if (product?.photoMode === 'packshot') return existing.slice(0, 12)
  // P28 (B) : la galerie choisie par le maître est servie TELLE QUELLE — dans
  // son ordre, avec ce qu'il a gardé et sans ce qu'il a retiré.
  //
  // Avant, la liste du maître n'était qu'une suggestion :
  //  · une ou deux photos montées sur une fiche du catalogue étaient complétées
  //    par `/photos/sku/<id>-1|2` — deux vues qu'il n'avait pas choisies, et deux
  //    404 pour les références qui n'ont pas de trio sur le disque (les écrans
  //    ajoutés au lot P27) ;
  //  · sur les 20 fiches « studio », la branche studio passait AVANT : moins de
  //    trois photos montées et la fiche montrait le visuel d'origine, la photo du
  //    maître n'apparaissait nulle part ;
  //  · une photo RETIRÉE du trio revenait, le trio étant recalculé depuis l'id.
  // `photoMode: 'custom'` est posé par le serveur dès que le maître enregistre une
  // galerie (`server/catalog.js`, `withOverride`) et par le mode local
  // (`buildShopView`). Une liste qui contient une photo du magasin est aussi la
  // sienne, même sans le drapeau (données antérieures à ce lot).
  if (product?.photoMode === 'custom' && existing.length) return existing.slice(0, 12)
  const sku = skuPhotoPaths(product.id)

  // Master / runtime overrides: keep non-catalog paths (data URLs, /uploads/, http…)
  const custom = existing.filter((p) => !isCatalogDefaultPhoto(p))
  if (custom.length) return existing.slice(0, 12)

  // Catalogue cœur : packshot studio en hero + vues réelles normalisées.
  if (STUDIO_IDS.includes(product.id)) {
    const out = [STUDIO(product.id)]
    for (const n of [1, 2, 3]) out.push(`/photos/sku/${product.id}-${n}.jpg`)
    return out
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
