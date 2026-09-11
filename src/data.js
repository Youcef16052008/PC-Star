import { EXTRA } from './extraCatalog.js'
import { DZ_EXTRA, DZ_DEALS, DZ_GUIDES, PAYMENT_HINTS, WILAYAS_NEAR, DZ_BRANDS } from './dzCatalog.js'
import { ensureProductPhotos } from './productPhotos.js'

export { DZ_DEALS, DZ_GUIDES, PAYMENT_HINTS, WILAYAS_NEAR, DZ_BRANDS }

export const STORE = {
  name: 'PC Star Informatique',
  short: 'PC Star',
  phone: '0770 65 03 87',
  phoneHref: 'tel:+213770650387',
  phone2: '0669 17 46 17',
  phone2Href: 'tel:+213669174617',
  whatsapp: '213770650387',
  email: 'pcstar.info31@gmail.com',
  instagram: 'pcstar31',
  instagramUrl: 'https://www.instagram.com/pcstar31/',
  facebookUrl: 'https://www.facebook.com/pcstar31',
  address: 'Rue Mimoune Bouadjimi, El Makari Les Castors, Oran',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=Rue+Mimoune+Bouadjimi+El+Makari+Les+Castors+Oran',
  mapEmbed: 'https://maps.google.com/maps?q=Rue%20Mimoune%20Bouadjimi%20El%20Makari%20Les%20Castors%20Oran&z=16&output=embed',
  // Textes (about/services/hours/warranty…) → clés i18n P3 :
  // storeAbout, storeServices, storeBuyNote, storeHours, storeReady,
  // storeWarranty, storeNote. STORE ne garde que les données (tél, adresse, URLs).
}

export const SHOP_SERVICES = [
  { id: 'parts', titleKey: 'svcPartsTitle', bodyKey: 'svcPartsBody' },
  { id: 'machines', titleKey: 'svcMachinesTitle', bodyKey: 'svcMachinesBody' },
  { id: 'repair', titleKey: 'svcRepairTitle', bodyKey: 'svcRepairBody' },
  { id: 'usb', titleKey: 'svcUsbTitle', bodyKey: 'svcUsbBody' }
]

export const STORE_LINKS = [
  { id: 'instagram', label: 'Instagram', sub: '@pcstar31', href: 'https://www.instagram.com/pcstar31/' },
  { id: 'facebook', label: 'Facebook', sub: 'PC Star Informatique', href: 'https://www.facebook.com/pcstar31' },
  { id: 'whatsapp', label: 'WhatsApp', sub: '0770 65 03 87', href: 'https://wa.me/213770650387' },
  { id: 'maps', label: 'Google Maps', sub: 'Les Castors, Oran', href: 'https://www.google.com/maps/search/?api=1&query=Rue+Mimoune+Bouadjimi+El+Makari+Les+Castors+Oran' }
]

export function money(n) {
  return `${Math.round(n).toLocaleString('fr-DZ')} DA`
}

export function third(n) {
  return money(Math.round(n / 3))
}

export const SLOTS = [
  '10:30',
  '11:30',
  '12:30',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00'
]

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'cpu', label: 'CPU' },
  { id: 'gpu', label: 'GPU' },
  { id: 'motherboard', label: 'Motherboard' },
  { id: 'memory', label: 'RAM & SSD' },
  { id: 'case', label: 'Case & PSU' },
  { id: 'laptop', label: 'Laptops' },
  { id: 'ready', label: 'Ready PCs' },
  { id: 'usb', label: 'USB & flash' },
  { id: 'console', label: 'Consoles' },
  { id: 'repair', label: 'Repairs' },
  { id: 'accessories', label: 'Accessories' }
]

function hay(p) {
  return `${p.name} ${p.short || ''} ${p.id}`.toLowerCase()
}

