import { EXTRA } from './extraCatalog.js'
import { DZ_EXTRA, DZ_DEALS, DZ_GUIDES, PAYMENT_HINTS, WILAYAS_NEAR, DZ_BRANDS } from './dzCatalog.js'

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
  hours: 'Call or WhatsApp before you come',
  address: 'Rue Mimoune Bouadjimi, El Makari Les Castors, Oran',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=Rue+Mimoune+Bouadjimi+El+Makari+Les+Castors+Oran',
  mapEmbed: 'https://maps.google.com/maps?q=Rue%20Mimoune%20Bouadjimi%20El%20Makari%20Les%20Castors%20Oran&z=16&output=embed',
  note: 'Reserve in store. Pay in dinars at pickup.',
  warranty: '1-year shop warranty on new parts. 7-day exchange if unused with receipt.',
  ready: 'Reserved orders are prepared at the desk. WhatsApp us if you need a time.',
  about: 'PC Star Informatique is a pickup shop in El Makari Les Castors, Oran. We sell PC parts, laptops, ready PCs, USB sticks, manettes and console gear — and we repair almost anything that plugs into a PC, laptop or console. Prices in dinars, pay at the desk.',
  services: 'We fix PCs and laptops: no power, overheating, screens, keyboards, fans. We install Windows 10/11 with drivers, format, clean dust and paste, clone HDD to SSD, remove malware, and save your files. Consoles and manettes too — analog drift, HDMI, dust. Bring it in; we quote before we work. Labour stays cheap. Parts are extra if needed.',
  buyNote: 'We buy used laptops, ready PCs, flash USB, manettes and console kits in fair condition. WhatsApp photos and the price you want. Cash at the desk if we take it.'
}

export const SHOP_SERVICES = [
  { id: 'parts', title: 'PC parts', body: 'CPU, GPU, boards, RAM, SSD, cases. Price in DA, bag at the desk.' },
  { id: 'machines', title: 'Laptops & PC pret', body: 'We buy and sell laptops and ready PCs — office boxes and gamer builds. Ask for the week’s stock.' },
  { id: 'repair', title: 'Reparations', body: 'PC, laptop, console, manette. Windows install, format, dust, paste, screen, fan, no-power diagnostic. If it is a computer problem, we usually can fix it.' },
  { id: 'usb', title: 'USB, flash & console', body: 'Flash disques, USB hubs, HDMI, manettes, PS / Xbox / Switch. Honest prices, in store now.' }
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
  { id: 'hav-combo4', tag: '-10%', note: 'Rentrée · Havit 4en1' },
  { id: 'sog-mkh5', tag: 'Pack SoG', note: 'En magasin Oran' },
  { id: 'cpu-5600', tag: 'Hit DZ', note: 'AM4 encore roi' },
  { id: 'ram-32', tag: '-12%', note: 'DDR5 semaine' },
  { id: 'ssd-1t', tag: 'Hot', note: 'NVMe en stock' },
  { id: 'tw-ssd-512', tag: 'Budget', note: 'Twinmos 512' }
]

