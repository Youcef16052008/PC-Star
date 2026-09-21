// LOT P1 (B11) : les listes de compatibilité peuvent être des tableaux ;
// rendu et recoupement passent par `src/productMeta.js` (une seule règle).
import { compatIntersects, compatLabel, compatValues } from './productMeta.js'
import { EXTRA } from './extraCatalog.js'
import { DZ_EXTRA, DZ_GUIDES, WILAYAS_NEAR, DZ_BRANDS } from './dzCatalog.js'
import { CATALOG_EXTENSIONS } from './catalogExtensions.js'
import { ensureProductPhotos } from './productPhotos.js'

export { DZ_GUIDES, WILAYAS_NEAR, DZ_BRANDS }

export const STORE = {
  name: 'PC Star Informatique',
  short: 'PC Star',
  phone: '0770 65 03 87',
  phoneHref: 'tel:+213770650387',
  phone2: '0669 17 46 17',
  phone2Href: 'tel:+213669174617',
  whatsapp: '213770650387',
  // P20 : le second numéro (06…) est tout aussi important que le premier.
  // Les deux reçoivent les notifications de commande et les deux sont
  // proposés en bouton WhatsApp sur la page « À propos ».
  whatsapp2: '213669174617',
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

/**
 * P20 — Les numéros WhatsApp du magasin, dans l'ordre d'affichage.
 *
 * Source unique : le serveur (notifications de commande) et le front (boutons)
 * lisent la même liste, donc ajouter un troisième numéro ne demande qu'une
 * ligne ici. Format international sans « + » — c'est ce qu'exige `wa.me`
 * (P14 #3 : un numéro local en `0…` donne un lien mort).
 */
export const STORE_WHATSAPP = [
  { number: STORE.whatsapp, label: STORE.phone },
  { number: STORE.whatsapp2, label: STORE.phone2 }
].filter((n) => n.number && /^\d{8,15}$/.test(n.number))

export const SHOP_SERVICES = [
  { id: 'parts', titleKey: 'svcPartsTitle', bodyKey: 'svcPartsBody' },
  { id: 'machines', titleKey: 'svcMachinesTitle', bodyKey: 'svcMachinesBody' },
  { id: 'repair', titleKey: 'svcRepairTitle', bodyKey: 'svcRepairBody' },
  { id: 'usb', titleKey: 'svcUsbTitle', bodyKey: 'svcUsbBody' }
]

export const STORE_LINKS = [
  { id: 'instagram', label: 'Instagram', sub: '@pcstar31', href: 'https://www.instagram.com/pcstar31/' },
  { id: 'facebook', label: 'Facebook', sub: 'PC Star Informatique', href: 'https://www.facebook.com/pcstar31' },
  // P20 : deux boutons WhatsApp, un par numéro du magasin.
  { id: 'whatsapp', label: 'WhatsApp', sub: STORE.phone, href: `https://wa.me/${STORE.whatsapp}` },
  { id: 'whatsapp2', css: 'whatsapp', label: 'WhatsApp', sub: STORE.phone2, href: `https://wa.me/${STORE.whatsapp2}` },
  // P22 (bug F) : sous-titre traduit via subKey (ar/fr/en).
  { id: 'maps', label: 'Google Maps', subKey: 'storeMapSub', sub: 'Les Castors, Oran', href: 'https://www.google.com/maps/search/?api=1&query=Rue+Mimoune+Bouadjimi+El+Makari+Les+Castors+Oran' }
]

// LOT 8.8 (A8) : le formatage des prix vit dans `src/format.js` — UNE seule
// définition, locale dérivée de la langue. Ré-exporté ici parce que huit
// modules importent `money` depuis `./data.js` : les appelants ne changent pas,
// mais il n'existe plus de seconde définition à faire diverger (l'ancien
// `money()` figeait `fr-DZ` quelle que soit la langue).
export { money } from './format.js'

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

// Les catégories sont la source de vérité du catalogue, du filtre d'accueil
// et du formulaire administrateur. Les rayons étendus correspondent à la
// structure observée chez les grandes boutiques informatiques locales : ils
// permettent de ranger un produit sans le rendre introuvable.
export const CATEGORIES = [
  { id: 'all', label: 'Tout le catalogue' },
  { id: 'cpu', label: 'CPU' },
  { id: 'gpu', label: 'GPU' },
  { id: 'motherboard', label: 'Carte mère' },
  { id: 'memory', label: 'RAM, SSD & HDD' },
  { id: 'case', label: 'Boîtier & alimentation' },
  { id: 'cooling', label: 'Refroidissement' },
  { id: 'laptop', label: 'PC portables' },
  { id: 'desktop', label: 'PC de bureau & mini PC' },
  { id: 'allinone', label: 'PC tout-en-un' },
  { id: 'tablet', label: 'Tablettes' },
  { id: 'server', label: 'Serveurs' },
  { id: 'ready', label: 'PC prêts' },
  { id: 'printer', label: 'Imprimantes' },
  { id: 'scanner', label: 'Scanners' },
  { id: 'pos', label: 'POS & code-barres' },
  { id: 'consumables', label: 'Toners, encres & papier' },
  { id: 'network', label: 'Réseau & Wi‑Fi' },
  { id: 'power', label: 'Onduleurs & électricité' },
  { id: 'laptop_accessories', label: 'Accessoires laptop' },
  { id: 'multimedia', label: 'Multimédia & création' },
  { id: 'furniture', label: 'Mobilier informatique' },
  { id: 'phone', label: 'Téléphonie & énergie mobile' },
  { id: 'usb', label: 'USB & flash' },
  { id: 'console', label: 'Consoles' },
  { id: 'repair', label: 'Réparations' },
  { id: 'accessories', label: 'Accessoires PC' }
]

export const PRODUCT_CONDITIONS = [
  { id: 'new', labelKey: 'conditionNew' },
  { id: 'used', labelKey: 'conditionUsed' },
  { id: 'refurbished', labelKey: 'conditionRefurbished' }
]

export const PRODUCT_USES = [
  { id: 'student', labelKey: 'useStudent' },
  { id: 'office', labelKey: 'useOffice' },
  { id: 'business', labelKey: 'useBusiness' },
  { id: 'gaming', labelKey: 'useGaming' },
  { id: 'creative', labelKey: 'useCreative' },
  { id: 'retail', labelKey: 'useRetail' }
]

export const PRODUCT_CONDITION_IDS = PRODUCT_CONDITIONS.map((c) => c.id)
export const PRODUCT_USE_IDS = PRODUCT_USES.map((u) => u.id)

function hay(p) {
  return `${p.name} ${p.short || ''} ${p.id}`.toLowerCase()
}

/** État sûr pour les références historiques qui n'avaient pas encore ce champ. */
export function conditionOf(product) {
  const explicit = product?.condition
  if (PRODUCT_CONDITION_IDS.includes(explicit)) return explicit
  const text = hay(product || {})
  if (/reconditionn[eé]|refurbished/.test(text)) return 'refurbished'
  if (/occasion|\bused\b|\boccas\b/.test(text)) return 'used'
  return 'new'
}

/** Usages normalisés ; les produits historiques sans usage restent visibles sans filtre. */
export function usesOf(product) {
  return Array.isArray(product?.uses) ? product.uses.filter((u) => PRODUCT_USE_IDS.includes(u)) : []
}

export function isKnownCondition(value) {
  return PRODUCT_CONDITION_IDS.includes(typeof value === 'string' ? value : '')
}

export function isKnownUse(value) {
  return PRODUCT_USE_IDS.includes(typeof value === 'string' ? value : '')
}

const byCategory = (...categories) => (p) => categories.includes(p.category)
const byCondition = (...conditions) => (p) => conditions.includes(conditionOf(p))
const hasUse = (use) => (p) => usesOf(p).includes(use)
const tagged = (tag) => (p) => (p.tags || []).includes(tag)

export const PART_LINES = [
  // Explorer
  { id: 'all', label: 'Tout', group: 'catalog', match: () => true },

  // Composants PC
  { id: 'cpu', label: 'CPU', group: 'parts', match: byCategory('cpu') },
  { id: 'motherboard', label: 'Carte mère', group: 'parts', match: byCategory('motherboard') },
  { id: 'gpu', label: 'GPU', group: 'parts', match: byCategory('gpu') },
  { id: 'ram', label: 'RAM', group: 'parts', match: (p) => p.category === 'memory' && p.compat?.memory },
  { id: 'ssd', label: 'SSD', group: 'parts', match: (p) => p.category === 'memory' && !p.compat?.memory && !/hdd/.test(hay(p)) },
  { id: 'hdd', label: 'HDD', group: 'parts', match: (p) => p.category === 'memory' && /hdd/.test(hay(p)) },
  { id: 'case', label: 'Boîtier', group: 'parts', match: (p) => p.category === 'case' && p.compat?.form },
  { id: 'psu', label: 'Alimentation', group: 'parts', match: (p) => Boolean(p.compat?.psuWatts) },
  { id: 'cooler', label: 'Refroidissement', group: 'parts', match: byCategory('cooling') },
  { id: 'fan', label: 'Ventilateurs', group: 'parts', match: (p) => p.category === 'case' && /fan/.test(hay(p)) && !Array.isArray(p.compat?.socket) && !p.compat?.form && !p.compat?.psuWatts },
  // Les deux ids ci-dessous restent aussi des emplacements facultatifs du
  // configurateur PC ; ils sont enrichis sans casser les anciennes configs.
  { id: 'misc', label: 'Câbles & pâte', group: 'parts', match: (p) => p.category === 'case' && /paste|pâte|cable|câble|nt-h2/.test(hay(p)) },
  { id: 'components_used', label: 'Composants occasion', group: 'parts', match: (p) => ['cpu', 'gpu', 'motherboard', 'memory', 'case', 'cooling'].includes(p.category) && byCondition('used', 'refurbished')(p) },

  // Ordinateurs
  { id: 'laptop', label: 'PC portables neufs', group: 'machines', match: (p) => p.category === 'laptop' && conditionOf(p) === 'new' },
  { id: 'laptop_used', label: 'Laptops occasion', group: 'machines', match: (p) => p.category === 'laptop' && byCondition('used', 'refurbished')(p) },
  { id: 'laptop_student', label: 'Laptops étudiant', group: 'machines', match: (p) => p.category === 'laptop' && hasUse('student')(p) },
  { id: 'laptop_business', label: 'Laptops pro', group: 'machines', match: (p) => p.category === 'laptop' && hasUse('business')(p) },
  { id: 'laptop_gaming', label: 'Laptops gaming', group: 'machines', match: (p) => p.category === 'laptop' && hasUse('gaming')(p) },
  { id: 'ready', label: 'PC prêts', group: 'machines', match: byCategory('ready') },
  { id: 'desktop', label: 'PC de marque', group: 'machines', match: byCategory('desktop') },
  { id: 'mini_pc', label: 'Mini PC', group: 'machines', match: (p) => p.category === 'desktop' && tagged('mini')(p) },
  { id: 'allinone', label: 'Tout-en-un', group: 'machines', match: byCategory('allinone') },
  { id: 'tablet', label: 'Tablettes', group: 'machines', match: byCategory('tablet') },
  { id: 'workstation', label: 'Workstations', group: 'machines', match: (p) => p.category === 'desktop' && tagged('workstation')(p) },
  { id: 'server', label: 'Serveurs', group: 'machines', match: byCategory('server') },
  { id: 'pc_used', label: 'PC occasion', group: 'machines', match: (p) => ['desktop', 'ready', 'allinone'].includes(p.category) && byCondition('used', 'refurbished')(p) },

  // Imprimantes et commerces
  { id: 'printer_laser', label: 'Imprimantes laser', group: 'printing', match: (p) => p.category === 'printer' && !tagged('thermal')(p) && !tagged('label')(p) && !tagged('matrix')(p) && !/ecotank|smart tank/.test(hay(p)) },
  { id: 'printer_ink', label: 'Jet d’encre', group: 'printing', match: (p) => p.category === 'printer' && /ecotank|smart tank|jet d.encre/.test(hay(p)) },
  { id: 'printer_thermal', label: 'Tickets thermiques', group: 'printing', match: (p) => p.category === 'printer' && tagged('thermal')(p) },
  { id: 'printer_label', label: 'Étiquettes & code-barres', group: 'printing', match: (p) => p.category === 'printer' && tagged('label')(p) },
  { id: 'printer_matrix', label: 'Imprimantes matricielles', group: 'printing', match: (p) => p.category === 'printer' && tagged('matrix')(p) },
  { id: 'scanner', label: 'Scanners', group: 'printing', match: byCategory('scanner') },
  { id: 'pos', label: 'POS & caisse', group: 'printing', match: byCategory('pos') },
  { id: 'toner', label: 'Toners', group: 'printing', match: (p) => p.category === 'consumables' && tagged('toner')(p) },
  { id: 'ink', label: 'Encres & cartouches', group: 'printing', match: (p) => p.category === 'consumables' && tagged('ink')(p) },
  { id: 'paper', label: 'Papier & rouleaux', group: 'printing', match: (p) => p.category === 'consumables' && tagged('paper')(p) },

  // Périphériques et accessoires laptop
  { id: 'keyboard', label: 'Claviers', group: 'peripherals', match: (p) => p.category === 'accessories' && /keyboard|clavier|apex|huntsman|alloy/.test(hay(p)) },
  { id: 'mouse', label: 'Souris', group: 'peripherals', match: (p) => p.category === 'accessories' && /mouse|souris|viper|rival|haste/.test(hay(p)) && !/pad/.test(hay(p)) },
  { id: 'headset', label: 'Casques', group: 'peripherals', match: (p) => p.category === 'accessories' && /headset|casque|arctis|blackshark|cloud|g pro x 2/.test(hay(p)) },
  { id: 'monitor', label: 'Écrans', group: 'peripherals', match: (p) => (p.category === 'accessories' && /monitor|écran|ecran|27"|24"/.test(hay(p))) },
  { id: 'controller', label: 'Manettes', group: 'peripherals', match: (p) => p.category === 'accessories' && /controller|manette|xbox|dualsense|dualshock|8bitdo/.test(hay(p)) },
  { id: 'webcam', label: 'Webcams', group: 'peripherals', match: (p) => p.category === 'accessories' && /webcam|brio|c920/.test(hay(p)) },
  { id: 'mic', label: 'Microphones', group: 'peripherals', match: (p) => p.category === 'accessories' && /mic|yeti/.test(hay(p)) && !/casque|headset/.test(hay(p)) },
  { id: 'mousepad', label: 'Tapis souris', group: 'peripherals', match: (p) => p.category === 'accessories' && /pad|qck|g640/.test(hay(p)) },
  { id: 'speakers', label: 'Enceintes', group: 'peripherals', match: (p) => p.category === 'accessories' && /speaker/.test(hay(p)) },
  { id: 'laptop_accessories', label: 'Accessoires laptop', group: 'peripherals', match: byCategory('laptop_accessories') },
  { id: 'laptop_charger', label: 'Chargeurs laptop', group: 'peripherals', match: (p) => p.category === 'laptop_accessories' && /chargeur/.test(hay(p)) },
  { id: 'laptop_bag', label: 'Sacs & housses', group: 'peripherals', match: (p) => p.category === 'laptop_accessories' && /sac|housse/.test(hay(p)) },
  { id: 'laptop_cooling', label: 'Refroidisseurs laptop', group: 'peripherals', match: (p) => p.category === 'laptop_accessories' && /refroid|cool/.test(hay(p)) },

  // Réseau et énergie
  // `network` reste dans le configurateur comme accessoire facultatif ; son
  // raccourci couvre maintenant le rayon complet au lieu de seulement deux routeurs.
  { id: 'network', label: 'Réseau', group: 'networking', match: byCategory('network') },
  { id: 'router', label: 'Routeurs & Wi‑Fi', group: 'networking', match: (p) => p.category === 'network' && /routeur|wifi|wi‑fi/.test(hay(p)) },
  { id: 'network_repeater', label: 'Répéteurs & points d’accès', group: 'networking', match: (p) => p.category === 'network' && /répéteur|point d.accès/.test(hay(p)) },
  { id: 'network_switch', label: 'Switchs réseau', group: 'networking', match: (p) => p.category === 'network' && /switch/.test(hay(p)) },
  { id: 'network_adapter', label: 'Adaptateurs réseau', group: 'networking', match: (p) => p.category === 'network' && /adaptateur|carte réseau/.test(hay(p)) },
  { id: 'network_cable', label: 'Câbles réseau & CPL', group: 'networking', match: (p) => p.category === 'network' && /câble|cable|cpl/.test(hay(p)) },
  { id: 'ups', label: 'Onduleurs', group: 'networking', match: (p) => p.category === 'power' && /onduleur|ups/.test(hay(p)) },
  { id: 'ups_battery', label: 'Batteries onduleur', group: 'networking', match: (p) => p.category === 'power' && /batterie/.test(hay(p)) },
  { id: 'power_strip', label: 'Multiprises & parafoudre', group: 'networking', match: (p) => p.category === 'power' && /multiprise|parafoudre/.test(hay(p)) },

  // Multimédia, mobilité et mobilier
  { id: 'multimedia', label: 'Multimédia & création', group: 'lifestyle', match: byCategory('multimedia') },
  { id: 'projector', label: 'Vidéoprojecteurs', group: 'lifestyle', match: (p) => p.category === 'multimedia' && /vidéoprojecteur|projecteur/.test(hay(p)) },
  { id: 'creative', label: 'Création & streaming', group: 'lifestyle', match: (p) => p.category === 'multimedia' && (hasUse('creative')(p) || hasUse('business')(p)) },
  { id: 'phone', label: 'Téléphonie & power bank', group: 'lifestyle', match: byCategory('phone') },
  { id: 'furniture', label: 'Mobilier informatique', group: 'lifestyle', match: byCategory('furniture') },
  { id: 'chairs', label: 'Chaises PC', group: 'lifestyle', match: (p) => p.category === 'furniture' && /chaise|siège|fauteuil/.test(hay(p)) },
  { id: 'desks', label: 'Bureaux & supports', group: 'lifestyle', match: (p) => p.category === 'furniture' && /bureau|support|bras/.test(hay(p)) },
  { id: 'usb', label: 'USB & flash', group: 'lifestyle', match: byCategory('usb') },
  { id: 'console', label: 'Consoles', group: 'lifestyle', match: byCategory('console') },
  { id: 'repair', label: 'Réparations', group: 'lifestyle', match: byCategory('repair') },

  // Raccourci transversal : état occasion/reconditionné, tous rayons confondus.
  { id: 'deals', label: 'Occasion & bonnes affaires', group: 'deals', match: (p) => byCondition('used', 'refurbished')(p) || tagged('budget')(p) }
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

/**
 * LOT 8.10 (A10) — les valeurs autorisées pour `category` et `kind`, et une
 * seule fois.
 *
 * Avant ce correctif, `createProduct` (`server/masterApi.js`) acceptait
 * n'importe quelle chaîne : `category: "SSD"` (un libellé, pas un id) ou
 * `category: "ssd"` (cet id n'existe pas — le catalogue utilise `memory`)
 * étaient enregistrés tels quels. Le produit apparaissait dans le panneau
 * master mais dans **aucun** filtre de la vitrine (`App.jsx` compare
 * `p.category === category`), dans aucune ligne de `PART_LINES` (toutes les
 * fonctions `match` testent des ids précis) et jamais dans le Builder
 * (`slot.pick` filtre par catégorie) : invendable par navigation, trouvable
 * seulement par recherche texte, avec un libellé retombant sur l'id brut.
 *
 * `sanitizeProductPatch` validait déjà `category` — mais contre un ensemble
 * dérivé de `PRODUCTS` (`new Set(PRODUCTS.map(p => p.category))`), pas contre
 * `CATEGORIES`. Les deux ensembles sont identiques aujourd'hui (vérifié par
 * test), mais la liste du formulaire master est `CATEGORIES` : c'est elle, la
 * source de vérité. Une catégorie sans produit de base serait sinon
 * impossible à utiliser alors que le formulaire la propose.
 *
 * `all` est exclu des deux listes : c'est une valeur de **filtre**
 * (« Everything »), pas une classification de produit.
 */
export const CATEGORY_IDS = CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id)
export const KIND_IDS = KINDS.filter((k) => k.id !== 'all').map((k) => k.id)

const CATEGORY_ID_SET = new Set(CATEGORY_IDS)
const KIND_ID_SET = new Set(KIND_IDS)

/**
 * Comparaison **exacte** : aucune normalisation silencieuse (ni casse, ni
 * espaces). Le principe du lot est de dire au maître quoi saisir plutôt que de
 * deviner — un `400 { error: 'category' }` explicite, pas une correction muette
 * qui range le produit là où personne ne le cherchera.
 */
export function isKnownCategory(value) {
  return CATEGORY_ID_SET.has(typeof value === 'string' ? value : '')
}

export function isKnownKind(value) {
  return KIND_ID_SET.has(typeof value === 'string' ? value : '')
}

/**
 * `kind` par défaut d'après la catégorie — la règle que le mode local
 * (`shopStore.addProduct`) appliquait déjà de son côté, et que le serveur
 * ignorait (il posait `'part'` systématiquement). Un produit `repair` créé via
 * l'API était donc `kind: 'part'` alors que le même produit créé hors ligne
 * était `kind: 'service'`, et que le catalogue de base classe ses réparations
 * en `service`. Même règle des deux côtés, désormais.
 */
export function kindForCategory(category) {
  if (category === 'repair') return 'service'
  if (['laptop', 'desktop', 'allinone', 'tablet', 'server', 'ready'].includes(category)) return 'machine'
  if (['accessories', 'usb', 'console', 'printer', 'scanner', 'pos', 'consumables', 'network', 'power', 'laptop_accessories', 'multimedia', 'furniture', 'phone'].includes(category)) return 'accessory'
  return 'part'
}

// LOT P3 (B25) : `BRANDS` (67 marques « curatées », aucune lecture dans le code)
// a été retiré : la vitrine dresse ses puces sur `BRANDS_DZ_PRIORITY` croisée
// avec les marques réellement en rayon, et la recherche les déduit du catalogue.



export const SOCKETS = ['AM4', 'AM5', 'LGA1700', 'LGA1851']

// LOT P25 (S6) : `PRICE_PRESETS` (six tranches de prix) est parti avec le filtre
// qu'il servait — le client tape désormais ses deux bornes (100 DA … 10 000 000 DA,
// `src/priceRange.js`). Six tranches décidées par le magasin ne savent pas dire
// « entre 42 000 et 137 000 ».

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
    category: 'cooling',
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

// Les anciennes références n'avaient pas encore forcément l'état/usage ; on
// les normalise ici afin que les nouveaux filtres restent fiables avec tout le
// catalogue, pas seulement avec les nouveaux rayons.
export const PRODUCTS = [...PRODUCTS_CORE, ...EXTRA, ...DZ_EXTRA, ...CATALOG_EXTENSIONS].map((product) =>
  ensureProductPhotos({
    ...product,
    condition: conditionOf(product),
    uses: usesOf(product),
    warrantyMonths: Number.isFinite(Number(product.warrantyMonths)) ? Math.max(0, Math.floor(Number(product.warrantyMonths))) : 0
  })
)

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

  if (p.category === 'cooling' && Array.isArray(c.socket)) {
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

/**
 * Phase 6 — compatibilité boîtier ↔ carte mère, UNE définition partagée par le
 * configurateur et les tests. Une carte mATX tient partout ; une carte ATX
 * exige un boîtier ATX (ou de même format). Un boîtier sans format déclaré est
 * exclu dès que la carte impose une contrainte : ne pas promettre ce qu'on ne
 * peut pas vérifier.
 */
export function caseFitsBoard(box, board) {
  const form = board?.compat?.form
  if (!form) return true
  // LOT P1 (B11) : `form` peut être une liste (« cette carte tient en ATX et
  // mATX »). Une carte mATX dans la liste tient partout ; sinon il suffit
  // qu'un format déclaré par la carte soit déclaré par le boîtier.
  if (compatValues(form).includes('mATX')) return true
  const boxForms = compatValues(box?.compat?.form)
  return boxForms.includes('ATX') || compatIntersects(box?.compat?.form, form)
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
/**
 * P17 (rapport #5) : deux sockets sont compatibles s'ils se recoupent.
 * Tolère le mélange string / tableau (les ventirads du catalogue ont déjà
 * `compat.socket` en tableau). Aucun CPU ni carte mère n'est concerné
 * aujourd'hui — c'est une garde, pas un correctif de données.
 */
export function socketsMatch(a, b) {
  if (!a || !b) return false
  const list = (v) => (Array.isArray(v) ? v.map(String) : [String(v)])
  return list(a).some((x) => list(b).includes(x))
}

export function checkCompatibility(items) {
  const warnings = []
  const W = (key, vars, block = false) => warnings.push({ key, vars, block })
  const list = (items || []).filter(Boolean)
  const cpus = list.filter((i) => i.category === 'cpu')
  const boards = list.filter((i) => i.category === 'motherboard')
  // LOT P2 (B10) : `i.compat && i.compat.memory` ne protégeait que la moitié du
  // chemin — `compat: null` passe `i.compat &&` mais casse à `compatValues` en
  // aval. Le chaînage court est la seule écriture qui tolère l'absence, la
  // valeur vide et le champ jamais posé, sans dupliquer la garde.
  const rams = list.filter((i) => i.compat?.memory && i.category === 'memory')
  const gpus = list.filter((i) => i.category === 'gpu')
  const psus = list.filter((i) => i.compat?.psuWatts)
  // LOT P1 (B11) : le repère « est-ce un ventirad ? » n'est plus le TYPE de la
  // donnée (tableau) mais la présence de sockets — un ventirad qui ne declare
  // qu'un seul support etait traite comme un composant ordinaire.
  const coolers = list.filter((i) => i.category === 'cooling' && compatValues(i.compat?.socket).length)
  const cases = list.filter((i) => i.category === 'case' && i.compat?.form && !i.compat?.psuWatts && !compatValues(i.compat?.socket).length)

  if (cpus.length && boards.length) {
    cpus.forEach((cpu) => {
      boards.forEach((board) => {
        // P17 (rapport #5) : `!==` aurait signalé à tort un CPU multi-socket.
        // LOT P2 (B10) : `cpu.compat.socket` levait un `TypeError` pour une
        // fiche sans objet `compat` — exactement le cas d'un produit créé par le
        // maître ou restauré d'une sauvegarde ancienne, et `checkCompatibility`
        // tourne DANS le rendu (`BuilderPage.jsx:26`) : toute la page retombait.
        if (cpu.compat?.socket && board.compat?.socket && !socketsMatch(cpu.compat.socket, board.compat.socket)) {
          W('compatSocketMismatch', { cpu: cpu.name, cpuSocket: compatLabel(cpu.compat?.socket), board: board.name, boardSocket: compatLabel(board.compat?.socket) }, true)
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
      W('compatNeedsBoard', { cpu: cpu.name, socket: compatLabel(cpu.compat?.socket) })
    })
  }

  if (boards.length && rams.length) {
    boards.forEach((board) => {
      rams.forEach((ram) => {
        // LOT P1 (B11) : recoupement au lieu d'une egalite stricte — une carte
        // qui accepte « DDR4 et DDR5 » ne doit pas faire refuser une barrette DDR4.
        if (compatValues(board.compat?.memory).length && compatValues(ram.compat?.memory).length && !compatIntersects(board.compat.memory, ram.compat.memory)) {
          W('compatRamMismatch', { ram: ram.name, ramMem: compatLabel(ram.compat?.memory), board: board.name, boardMem: compatLabel(board.compat?.memory) }, true)
        }
      })
    })
  }

  if (gpus.length && psus.length) {
    gpus.forEach((gpu) => {
      psus.forEach((psu) => {
        if (gpu.compat?.psuMin && psu.compat?.psuWatts < gpu.compat.psuMin) {
          W('compatPsuWeak', { gpu: gpu.name, min: gpu.compat.psuMin, psu: psu.name, watts: psu.compat?.psuWatts }, true)
        }
      })
    })
  }

  if (gpus.length && !psus.length) {
    gpus.forEach((gpu) => {
      if (gpu.compat?.psuMin) W('compatNeedsPsu', { gpu: gpu.name, min: gpu.compat?.psuMin })
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