export const PART_LINES = [
  { id: 'cpu', label: 'CPU', group: 'parts', match: (p) => p.category === 'cpu' },
  { id: 'motherboard', label: 'Motherboard', group: 'parts', match: (p) => p.category === 'motherboard' },
  { id: 'gpu', label: 'GPU', group: 'parts', match: (p) => p.category === 'gpu' },
  { id: 'ram', label: 'RAM', group: 'parts', match: (p) => p.category === 'memory' && p.compat?.memory },
  { id: 'ssd', label: 'SSD', group: 'parts', match: (p) => p.category === 'memory' && !p.compat?.memory && !/hdd/.test(hay(p)) },
  { id: 'hdd', label: 'HDD', group: 'parts', match: (p) => p.category === 'memory' && /hdd/.test(hay(p)) },
  { id: 'case', label: 'Case', group: 'parts', match: (p) => p.category === 'case' && p.compat?.form },
  { id: 'psu', label: 'PSU', group: 'parts', match: (p) => Boolean(p.compat?.psuWatts) },
  { id: 'cooler', label: 'Cooler', group: 'parts', match: (p) => p.category === 'case' && Array.isArray(p.compat?.socket) },
  { id: 'fan', label: 'Fan', group: 'parts', match: (p) => p.category === 'case' && /fan/.test(hay(p)) && !Array.isArray(p.compat?.socket) && !p.compat?.form && !p.compat?.psuWatts },
  { id: 'keyboard', label: 'Keyboard', group: 'accessories', match: (p) => p.category === 'accessories' && /keyboard|clavier|apex|huntsman|alloy/.test(hay(p)) },
  { id: 'mouse', label: 'Mouse', group: 'accessories', match: (p) => p.category === 'accessories' && /mouse|souris|viper|rival|haste/.test(hay(p)) && !/pad/.test(hay(p)) },
  { id: 'headset', label: 'Headset', group: 'accessories', match: (p) => p.category === 'accessories' && /headset|casque|arctis|blackshark|cloud|g pro x 2/.test(hay(p)) },
  { id: 'monitor', label: 'Monitor', group: 'accessories', match: (p) => p.category === 'accessories' && /monitor|27"|24"/.test(hay(p)) },
  { id: 'controller', label: 'Manette', group: 'accessories', match: (p) => p.category === 'accessories' && /controller|manette|xbox|dualsense|dualshock|8bitdo/.test(hay(p)) },
  { id: 'webcam', label: 'Webcam', group: 'accessories', match: (p) => p.category === 'accessories' && /webcam|brio|c920/.test(hay(p)) },
  { id: 'mic', label: 'Microphone', group: 'accessories', match: (p) => p.category === 'accessories' && /mic|yeti/.test(hay(p)) && !/casque|headset/.test(hay(p)) },
  { id: 'mousepad', label: 'Mousepad', group: 'accessories', match: (p) => p.category === 'accessories' && /pad|qck|g640/.test(hay(p)) },
  { id: 'speakers', label: 'Speakers', group: 'accessories', match: (p) => p.category === 'accessories' && /speaker/.test(hay(p)) },
  { id: 'network', label: 'Network', group: 'accessories', match: (p) => p.category === 'accessories' && /wifi|router|archer/.test(hay(p)) },
  { id: 'misc', label: 'Cables & paste', group: 'parts', match: (p) => p.category === 'case' && /paste|cable|nt-h2/.test(hay(p)) },
  { id: 'laptop', label: 'Laptop', group: 'machines', match: (p) => p.category === 'laptop' },
  { id: 'ready', label: 'PC pret', group: 'machines', match: (p) => p.category === 'ready' },
  { id: 'usb', label: 'USB & flash', group: 'desk', match: (p) => p.category === 'usb' },
  { id: 'console', label: 'Console', group: 'desk', match: (p) => p.category === 'console' },
  { id: 'repair', label: 'Reparation', group: 'desk', match: (p) => p.category === 'repair' }
]

export function brandsForLine(lineId) {
  const line = PART_LINES.find((l) => l.id === lineId)
  if (!line) return []
  return [...new Set(PRODUCTS.filter(line.match).map((p) => p.brand))].sort((a, b) => a.localeCompare(b))
}

export const KINDS = [
  { id: 'all', label: 'Everything' },
  { id: 'part', label: 'PC parts' },
  { id: 'accessory', label: 'Accessories' },
  { id: 'machine', label: 'Laptops & PCs' },
  { id: 'service', label: 'Repairs' }
]

export const BRANDS = [
  'AMD', 'Intel', 'NVIDIA', 'ASUS', 'MSI', 'Gigabyte', 'ASRock',
  'Corsair', 'G.Skill', 'Kingston', 'Samsung', 'WD', 'Crucial',
  'Lian Li', 'NZXT', 'Cooler Master', 'Noctua', 'be quiet!',
  'Logitech', 'Razer', 'SteelSeries', 'HyperX', 'Xbox', 'Zotac',
  'Sapphire', 'Blue', 'PowerColor', 'Palit', 'PNY', 'XFX',
  'TeamGroup', 'Patriot', 'Seagate', 'Fractal', 'Phanteks',
  'Thermaltake', 'DeepCool', 'SilverStone', 'Seasonic', 'EVGA',
  'Arctic', 'TP-Link', 'HP', 'Dell', 'Lenovo', 'Acer', 'Apple', 'PC Star',
  'SanDisk', 'Sony', 'Nintendo', '8BitDo', 'Generic',
  'Spirit of Gamer', 'Havit', 'Gamemax', 'Raidmax', 'Twinmos', 'Magma',
  'Xigmatek', 'Tenda', '1st Player', 'Ares', 'Hybrok', 'Antec', 'GameNote', 'Ugreen'
]