export const GUIDES = [
  {
    id: 'dz-budget',
    title: 'Budget étudiant DZ',
    body: 'Ryzen 5 5600 + B450 + 16 Go Magma + SSD Twinmos 512. Spirit of Gamer Ghost 5 ou Havit combo pour le desk. On vérifie au comptoir avant paiement.'
  },
  {
    id: 'dz-sog',
    title: 'Spirit of Gamer & Havit',
    body: 'Marques très présentes en Algérie (LICB+, Campus, Digitec…). Packs 4en1, boîtiers Ghost, casques Elite — bon rapport DA / perf pour Oran.'
  },
  {
    id: 'am5',
    title: 'AM5 starter',
    body: '7800X3D + B650 + 32 Go DDR5. Le desk vérifie le socket avant paiement.'
  },
  {
    id: 'fix',
    title: 'Réparation PC & laptop',
    body: 'Windows, poussière, pâte, écran, ventilo, no-power. Console et manette aussi. Devis au comptoir — main-d’œuvre légère.'
  },
  {
    id: 'desk',
    title: 'Retrait El Makari',
    body: 'Panier → créneau → code PS au comptoir Les Castors, Oran. Espèces, CCP ou BaridiMob. 3x dès 30 000 DA.'
  }
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
    { name: 'Yacine M.', city: 'Oran', stars: 5, text: 'Picked up same day. Runs cool with the NH-D15 we took with it.' },
    { name: 'Lina B.', city: 'Oran', stars: 5, text: 'Best CPU here for 1440p. Desk confirmed the AM5 board.' }
  ],
  'cpu-14700k': [
    { name: 'Karim T.', city: 'Blida', stars: 5, text: 'Unlocked and fast. Needed the Z790 — they had it in the next aisle.' },
    { name: 'Sofia R.', city: 'Oran', stars: 4, text: 'Warm under load. The Noctua cooler they suggested fixed it.' }
  ],
  'gpu-4070s': [
    { name: 'Nabil H.', city: 'Oran', stars: 5, text: '1440p ultra in store demo. Paid in 3x at the desk.' },
    { name: 'Amira K.', city: 'Tizi Ouzou', stars: 4, text: 'Card is long. Lancool 216 fits. Ask them to measure.' }
  ],
  'gpu-7800xt': [
    { name: 'Riad S.', city: 'Constantine', stars: 5, text: '16 GB helps. Cheaper than the 4070 Super this month.' },
    { name: 'Ines D.', city: 'Oran', stars: 4, text: 'Needs the 750W. They would not sell it with a weaker PSU.' }
  ],
  'mb-b650': [
    { name: 'Mehdi A.', city: 'Oran', stars: 5, text: 'Wi-Fi worked out of the box. BIOS already AM5-ready.' }
  ],
  'ram-32': [
    { name: 'Yanis C.', city: 'Oran', stars: 5, text: 'Deal of the week. EXPO 6000 on the B650, no drama.' }
  ],
  'headset': [
    { name: 'Sara M.', city: 'Oran', stars: 4, text: 'Casque is comfortable. Mic is fine for Discord.' }
  ],
  'mouse': [
    { name: 'Anis B.', city: 'Setif', stars: 5, text: 'Light and clean. Took the G640 pad with it.' }
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
    needs: 'Needs an AM5 motherboard and DDR5 RAM.',
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
    needs: 'Needs an LGA1700 motherboard (Z790 / B760) and DDR5 RAM.',
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
    needs: 'Needs a 700W+ PSU and an ATX case with room for a 3-slot card.',
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
    needs: 'Needs a 700W+ PSU and an ATX case.',
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
    needs: 'Works with AM5 CPUs (Ryzen 7000/9000) and DDR5 RAM only.',
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
    needs: 'Works with 12th/13th/14th-gen Intel CPUs and DDR5 RAM only.',
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
    needs: 'DDR5 kit. Will not work on DDR4 motherboards.',
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
    needs: 'Fits any M.2 2280 slot (AMD or Intel).',
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
    needs: 'Fits ATX / mATX motherboards and long GPUs.',
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
    needs: '750W is enough for a 4070 Super or 7800 XT build.',
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
    needs: 'Fits AM5 and LGA1700. Check case height (165 mm).',
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
    needs: 'Works on PC out of the box. No extra parts needed.',
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
    needs: 'Plug-and-play on Windows via USB-C or Bluetooth.',
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
    needs: 'PC accessory. No compatibility with CPU/motherboard.',
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
    needs: 'PC accessory. Pairs with the XL mousepad we stock.',
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
    needs: 'Needs HDMI or DisplayPort from the GPU.',
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
    needs: 'USB webcam. Works on any PC.',
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
    needs: 'USB microphone. No extra interface needed.',
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
    needs: 'Desk accessory. In stock.',
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
    needs: 'Currently out of stock. Ask the desk for the next lot.',
    compat: {}
  }
]

export const PRODUCTS = [...PRODUCTS_CORE, ...EXTRA, ...DZ_EXTRA]

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
    if (w.startsWith('BLOCK:')) blocks.push(w.replace(/^BLOCK:\s*/, ''))
    else notes.push(w)
  })
  return { blocks, notes }
}

