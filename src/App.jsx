import { useEffect, useMemo, useRef, useState } from 'react'
import { Offcanvas } from 'bootstrap'
import {
  BRANDS_DZ_PRIORITY,
  CATEGORIES,
  PART_LINES,
  PRODUCTS,
  REVIEWS,
  SLOTS,
  SHOP_SERVICES,
  STORE,
  STORE_LINKS,
  checkCompatibility,
  money,
  splitWarnings,
  starText
} from './data'
import * as api from './api.js'
// P19 : flux Desk temps réel (WebSocket + repli polling) et notifications
// navigateur — une commande ne doit plus attendre la fenêtre de 20 s.
import { createDeskStream } from './deskStream.js'
import { notifyNewOrder, requestNotificationPermission } from './notify.js'
import { ensureProductPhotos } from './productPhotos.js'
import { brandsOnSale, discountPercent, hasSale } from './productMeta.js'
// LOT P6 (S2) : la regle de pagination est partagee avec la page Recherche.
// LOT P6 (S3) : le pager, le choix de taille de page et la feuille des marques sont
// des composants partages — les deux ecrans ne recopient plus le meme markup.
import { PAGE_TAILLE, pageCourante, pagesPour, tailleSure, tranche } from './pager.js'
import { ChoixTaille, Pager } from './pagerControls.jsx'
import { BrandSheet } from './brandSheet.jsx'
import { useFeuilleFiltre } from './filterSheet.js'
import SearchPage from './SearchPage.jsx'
import BuilderPage from './BuilderPage.jsx'
import PartThumb from './PartThumb.jsx'
import { stockLabel } from './stockLabel.js'
import ContactButton from './ContactPicker.jsx'
import { specRows } from './media.js'
import AuthPanel from './AuthPanel.jsx'
import ProfilePage from './ProfilePage.jsx'
import OrdersPage from './OrdersPage.jsx'
import MasterPage from './MasterPage.jsx'
import DeskPage from './DeskPage.jsx'
import ProductPage from './ProductPage.jsx'
import LegalPage from './LegalPage.jsx'
import {
  buildWaMessage,
  canCancelHere,
  dropCartLines,
  localDay,
  mergeServerOrders,
  nextLocalOrderCode,
  orderApiFailure,
  orderBlockedMessage,
  pickupForUser,
  shortageMessage
} from './orderLogic.js'
import { isStorageBlocked, safeStorage } from './safeStorage.js'
import { clampVitrine } from './vitrine.js'
import { t as translate, labelOr, LANGS, langMeta } from './i18n.js'
import {
  applyDocumentChrome,
  loadDeskSeenAt,
  loadLang,
  loadOrders,
  saveDeskSeenAt,
  saveLang,
  saveOrders
} from './prefs.js'
import {
  buildShopView,
  isDzPhone,
  loadMeta,
  loadSession,
  loadUsers,
  normalizePhone,
  phoneCarrier,
  saveMeta,
  saveSession,
  saveUsers
} from './shopStore.js'

/**
 * P22 (piège 2) — accès au stockage résolu **paresseusement**.
 *
 * C'était `const storage = typeof localStorage !== 'undefined' ? localStorage : null`,
 * évalué une fois pour toutes à l'import du module. Dans tout contexte où
 * `localStorage` n'existe pas encore à cet instant — harnais de test qui pose
 * ses globaux après les imports, worker sans DOM, rendu côté serveur — la
 * constante restait figée à `null` pour toute la durée de vie du module.
 *
 * Conséquence observée : l'app retombait sur la langue du navigateur (arabe)
 * au lieu de `pcstar-lang`, et `loadUsers(null)` ne seedait aucun compte —
 * donc aucun bouton profil. Le symptôme ressemblait à s'y méprendre à un bug
 * applicatif alors que le code de l'app était correct.
 *
 * Les 21 sites d'appel n'utilisent que `getItem` / `setItem` / `removeItem`
 * en invocation optionnelle (`storage?.getItem?.(k)`), ce wrapper leur est
 * donc transparent — et il suit le stockage réel dès qu'il apparaît.
 */
// LOT 3.1 (F7 + F8) : ce wrapper maison — ajouté pour les iframes à stockage
// bloqué — levait comme le reste, faute de `try/catch`. Il est remplacé par le
// module partagé `safeStorage`, qui ne lève jamais, garde la résolution
// paresseuse décrite ci-dessus, et retombe sur un repli mémoire par clé.
const storage = safeStorage

/**
 * LOT 3.9 (B12) — bornes du retry de `me()` après un retour OAuth. Un cold
 * start serverless ou une base lente faisait échouer l'unique tentative, et
 * l'utilisateur restait sur une page qui ne disait rien.
 */
const OAUTH_ME_ATTEMPTS = 3
const OAUTH_ME_RETRY_MS = 700

/**
 * LOT 3.11 (B16) — plafond de notifications navigateur pour les commandes
 * arrivées pendant l'absence du comptoir : 20 résas nocturnes ne doivent pas
 * produire 20 notifications. Le toast, lui, donne le compte exact.
 */
const MAX_MISSED_NOTIFY = 3

/*
 * LOT P4 (V3) — taille d'une page du catalogue de la vitrine. 12, et pas 24 :
 * la grille est en `col-6 col-md-4 col-xl-3`, donc 12 fiches remplissent
 * exactement deux largeurs de grille sur un téléphone (2 par ligne) comme sur
 * un grand écran (4 par ligne) — pas de dernière ligne à moitié vide, et le
 * client qui cherche voit six lignes de produits au lieu d'un mur de trente.
 * Exportée pour que `src/p3Vitrine.test.js` verrouille la valeur au lieu de la
 * recopier : un nombre de pages écrit dans un test est un nombre qui ment.
 */
// LOT P6 (S2) : la taille de page n'est plus écrite ici — elle vit dans
// `src/pager.js`, partagée avec la page Recherche (deux listes, une regle de
// tranchage). L'alias reste exporté : c'est la constante que les verrous lisent.
export const SHOP_PAGE_SIZE = PAGE_TAILLE

/**
 * LOT 3.16 (B19) — âge lisible d'un horodatage, dans la langue de l'interface.
 * `Intl.RelativeTimeFormat` rend déjà « il y a 5 minutes » / « 5 minutes ago » /
 * « قبل ٥ دقائق » : la clé i18n ne répète donc pas la locution.
 */
const RELATIVE_FMT = {}
function timeAgo(ts, lang) {
  const at = Number(ts)
  if (!Number.isFinite(at) || at <= 0) return ''
  const sec = Math.max(1, Math.round((Date.now() - at) / 1000))
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR'
  try {
    RELATIVE_FMT[locale] =
      RELATIVE_FMT[locale] || new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
    const rtf = RELATIVE_FMT[locale]
    if (sec < 60) return rtf.format(-sec, 'second')
    const min = Math.round(sec / 60)
    if (min < 60) return rtf.format(-min, 'minute')
    const h = Math.round(min / 60)
    if (h < 24) return rtf.format(-h, 'hour')
    return rtf.format(-Math.round(h / 24), 'day')
  } catch {
    return `${sec}s`
  }
}

/** Cart is stored PER ACCOUNT (guest = 'guest'), so switching account = own cart. */
const cartKeyFor = (uid) => `pcstar-cart-${uid || 'guest'}`

/** Clé opaque conservée pendant les tentatives d'une même réservation. */
function newReservationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  // Navigateurs modernes ont Web Crypto; ce dernier recours garde seulement la
  // compatibilité de démo/tests et respecte la forme opaque attendue par l'API.
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
}

function loadCartFor(st, uid) {
  try {
    const raw = st?.getItem?.(cartKeyFor(uid))
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** P8 (P7-3) : formulaire de retrait — valeurs vides d'origine. */
const PICKUP_DEFAULTS = {
  name: '',
  phone: '',
  slot: SLOTS[2],
  wilaya: 'Oran',
  payment: 'cash'
}

// Les rayons de recherche sont délibérément orientés client : les imprimantes,
// produits reconditionnés, réseau/UPS et mobilier ne sont plus cachés derrière
// « accessoires » ou « USB ».
const BASE_PANELS = [
  { id: 'catalog', titleKey: 'panelCatalog' },
  { id: 'machines', titleKey: 'panelMachines' },
  { id: 'printing', titleKey: 'panelPrinting' },
  { id: 'parts', titleKey: 'panelParts' },
  { id: 'peripherals', titleKey: 'panelPeripherals' },
  { id: 'networking', titleKey: 'panelNetworking' },
  { id: 'lifestyle', titleKey: 'panelLifestyle' },
  { id: 'deals', titleKey: 'panelDeals' }
]

// P9 (P7-6) : UN SEUL AudioContext partagé (créé à la demande), réutilisé à
// chaque bipe. Avant : `new AudioContext()` par commande — Chrome plafonne à
// ~6 contextes actifs par page, au-delà plus aucun son + fuite mémoire.
let deskAudioCtx = null
/** LOT 5.9 (U9) : paramètres du bip — exportés pour test (enveloppe vérifiée). */
export const BEEP_PEAK_GAIN = 0.04
export const BEEP_ATTACK_S = 0.01
export const BEEP_DURATION_S = 0.12

export function deskBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!deskAudioCtx || deskAudioCtx.state === 'closed') deskAudioCtx = new AC()
    // autoplay : un contexte peut naître « suspended » → le réveiller.
    // LOT P3 (B26) : `resume()` renvoie une promesse. Le `try` de cette
    // fonction est SYNCHRONE, donc un refus du navigateur (aucun geste
    // utilisateur) partait en `unhandledrejection` : un bruit de console à
    // chaque commande annoncée, sans conséquence ailleurs — mais le `catch`
    // ne coûte rien et le bruit coûtait un diagnostic à chaque audit.
    if (deskAudioCtx.state === 'suspended') deskAudioCtx.resume().catch(() => {})
    const o = deskAudioCtx.createOscillator()
    const g = deskAudioCtx.createGain()
    o.connect(g)
    g.connect(deskAudioCtx.destination)
    o.frequency.value = 880
    // LOT 5.9 (U9) : enveloppe de gain. `g.gain.value = 0.04` posait le niveau
    // d'un coup et l'oscillateur démarrait/s'arrêtait à pleine amplitude : une
    // discontinuité = un **clic** audible à chaque commande annoncée au
    // comptoir (le bip censé aider était le bruit le plus désagréable des deux).
    // Attaque 10 ms, retombée exponentielle vers le silence AVANT l'arrêt, et
    // `start`/`stop` calés sur le même horodatage (pas `Date.now`).
    const t0 = deskAudioCtx.currentTime
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(BEEP_PEAK_GAIN, t0 + BEEP_ATTACK_S)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + BEEP_DURATION_S)
    o.start(t0)
    o.stop(t0 + BEEP_DURATION_S + 0.01)
  } catch {
    /* ignore */
  }
}

/** Test uniquement : oublie le contexte audio partagé (jsdom n'en a pas). */
export function __resetDeskAudio() {
  try {
    if (deskAudioCtx && deskAudioCtx.state !== 'closed') deskAudioCtx.close()
  } catch {
    /* ignore */
  }
  deskAudioCtx = null
}

// LOT 6.1 (Q1) : `stockLabel` vient de `src/stockLabel.js` — une seule définition,
// une seule famille de classes (la classe Bootstrap complète, rien à traduire).

/** Un lien externe DOIT s'ouvrir même dans un environnement qui bloque les
    popups (aperçu de développement, bloqueurs de fenêtres) : window.open
    d'abord, repli même onglet ensuite (même pattern que ContactPicker). */
function openExternal(e, href) {
  e.preventDefault()
  let w = null
  try {
    w = window.open(href, '_blank')
  } catch {
    w = null
  }
  // LOT P3 (B22) : `window.open` ne beneficie PAS du `noopener` implicite des
  // `<a target="_blank">` — la page ouverte garde `window.opener` sur le
  // boutique et peut la rediriger. Passer `'noopener'` en 3e argument etait
  // la refonte refusee ici (voir `ContactPicker.jsx:56-69`) : il fait renvoyer
  // `null`, ce qui declencherait la navigation meme onglet pour TOUTE
  // ouverture reussie. Couper le lien apres coup donne la meme protection sans
  // perdre le sens de `w`.
  if (w) {
    try {
      w.opener = null
    } catch {
      /* environnement qui refuse d'ecrire sur l'objet fenetre */
    }
    return undefined
  }
  window.location.href = href
  return undefined
}

// LOT 5.7 (U7) : `cartMessage` vivait ici, sans garde de longueur. La
// composition (et la troncature honnête du récapitulatif) est passée dans
// `buildWaMessage` (`src/orderLogic.js`) — pure, partagée, testable sans monter
// toute l'application.

function Stars({ product, t }) {
  if (!product || !product.rating) return null
  return (
    <div className="stars" title={`${product.rating} ${t('xReviews', { n: product.reviews })}`}>
      <span>{starText(product.rating)}</span>
      <em>{product.rating.toFixed(1)}</em>
      <span className="rev">({product.reviews})</span>
    </div>
  )
}