export const SOCKETS = ['AM5', 'LGA1700', 'LGA1851']

export const PRICE_PRESETS = [
  { id: 'any', label: 'Any price', min: 0, max: 999999 },
  { id: 'u15', label: 'Under 15 000 DA', min: 0, max: 15000 },
  { id: '15-30', label: '15 000 – 30 000 DA', min: 15000, max: 30000 },
  { id: '30-50', label: '30 000 – 50 000 DA', min: 30000, max: 50000 },
  { id: '50-100', label: '50 000 – 100 000 DA', min: 50000, max: 100000 },
  { id: '100+', label: '100 000 DA+', min: 100000, max: 999999 }
]

export const DEALS = [
  { id: 'hav-combo4', tag: '-10%', noteKey: 'dealNoteHavCombo' },
  { id: 'sog-mkh5', tag: 'Pack SoG', noteKey: 'dealNoteSogPack' },
  { id: 'cpu-5600', tag: 'Hit DZ', noteKey: 'dealNoteCpu5600' },
  { id: 'ram-32', tag: '-12%', noteKey: 'dealNoteRam32' },
  { id: 'ssd-1t', tag: 'Hot', noteKey: 'dealNoteSsd1t' },
  { id: 'tw-ssd-512', tag: 'Budget', noteKey: 'dealNoteTwSsd512' }
]

export const GUIDES = [
  { id: 'dz-budget', titleKey: 'guideHomeBudgetTitle', bodyKey: 'guideHomeBudgetBody' },
  { id: 'dz-sog', titleKey: 'guideHomeSogTitle', bodyKey: 'guideHomeSogBody' },
  { id: 'am5', titleKey: 'guideHomeAm5Title', bodyKey: 'guideHomeAm5Body' },
  { id: 'fix', titleKey: 'guideHomeFixTitle', bodyKey: 'guideHomeFixBody' },
  { id: 'desk', titleKey: 'guideHomeDeskTitle', bodyKey: 'guideHomeDeskBody' }
]

export const BRANDS_DZ_PRIORITY = [
  'Spirit of Gamer',
  'Havit',
  'Gamemax',
  'Raidmax',
  'Twinmos',
  'Magma',
  'Xigmatek',
  'Tenda',
  '1st Player',
  'DeepCool',
  'AMD',
  'Intel',
  'MSI',
  'ASUS',
  'Gigabyte'
]

export const REVIEWS = {
  'cpu-7800x3d': [
    { name: 'Yacine M.', city: 'Oran', stars: 5, textKey: 'rev7800x3d1' },
    { name: 'Lina B.', city: 'Oran', stars: 5, textKey: 'rev7800x3d2' }
  ],
  'cpu-14700k': [
    { name: 'Karim T.', city: 'Blida', stars: 5, textKey: 'rev14700k1' },
    { name: 'Sofia R.', city: 'Oran', stars: 4, textKey: 'rev14700k2' }
  ],
  'gpu-4070s': [
    { name: 'Nabil H.', city: 'Oran', stars: 5, textKey: 'rev4070s1' },
    { name: 'Amira K.', city: 'Tizi Ouzou', stars: 4, textKey: 'rev4070s2' }
  ],
  'gpu-7800xt': [
    { name: 'Riad S.', city: 'Constantine', stars: 5, textKey: 'rev7800xt1' },
    { name: 'Ines D.', city: 'Oran', stars: 4, textKey: 'rev7800xt2' }
  ],
  'mb-b650': [
    { name: 'Mehdi A.', city: 'Oran', stars: 5, textKey: 'revB650' }
  ],
  'ram-32': [
    { name: 'Yanis C.', city: 'Oran', stars: 5, textKey: 'revRam32' }
  ],
  'headset': [
    { name: 'Sara M.', city: 'Oran', stars: 4, textKey: 'revHeadset' }
  ],
  'mouse': [
    { name: 'Anis B.', city: 'Setif', stars: 5, textKey: 'revMouse' }
  ]
}

function shots(...files) {
  return files.map((f) => `/photos/${f.replace(/\.jpe?g$/i, '.png')}`)
}