export function checkCompatibility(items) {
  const warnings = []
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
          warnings.push(`BLOCK: ${cpu.name} needs ${cpu.compat.socket}. ${board.name} is ${board.compat.socket}. They will not work together.`)
        }
        const cs = specOf(cpu)
        const bs = specOf(board)
        if (cs.tdp && bs.vrm && cs.tdp > bs.vrm) {
          warnings.push(`BLOCK: ${cpu.name} (${cs.tdp}W) will overheat the VRM on ${board.name}. Pick a higher-end board.`)
        } else if (cs.tdp && bs.vrm && cs.tdp > bs.vrm * 0.85) {
          warnings.push(`${cpu.name} pushes the VRM on ${board.name}. Risk of surchauffe under load.`)
        }
      })
    })
  }

  if (cpus.length && !boards.length) {
    cpus.forEach((cpu) => {
      warnings.push(`${cpu.name} needs a ${cpu.compat.socket} motherboard.`)
    })
  }

  if (boards.length && rams.length) {
    boards.forEach((board) => {
      rams.forEach((ram) => {
        if (board.compat.memory && ram.compat.memory && board.compat.memory !== ram.compat.memory) {
          warnings.push(`BLOCK: ${ram.name} is ${ram.compat.memory}. ${board.name} only takes ${board.compat.memory}.`)
        }
      })
    })
  }

  if (gpus.length && psus.length) {
    gpus.forEach((gpu) => {
      psus.forEach((psu) => {
        if (gpu.compat.psuMin && psu.compat.psuWatts < gpu.compat.psuMin) {
          warnings.push(`BLOCK: ${gpu.name} wants ${gpu.compat.psuMin}W+. ${psu.name} is ${psu.compat.psuWatts}W.`)
        }
      })
    })
  }

  if (gpus.length && !psus.length) {
    gpus.forEach((gpu) => {
      if (gpu.compat.psuMin) warnings.push(`${gpu.name} needs a ${gpu.compat.psuMin}W+ power supply.`)
    })
  }

  if (cpus.length && gpus.length) {
    cpus.forEach((cpu) => {
      gpus.forEach((gpu) => {
        const cs = specOf(cpu)
        const gs = specOf(gpu)
        const gap = (gs.tier || 0) - (cs.tier || 0)
        if (gap >= 3) {
          warnings.push(`BLOCK: ${gpu.name} is too high gamme for ${cpu.name}. The CPU will bottleneck hard and the GPU will run hot for nothing.`)
        } else if (gap >= 2) {
          warnings.push(`${gpu.name} is a class above ${cpu.name}. Expect a CPU bottleneck in games.`)
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
          warnings.push(`BLOCK: ${board.name} is an entry board. ${gpu.name} is too high gamme — VRM heat, tight PCIe clearance, and extra surchauffe.`)
        } else if ((bs.tier || 0) <= 3 && (gs.tier || 0) >= 6) {
          warnings.push(`${gpu.name} is heavy for ${board.name}. Prefer a B650 / Z790 ATX board.`)
        }
        if (gs.pcie === 16 && bs.pcie === 8) {
          warnings.push(`${gpu.name} wants x16. ${board.name} runs x8 — slower, more heat.`)
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
          warnings.push(`BLOCK: ${cpu.name} (${cs.tdp}W) will surchauffe with ${cooler.name}. Need a dual-tower or 240 AIO.`)
        }
      })
    })
  } else if (cpus.length && specOf(cpus[0]).tdp >= 125) {
    warnings.push(`${cpus[0].name} needs a proper cooler. Stock / small air will surchauffe.`)
  }

  if (gpus.length && cases.length) {
    gpus.forEach((gpu) => {
      cases.forEach((box) => {
        const gs = specOf(gpu)
        const air = specOf(box).airflow || 2
        if ((gs.tdp || 0) >= 280 && air <= 1) {
          warnings.push(`BLOCK: ${gpu.name} in ${box.name} will overheat. Need a mesh ATX case.`)
        } else if ((gs.tdp || 0) >= 220 && air <= 1) {
          warnings.push(`${gpu.name} has little airflow in ${box.name}. Risk of surchauffe.`)
        }
        if ((gs.slots || 0) >= 3 && box.compat?.form === 'mATX' && air <= 1) {
          warnings.push(`BLOCK: ${gpu.name} is a thick card. ${box.name} is too tight.`)
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
      warnings.push(`CPU+GPU ~${load}W. This setup can surchauffe. Mesh case + dual-tower or 240 AIO.`)
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

export const COMPARE_FIELDS = [
  { key: 'sku', label: 'SKU', value: (p) => p.sku },
  { key: 'brand', label: 'Brand', value: (p) => p.brand },
  { key: 'kind', label: 'Type', value: (p) => ({ part: 'PC part', accessory: 'Accessory', machine: 'Laptop / PC', service: 'Repair' }[p.kind] || p.kind) },
  { key: 'category', label: 'Category', value: (p) => CATEGORIES.find((c) => c.id === p.category)?.label || p.category },
  { key: 'price', label: 'Price', value: (p) => money(p.price) },
  { key: 'pay3x', label: '3x at desk', value: (p) => (p.price >= 30000 ? `${third(p.price)} × 3` : 'Cash / card') },
  { key: 'rating', label: 'Rating', value: (p) => `${p.rating.toFixed(1)} · ${p.reviews} reviews` },
  { key: 'stock', label: 'In store', value: (p) => (p.stock > 0 ? `${p.stock}` : 'Out of stock') },
  { key: 'socket', label: 'Socket', value: (p) => (Array.isArray(p.compat?.socket) ? p.compat.socket.join(' / ') : p.compat?.socket || '—') },
  { key: 'memory', label: 'Memory', value: (p) => p.compat?.memory || '—' },
  { key: 'psu', label: 'PSU', value: (p) => (p.compat?.psuWatts ? `${p.compat.psuWatts}W` : p.compat?.psuMin ? `${p.compat.psuMin}W min` : '—') },
  { key: 'form', label: 'Form', value: (p) => p.compat?.form || '—' },
  { key: 'needs', label: 'Needs', value: (p) => p.needs }
]