export default function App() {
  const [lang, setLang] = useState(() => loadLang(storage))
  // Thème sombre supprimé (demande client) : le site tourne en clair,
  // quels que soient la préférence stockée ou le système.
  // Site clair uniquement (choix client) : plus de préférence de thème.
  const theme = 'light'
  const [users, setUsers] = useState(() => loadUsers(storage))
  const [session, setSession] = useState(() => loadSession(storage))
  const [meta, setMeta] = useState(() => loadMeta(storage))
  const [page, setPage] = useState('shop')
  const [selectedId, setSelectedId] = useState(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [cart, setCartState] = useState(() => loadCartFor(storage, loadSession(storage)?.userId))
  const [toast, setToast] = useState('')
  // P8 (P7-3) : état vide du formulaire de retrait — unique source, réutilisé
  // au logout pour ne JAMAIS laisser les infos du client précédent.
  const [pickup, setPickup] = useState({ ...PICKUP_DEFAULTS, pickupDate: localDay(new Date()) })
  const [phoneErr, setPhoneErr] = useState('')
  const [nameErr, setNameErr] = useState('')
  const [reservations, setReservations] = useState(() => loadOrders(storage))
  const [reserved, setReserved] = useState(null)
  const [build, setBuild] = useState({})
  const [authOpen, setAuthOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [apiOnline, setApiOnline] = useState(false)
  const [apiUser, setApiUser] = useState(null)
  const [authMode, setAuthMode] = useState('local')
  const [brandFilter, setBrandFilter] = useState(null)
  // LOT P4 (V2) — les filtres de la vitrine sont deux panneaux fermables ; une
  // seule ouverture à la fois (deux panneaux ouverts = le même écran qui se
  // contredit). `brandQuery` ne filtre QUE la liste des marques du panneau : il
  // ne filtre pas le catalogue, sinon « fermer le panneau » changerait les
  // résultats sans que personne l'ait demandé.
  const [shopSheet, setShopSheet] = useState(null)
  // LOT P6 (S3) : la recherche « une marque » n'est plus un etat de l'ecran — elle
  // vit dans la feuille (`src/brandSheet.jsx`), pour les deux ecrans a la fois.
  const [shopTaille, setShopTaille] = useState(PAGE_TAILLE)
  const [shopPage, setShopPage] = useState(1)

  const [stockMap, setStockMap] = useState({}) // id -> live server stock
  const [serverCatalog, setServerCatalog] = useState([]) // produits complets servis par l'API (mode API)
  // P10 (P7-11) : le catalogue reçu du serveur est la vérité — mais seulement
  // s'il a bien été REÇU (200 + tableau). Un 5xx / une base injoignable ne
  // marque plus le catalogue « prêt » : avant, une panne Neon laissait
  // serverCatalog vide ET ready → vitrine sans aucun produit (B25).
  const [serverCatalogReady, setServerCatalogReady] = useState(false)
  // P12 (B25) : l'API a répondu mais sa base est injoignable → catalogue de
  // base servi en mode dégradé (stock d'origine, sans masquages master).
  const [catalogDegraded, setCatalogDegraded] = useState(false)
  const [degradedDismissed, setDegradedDismissed] = useState(false)
  const [cartStep, setCartStep] = useState(0) // 0 cart, 1 info (when items)
  const cartElRef = useRef(null)
  const cartOcRef = useRef(null)
  // Même clé pendant un double clic ou une réponse perdue : le serveur répond
  // alors avec la réservation déjà créée, sans réserver le stock une seconde fois.
  const reservationKeyRef = useRef(null)
  // Toute modification de panier représente une nouvelle intention de commande.
  // Une même intention conserve sa clé entre les tentatives réseau.
  useEffect(() => {
    reservationKeyRef.current = null
  }, [cart])
  // P19 : codes déjà vus — la détection par longueur ratait une commande
  // arrivée en même temps qu'une suppression.
  const seenOrderCodes = useRef(null)
  const deskStream = useRef(null)
  // P21 : code → horodatage de la dernière transition décidée par le maître.
  // Sert à ne pas laisser une réponse de polling périmée écraser un changement
  // qui vient d'aboutir (voir `mergeServerOrders`).
  const orderEditedAt = useRef(new Map())

  const t = (key, vars) => translate(lang, key, vars)
  const localUser = useMemo(() => {
    if (!session?.userId) return null
    return users.find((u) => u.id === session.userId) || null
  }, [session, users])
  const user = authMode === 'api' && apiUser ? apiUser : localUser
  const isMaster = user?.role === 'master'
  const authId = user?.id || null
  const authIdRef = useRef(authId)
  authIdRef.current = authId

  // LOT 3.3 (B6) — miroirs SYNCHRONES de l'état, et effets de bord hors des
  // updaters React.
  //
  // Avant, `setCart` écrivait dans le stockage **depuis l'updater** :
  //  · React rappelle un updater (StrictMode, rendu interrompu puis repris) →
  //    deux écritures pour une mutation, et potentiellement l'écriture d'un état
  //    intermédiaire jamais affiché ;
  //  · l'updater lisait `authIdRef.current` au moment du rappel, pas au moment de
  //    l'appel : le panier pouvait être persisté sous la clé d'un autre compte.
  //
  // Les miroirs servent aussi B7/B8 : un calcul qui dépend de l'état courant
  // (code de commande, garde de stock) lit une valeur À JOUR, plus la closure du
  // dernier rendu.
  const cartRef = useRef(cart)
  const reservationsRef = useRef(reservations)
  // LOT 3.7 (B10) : séquence de `refreshStock` — la dernière requête partie est
  // la seule dont la réponse est appliquée.
  const stockReqSeq = useRef(0)
  // LOT 3.11 (B16) : horodatage du dernier pull Desk, persisté.
  const deskSeenAt = useRef(loadDeskSeenAt(storage))
  // LOT 3.16 (B19) : âge et source du repli dégradé.
  const [degradedInfo, setDegradedInfo] = useState(null)
  // LOT 3.8/3.9 (B11 + B13) : une seule alerte « session expirée » par session.
  const sessionExpiredNotified = useRef(false)

  /** Écrit le panier — jamais depuis un updater (LOT 3.3 / B6). */
  function persistCart(next) {
    // `safeStorage.setItem` ne lève pas : stockage bloqué ou quota dépassé, la
    // page continue (LOT 3.1 / F7 + F8). La clé suit le compte COURANT au moment
    // de l'appel, plus au moment où React rappelle un updater.
    safeStorage.setItem(cartKeyFor(authIdRef.current), JSON.stringify(next))
  }

  /**
   * Calcule `next` hors updater, met à jour état + miroir, persiste, renvoie
   * `next`. Synchrone : les appelants peuvent lire le résultat tout de suite
   * (garde de stock de B8, toast du panier).
   */
  function setCart(updater) {
    const next = typeof updater === 'function' ? updater(cartRef.current) : updater
    cartRef.current = next
    setCartState(next)
    persistCart(next)
    return next
  }

  /** Remplace le panier sans réécrire (chargement depuis le stockage). */
  function loadCart(next) {
    cartRef.current = next
    setCartState(next)
    return next
  }

  /** Commandes : état + miroir. Pour les mises à jour d'origine SERVEUR. */
  function syncReservations(updater) {
    const next = typeof updater === 'function' ? updater(reservationsRef.current) : updater
    reservationsRef.current = next
    setReservations(next)
    return next
  }

  /** Commandes : état + miroir + copie navigateur. Pour les mutations locales. */
  function commitReservations(updater) {
    const next = syncReservations(updater)
    saveOrders(storage, next)
    return next
  }

  const shopView = useMemo(() => buildShopView(PRODUCTS, PART_LINES, BASE_PANELS, meta), [meta])
  /*
   * LOT P4 (V1) — la vitrine lue par la page d'accueil. Derivée du même `meta`
   * que les panneaux, et non d'un état parallèle : un compteur qui vivrait dans
   * son propre `useState` serait différent selon l'onglet qui a écrit le
   * dernier. Le bornage est la fonction même que côté serveur (`clampVitrine`, :
   * une clé tapée à la main dans le stockage, ou revenue d'un cache ancien, ne
   * doit pas afficher `NaN` ni un nombre de 12 chiffres.
   */
  const vitrine = clampVitrine(meta.vitrine)
  // Mode API : le catalogue serveur est la source de vérité (masquages et
  // créations du master, stock live, overrides de prix). Offline : repli
  // sur le catalogue statique + meta local.
  // Rupture (stock live = 0) → produit invisible au client (le master le
  // voit toujours dans sa vue complète).
  const catalog = useMemo(() => {
    // P10 (P7-11) : API en ligne + catalogue chargé → c'est la vérité, même
    // vide (tous masqués/rupture) — plus de repli SILENCIEUX sur le catalogue
    // statique (produits masqués réapparaissaient, prix désuets).
    if (apiOnline && serverCatalogReady) return serverCatalog.map(ensureProductPhotos)
    return shopView.products.filter((p) => (stockMap[p.id] != null ? stockMap[p.id] : p.stock) > 0)
  }, [apiOnline, serverCatalogReady, serverCatalog, shopView.products, stockMap])
  // Le produit affiché peut sortir du catalogue pendant la visite (rupture /
  // masquage) : on garde la dernière référence pour ne pas vider la PDP.
  // LOT P3 (B25) : ordre de la priorité Algérie, mais uniquement des marques
  // réellement en rayon (les autres marques du catalogue suivent, triées).
  // Déclaré ici, après `catalog` : posé plus haut, il lisait une constante en
  // zone morte de déclaration (TDZ) et faisait tomber tout le montage de `App`.
  const marquesVendues = useMemo(() => brandsOnSale(catalog, BRANDS_DZ_PRIORITY), [catalog])

  const selectedFound = catalog.find((p) => p.id === selectedId)
  const selectedRef = useRef(null)
  if (selectedFound) selectedRef.current = selectedFound
  const selected = selectedFound || (selectedRef.current?.id === selectedId ? selectedRef.current : null)

  useEffect(() => {
    const metaL = langMeta(lang)
    applyDocumentChrome({ lang, dir: metaL.dir, theme })
  }, [lang, theme])

  useEffect(() => {
    const titles = {
      shop: t('heroTitle'),
      search: t('navSearch'),
      builder: t('navBuilder'),
      about: t('aboutTitle'),
      product: selected?.name || t('navShop'),
      desk: t('deskTitle'),
      master: t('masterTitle'),
      profile: t('profileTitle'),
      warranty: t('legalWarrantyTitle'),
      privacy: t('legalPrivacyTitle'),
      terms: t('legalTermsTitle'),
      help: t('helpTitle')
    }
    document.title = `${titles[page] || 'PC Star'} · PC Star Oran`
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = t('seoDescription')
    // JSON-LD LocalBusiness once
    if (!document.getElementById('pcstar-ld')) {
      const s = document.createElement('script')
      s.id = 'pcstar-ld'
      s.type = 'application/ld+json'
      s.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ComputerStore',
        name: 'PC Star Informatique',
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Rue Mimoune Bouadjimi, El Makari Les Castors',
          addressLocality: 'Oran',
          addressCountry: 'DZ'
        },
        telephone: '+213770650387',
        url: typeof location !== 'undefined' ? location.origin : 'https://pcstar.dz',
        currenciesAccepted: 'DZD',
        paymentAccepted: 'Cash',
        openingHours: 'Mo-Sa 10:00-18:30'
      })
      document.head.appendChild(s)
    }
  }, [page, lang, selected]) // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  /* Bootstrap Offcanvas — focus trap + backdrop via official API */
  useEffect(() => {
    const el = cartElRef.current
    if (!el) return undefined
    const oc = Offcanvas.getOrCreateInstance(el, { backdrop: true, scroll: false })
    cartOcRef.current = oc
    const onShown = () => setCartOpen(true)
    const onHidden = () => setCartOpen(false)
    el.addEventListener('shown.bs.offcanvas', onShown)
    el.addEventListener('hidden.bs.offcanvas', onHidden)
    return () => {
      el.removeEventListener('shown.bs.offcanvas', onShown)
      el.removeEventListener('hidden.bs.offcanvas', onHidden)
      oc.dispose()
      cartOcRef.current = null
    }
  }, [])

  useEffect(() => {
    const oc = cartOcRef.current
    if (!oc) return
    if (cartOpen) oc.show()
    else oc.hide()
  }, [cartOpen])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const h = await api.health()
      if (cancelled) return
      setApiOnline(Boolean(h?.ok))
      if (h?.ok) {
        // LOT 3.7 (B10) : même séquence que `refreshStock` — un rafraîchissement
        // parti entre-temps doit avoir le dernier mot.
        const catSeq = (stockReqSeq.current += 1)
        const cat = await api.getCatalog()
        if (!cancelled && catSeq === stockReqSeq.current) {
          // P12 (B25) : on ne déclare le catalogue « prêt » que sur une vraie
          // réponse (200 + tableau). Un 500/502/timeout laissait avant
          // serverCatalogReady=true avec une liste vide → plus AUCUN produit
          // alors que la base contenait tout.
          if (cat.ok && Array.isArray(cat.data?.products)) applyCatalog(cat.data)
        }
        // LOT 3.7 (B10) : réponse périmée = un rafraîchissement PLUS RÉCENT a
        // déjà appliqué un catalogue serveur, et `applyCatalog` a donc déjà
        // marqué le catalogue prêt. Laisser `serverCatalogReady` à false ici
        // aurait fait retomber la boutique sur le catalogue statique alors que
        // l'état serveur était bien en mémoire.
        // Panneaux (P6) : le serveur est la source de vérité pour
        // extraPanels/hiddenPanelIds → le shop est cohérent multi-appareils.
        // P12 (B25) : jamais en mode dégradé — l'API renverrait des panneaux
        // vides par défaut et écraserait le cache local.
        const m = await api.getMeta()
        // LOT P4 (V1) : la vitrine voyage avec les panneaux — même requête, même
        // rafraîchissement, et surtout le MÊME chemin de persistance (voir
        // `persistMeta` plus bas). `degraded` = l'API a répondu « je n'ai pas la
        // base » : on garde ce qui est à l'écran au lieu de remettre des zéros
        // qui feraient croire au client que le comptoir n'a rien livré.
        if (!cancelled && m.ok && !m.data?.degraded && m.data?.meta) {
          const sm = m.data.meta
          persistMeta({
            ...loadMeta(storage),
            hiddenPanelIds: Array.isArray(sm.hiddenPanelIds) ? sm.hiddenPanelIds : [],
            extraPanels: Array.isArray(sm.extraPanels) ? sm.extraPanels : [],
            // LOT P4 (V1) : le serveur est la source de vérité des trois
            // compteurs comme il l'est des panneaux — la vitrine est la même sur
            // tous les écrans du magasin, pas celle du dernier navigateur ouvert.
            vitrine: m.data.vitrine || loadMeta(storage).vitrine
          })
        }
      }
      const token = api.getToken()
      if (token) {
        // LOT 3.9 (B12) : deux tentatives — une API lente au démarrage ne doit
        // pas faire purger un jeton valide. La purge n'intervient que sur un
        // refus DÉFINITIF du serveur (401 = jeton expiré/révoqué). Sur un 503,
        // un timeout ou un réseau coupé, le jeton reste : la session est toujours
        // valable côté serveur et le prochain chargement retentera. Purger sur
        // une panne transitoire déconnectait le maître (et le client OAuth qui
        // venait d'atterrir) pour rien.
        const res = await applyApiSession({ attempts: 2 })
        if (!res.applied && res.unauthorized) api.setToken(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * LOT 3.9 (B12 + B13) — applique la session API en bornant les tentatives.
   *
   * @returns {Promise<{applied: boolean, unauthorized: boolean}>}
   *   `applied`      : un utilisateur a été appliqué ;
   *   `unauthorized` : le serveur a refusé le jeton (401) — il est réellement
   *                    mort, le purger est sûr. `false` quand l'échec vient d'un
   *                    503 / timeout / réseau coupé : le jeton doit être
   *                    CONSERVÉ (une panne transitoire ne coûte pas la session).
   */
  async function applyApiSession({ attempts = OAUTH_ME_ATTEMPTS, delayMs = OAUTH_ME_RETRY_MS } = {}) {
    let unauthorized = false
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, delayMs * (attempt - 1)))
      const me = await api.me()
      if (me.ok && me.data?.user) {
        sessionExpiredNotified.current = false
        setApiUser(me.data.user)
        setAuthMode('api')
        setApiOnline(true)
        return { applied: true, unauthorized: false }
      }
      // Jeton mort (expiré, révoqué après changement de mot de passe) : insister
      // ne servirait à rien.
      if (me.status === 401) {
        unauthorized = true
        break
      }
    }
    return { applied: false, unauthorized }
  }

  // LOT 3.18 (R14) — retour OAuth par FRAGMENT (`#oauth_token=`), plus par query.
  //
  // Un token en query string part dans les journaux du proxy et de l'hébergeur,
  // dans l'historique du serveur, et dans l'en-tête `Referer` de toute requête
  // tierce déclenchée par la page (images, polices, analytics). Le fragment
  // n'est **jamais** envoyé au serveur, et il est retiré de l'URL dès la lecture
  // — donc absent de l'historique du navigateur après le `replaceState`.
  // L'ancien paramètre `?oauth_token=` reste accepté en repli le temps qu'un
  // retour déjà en vol atterrisse.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      const hashParams = new URLSearchParams(String(u.hash || '').replace(/^#/, ''))
      const tok = hashParams.get('oauth_token') || u.searchParams.get('oauth_token')
      if (!tok) return
      api.setToken(tok)
      hashParams.delete('oauth_token')
      hashParams.delete('oauth_provider')
      u.hash = hashParams.toString() ? `#${hashParams.toString()}` : ''
      u.searchParams.delete('oauth_token')
      u.searchParams.delete('oauth_provider')
      // Nettoyage IMMÉDIAT : le token ne doit pas survivre dans l'URL affichée,
      // partageable ou recopiée dans l'historique.
      window.history.replaceState({}, '', u.pathname + u.search + u.hash)
      ;(async () => {
        const { applied } = await applyApiSession()
        if (applied) {
          setToast(t('authOk'))
          setPage('shop')
          setNavOpen(false)
        } else {
          // LOT 3.9 (B12) : avant, aucun retry et AUCUN message — l'utilisateur
          // restait sur la vitrine comme si rien ne s'était passé. Le jeton est
          // conservé s'il n'est pas rejeté (401) : une API momentanément lente ne
          // doit pas coûter la session, et le bootstrap du prochain chargement
          // retentera.
          setToast(t('authRetryFailed'))
        }
      })()
    } catch {
      /* ignore */
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // LOT 3.8/3.9 (B11 + B13) — toute réponse 401 sur une route authentifiée
  // purge la session API, repasse en mode local et LE DIT.
  //
  // Avant : le polling du Desk avalait le 401 (`!r.ok` → `return`) et continuait
  // d'interroger toutes les 20 s, en silence, jusqu'à la fermeture de l'onglet ;
  // ailleurs, un 401 se confondait avec un échec réseau. Une seule alerte par
  // session morte, réarmée dès qu'une session est appliquée.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      if (sessionExpiredNotified.current) return
      if (!api.getToken()) return
      sessionExpiredNotified.current = true
      api.setToken(null)
      setApiUser(null)
      setAuthMode('local')
      setApiOnline(false)
      setToast(t('sessionExpired'))
    })
    return () => api.clearUnauthorizedHandler()
  }, [lang]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Applique une réponse de catalogue. LOT 3.16 (B19) : on conserve aussi
   * `db.asOf` / `db.source` — l'âge du repli dégradé, que le bandeau affiche au
   * lieu de laisser l'utilisateur deviner si les prix datent de cinq secondes ou
   * du dernier déploiement.
   */
  function applyCatalog(data) {
    setServerCatalog(data.products)
    const map = {}
    for (const pr of data.products) map[pr.id] = pr.stock
    setStockMap(map)
    setCatalogDegraded(Boolean(data.degraded))
    setDegradedInfo(data.db && typeof data.db === 'object' ? data.db : null)
    // Appelée UNIQUEMENT sur une réponse valable (200 + tableau de produits) :
    // c'est donc ici, et pas seulement au démarrage, que le catalogue serveur
    // devient la source affichée (LOT 3.7 / B10).
    setServerCatalogReady(true)
  }

  async function refreshStock() {
    if (!apiOnline) return
    // LOT 3.7 (B10) — garde de fraîcheur. `refreshStock` est appelé par
    // l'annulation, la suppression, le changement de statut et le polling : trois
    // appels pouvaient se croiser, et c'était la réponse la plus LENTE (donc la
    // plus ancienne) qui s'appliquait en dernier, écrasant le stock le plus
    // récent. Chaque requête prend un numéro ; seule la dernière partie est
    // appliquée.
    const seq = (stockReqSeq.current += 1)
    try {
      const cat = await api.getCatalog()
      if (seq !== stockReqSeq.current) return
      if (cat.ok && Array.isArray(cat.data?.products)) applyCatalog(cat.data)
    } catch {
      /* ignore */
    }
  }

  // P19 : suppression définitive d'une commande (master). Le serveur rend le
  // stock, donc on rafraîchit aussi l'état du catalogue.
  async function handleOrderDelete(code) {
    if (!(apiOnline && authMode === 'api' && isMaster)) return false
    // LOT 2.3 (F5) : une commande `localOnly` n'existe PAS côté serveur — l'API
    // répondrait 404 `not_found` et la suppression échouerait. Comme la fusion
    // du polling la conserve désormais (au lieu de l'effacer en silence), il
    // faut une voie de suppression locale : état + copie navigateur. Pas de
    // rendu de stock côté serveur (il n'a jamais été décrémenté là-bas) ; le
    // rafraîchissement du catalogue remet le stock local d'aplomb.
    const target = (reservations || []).find((o) => o.code === code)
    if (target?.localOnly) {
      commitReservations((prev) => prev.filter((o) => o.code !== code))
      await refreshStock()
      setToast(t('orderDeleted'))
      return true
    }
    try {
      const r = await api.deleteOrder(code)
      if (!r.ok) {
        setToast(t('deskDeleteFail'))
        return false
      }
      // La copie navigateur doit partir elle aussi : conservée, elle serait
      // réinjectée par la fusion suivante (et un `localOnly` ressusciterait).
      commitReservations((prev) => prev.filter((o) => o.code !== code))
      await refreshStock()
      setToast(t('orderDeleted'))
      return true
    } catch {
      setToast(t('deskDeleteFail'))
      return false
    }
  }

  async function handleOrderStatus(code, status) {
    if (apiOnline && authMode === 'api' && isMaster) {
      try {
        // LOT P2 (B6) : le statut que CET écran affiche. Fourni au serveur, il
        // refuse l'écriture obsolète au lieu de l'appliquer à l'aveugle.
        const visible = reservationsRef.current.find((o) => o?.code === code)?.status || null
        const r = await api.patchOrder(code, status, visible)
        if (r.ok && r.data?.order) {
          // P21 : horodatage AVANT la mise à jour d'état, pour que la fusion
          // du polling suivant sache que ce statut est plus récent.
          orderEditedAt.current.set(code, Date.now())
          syncReservations((prev) => prev.map((o) => (o.code === code ? { ...o, ...r.data.order } : o)))
          await refreshStock()
          return true
        }
        // Commande inconnue du serveur (créée en mode local), session non
        // API ou réseau tombé : on bascule sur le repli local au lieu de
        // laisser le bureau bloqué sur « Could not update status ».
        // Refus pour état dépassé : la vérité est dans la réponse, on la
        // réapplique à la carte — l'écran ne doit pas rester sur le statut
        // qu'il vient de perdre.
        if (r.status === 409 && r.data?.error === 'stale') {
          if (r.data.order) {
            syncReservations((prev) => prev.map((o) => (o.code === code ? { ...o, ...r.data.order } : o)))
          }
          setToast(t('deskStatusStale'))
          return false
        }
        const err = r.data?.error
        if (!r.offline && err !== 'not_found' && err !== 'forbidden') {
          setToast(t('deskStatusFail'))
          return false
        }
      } catch {
        /* réseau mort → repli local ci-dessous */
      }
    }
    // local fallback
    commitReservations((prev) => prev.map((o) => (o.code === code ? { ...o, status } : o)))
    return true
  }

  // Date de retrait fixée/décalée par le comptoir — le client la voit dans
  // « Mes commandes » ; en repli local, la copie de l'appareil est mise à jour.
  async function handleOrderPickup(code, pickupDate) {
    if (apiOnline && authMode === 'api' && isMaster) {
      try {
        const r = await api.patchOrderPickup(code, pickupDate)
        if (r.ok && r.data?.order) {
          orderEditedAt.current.set(code, Date.now())
          syncReservations((prev) => prev.map((o) => (o.code === code ? { ...o, ...r.data.order } : o)))
          return true
        }
        const err = r.data?.error
        if (!r.offline && err !== 'not_found' && err !== 'forbidden') return false
      } catch {
        /* réseau mort → repli local ci-dessous */
      }
    }
    commitReservations((prev) => prev.map((o) => (o.code === code ? { ...o, pickupDate } : o)))
    return true
  }

  // P6 : le client annule une de SES commandes (état « neuve » uniquement)
  // → le stock est rétabli (serveur ou local).
  async function cancelMyOrder(code) {
    if (apiOnline && authMode === 'api' && user) {
      let r = null
      try {
        r = await api.cancelMyOrder(code)
      } catch {
        r = { ok: false, offline: true }
      }
      if (r?.ok && r.data?.order) {
        syncReservations((prev) => prev.map((o) => (o.code === code ? { ...o, ...r.data.order } : o)))
        await refreshStock()
        setToast(t('orderCancelled'))
        return true
      }
      // Le 404 n'est pas une panne : la commande n'est pas explicitement liée
      // à cette session (guest, supprimée par le maître ou autre compte). La
      // phase 3 interdit toute appropriation par simple numéro de téléphone.
      if (r?.status === 404 || r?.data?.error === 'not_found') {
        setToast(t('orderCancelNotMine'))
        return false
      }
      setToast(t(r?.offline || !r ? 'backendOffline' : 'orderCancelFail'))
      return false
    }
    const target = (reservations || []).find((o) => o.code === code)
    if (!target) {
      setToast(t('orderOnlyNew'))
      return false
    }
    // Même règle que le bouton de la page « Commandes ». Hors session, elle
    // permet l'annulation de la copie guest locale; une route API ne reçoit
    // jamais cette exception.
    if (!canCancelHere(target, { allowGuest: !user })) {
      setToast(t('orderOnlyNew'))
      return false
    }
    // LOT P3 (B17) : une commande qui VIT SUR LE SERVEUR ne s'annule pas en
    // local. Avant : l'écran affichait « Commande annulée — stock rétabli »
    // pendant que la ligne restait `new` au comptoir, et le prochain
    // `mergeServerOrders` (`src/orderLogic.js:545`) ramenait le statut serveur —
    // la commande réapparaissait chez le client comme au bureau. Le faux succès
    // était donc en plus temporaire. Sans session, la seule voie honnête est de
    // le dire, et la copie locale n'est pas touchée.
    if (apiOnline && target.localOnly !== true && !user) {
      setToast(t('orderCancelNeedsLogin'))
      return false
    }
    commitReservations((prev) =>
      prev.map((o) => (o.code === code ? { ...o, status: 'cancelled', cancelledAt: new Date().toISOString() } : o))
    )
    // LOT 3.6 (B9) — en mode mixte, le stock AFFICHÉ vient du serveur
    // (`stockMap`). L'incrémenter localement pour une commande SERVEUR ajoutait
    // des unités fantômes : le serveur rend déjà le stock à l'annulation, et le
    // prochain `refreshStock` appliquait SA valeur — l'incrément local servait
    // juste à gonfler l'affichage entre-temps. On ne touche `stockMap` que pour
    // une commande vraiment locale (mode hors-ligne, `localOnly`).
    if (apiOnline && target.localOnly !== true) {
      await refreshStock()
    } else {
      setStockMap((prev) => {
        const next = { ...prev }
        for (const line of target.items || []) {
          const cur = next[line.id] != null ? next[line.id] : catalog.find((p) => p.id === line.id)?.stock ?? 0
          next[line.id] = Math.max(0, cur + (Number(line.qty) || 0))
        }
        return next
      })
    }
    setToast(t('orderCancelled'))
    return true
  }

  // Phase 3 — rattachement d'une commande guest via le code remis au comptoir.
  // Contrairement à l'annulation, la commande peut être absente de la copie
  // locale (passée depuis un autre appareil) : on l'ajoute si besoin.
  async function claimMyOrder(claimCode) {
    if (!(apiOnline && authMode === 'api' && user)) return { ok: false, error: 'offline' }
    let r = null
    try {
      r = await api.claimMyOrder(claimCode)
    } catch {
      r = { ok: false, offline: true }
    }
    if (r?.ok && r.data?.order) {
      const claimed = r.data.order
      syncReservations((prev) => {
        const known = prev.some((o) => o.code === claimed.code)
        return known ? prev.map((o) => (o.code === claimed.code ? { ...o, ...claimed } : o)) : [claimed, ...prev]
      })
      await refreshStock()
      setToast(t('orderClaimOk'))
      return { ok: true }
    }
    const err = r?.data?.error
    if (err === 'taken') {
      setToast(t('orderClaimTaken'))
      return { ok: false, error: 'taken' }
    }
    if (err === 'status') {
      setToast(t('orderClaimStatus'))
      return { ok: false, error: 'status' }
    }
    setToast(t(r?.offline || !r ? 'backendOffline' : 'orderClaimInvalid'))
    return { ok: false, error: err || 'not_found' }
  }

  // Per-account cart + pickup form : à la connexion / déconnexion /
  // changement de compte, charger le PROPRE panier du compte et reprendre
  // nom/tél depuis son profil (un nouveau client ne voit plus le panier
  // ni les infos du précédent).
  useEffect(() => {
    loadCart(loadCartFor(storage, authId))
    // P8 (P7-3) : sans compte → formulaire VIDE (plus les nom/tél du client
    // précédent) ; avec compte → reprise depuis le profil.
    setPickup((p) => pickupForUser(user, p, PICKUP_DEFAULTS))
    // LOT 2.4 (F6) : la confirmation de commande (`reserved`) porte le NOM, le
    // créneau et le total d'un client précis. Elle survivait au changement de
    // compte : sur un poste partagé (comptoir, cybercafé, téléphone familial),
    // le client suivant qui ouvrait le panier voyait « Réservation confirmée ·
    // Karim B. · 12:30 · 45 000 DA » — la confirmation d'un autre, avec ses
    // données personnelles. Le panier et le formulaire étaient déjà
    // réinitialisés ici ; l'écran de confirmation ne l'était pas.
    setReserved(null)
  }, [authId]) // eslint-disable-next-line react-hooks/exhaustive-deps

  // P19 : demande de permission de notification dès que le master est connecté.
  // Sans accord explicite, aucune notification navigateur n'est possible. Le
  // navigateur n'autorise qu'une demande par geste utilisateur : si l'état est
  // déjà tranché (accordé ou refusé), cet appel ne fait rien.
  useEffect(() => {
    if (!isMaster) return
    requestNotificationPermission().catch(() => {})
  }, [isMaster])

  useEffect(() => {
    if (!isMaster || !apiOnline || authMode !== 'api') return undefined
    let cancelled = false
    async function pull() {
      // P21 : l'horodatage est pris AVANT l'envoi. Toute transition décidée
      // après cet instant est plus récente que la réponse qui va arriver.
      const requestedAt = Date.now()
      const r = await api.listOrders()
      if (cancelled) return
      // LOT 3.8 (B11) : session morte. Le handler 401 global (`api.js`) purge le
      // jeton, repasse en mode local et affiche `sessionExpired` ; cet effet se
      // démontera (ses dépendances changent). On ne fusionne rien.
      if (r.status === 401) return
      if (!r.ok || !Array.isArray(r.data?.orders)) return
      const server = r.data.orders
      // P19 : détection par ensemble de codes (pas par longueur) — une
      // suppression simultanée masquait auparavant l'arrivée d'une commande.
      // La détection porte sur la liste SERVEUR : c'est elle qui révèle les
      // arrivées, indépendamment de la fusion ci-dessous.
      const known = seenOrderCodes.current
      if (known) {
        const fresh = server.filter((o) => !known.has(o.code))
        for (const o of fresh) {
          if (page === 'desk') {
            deskBeep() // P9 (P7-6) : contexte unique partagé, jamais de leak
            setToast(t('deskNewOrder'))
          }
          // Notification navigateur : visible même si l'onglet est en
          // arrière-plan. Silencieuse si la permission n'a pas été accordée.
          notifyNewOrder(o, t, { lang })
        }
      } else {
        // LOT 3.11 (B16) — premier pull de la session.
        //
        // Avant, `seenOrderCodes` démarrait à `null` et ce premier pull se
        // contentait de l'initialiser : les commandes arrivées pendant l'absence
        // du comptoir (navigateur fermé, onglet rechargé) s'affichaient dans la
        // liste SANS bip ni notification. On les compare à l'horodatage du
        // dernier pull persisté ; sans horodatage (tout premier démarrage), on
        // initialise en silence comme avant — annoncer tout l'historique à la
        // première ouverture serait du bruit.
        const since = deskSeenAt.current
        if (since) {
          const missed = server
            .filter((o) => Number.isFinite(Date.parse(o?.at || '')) && Date.parse(o.at) > since)
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
          if (missed.length) {
            if (page === 'desk') {
              deskBeep()
              setToast(missed.length === 1 ? t('deskNewOrder') : t('deskNewOrders', { n: missed.length }))
            }
            for (const o of missed.slice(0, MAX_MISSED_NOTIFY)) notifyNewOrder(o, t, { lang })
          }
        }
      }
      seenOrderCodes.current = new Set(server.map((o) => o.code))
      // LOT 3.11 (B16) : horodatage persisté du dernier pull réussi — pris AVANT
      // l'envoi, donc toute commande créée pendant la requête sera vue comme
      // « arrivée depuis » au prochain démarrage à froid.
      deskSeenAt.current = requestedAt
      saveDeskSeenAt(storage, requestedAt)
      // P21 : forme FONCTIONNELLE obligatoire. Ce useEffect ne liste pas
      // `reservations` dans ses dépendances : la variable capturée ici serait
      // celle du montage, donc périmée. `prev` est l'état réellement courant.
      syncReservations((prev) => mergeServerOrders(server, prev, requestedAt, orderEditedAt.current))
    }
    pull()
    // P19 : socket en temps réel, avec repli automatique sur le polling si le
    // socket est indisponible (cas de Vercel, où les WebSockets n'existent pas
    // en serverless). Le pull reste la source de vérité : le socket ne fait
    // que déclencher un rafraîchissement immédiat.
    deskStream.current = createDeskStream({
      getToken: () => api.getToken(),
      onEvent: () => {},
      onRefresh: () => {
        pull()
      },
      enabled: true,
    })
    return () => {
      cancelled = true
      deskStream.current?.close()
      deskStream.current = null
    }
  }, [isMaster, apiOnline, authMode, page]) // eslint-disable-line react-hooks/exhaustive-deps

  function persistUsers(next) {
    setUsers(next)
    saveUsers(storage, next)
  }

  function persistSession(next) {
    setSession(next)
    saveSession(storage, next)
    if (next) {
      setAuthMode('local')
      setApiUser(null)
    }
  }

  function onApiUser(u) {
    setApiUser(u)
    setAuthMode('api')
    setSession(null)
    saveSession(storage, null)
    // après login (API) → page d'accueil
    setPage('shop')
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  function persistMeta(next) {
    setMeta(next)
    saveMeta(storage, next)
  }

  function changeLang(id) {
    setLang(id)
    saveLang(storage, id)
  }

  async function logout() {
    if (authMode === 'api') await api.logout()
    setApiUser(null)
    setAuthMode('local')
    persistSession(null)
    // LOT 2.4 (F6) : même raison que dans l'effet `authId` — et `logout()`
    // n'entraîne pas toujours un changement d'`authId` observable (déconnexion
    // d'un guest, ou repli local qui conserve un `user`), donc l'effet seul ne
    // suffit pas. La déconnexion doit fermer la confirmation du compte qui
    // vient de partir.
    setReserved(null)
    setToast(t('navLogout'))
    if (page === 'desk' || page === 'master' || page === 'profile' || page === 'help' || page === 'orders') {
      setPage('shop')
      window.scrollTo({ top: 0 })
    }
  }

  const count = cart.reduce((s, i) => s + i.qty, 0)
  // LOT 5.4 (U4) : les prix du panier suivent le catalogue LIVE.
  //
  // Reproduit à l'audit : le prix est figé à l'ajout au panier (`{...product}`
  // dans `add()`), puis le maître change un prix pendant la visite — le
  // rafraîchissement du catalogue arrive, la vitrine affiche le nouveau prix,
  // mais le panier, son total, le récapitulatif de commande et le message
  // WhatsApp restent sur l'ancien. Le serveur, lui, recalcule les prix depuis le
  // catalogue (`placeOrder` ignore le prix envoyé) : la commande confirmée ne
  // correspondait donc à rien de ce que l'écran venait de montrer.
  //
  // `pricedCart` est la vue affichée/envoyée ; `priceDrift` liste les écarts pour
  // (a) recaler le panier persisté et (b) le dire à l'utilisateur — un prix qui
  // change en silence sous un total est exactement le genre de chose qu'il faut
  // annoncer.
  const { pricedCart, priceDrift } = useMemo(() => {
    const drift = []
    const priced = cart.map((i) => {
      const live = catalog.find((p) => p.id === i.id)
      if (!live) return i // produit sorti du catalogue : on garde le snapshot
      const livePrice = Number(live.price) || 0
      if (livePrice !== Number(i.price)) {
        drift.push({ id: i.id, name: live.name || i.name, from: Number(i.price) || 0, to: livePrice })
      }
      return { ...i, price: livePrice, name: live.name || i.name }
    })
    return { pricedCart: priced, priceDrift: drift }
  }, [cart, catalog])
  const total = pricedCart.reduce((s, i) => s + i.qty * i.price, 0)

  // Recale le panier persisté (miroir inclus) et annonce l'écart. Une fois les
  // prix recopiés, `priceDrift` se vide : l'effet ne se rejoue pas.
  useEffect(() => {
    if (!priceDrift.length) return
    setCart((prev) =>
      prev.map((i) => {
        const d = priceDrift.find((x) => x.id === i.id)
        return d ? { ...i, price: d.to, name: d.name } : i
      })
    )
    const shown = priceDrift
      .slice(0, 2)
      .map((d) => `${d.name} → ${money(d.to, lang)}`)
      .join(' · ')
    setToast(t('cartPriceUpdated', { lines: priceDrift.length > 2 ? `${shown} …` : shown }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceDrift])
  const warnings = useMemo(() => checkCompatibility(cart), [cart])
  const { blocks, notes } = useMemo(() => splitWarnings(warnings), [warnings])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((p) => {
      const catOk = category === 'all' || p.category === category
      const brandOk = !brandFilter || p.brand === brandFilter
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.short || '').toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      return catOk && brandOk && qOk
    })
  }, [category, query, catalog, brandFilter])



  const catLabel = (id) => {
    const c = CATEGORIES.find((x) => x.id === id)
    return c ? labelOr(t, `cat_${c.id}`, c.label || c.id) : id
  }
  // LOT P6 (S3) : le filtrage par texte de la liste des marques est dans
  // `BrandSheet` (une fois, pour les deux ecrans) ; `marquesVendues` reste la liste
  // REDUITE A LA CATEGORIE choisie, et c'est ce lien-la que le verrou V4 surveille.
  useFeuilleFiltre(shopSheet !== null, () => setShopSheet(null))
  // Le numero de page est borne a la lecture, pas a l'ecriture : un filtre qui
  // réduit la liste pendant qu'on est page 4 doit ramener page 1 sans que
  // l'appelant ait pensé à réinitialiser l'état.
  const pas = tailleSure(shopTaille)
  const shopPages = pagesPour(list.length, pas)
  const shopPageSure = pageCourante(shopPage, shopPages)
  const pageProduits = tranche(list, shopPageSure, pas)

  useEffect(() => {
    setShopPage(1)
  }, [category, brandFilter, query])

  function gotoPage(n) {
    const next = pageCourante(n, shopPages)
    setShopPage(next)
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })
  }

  function resetShopFilters() {
    setCategory('all')
    setBrandFilter(null)
    setQuery('')
    setBrandQuery('')
    setShopPage(1)
  }

  function liveStock(product) {
    const base = stockMap[product.id] != null ? stockMap[product.id] : product.stock
    const inCart = cart.find((i) => i.id === product.id)
    return Math.max(0, base - (inCart ? inCart.qty : 0))
  }

  function add(product) {
    // LOT 3.5 (B8) — la garde de stock est évaluée SUR LE PANIER COURANT, dans
    // la mise à jour, et non avant sur la closure du dernier rendu.
    //
    // Reproduit à l'audit : stock = 1, double-clic sur « Ajouter ». Les deux
    // clics lisaient le même `cart` (vide) et le même `liveStock` (1) : les deux
    // passaient la garde, le panier finissait à 2 unités pour 1 en stock — puis
    // la commande partait en 409 `stock` ou, hors-ligne, en survente locale.
    // `setCart` étant synchrone (miroir + état), la décision et le toast sont
    // cohérents avec ce qui a réellement été ajouté.
    const base = stockMap[product.id] != null ? stockMap[product.id] : product.stock
    let qtyAfter = 0
    setCart((prev) => {
      const inCart = prev.find((i) => i.id === product.id)?.qty || 0
      if (Math.max(0, base - inCart) <= 0) return prev
      qtyAfter = inCart + 1
      return inCart
        ? prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
        : [...prev, { ...product, qty: 1 }]
    })
    if (!qtyAfter) {
      setToast(t('outOfStock'))
      return
    }
    // LOT 6.3 (Q5) : le champ `count` était posé ici puis **jamais lu** — le
    // rendu affiche `nom · ajouté au panier`, et la quantité totale vit dans le
    // badge du panier. Un champ mort dans un état partagé, c'est un lecteur
    // futur qui croit l'information affichée. `qtyAfter` reste utilisé juste
    // au-dessus : c'est lui qui dit si l'ajout a eu lieu (garde de stock B8).
    setToast({ kind: 'cart', name: product.name })
  }

  function setQty(id, qty) {
    const product = catalog.find((p) => p.id === id)
    // LOT 3.5 (B8) : le plafond est calculé DANS la mise à jour. Avant, il
    // passait par `liveStock(product)` — donc par le `cart` du dernier rendu —
    // puis soustrayait/réajoutait la quantité déjà présente : deux changements
    // rapides lisaient la même valeur périmée.
    // P5 (B20) inchangé : plafond = stock VRAIMENT disponible (`stockMap`), pas
    // le `product.stock` statique ; produit sorti du catalogue → plafond 1.
    const max = product ? (stockMap[id] != null ? stockMap[id] : product.stock) : 1
    // LOT P3 (B19) : avec un stock a zero, `Math.min(0, Math.max(1, 2))`
    // rendait 0, et le `.filter(qty > 0)` du bas faisait disparaitre la LIGNE :
    // un clic sur « + » supprimait le produit du panier, sans un mot. Une
    // montee au-dessus de ce qui reste se refuse et se dit ; la descendre a 0
    // reste le moyen prevu de retirer la ligne (et fonctionne aussi en rupture).
    if (max < 1) {
      const deja = (cart.find((i) => i.id === id) || {}).qty || 0
      if (Number(qty) > deja) {
        setToast(t('outOfStock'))
        return
      }
    }
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: Math.min(max, Math.max(1, qty)) } : i))
        .filter((i) => i.qty > 0)
    )
  }

  function remove(id) {
    setCart((prev) => prev.filter((i) => i.id !== id))
  }

  const KNOWN_PAGES = ['shop', 'search', 'builder', 'about', 'orders', 'desk', 'master', 'help', 'profile', 'privacy', 'terms', 'warranty', 'product']

  function openProduct(id) {
    // Anti page blanche : référence inexistante/cachée → retour boutique.
    if (!catalog.some((p) => p.id === id)) {
      setPage('shop')
      return
    }
    setSelectedId(id)
    setPhotoIndex(0)
    setPage('product')
    setNavOpen(false)
    window.scrollTo({ top: 0 })
  }

  function go(next) {
    // LOT 2.1 (F1) : le panier est un OFFCANVAS, pas une page — il n'a donc pas
    // sa place dans `KNOWN_PAGES`, et le garde-fou ci-dessous le réécrivait en
    // `'shop'` AVANT que la branche `next === 'cart'` ne soit atteinte. Cette
    // branche était morte : depuis le configurateur, « Ajouter la config »
    // (`BuilderPage.jsx` → `onGoCart`) ajoutait bien les pièces au panier puis
    // renvoyait l'utilisateur sur la boutique, panier fermé. Le test ci-dessous
    // est donc placé EN TÊTE, et `KNOWN_PAGES` reste la liste des pages réelles.
    if (next === 'cart') {
      setCartOpen(true)
      setNavOpen(false)
      return
    }
    if (!KNOWN_PAGES.includes(next)) next = 'shop'
    if ((next === 'desk' || next === 'master' || next === 'help') && !isMaster) {
      setToast(t(next === 'help' ? 'masterOnlyGuide' : next === 'desk' ? 'masterOnlyDesk' : 'masterForbidden'))
      setAuthOpen(true)
      return
    }
    if (next === 'profile' && !user) {
      setAuthOpen(true)
      return
    }
    setPage(next)
    setNavOpen(false)
    setCartOpen(false)
    window.scrollTo({ top: 0 })
  }

  async function reserve(e) {
    e.preventDefault()
    // BUGFIX : plus de retour silencieux — chaque blocage de validation est
    // signalé (avant : clic « sans effet » si nom vide ou panier vide).
    if (cart.length === 0) {
      setToast(t('cartEmpty'))
      return
    }
    if (!pickup.name.trim()) {
      setNameErr(t('required'))
      return
    }
    setNameErr('')
    if (!isDzPhone(pickup.phone)) {
      setPhoneErr(t('phoneInvalid'))
      return
    }
    setPhoneErr('')
    const idempotencyKey = reservationKeyRef.current || newReservationKey()
    reservationKeyRef.current = idempotencyKey
    const base = {
      name: pickup.name.trim(),
      idempotencyKey,
      phone: normalizePhone(pickup.phone),
      carrier: phoneCarrier(pickup.phone),
      wilaya: pickup.wilaya,
      // P9 (P7-4) : « journée » = date LOCALE du client (Oran) — le serveur
      // l'intègre au code de commande et à l'export CSV (plus de décalage UTC).
      day: localDay(new Date()),
      payment: 'cash',
      slot: pickup.slot,
      // Date de retrait souhaitée (le comptoir peut la décaler ensuite).
      pickupDate: pickup.pickupDate || localDay(new Date()),
      // LOT 5.4 (U4) : `pricedCart`, pas `cart` — le récapitulatif local (repli
      // hors-ligne) et le message WhatsApp portent les mêmes prix que l'écran.
      items: pricedCart.map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        qty: i.qty,
        price: i.price
      })),
      total
    }

    if (apiOnline) {
      const r = await api.postOrder(base)
      if (r.ok && r.data?.order) {
        const order = { ...r.data.order, status: r.data.order.status || 'new' }
        // P11 : on persiste AUSSI localement la copie navigateur — avant, seul
        // le repli hors-ligne faisait saveOrders(), donc après un succès API la
        // commande « disparaissait » (aucune trace locale ; un guest n'avait
        // nulle part où la retrouver). La page « Commandes » croise maintenant
        // cette copie avec le serveur.
        commitReservations((prev) => [order, ...prev.filter((o) => o.code !== order.code)])
        setReserved(order)
        reservationKeyRef.current = null
        setCart([])
        setCartStep(0)
        setToast(t('ordersSynced'))
        await refreshStock()
        return
      }
      // P8 (P7-2) : seul un échec OFFLINE (backend injoignable) déclenche le
      // repli local — un 429 (rate-limit) ou un 5xx est signalé honnêtement,
      // le panier reste intact (avant : repli local silencieux = commande
      // invisible au shop + code en collision avec le serveur).
      const fail = orderApiFailure(r)
      if (fail.kind === 'stock') {
        // LOT 5.2 (U2) : le 409 du serveur porte `shortages` — la ligne qui
        // manque, la quantité demandée, ce qui reste. Tout était jeté au profit
        // d'un « Stock insuffisant » générique : à l'utilisateur de deviner
        // quelle ligne de son panier posait problème, puis de tester des
        // quantités au hasard. Le détail est maintenant nommé.
        setToast(shortageMessage(fail.shortages, t))
        await refreshStock()
        return
      }
      // LOT P1 (B13) : `unpriced` rejoint les deux refus ci-dessous — un article
      // sans prix exploitable côté serveur ne reviendra pas par un nouvel envoi
      // du panier, il faut donc le retirer comme les autres.
      // LOT 8.1 (A1) + LOT 8.2 (A2) : refus DÉFINITIF du serveur sur certaines
      // lignes — produit retiré de la vente par le maître, ou id inconnu du
      // catalogue (onglet ouvert avant un changement de catalogue, commande
      // rejouée). Le message nomme les lignes, elles sont retirées du panier, et
      // le reste reste commandable : sans cela l'utilisateur renvoyait la même
      // commande en boucle sur un échec identique — et le repli hors-ligne
      // pouvait finir par créer une commande locale sur un article fantôme.
      if (fail.kind === 'unavailable' || fail.kind === 'unknown' || fail.kind === 'unpriced') {
        setToast(orderBlockedMessage(fail.lines, t, fail.kind))
        const kept = dropCartLines(cart, fail.lines)
        setCart(kept)
        // Panier vidé par le retrait : on sort de l'étape de commande plutôt que
        // de laisser un formulaire de retrait face à un panier vide.
        if (!kept.length) setCartStep(0)
        await refreshStock()
        return
      }
      // La même clé a été présentée avec une intention différente. Cette
      // réponse protège le stock; on l'oublie ici pour que la prochaine action
      // utilisateur reçoive une nouvelle clé, sans la faire passer pour rupture.
      if (fail.kind === 'idempotency') {
        reservationKeyRef.current = null
        setToast(t('orderRetryConflict'))
        return
      }
      if (fail.kind === 'rate') {
        setToast(t('orderRateLimit', { n: fail.retryAfter || 60 }))
        return
      }
      if (fail.kind === 'server') {
        setToast(t('orderServerError'))
        return
      }
      // fail.kind === 'offline' → repli local ci-dessous
    }

    // Local fallback — still decrement local stockMap view
    // LOT 5.2 (U2) : mêmes exigences qu'avec le serveur. Le parcours s'arrêtait
    // sur la PREMIÈRE ligne courte avec le même message générique ; on collecte
    // maintenant toutes les lignes en manque et on les nomme (le repli local
    // connaît les quantités, il n'y a aucune raison d'être moins précis que
    // l'API).
    const localShortages = []
    for (const line of base.items) {
      // P5 (B14) : on compare le stock BRUT (pas liveStock qui soustrait le
      // panier — la ligne en cours de checkout fait partie du stock réservé)
      const raw = stockMap[line.id] != null ? stockMap[line.id] : catalog.find((p) => p.id === line.id)?.stock ?? 0
      if (raw < line.qty) {
        localShortages.push({ id: line.id, name: line.name, need: line.qty, left: Math.max(0, raw) })
      }
    }
    if (localShortages.length) {
      setToast(shortageMessage(localShortages, t))
      return
    }
    setStockMap((prev) => {
      const next = { ...prev }
      for (const line of base.items) {
        const raw = next[line.id] != null ? next[line.id] : catalog.find((p) => p.id === line.id)?.stock ?? 0
        next[line.id] = Math.max(0, raw - line.qty)
      }
      return next
    })
    // LOT 3.4 (B7) : le code est calculé sur le MIROIR SYNCHRONE, pas sur la
    // variable `reservations` capturée au dernier rendu. `reserve()` est
    // asynchrone : en mode mixte (API injoignable après l'envoi), deux
    // réservations quasi simultanées lisaient toutes deux la même closure
    // périmée et produisaient le MÊME code local. Le miroir est mis à jour dès
    // la création, donc la seconde réservation voit le code de la première.
    const currentOrders = reservationsRef.current
    // Cette clé ne sert qu'au protocole avec le serveur. Ne pas la conserver
    // dans la copie locale d'un repli hors-ligne (ni dans localStorage).
    const { idempotencyKey: _idempotencyKey, ...localOrderBase } = base
    const order = {
      // P8 (P7-2) : séquence = max des codes locaux du jour + 1 (jamais
      // `reservations.length + 1`) → plus de collision si la liste client est
      // partielle.
      code: nextLocalOrderCode(currentOrders.map((o) => o.code)),
      ...localOrderBase,
      // Le rattachement de la copie locale reflète uniquement la session qui
      // l'a créée; l'API détermine indépendamment son userId depuis le token.
      userId: user?.id || null,
      status: 'new',
      at: new Date().toISOString(),
      // LOT 2.3 (F5) : marqueur de commande JAMAIS envoyée au serveur. Sans
      // lui, `mergeServerOrders` ne peut pas la distinguer d'une copie locale
      // d'une commande supprimée côté serveur — et la réinjecter ferait
      // ressusciter les suppressions. Posé uniquement ici (repli hors-ligne) :
      // le chemin API ci-dessus ne le met pas.
      localOnly: true
    }
    commitReservations([order, ...currentOrders])
    setReserved(order)
    reservationKeyRef.current = null
    setCart([])
    setCartStep(0)
    // On n'arrive ici QUE si la commande n'a pas été acceptée par l'API
    // (échec ou offline) : le toast doit le dire, jamais « synchronisée ».
    setToast(t('ordersLocalOnly'))
  }

  // LOT 5.7 (U7) : mémoïsé. Le message était recomposé — puis
  // `encodeURIComponent`-é DEUX fois — à chaque rendu, donc à chaque frappe dans
  // le formulaire de retrait ou le champ de recherche (le composant entier se
  // re-rend). Sur un panier de 40 lignes, ça fait quelques centaines de
  // microsecondes par touche, pour un résultat strictement identique tant que
  // panier/total/retrait/langue n'ont pas bougé.
  // `t` est recréé à chaque rendu : c'est `lang` qui est en dépendance.
  const wa = useMemo(() => {
    // LOT 5.4 (U4) : le message WhatsApp porte les prix/labels LIVE, comme
    // l'écran et la commande — sinon le commerçant lit un récapitulatif qui ne
    // correspond à rien de ce que le client vient de voir.
    // LOT 8.8 (A8) : le message WhatsApp suit la langue de l'interface — le total
    // n'y fait plus exception (il restait au format français en mode arabe).
    const text = buildWaMessage(pricedCart, total, pickup, t, { lang })
    const encoded = encodeURIComponent(text)
    return {
      msg: text,
      href: `https://wa.me/${STORE.whatsapp}?text=${encoded}`,
      href2: `https://wa.me/${STORE.whatsapp2}?text=${encoded}`
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricedCart, total, pickup, lang])
  const msg = wa.msg
  const waHref = wa.href
  const waHref2 = wa.href2
  const carrier = phoneCarrier(pickup.phone)

  // LOT 5.1 (U1) : état système affiché dans la topbar.
  //  · offline  — API injoignable : mode local, commandes non synchronisées ;
  //  · degraded — API debout mais base en repli (catalogue/stock d'origine) ;
  //  · online   — tout vient du serveur.
  const sysState = !apiOnline ? 'offline' : catalogDegraded ? 'degraded' : 'online'

  const toastText = typeof toast === 'string' ? toast : toast?.kind === 'cart' ? `${toast.name} · ${t('addedToCart')}` : ''

  return (
    <div className={`app theme-${theme}`}>
      <a className="skip-link" href="#main-content">
        {t('skipToContent')}
      </a>
      {/* P12 (B25) : base injoignable → la vitrine reste debout sur le
          catalogue de base, mais l'utilisateur doit le savoir (prix/stock
          d'origine, masquages master ignorés, commandes non persistées). */}
      {catalogDegraded && !degradedDismissed && (
        <div className="alert alert-warning rounded-0 mb-0 py-2" role="alert">
          <div className="container d-flex flex-wrap align-items-center gap-2">
            <span className="small flex-grow-1">
              {t('catalogDegraded')}{' '}
              {/* LOT 3.16 (B19) : l'âge du repli est dit, au lieu d'être deviné.
                  `asOf` vient de la dernière lecture réussie (source `cache`) ;
                  sans elle (source `static`), c'est le catalogue du build. */}
              <span className="text-secondary">
                {degradedInfo?.asOf
                  ? t('catalogDegradedSince', { ago: timeAgo(degradedInfo.asOf, lang) })
                  : t('catalogDegradedStatic')}
              </span>
            </span>
            <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => window.location.reload()}>
              {t('catalogRetry')}
            </button>
            <button type="button" className="btn-close" onClick={() => setDegradedDismissed(true)} aria-label={t('close')} />
          </div>
        </div>
      )}
      {/* LOT 3.1 (F7 + F8) : stockage navigateur bloqué (cookies tiers refusés,
          navigation privée) ou plein → l'app tourne sur son repli mémoire. Le
          dire est la seule façon honnête d'expliquer un panier qui se vide au
          rechargement. LOT 5.10 (U10) : l'encadrement par un tiers, lui, est
          interdit en production (X-Frame-Options / frame-ancestors) — ce
          bandeau ne couvre pas ce cas, il ne se produira pas. */}
      {isStorageBlocked() && (
        <div className="alert alert-secondary rounded-0 mb-0 py-2" role="status">
          <div className="container">
            <span className="small">{t('storageBlockedNote')}</span>
          </div>
        </div>
      )}
      <div className="topbar small py-1">
        <div className="container d-flex flex-wrap justify-content-between gap-2">
          <span>
            {/* LOT 5.1 (U1) : l'indicateur reflète l'état RÉEL. Il était
                codé en dur — point vert + « SYS.ONLINE » en permanence, y
                compris API morte, base dégradée ou mode local : la seule
                information d'état du site disait toujours la même chose, et le
                bandeau dégradé (B19) était le seul indice, une fois descendu
                dans la page. Trois états, trois couleurs, et une explication
                dans la langue de l'utilisateur (title + aria-label) : le
                libellé terminal reste en anglais, c'est la charte graphique. */}
            <span
              className={sysState === 'online' ? 'text-success' : sysState === 'degraded' ? 'text-warning' : 'text-danger'}
              aria-hidden="true"
            >
              ●
            </span>{' '}
            <span title={t(`sysState_${sysState}`)}>
              <span aria-label={t(`sysState_${sysState}`)}>
                {sysState === 'online' ? 'SYS.ONLINE' : sysState === 'degraded' ? 'SYS.DEGRADED' : 'SYS.OFFLINE'}
              </span>{' '}
              {sysState === 'online' && <span className="blink" aria-hidden="true">_</span>}
            </span>
            {' · '}
            {t('storeOpen')} · Oran
          </span>
          <span className="topbar-right d-flex gap-3">
            <span dir="ltr">TEL {STORE.phone}</span>
            <span dir="ltr">TEL {STORE.phone2}</span>
            <span>SKU {catalog.length}</span>
          </span>
        </div>
      </div>

      <nav className="navbar navbar-expand-lg sticky-top border-bottom shop-navbar">
        <div className="container">
          <button type="button" className="navbar-brand btn btn-link text-decoration-none p-0 logo" onClick={() => go('shop')} aria-label="PC Star Informatique — accueil">
            <img src="/logo.png" alt="PC Star Informatique" className="logo-img" />
          </button>
          <div className="d-flex align-items-center gap-2 order-lg-last ms-auto ms-lg-0">
            <button
              type="button"
              className="btn btn-success position-relative"
              onClick={() => setCartOpen(true)}
              aria-label={count > 0 ? `${t('navCart')} (${count})` : t('navCart')}
            >
              {t('navCart')}
              {count > 0 && (
                <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" aria-hidden="true">
                  {count}
                </span>
              )}
            </button>
            <button
              className="navbar-toggler"
              type="button"
              aria-label={t('navMenu')}
              aria-expanded={navOpen}
              onClick={() => setNavOpen((v) => !v)}
            >
              <span className="navbar-toggler-icon" />
            </button>
          </div>
          {/*
            * LOT P4 (V5) — le menu latéral prend toute la page. L'ancien
            * `collapse` déroulait six liens hauts de 40 px sous la barre : sur un
            * téléphone, la moitié du menu restait sous le clavier ou sous la
            * ligne de flottaison, et le client qui voulait « se connecter »
            * voyait un bouton coupé. `.nav-sheet` (voir src/index.css) transforme
            * ce panneau en feuille pleine page, avec son propre en-tête de
            * fermeture — indispensable : la feuille couvre la barre, donc le
            * bouton ☰ n'est plus atteignable une fois ouvert.
            */}
          <div className={`collapse navbar-collapse nav-sheet ${navOpen ? 'show' : ''}`}>
            <div className="nav-sheet-head">
              <strong>{t('navMenu')}</strong>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setNavOpen(false)}>
                ✕ {t('close')}
              </button>
            </div>
            <ul className="navbar-nav me-auto mb-2 mb-lg-0 align-items-lg-center gap-lg-1">
              {[
                ['shop', t('navShop'), page === 'shop' || page === 'product'],
                ['search', t('navSearch'), page === 'search'],
                ['builder', t('navBuilder'), page === 'builder'],
                ['about', t('navAbout'), page === 'about'],
                // P11 : bouton « Commandes » dans le menu (page unique, tous
                // clients — un guest voit celles passées depuis cet appareil).
                ['orders', t('navOrders'), page === 'orders']
              ].map(([id, label, on]) => (
                <li className="nav-item" key={id}>
                  <button type="button" className={`nav-link btn btn-link ${on ? 'active fw-semibold' : ''}`} onClick={() => go(id)}>
                    {label}
                  </button>
                </li>
              ))}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'help' ? 'active fw-semibold' : ''}`} onClick={() => go('help')}>
                    {t('navHelp')}
                  </button>
                </li>
              )}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'desk' ? 'active fw-semibold' : ''}`} onClick={() => go('desk')}>
                    {t('navDesk')}
                  </button>
                </li>
              )}
              {isMaster && (
                <li className="nav-item">
                  <button type="button" className={`nav-link btn btn-link ${page === 'master' ? 'active fw-semibold' : ''}`} onClick={() => go('master')}>
                    {t('navMaster')}
                  </button>
                </li>
              )}
            </ul>
            <div className="d-flex flex-wrap align-items-center gap-2 py-2 py-lg-0">
              <div className="btn-group btn-group-sm" role="group" aria-label={t('lang')}>
                {LANGS.map((l) => (
                  <button key={l.id} type="button" className={`btn ${lang === l.id ? 'btn-success' : 'btn-outline-secondary'}`} onClick={() => changeLang(l.id)}>
                    {l.short}
                  </button>
                ))}
              </div>
              {/* Thème sombre supprimé à la demande du client : site blanc. */}
              {user ? (
                <>
                  {/*
                    P22 (bug E) : le bouton affichait `{user.name}` seul. La clé
                    `navProfile` existait dans les 3 langues sans jamais être
                    rendue, et rien n'indiquait à un lecteur d'écran que ce
                    bouton ouvre le profil — un compte nommé « A » donnait un
                    bouton d'un caractère. `aria-label` reprend le nom visible
                    (WCAG 2.5.3 « label in name ») plus sa fonction.
                  */}
                  <button
                    type="button"
                    className={`btn btn-sm ${page === 'profile' ? 'btn-success' : 'btn-outline-secondary'}`}
                    onClick={() => go('profile')}
                    title={t('navProfile')}
                    aria-label={`${t('navProfile')} — ${user.name}`}
                  >
                    {user.name}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={logout}>
                    {t('navLogout')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-sm btn-outline-success" onClick={() => { setAuthOpen(true); setNavOpen(false) }}>
                  {t('navLogin')}
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {page === 'shop' && (
        <main id="main-content" className="container page py-4" tabIndex={-1}>
          {/* Hero « photocopié » sur la maquette Terminal Cyber : prompt $,
              titre display, CTA et readout 4 compteurs live. */}
          <section className="hero hero-simple mb-4">
            <div className="prompt" dir="ltr">
              $ pcstar --catalog --stock=live
              <span className="blink" aria-hidden="true">▊</span>
            </div>
            <h1 className="fw-bold mb-2">{t('heroTitle')}</h1>
            <p className="lead mb-3">{t('heroBody')}</p>
            <div className="d-flex flex-wrap gap-2">
              <button className="btn btn-success" type="button" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>
                {t('browseShop')} →
              </button>
              <button className="btn" type="button" onClick={() => go('builder')}>
                {t('pcBuilder')}
              </button>
            </div>
            {/*
              * LOT P4 (V1) — deux des quatre compteurs changent de nature.
              * « références » (301 fiches) ne regardait personne : c'est un
              * chiffre de stock interne. La vitrine dit desormais ce qui se passe
              * AU comptoir : combien de commandes ont ete prevenues « pretes »
              * (compte par le serveur, jamais saisi), et — a la demande du
              * maitre — le nombre de reparations faites, dont il ecrit
              * lui-meme le libelle et le chiffre (page Admin → Vitrine). Les
              * clients lisent, ils ne touchent a rien : l'API d'ecriture est
              * reservee au role maitre, et le troisieme champ n'est pas
              * ecrasable depuis le navigateur.
              */}
            <div className="readout">
              <div className="ro">
                <b>{vitrine.readyTally}</b>
                <span>{t('roOrders')}</span>
              </div>
              <div className="ro">
                <b>{catalog.filter((p) => p.category === 'gpu').length}</b>
                <span>{t('roGpu')}</span>
              </div>
              <div className="ro">
                <b>{catalog.filter((p) => p.category === 'laptop').length}</b>
                <span>{t('roLaptops')}</span>
              </div>
              <div className="ro">
                <b>{vitrine.repairsDone}</b>
                <span>{vitrine.repairsLabel || t('roRepairs')}</span>
              </div>
            </div>
          </section>

          {/* À la demande du client : sections « Hits DZ » et « hits marché
              Algérie » supprimées — la page commence par le hero puis
              enchaîne directement sur filtres + catalogue (image-1). */}

          {/* P11 : section « Configs Star » + ses cartes supprimées sur demande. */}

          {/*
            * LOT P4 (V2) — les filtres de la vitrine. L'ancienne rangee dressait
            * TOUTES les marques vendues en puces avant meme le premier produit :
            * sur un telephone, une page entiere a scroller pour arriver au
            * catalogue. Chaque filtre devient un bouton qui ouvre son panneau, et
            * le bouton porte la valeur choisie (« Marques · Raidmax ») — le filtre
            * reste lisible une fois ferme. Le champ de recherche du panneau
            * marques ne filtre QUE la liste des marques : s'il filtrait aussi le
            * catalogue, fermer le panneau aurait change les resultats sans que
            * personne ne l'ait demande.
            */}
          <div className="filters-bar mb-3" id="catalog">
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <button
                type="button"
                className={`btn btn-sm ${brandFilter ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => setShopSheet(shopSheet === 'brands' ? null : 'brands')}
                aria-expanded={shopSheet === 'brands'}
                aria-controls={shopSheet === 'brands' ? 'sheet-brands' : undefined}
              >
                {t('filterBrands')}
                {brandFilter ? ` · ${brandFilter}` : ''}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${category !== 'all' ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => setShopSheet(shopSheet === 'catalog' ? null : 'catalog')}
                aria-expanded={shopSheet === 'catalog'}
                aria-controls={shopSheet === 'catalog' ? 'sheet-catalog' : undefined}
              >
                {t('filterCatalog')}
                {category !== 'all' ? ` · ${catLabel(category)}` : ''}
              </button>
              {(brandFilter || category !== 'all' || query.trim()) && (
                <button type="button" className="btn btn-sm btn-link" onClick={resetShopFilters}>
                  {t('reset')}
                </button>
              )}
              <ChoixTaille t={t} taille={shopTaille} onTaille={setShopTaille} />
              <input
                className="form-control form-control-sm ms-lg-auto"
                style={{ maxWidth: 280 }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('navSearch')}
              />
            </div>

            {shopSheet === 'brands' && (
              <div className="filter-sheet" id="sheet-brands" role="group" aria-label={t('filterBrands')}>
                <BrandSheet
                  t={t}
                  marques={marquesVendues}
                  estActive={(b) => brandFilter === b}
                  onChoisir={(b) => { setBrandFilter(brandFilter === b ? null : b); setShopSheet(null) }}
                  onTout={() => { setBrandFilter(null); setShopSheet(null) }}
                />
              </div>
            )}

            {shopSheet === 'catalog' && (
              <div className="filter-sheet" id="sheet-catalog" role="group" aria-label={t('filterCatalog')}>
                <div className="filter-sheet-grid">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`btn btn-sm cat-${c.id} ${category === c.id ? 'btn-success' : 'btn-outline-secondary'}`}
                      onClick={() => { setCategory(c.id); setShopSheet(null) }}
                    >
                      {/* LOT 5.6 (U6) : repli explicite — `t()` renvoie la clé quand
                          la traduction manque. Une catégorie master ajoutée sans
                          traduction ne doit pas fuiter jusqu'à l'écran. */}
                      {labelOr(t, `cat_${c.id}`, c.label || c.id)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="small text-secondary mb-2">
            {t('shopCount', { n: list.length })}
            {shopPages > 1 ? t('shopPageOf', { page: shopPageSure, pages: shopPages }) : ''}
          </p>

          {list.length === 0 ? (
            <div className="empty-state">
              <strong>{t('noProducts')}</strong>
              <button type="button" className="btn btn-sm btn-outline-success mt-2" onClick={resetShopFilters}>
                {t('reset')}
              </button>
            </div>
          ) : (
            <>
              <div className="row g-3">
                {pageProduits.map((p) => {
                  const left = liveStock(p)
                  const st = stockLabel(left, t)
                  return (
                    <div className="col-6 col-md-4 col-xl-3" key={p.id}>
                      <div className="card h-100 shadow-sm product-bs-card">
                        <button className="btn p-0 border-0 position-relative" type="button" onClick={() => openProduct(p.id)} aria-label={p.name}>
                          <div className="ratio ratio-4x3 photo-frame overflow-hidden">
                            <PartThumb product={p} />
                          </div>
                          <span className={`badge position-absolute top-0 start-0 m-2 ${st.cls}`}>
                            {st.text}
                          </span>
                          {p.photoMode === 'category' && <span className="badge text-bg-light border position-absolute top-0 end-0 m-2">{t('categoryIllustrationBadge')}</span>}
                        </button>
                        {/* Corps de carte photocopié sur la maquette :
                            marque → titre → specs → ligne prix / + panier. */}
                        <div className="card-body d-flex flex-column">
                          <span className="cbrand">{p.brand}</span>
                          <h3 className="h6 card-title">{p.name}</h3>
                          <div className="specs">
                            {specRows(p, t).slice(2, 6).map((r) => (
                              <span className="d-block" key={r.label}>
                                <i>{r.label}</i> {r.value}
                              </span>
                            ))}
                          </div>
                          <div className="card-row mt-auto d-flex justify-content-between align-items-center gap-2">
                            <span className="d-flex flex-column">
                              <span className="price text-success">{money(p.price, lang)}</span>
                              {hasSale(p) && <small className="text-danger"><del>{money(p.compareAtPrice, lang)}</del> · −{discountPercent(p)}%</small>}
                            </span>
                            <button className="btn btn-sm btn-success" type="button" disabled={left <= 0} onClick={() => add(p)}>
                              {left <= 0 ? t('soldOut') : t('add')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* LOT P6 (S3) : le pager est `Pager` (src/pagerControls.jsx), la
                  fenetre de numeros vient de `fenetrePages` — ni la vitrine ni la
                  recherche ne dressent plus un bouton par page. */}
              <Pager t={t} page={shopPageSure} pages={shopPages} onPage={gotoPage} />
            </>
          )}

          {/* ── Configurateur : un acces, plus de tableau decoratif ──
              LOT P4 (V3) : le panneau « split » de la maquette recitait cinq
              lignes de composants (Ryzen 5 7600 · 42 000, B650 · AM5 · 28 000 …)
              et un total de 177 000 DA — des nombres ECRITS EN DUR dans le JSX,
              qui ne venaient ni du catalogue ni d'une vraie configuration, a
              cote d'une liste de controles de compatibilite simules
              (« [OK] socket AM5 »). Le client voyait un devis qui n'en etait
              pas un. Le tout est retire : le catalogue continue en pages
              au-dessus, et le configurateur reste a un clic. */}
          <section className="py-4">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 border-top pt-3">
              <div>
                <h2 className="h5 mb-1">{t('pcBuilder')}</h2>
                <p className="small text-secondary mb-0">{t('builderBody', { address: STORE.address })}</p>
              </div>
              {/* La cle porte deja sa fleche (« Ouvrir le configurateur → ») :
                  l'ajouter ici la doublait a l'ecran. */}
              <button className="btn btn-success" type="button" onClick={() => go('builder')}>
                {t('openBuilder')}
              </button>
            </div>
          </section>

          {/* ── Le comptoir : panneau « store » de la maquette ── */}
          <section className="py-5">
            <div className="mb-4">
              <h2 className="h4 mb-1">{t('secStore')}</h2>
              <p className="small text-secondary mb-0">{t('storeNote')}</p>
            </div>
            <div className="store">
              <div>
                <h3 className="h5">PC Star Informatique</h3>
                <div className="kv">
                  <div>
                    <dt>{t('kvAddr')}</dt>
                    <dd>{STORE.address}</dd>
                  </div>
                  <div>
                    <dt>{t('kvTel')}</dt>
                    <dd dir="ltr">{STORE.phone} · {STORE.phone2}</dd>
                  </div>
                  <div>
                    <dt>{t('kvHours')}</dt>
                    <dd>{t('storeHours')}</dd>
                  </div>
                  <div>
                    <dt>{t('kvPay')}</dt>
                    <dd>{t('payCash')}</dd>
                  </div>
                </div>
                <div className="d-flex flex-wrap gap-2 mt-4">
                  <ContactButton
                    label="WhatsApp"
                    btnClass="btn"
                    choices={[
                      { title: STORE.phone, href: `https://wa.me/${STORE.whatsapp}`, external: true },
                      { title: STORE.phone2, href: `https://wa.me/${STORE.whatsapp2}`, external: true }
                    ]}
                  />
                  <a className="btn" href={STORE.mapUrl} target="_blank" rel="noreferrer">
                    {t('openMaps')}
                  </a>
                </div>
              </div>
              <div className="map" dir="ltr">
                EL MAKARI LES CASTORS
                <br />
                ORAN · DZ
                <br />
                35.6969 N / 0.6331 W
              </div>
            </div>
          </section>
        </main>
      )}

      {page === 'search' && (
        <SearchPage t={t} products={catalog} lines={shopView.lines} panels={shopView.panels} lang={lang} liveStock={liveStock} onAdd={add} onOpen={openProduct} />
      )}

      {page === 'product' && selected && (
        <ProductPage
          key={selected.id}
          t={t}
          lang={lang}
          product={selected}
          photoIndex={photoIndex}
          setPhotoIndex={setPhotoIndex}
          left={liveStock(selected)}
          onBack={() => go('shop')}
          onAdd={() => add(selected)}
          onOpen={openProduct}
          liveStock={liveStock}
          onAddRelated={add}
          catalog={catalog}
        />
      )}

      {page === 'builder' && (
        <BuilderPage
          t={t}
          lang={lang}
          products={catalog}
          build={build}
          setBuild={setBuild}
          liveStock={liveStock}
          onAdd={add}
          onOpen={openProduct}
          onGoCart={() => go('cart')}
          setToast={setToast}
        />
      )}

      {page === 'about' && (
        <main id="main-content" className="container page py-4" tabIndex={-1}>
          <div className="row g-4">
            <div className="col-lg-7">
              <h1 className="h3 mb-3">{t('aboutTitle')}</h1>
              <p className="lead fs-6 text-secondary">{t('storeAbout')}</p>
              <p>{t('storeServices')}</p>
              <p className="text-secondary">{t('storeBuyNote')}</p>
              <div className="row g-3 my-3">
                {SHOP_SERVICES.map((s) => (
                  <div className="col-sm-6" key={s.id}>
                    <article className="card h-100 shadow-sm border-0">
                      <div className="card-body">
                        <h3 className="h6">{t(s.titleKey)}</h3>
                        <p className="small text-secondary mb-0">{t(s.bodyKey)}</p>
                      </div>
                    </article>
                  </div>
                ))}
              </div>
              <ul className="list-group list-group-flush mb-3">
                <li className="list-group-item px-0">
                  <strong>{STORE.address}</strong>
                </li>
                <li className="list-group-item px-0 text-secondary">{t('storeHours')}</li>
                <li className="list-group-item px-0 text-secondary">{t('storeReady')}</li>
                <li className="list-group-item px-0">
                  <a href={`mailto:${STORE.email}`}>{STORE.email}</a>
                </li>
                <li className="list-group-item px-0">
                  {t('call')}{' '}
                  <a href={STORE.phoneHref}>{STORE.phone}</a>
                  {' · '}
                  <a href={STORE.phone2Href}>{STORE.phone2}</a>
                </li>
              </ul>
              <div className="d-flex flex-wrap gap-2">
                {STORE_LINKS.map((l) => (
                  <a
                    key={l.id}
                    className={`btn btn-sm social-btn social-${l.css || l.id} text-white`}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => openExternal(e, l.href)}
                  >
                    <strong>{l.label}</strong>
                    <span className="d-block small opacity-75">{l.subKey ? t(l.subKey) : l.sub}</span>
                  </a>
                ))}
              </div>
            </div>
            <div className="col-lg-5">
              <div className="card shadow-sm border-0 overflow-hidden h-100">
                <div className="ratio ratio-4x3">
                  <iframe title="PC Star map" src={STORE.mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="border-0" />
                </div>
                <div className="card-body">
                  <a className="btn btn-outline-success btn-sm" href={STORE.mapUrl} target="_blank" rel="noreferrer" onClick={(e) => openExternal(e, STORE.mapUrl)}>
                    Google Maps
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {page === 'help' && isMaster && (
        <main id="main-content" className="container page py-4" tabIndex={-1}>
          <div className="alert alert-warning border-0 shadow-sm" role="status">
            {t('masterOnlyGuideNote')}
          </div>
          <h1 className="h3 mb-3">{t('helpTitle')}</h1>
          <div className="row g-3">
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">1. {t('authTitle')}</h2>
                  <p>{t('authSimpleNote')}</p>
                  <p className="small text-secondary">{t('helpNoPublicDemo')}</p>
                  <button type="button" className="btn btn-success" onClick={() => setAuthOpen(true)}>
                    {t('navLogin')}
                  </button>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">2. {t('roleMaster')}</h2>
                  <ol className="mb-2 ps-3">
                    <li>{t('navLogin')} → master</li>
                    <li>
                      {t('navMaster')} → {t('masterAddProduct')} / {t('masterHide')}
                    </li>
                    <li>
                      {t('navDesk')} → {t('deskHint')}
                    </li>
                  </ol>
                  <p className="small text-secondary mb-0">
                    API multi-device: <code>npm run start:api</code> + <code>npm run dev</code>
                  </p>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">3. {t('roleCustomer')}</h2>
                  <ol className="mb-0 ps-3">
                    <li>
                      {t('navShop')} / {t('navSearch')} / {t('navBuilder')}
                    </li>
                    <li>
                      {t('navCart')} → tél 05/06/07 → {t('reservePickup')}
                    </li>
                    <li>Code PS-xxxxxx au comptoir Oran</li>
                  </ol>
                </div>
              </article>
            </div>
            <div className="col-md-6">
              <article className="card h-100 shadow-sm">
                <div className="card-body">
                  <h2 className="h5">4. {t('navBuilder')}</h2>
                  <p>{t('builderBody', { address: STORE.address })}</p>
                  <p className="small text-secondary">
                    {t('willNotRun')} · {t('watchThis')}
                  </p>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => go('builder')}>
                    {t('pcBuilder')}
                  </button>
                </div>
              </article>
            </div>
          </div>
        </main>
      )}

      {page === 'desk' && isMaster && (
        <DeskPage
          t={t}
          lang={lang}
          reservations={reservations}
          onStatus={handleOrderStatus}
          onPickupDate={handleOrderPickup}
          onDelete={handleOrderDelete}
          setToast={setToast}
        />
      )}

      {(page === 'warranty' || page === 'privacy' || page === 'terms') && (
        <LegalPage t={t} kind={page} onBack={() => go('shop')} />
      )}

      {page === 'profile' && user && (
        <ProfilePage
          t={t}
          user={user}
          users={users}
          onUsers={persistUsers}
          onUser={(u) => {
            if (authMode === 'api') setApiUser(u)
            else persistSession({ userId: u.id })
          }}
          setToast={setToast}
          onBack={() => go('shop')}
          apiOnline={apiOnline}
          mode={authMode}
        />
      )}

      {/* P11 : page unique « Commandes » (bouton du menu) — accessible aussi
          aux guests (commandes passées depuis cet appareil). */}
      {page === 'orders' && (
        <OrdersPage
          t={t}
          lang={lang}
          user={user}
          apiOnline={apiOnline}
          mode={authMode}
          onCancelOrder={cancelMyOrder}
          onClaimOrder={claimMyOrder}
          onBack={() => go('shop')}
        />
      )}

      {page === 'master' && (
        <MasterPage
          t={t}
          lang={lang}
          user={user}
          users={users}
          onUsers={persistUsers}
          products={catalog}
          masterCatalog={shopView.products}
          meta={meta}
          onMeta={persistMeta}
          basePanels={BASE_PANELS}
          setToast={setToast}
          onBack={() => go('shop')}
          apiOnline={apiOnline && authMode === 'api'}
          onStockRefresh={refreshStock}
        />
      )}

      {/* Footer photocopié sur la maquette : © à gauche, liens à droite.
          (Garantie retirée sur demande explicite du client.) */}
      <footer className="site-footer mt-auto">
        <div className="container py-4 d-flex flex-wrap justify-content-between align-items-center gap-3">
          <p className="small mb-0">© 2026 PC STAR INFORMATIQUE — ORAN, DZ</p>
          <div className="footer-links d-flex gap-3">
            <button type="button" onClick={() => go('about')}>{t('navAbout')}</button>
            <button type="button" onClick={() => go('privacy')}>{t('navPrivacy')}</button>
            <button type="button" onClick={() => go('terms')}>{t('navTerms')}</button>
          </div>
        </div>
      </footer>

      {/* FAB WhatsApp unique : au clic, choix du numéro (07 ou 06). */}
      <ContactButton
        wrapClass="wa-fab-wrap"
        btnClass="wa-fab"
        dropUp
        label="WhatsApp"
        choices={[
          { title: STORE.phone, href: `https://wa.me/${STORE.whatsapp}`, external: true },
          { title: STORE.phone2, href: `https://wa.me/${STORE.whatsapp2}`, external: true }
        ]}
      />

      {/* Cart offcanvas — controlled via Bootstrap Offcanvas API */}
      <div
        ref={cartElRef}
        className="offcanvas offcanvas-end"
        tabIndex={-1}
        id="cartOffcanvas"
        aria-labelledby="cartOffcanvasLabel"
      >
        <div className="offcanvas-header border-bottom">
          <h2 className="offcanvas-title h5 mb-0" id="cartOffcanvasLabel">
            {t('cartTitle')} {count > 0 ? `(${count})` : ''}
          </h2>
          <button type="button" className="btn-close" data-bs-dismiss="offcanvas" aria-label={t('close')} />
        </div>
        <div className="offcanvas-body d-flex flex-column">
          {reserved ? (
            <div className="text-center py-2">
              <div className="text-success mb-2 fw-semibold">{t('successTitle')}</div>
              <div className="display-6 fw-bold font-monospace mb-2">{reserved.code}</div>
              <p className="small text-secondary">{t('successShowCode')}</p>
              <div className="alert alert-success text-start">
                <div className="fw-semibold mb-1">{reserved.name}</div>
                <div className="small">{reserved.slot} · {STORE.address}</div>
                <div className="small mt-2">{t('successCash')}</div>
                <div className="fs-5 fw-bold text-success mt-2">{money(reserved.total, lang)}</div>
              </div>
              <div className="d-grid gap-2">
                {user && (
                  <button
                    className="btn btn-outline-dark"
                    type="button"
                    onClick={() => {
                      setReserved(null)
                      setCartOpen(false)
                      // LOT P3 (B21) : le libellé dit « Mes commandes » et
                      // envoyait sur le profil. Depuis le LOT 5.x, « Mes
                      // commandes » est SORTI du profil (`src/OrdersPage.jsx`,
                      // que `ProfilePage.jsx:6-7` cite lui-même) : le bouton
                      // menait donc à un écran qui n'affiche aucune commande.
                      go('orders')
                    }}
                  >
                    {t('viewMyOrders')}
                  </button>
                )}
                <a className="btn btn-outline-success btn-sm" href={STORE.mapUrl} target="_blank" rel="noreferrer">
                  {t('openMaps')}
                </a>
                <ContactButton
                  label={t('call')}
                  btnClass="btn btn-outline-secondary btn-sm"
                  choices={[
                    { title: STORE.phone, href: STORE.phoneHref },
                    { title: STORE.phone2, href: STORE.phone2Href }
                  ]}
                />
                <button
                  className="btn btn-success"
                  type="button"
                  onClick={() => {
                    setReserved(null)
                    setCartOpen(false)
                    go('shop')
                  }}
                >
                  {t('backToShop')}
                </button>
              </div>
            </div>
          ) : cart.length === 0 ? (
            <div className="empty-state my-4">
              <strong>{t('emptyCartTitle')}</strong>
              <p className="small mb-3">{t('emptyCartBody')}</p>
              <button type="button" className="btn btn-success btn-sm" onClick={() => { setCartOpen(false); go('shop') }}>
                {t('browseShop')}
              </button>
            </div>
          ) : (
            <>
              <div className="d-flex justify-content-between small mb-3 px-1">
                {[t('cartStepCart'), t('cartStepInfo'), t('cartStepDone')].map((label, i) => (
                  <span key={label} className={i <= (reserved ? 2 : cartStep) ? 'text-success fw-semibold' : 'text-secondary'}>
                    {i + 1}. {label}
                  </span>
                ))}
              </div>
              <div className="list-group list-group-flush mb-3 flex-grow-1 overflow-auto">
                {pricedCart.map((i) => (
                  <div className="list-group-item px-0" key={i.id}>
                    <div className="d-flex gap-3">
                      <div style={{ width: 64, height: 64 }} className="rounded overflow-hidden photo-frame flex-shrink-0">
                        <PartThumb product={i} />
                      </div>
                      <div className="flex-grow-1">
                        <div className="small text-secondary">{i.sku}</div>
                        <div className="fw-semibold">{i.name}</div>
                        <div className="d-flex align-items-center gap-2 mt-1">
                          <div className="btn-group btn-group-sm">
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setQty(i.id, i.qty - 1)}>-</button>
                            <span className="btn btn-outline-secondary disabled">{i.qty}</span>
                            <button type="button" className="btn btn-outline-secondary" onClick={() => setQty(i.id, i.qty + 1)}>+</button>
                          </div>
                          <button type="button" className="btn btn-sm btn-link text-danger" onClick={() => remove(i.id)}>
                            {t('remove')}
                          </button>
                          <strong className="ms-auto">{money(i.qty * i.price, lang)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {blocks.length > 0 && (
                <div className="alert alert-danger py-2">
                  <strong>{t('willNotRun')}</strong>
                  {blocks.map((w, i) => (
                    <div key={`${w.key}-${i}`} className="small">{t(w.key, w.vars)}</div>
                  ))}
                </div>
              )}
              {notes.length > 0 && (
                <div className="alert alert-warning py-2">
                  <strong>{t('watchThis')}</strong>
                  {notes.map((w, i) => (
                    <div key={`${w.key}-${i}`} className="small">{t(w.key, w.vars)}</div>
                  ))}
                </div>
              )}

              <form onSubmit={reserve} className="border-top pt-3 mt-auto" onFocus={() => setCartStep(1)}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="fw-semibold">{t('total')}</span>
                  <span className="fs-5 fw-bold text-success">{money(total, lang)}</span>
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="name">{t('yourName')}</label>
                  <input
                    id="name"
                    className={`form-control ${nameErr ? 'is-invalid' : ''}`}
                    value={pickup.name}
                    onChange={(e) => {
                      setPickup({ ...pickup, name: e.target.value })
                      setNameErr('')
                    }}
                    required
                  />
                  {nameErr && <div className="invalid-feedback d-block">{nameErr}</div>}
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="phone">{t('phone')}</label>
                  <input
                    id="phone"
                    className={`form-control ${phoneErr ? 'is-invalid' : ''}`}
                    value={pickup.phone}
                    onChange={(e) => {
                      setPickup({ ...pickup, phone: e.target.value })
                      setPhoneErr('')
                    }}
                    required
                    inputMode="tel"
                    placeholder="05xx / 06xx / 07xx"
                  />
                  {phoneErr && <div className="invalid-feedback d-block">{phoneErr}</div>}
                  <div className="form-text">
                    {t('carrierNote')}
                    {carrier === 'mobilis' && ` · ${t('carrierMobilis')}`}
                    {carrier === 'ooredoo' && ` · ${t('carrierOoredoo')}`}
                    {carrier === 'djezzy' && ` · ${t('carrierDjezzy')}`}
                  </div>
                </div>
                {/* P11 : champ wilaya retiré du panier sur demande — la wilaya
                    reste transmise (profil du client ou « Oran » par défaut). */}
                {/* P21 : bloc « Mode de paiement / Espèces au comptoir » retiré
                    du panier — le paiement reste `cash` côté données. */}
                <div className="mb-2">
                  <label className="form-label small mb-1" htmlFor="pickup-date">{t('pickupDate')}</label>
                  <input
                    id="pickup-date"
                    type="date"
                    className="form-select"
                    min={localDay(new Date())}
                    value={pickup.pickupDate || localDay(new Date())}
                    onChange={(e) => setPickup({ ...pickup, pickupDate: e.target.value })}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small mb-1" htmlFor="slot">{t('timeSlot')}</label>
                  <select id="slot" className="form-select" value={pickup.slot} onChange={(e) => setPickup({ ...pickup, slot: e.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-success w-100 mb-2" type="submit">{t('reservePickup')}</button>
                <div className="d-grid gap-2">
                  <ContactButton
                    block
                    label={t('whatsappCart')}
                    btnClass="btn btn-outline-secondary btn-sm"
                    choices={[
                      { title: STORE.phone, href: waHref, external: true },
                      { title: STORE.phone2, href: waHref2, external: true }
                    ]}
                  />
                  <ContactButton
                    block
                    label={t('call')}
                    btnClass="btn btn-outline-secondary btn-sm"
                    choices={[
                      { title: STORE.phone, href: STORE.phoneHref },
                      { title: STORE.phone2, href: STORE.phone2Href }
                    ]}
                  />
                </div>
                <p className="small text-secondary mt-2 mb-0">{t('storeReady')}</p>
              </form>
            </>
          )}
        </div>
      </div>

      {toastText && (
        <div className="position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1100 }}>
          <div className="toast show align-items-center text-bg-success border-0 pc-toast" role="status" aria-live="polite">
            <div className="d-flex align-items-center w-100">
              <div className="toast-body flex-grow-1">
                <div className="fw-semibold">{toastText}</div>
                {typeof toast === 'object' && toast?.kind === 'cart' && (
                  <div className="small opacity-75">{t('itemsInCart', { n: count })}</div>
                )}
              </div>
              {typeof toast === 'object' && toast?.kind === 'cart' && (
                <button type="button" className="btn btn-sm btn-light me-2" onClick={() => { setToast(''); setCartOpen(true) }}>
                  {t('viewCart')}
                </button>
              )}
              <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={() => setToast('')} aria-label={t('close')} />
            </div>
          </div>
        </div>
      )}

      {authOpen && (
        <AuthPanel
          t={t}
          users={users}
          onUsers={persistUsers}
          onSession={(s) => {
            persistSession(s)
            // après login local → page d'accueil
            if (s?.userId) {
              setPage('shop')
              setNavOpen(false)
              window.scrollTo({ top: 0 })
            }
          }}
          onClose={() => setAuthOpen(false)}
          setToast={setToast}
          apiOnline={apiOnline}
          onApiUser={onApiUser}
        />
      )}

    </div>
  )
}