const PRODUCTS_CORE = [
  {
    id: 'cpu-7800x3d',
    sku: '100-100000910WOF',
    name: 'AMD Ryzen 7 7800X3D',
    brand: 'AMD',
    kind: 'part',
    category: 'cpu',
    price: 97000,
    stock: 6,
    rating: 4.8,
    reviews: 214,
    related: ['mb-b650', 'ram-32', 'cooler'],
    photos: shots('cpu.jpg', 'cpu-7800x3d.jpg', 'cpu-14700k.jpg'),
    short: '8 cores / 16 threads · 5.0 GHz',
    socket: 'AM5',
    needsKey: 'needsCpu7800x3d',
    compat: { socket: 'AM5', memory: 'DDR5' }
  },
  {
    id: 'cpu-14700k',
    sku: 'BX8071514700K',
    name: 'Intel Core i7-14700K',
    brand: 'Intel',
    kind: 'part',
    category: 'cpu',
    price: 90000,
    stock: 4,
    rating: 4.6,
    reviews: 156,
    related: ['mb-z790', 'ram-32', 'cooler'],
    photos: shots('cpu-14700k.jpg', 'cpu.jpg', 'cpu-7800x3d.jpg'),
    short: '20 cores · unlocked · LGA1700',
    socket: 'LGA1700',
    needsKey: 'needsCpu14700k',
    compat: { socket: 'LGA1700', memory: 'DDR5' }
  },
  {
    id: 'gpu-4070s',
    sku: 'RTX4070S-12G',
    name: 'NVIDIA GeForce RTX 4070 Super 12 GB',
    brand: 'NVIDIA',
    kind: 'part',
    category: 'gpu',
    price: 147000,
    stock: 3,
    rating: 4.7,
    reviews: 189,
    related: ['psu-750', 'case-atx', 'monitor'],
    photos: shots('gpu.jpg', 'gpu-4070.jpg', 'gpu-7800xt.jpg'),
    short: '12 GB GDDR6X · 1440p',
    needsKey: 'needsGpu4070s',
    compat: { psuMin: 700, form: 'ATX' }
  },
  {
    id: 'gpu-7800xt',
    sku: 'RX7800XT-16G',
    name: 'AMD Radeon RX 7800 XT 16 GB',
    brand: 'AMD',
    kind: 'part',
    category: 'gpu',
    price: 125000,
    stock: 5,
    rating: 4.5,
    reviews: 132,
    related: ['psu-750', 'case-atx', 'monitor'],
    photos: shots('gpu-7800xt.jpg', 'gpu.jpg', 'gpu-4070.jpg'),
    short: '16 GB GDDR6 · 1440p',
    needsKey: 'needsGpu7800xt',
    compat: { psuMin: 700, form: 'ATX' }
  },
  {
    id: 'mb-b650',
    sku: 'B650-GAMING-WIFI',
    name: 'MSI MAG B650 Tomahawk WiFi',
    brand: 'MSI',
    kind: 'part',
    category: 'motherboard',
    price: 47500,
    stock: 8,
    rating: 4.6,
    reviews: 98,
    related: ['cpu-7800x3d', 'ram-32', 'ssd-1t'],
    photos: shots('mb.jpg', 'mb-b650.jpg', 'mb-z790.jpg'),
    short: 'AM5 · DDR5 · ATX · Wi-Fi 6E',
    socket: 'AM5',
    needsKey: 'needsMbB650',
    compat: { socket: 'AM5', memory: 'DDR5', form: 'ATX' }
  },
  {
    id: 'mb-z790',
    sku: 'Z790-GAMING-X',
    name: 'Gigabyte Z790 Gaming X AX',
    brand: 'Gigabyte',
    kind: 'part',
    category: 'motherboard',
    price: 55000,
    stock: 5,
    rating: 4.4,
    reviews: 76,
    related: ['cpu-14700k', 'ram-32', 'ssd-1t'],
    photos: shots('mb-b650.jpg', 'mb.jpg', 'mb-z790.jpg'),
    short: 'LGA1700 · DDR5 · ATX',
    socket: 'LGA1700',
    needsKey: 'needsMbZ790',
    compat: { socket: 'LGA1700', memory: 'DDR5', form: 'ATX' }
  },
  {
    id: 'ram-32',
    sku: 'CMK32GX5M2B6000C30',
    name: 'Corsair Vengeance 32 GB DDR5-6000',
    brand: 'Corsair',
    kind: 'part',
    category: 'memory',
    price: 22500,
    stock: 14,
    rating: 4.7,
    reviews: 243,
    related: ['cpu-7800x3d', 'mb-b650', 'ssd-1t'],
    photos: shots('ram.jpg', 'ram-32.jpg', 'ssd.jpg'),
    short: '2x16 GB · CL30 · DDR5',
    needsKey: 'needsRam32',
    compat: { memory: 'DDR5' }
  },
  {
    id: 'ssd-1t',
    sku: 'WD-BLACK-SN770-1TB',
    name: 'WD Black SN770 1 TB NVMe',
    brand: 'WD',
    kind: 'part',
    category: 'memory',
    price: 19900,
    stock: 11,
    rating: 4.8,
    reviews: 301,
    related: ['ram-32', 'mb-b650', 'case-atx'],
    photos: shots('ssd.jpg', 'ssd-1t.jpg', 'ram.jpg'),
    short: 'PCIe 4.0 · M.2 2280',
    needsKey: 'needsSsd1t',
    compat: {}
  },
  {
    id: 'case-atx',
    sku: 'LANCOOL-216',
    name: 'Lian Li Lancool 216 ATX',
    brand: 'Lian Li',
    kind: 'part',
    category: 'case',
    price: 24900,
    stock: 7,
    rating: 4.5,
    reviews: 87,
    related: ['psu-750', 'cooler', 'gpu-4070s'],
    photos: shots('case.jpg', 'case-atx.jpg', 'psu.jpg'),
    short: 'ATX mid-tower · mesh · 2 fans',
    needsKey: 'needsCaseAtx',
    compat: { form: 'ATX' }
  },
  {
    id: 'psu-750',
    sku: 'RM750e',
    name: 'Corsair RM750e 750W Gold',
    brand: 'Corsair',
    kind: 'part',
    category: 'case',
    price: 27500,
    stock: 9,
    rating: 4.6,
    reviews: 164,
    related: ['gpu-4070s', 'case-atx', 'cooler'],
    photos: shots('psu.jpg', 'psu-750.jpg', 'case.jpg'),
    short: 'Fully modular · 80+ Gold',
    needsKey: 'needsPsu750',
    compat: { psuWatts: 750 }
  },
  {
    id: 'cooler',
    sku: 'NH-D15',
    name: 'Noctua NH-D15 CPU cooler',
    brand: 'Noctua',
    kind: 'part',
    category: 'case',
    price: 24900,
    stock: 6,
    rating: 4.9,
    reviews: 412,
    related: ['cpu-7800x3d', 'case-atx', 'mb-b650'],
    photos: shots('cooler.jpg', 'case.jpg', 'cpu.jpg'),
    short: 'Dual-tower · AM5 & LGA1700',
    needsKey: 'needsCooler',
    compat: { socket: ['AM5', 'LGA1700'] }
  },
  {
    id: 'headset',
    sku: 'G PRO X 2',
    name: 'Logitech G Pro X 2 headset',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 32500,
    stock: 10,
    rating: 4.4,
    reviews: 178,
    related: ['mic', 'mouse', 'keyboard'],
    photos: shots('headset.jpg', 'mic.jpg', 'speakers.jpg'),
    short: 'Casque · USB / 3.5 mm · mic',
    needsKey: 'needsHeadset',
    compat: {}
  },
  {
    id: 'controller',
    sku: 'XBOX-PAD-PC',
    name: 'Xbox Wireless Controller',
    brand: 'Xbox',
    kind: 'accessory',
    category: 'accessories',
    price: 14900,
    stock: 12,
    rating: 4.7,
    reviews: 256,
    related: ['headset', 'mouse', 'keyboard'],
    photos: shots('controller.jpg', 'keyboard.jpg', 'mouse.jpg'),
    short: 'Manette · PC & Xbox',
    needsKey: 'needsController',
    compat: {}
  },
  {
    id: 'keyboard',
    sku: 'G915-TKL',
    name: 'Logitech G915 TKL keyboard',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 37500,
    stock: 4,
    rating: 4.5,
    reviews: 143,
    related: ['mouse', 'mousepad', 'headset'],
    photos: shots('keyboard.jpg', 'mouse.jpg', 'mousepad.jpg'),
    short: 'Wireless · low-profile mechanical',
    needsKey: 'needsKeyboard',
    compat: {}
  },
  {
    id: 'mouse',
    sku: 'GPX-2',
    name: 'Logitech G Pro X Superlight 2',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 32500,
    stock: 8,
    rating: 4.8,
    reviews: 389,
    related: ['mousepad', 'keyboard', 'headset'],
    photos: shots('mouse.jpg', 'mousepad.jpg', 'keyboard.jpg'),
    short: 'Wireless · 60 g · 8K polling',
    needsKey: 'needsMouse',
    compat: {}
  },
  {
    id: 'monitor',
    sku: 'XG27ACS',
    name: 'ASUS TUF VG27AQ 27" 165Hz',
    brand: 'ASUS',
    kind: 'accessory',
    category: 'accessories',
    price: 57500,
    stock: 5,
    rating: 4.6,
    reviews: 201,
    related: ['gpu-4070s', 'webcam', 'speakers'],
    photos: shots('monitor.jpg', 'webcam.jpg', 'speakers.jpg'),
    short: '27" IPS · 2560×1440 · HDMI & DP',
    needsKey: 'needsMonitor',
    compat: {}
  },
  {
    id: 'webcam',
    sku: 'C920S',
    name: 'Logitech C920s HD Pro',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 17500,
    stock: 9,
    rating: 4.3,
    reviews: 167,
    related: ['mic', 'headset', 'monitor'],
    photos: shots('webcam.jpg', 'mic.jpg', 'headset.jpg'),
    short: '1080p · stereo mics',
    needsKey: 'needsWebcam',
    compat: {}
  },
  {
    id: 'mic',
    sku: 'YETI-NANO',
    name: 'Blue Yeti Nano USB mic',
    brand: 'Blue',
    kind: 'accessory',
    category: 'accessories',
    price: 22500,
    stock: 7,
    rating: 4.5,
    reviews: 122,
    related: ['webcam', 'headset', 'speakers'],
    photos: shots('mic.jpg', 'headset.jpg', 'webcam.jpg'),
    short: 'USB · cardioid / omni',
    needsKey: 'needsMic',
    compat: {}
  },
  {
    id: 'mousepad',
    sku: 'G640',
    name: 'Logitech G640 XL mousepad',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 7500,
    stock: 18,
    rating: 4.6,
    reviews: 88,
    related: ['mouse', 'keyboard', 'headset'],
    photos: shots('mousepad.jpg', 'mouse.jpg', 'keyboard.jpg'),
    short: '460 × 400 mm · cloth',
    needsKey: 'needsMousepad',
    compat: {}
  },
  {
    id: 'speakers',
    sku: 'Z313',
    name: 'Logitech Z313 2.1 speakers',
    brand: 'Logitech',
    kind: 'accessory',
    category: 'accessories',
    price: 13900,
    stock: 0,
    rating: 4.2,
    reviews: 54,
    related: ['headset', 'mic', 'monitor'],
    photos: shots('speakers.jpg', 'headset.jpg', 'monitor.jpg'),
    short: 'Stereo + sub · 3.5 mm',
    needsKey: 'needsSpeakers',
    compat: {}
  }
]

export const PRODUCTS = [...PRODUCTS_CORE, ...EXTRA, ...DZ_EXTRA].map(ensureProductPhotos)

function firstMatch(text, rules, fallback = {}) {
  for (const [re, spec] of rules) {
    if (re.test(text)) return spec
  }
  return fallback
}

export function specOf(p) {
  if (!p) return {}
  const n = `${p.id} ${p.name} ${p.short || ''} ${p.sku || ''}`.toLowerCase()
  const c = { ...(p.compat || {}) }

  if (p.category === 'cpu') {
    return {
      ...c,
      ...firstMatch(n, [
        [/14900/, { tier: 8, tdp: 253 }],
        [/14700/, { tier: 7, tdp: 125 }],
        [/14600/, { tier: 6, tdp: 125 }],
        [/12400/, { tier: 3, tdp: 65 }],
        [/265k|ultra 7/, { tier: 7, tdp: 125 }],
        [/7800x3d/, { tier: 7, tdp: 120 }],
        [/7900/, { tier: 7, tdp: 170 }],
        [/9700/, { tier: 6, tdp: 65 }],
        [/9600/, { tier: 5, tdp: 65 }],
        [/7700/, { tier: 5, tdp: 65 }],
        [/7600/, { tier: 4, tdp: 65 }]
      ], { tier: 5, tdp: 105 })
    }
  }

  if (p.category === 'gpu') {
    return {
      ...c,
      ...firstMatch(n, [
        [/4080/, { tier: 8, tdp: 320, pcie: 16, slots: 3 }],
        [/4070\s*s|4070s/, { tier: 6, tdp: 220, pcie: 16, slots: 3 }],
        [/4070/, { tier: 6, tdp: 200, pcie: 16, slots: 2 }],
        [/4060\s*ti|4060ti/, { tier: 5, tdp: 160, pcie: 8, slots: 2 }],
        [/4060/, { tier: 4, tdp: 115, pcie: 8, slots: 2 }],
        [/7900/, { tier: 8, tdp: 315, pcie: 16, slots: 3 }],
        [/7800/, { tier: 6, tdp: 263, pcie: 16, slots: 3 }],
        [/7700/, { tier: 5, tdp: 245, pcie: 16, slots: 3 }],
        [/7600/, { tier: 4, tdp: 165, pcie: 8, slots: 2 }]
      ], { tier: 5, tdp: 180, pcie: 16, slots: 2 })
    }
  }

  if (p.category === 'motherboard') {
    return {
      ...c,
      ...firstMatch(n, [
        [/x670|x870|z790|z890/, { tier: 7, vrm: 280, pcie: 16 }],
        [/tomahawk|tuf b650|b650-plus|b650e|b850|eagle ax/, { tier: 5, vrm: 180, pcie: 16 }],
        [/b650m|b760m|prime-b760|ds3h|riptide/, { tier: 3, vrm: 120, pcie: 16 }],
        [/b650|b760/, { tier: 5, vrm: 160, pcie: 16 }]
      ], { tier: 4, vrm: 140, pcie: 16 })
    }
  }

  if (p.category === 'case' && Array.isArray(c.socket)) {
    return {
      ...c,
      ...firstMatch(n, [
        [/212/, { cool: 150, class: 'air-small' }],
        [/240|kraken|liquid|freezer/, { cool: 280, class: 'aio' }],
        [/d15|ak620|dark rock/, { cool: 250, class: 'air-big' }]
      ], { cool: 220, class: 'air' })
    }
  }

  if (c.form && !c.psuWatts && !Array.isArray(c.socket)) {
    return {
      ...c,
      ...firstMatch(n, [
        [/slim|td300|ps15/, { airflow: 1 }],
        [/mesh|flow|216|g360|pop air|cc560/, { airflow: 3 }]
      ], { airflow: 2 })
    }
  }

  return c
}

export function splitWarnings(warnings) {
  const blocks = []
  const notes = []
  warnings.forEach((w) => {
    if (w.block) blocks.push(w)
    else notes.push(w)
  })
  return { blocks, notes }
}

// P3 i18n : chaque avertissement est un objet { key, vars, block? } rendu
// par t(key, vars) — plus de texte anglais durci dans le code.
export function checkCompatibility(items) {
  const warnings = []
  const W = (key, vars, block = false) => warnings.push({ key, vars, block })
  const list = (items || []).filter(Boolean)
  const cpus = list.filter((i) => i.category === 'cpu')
  const boards = list.filter((i) => i.category === 'motherboard')
  const rams = list.filter((i) => i.compat && i.compat.memory && i.category === 'memory')
  const gpus = list.filter((i) => i.category === 'gpu')
  const psus = list.filter((i) => i.compat && i.compat.psuWatts)
  const coolers = list.filter((i) => i.category === 'case' && Array.isArray(i.compat?.socket))
  const cases = list.filter((i) => i.compat?.form && !i.compat?.psuWatts && !Array.isArray(i.compat?.socket))

  if (cpus.length && boards.length) {
    cpus.forEach((cpu) => {
      boards.forEach((board) => {
        if (cpu.compat.socket && board.compat.socket && cpu.compat.socket !== board.compat.socket) {
          W('compatSocketMismatch', { cpu: cpu.name, cpuSocket: cpu.compat.socket, board: board.name, boardSocket: board.compat.socket }, true)
        }
        const cs = specOf(cpu)
        const bs = specOf(board)
        if (cs.tdp && bs.vrm && cs.tdp > bs.vrm) {
          W('compatVrmOverheat', { cpu: cpu.name, tdp: cs.tdp, board: board.name }, true)
        } else if (cs.tdp && bs.vrm && cs.tdp > bs.vrm * 0.85) {
          W('compatVrmHot', { cpu: cpu.name, board: board.name })
        }
      })
    })
  }

  if (cpus.length && !boards.length) {
    cpus.forEach((cpu) => {
      W('compatNeedsBoard', { cpu: cpu.name, socket: cpu.compat.socket })
    })
  }

  if (boards.length && rams.length) {
    boards.forEach((board) => {
      rams.forEach((ram) => {
        if (board.compat.memory && ram.compat.memory && board.compat.memory !== ram.compat.memory) {
          W('compatRamMismatch', { ram: ram.name, ramMem: ram.compat.memory, board: board.name, boardMem: board.compat.memory }, true)
        }
      })
    })
  }

  if (gpus.length && psus.length) {
    gpus.forEach((gpu) => {
      psus.forEach((psu) => {
        if (gpu.compat.psuMin && psu.compat.psuWatts < gpu.compat.psuMin) {
          W('compatPsuWeak', { gpu: gpu.name, min: gpu.compat.psuMin, psu: psu.name, watts: psu.compat.psuWatts }, true)
        }
      })
    })
  }

  if (gpus.length && !psus.length) {
    gpus.forEach((gpu) => {
      if (gpu.compat.psuMin) W('compatNeedsPsu', { gpu: gpu.name, min: gpu.compat.psuMin })
    })
  }

  if (cpus.length && gpus.length) {
    cpus.forEach((cpu) => {
      gpus.forEach((gpu) => {
        const cs = specOf(cpu)
        const gs = specOf(gpu)
        const gap = (gs.tier || 0) - (cs.tier || 0)
        if (gap >= 3) {
          W('compatGapHigh', { gpu: gpu.name, cpu: cpu.name }, true)
        } else if (gap >= 2) {
          W('compatGapOne', { gpu: gpu.name, cpu: cpu.name })
        }
      })
    })
  }

  if (boards.length && gpus.length) {
    boards.forEach((board) => {
      gpus.forEach((gpu) => {
        const bs = specOf(board)
        const gs = specOf(gpu)
        if ((bs.tier || 0) <= 3 && (gs.tier || 0) >= 7) {
          W('compatEntryBoard', { board: board.name, gpu: gpu.name }, true)
        } else if ((bs.tier || 0) <= 3 && (gs.tier || 0) >= 6) {
          W('compatHeavyForBoard', { gpu: gpu.name, board: board.name })
        }
        if (gs.pcie === 16 && bs.pcie === 8) {
          W('compatPcieDowngrade', { gpu: gpu.name, board: board.name })
        }
      })
    })
  }

  if (cpus.length && coolers.length) {
    cpus.forEach((cpu) => {
      coolers.forEach((cooler) => {
        const cs = specOf(cpu)
        const cl = specOf(cooler)
        if (cs.tdp && cl.cool && cs.tdp > cl.cool) {
          W('compatCoolerWeak', { cpu: cpu.name, tdp: cs.tdp, cooler: cooler.name }, true)
        }
      })
    })
  } else if (cpus.length && specOf(cpus[0]).tdp >= 125) {
    W('compatNeedsCooler', { cpu: cpus[0].name })
  }

  if (gpus.length && cases.length) {
    gpus.forEach((gpu) => {
      cases.forEach((box) => {
        const gs = specOf(gpu)
        const air = specOf(box).airflow || 2
        if ((gs.tdp || 0) >= 280 && air <= 1) {
          W('compatCaseOverheat', { gpu: gpu.name, box: box.name }, true)
        } else if ((gs.tdp || 0) >= 220 && air <= 1) {
          W('compatCaseAirflow', { gpu: gpu.name, box: box.name })
        }
        if ((gs.slots || 0) >= 3 && box.compat?.form === 'mATX' && air <= 1) {
          W('compatCaseTight', { gpu: gpu.name, box: box.name }, true)
        }
      })
    })
  }

  const cpuT = cpus.reduce((s, p) => s + (specOf(p).tdp || 0), 0)
  const gpuT = gpus.reduce((s, p) => s + (specOf(p).tdp || 0), 0)
  const load = cpuT + gpuT
  if (load >= 400) {
    const air = cases[0] ? specOf(cases[0]).airflow || 2 : 0
    if (!cases.length || air <= 2) {
      W('compatTotalLoad', { load })
    }
  }

  return warnings
}

export function starText(rating) {
  const n = Math.max(0, Math.min(5, Math.round(rating)))
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`
}

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id)
}

export function relatedOf(product) {
  return (product.related || []).map(productById).filter(Boolean)
}

const BUILDER_ORDER = [
  'motherboard', 'cpu', 'ram', 'gpu', 'ssd', 'hdd', 'case', 'psu', 'cooler', 'fan', 'misc',
  'keyboard', 'mouse', 'headset', 'monitor', 'controller', 'webcam', 'mic', 'mousepad', 'speakers', 'network'
]
const BUILDER_REQUIRED = new Set(['motherboard', 'cpu', 'ram'])
const BUILDER_NEEDS_BOARD = new Set(['cpu', 'ram', 'cooler'])

export const BUILDER_SLOTS = BUILDER_ORDER.map((id) => {
  const line = PART_LINES.find((l) => l.id === id)
  return {
    key: id,
    label: line.label,
    group: line.group,
    required: BUILDER_REQUIRED.has(id),
    needsBoard: BUILDER_NEEDS_BOARD.has(id),
    pick: line.match
  }
})
