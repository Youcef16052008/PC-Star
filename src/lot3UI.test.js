import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 3 — robustesse & concurrence, partie UI (composants réels dans jsdom).
//
//  3.5  (B8)   garde de stock DANS l'updater : double-clic « Ajouter » avec
//              stock 1 → UNE seule unité au panier
//  3.8  (B11)  401 en polling Desk → jeton purgé, mode local, message
//              « Session expirée » (plus de silence jusqu'à la fermeture)
//  3.11 (B16)  premier pull du Desk : les commandes arrivées depuis le dernier
//              horodatage persisté sont annoncées (toast + notification bornée)
//  3.16 (B19)  bandeau dégradé DATÉ : l'âge du repli (`cache`) ou son origine
//              (`static`) est dit à l'utilisateur
//
// La logique pure (safeStorage, handler 401, plafond de reconnexion du socket)
// est dans src/lot3Client.test.js ; le montage avec un stockage navigateur
// bloqué, dans src/lot3StorageBlocked.test.js.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'getComputedStyle'
]) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('./App.jsx')
const { dict } = await import('./i18n.js')
const { PRODUCTS } = await import('./data.js')
const api = await import('./api.js')
const { saveDeskSeenAt, loadDeskSeenAt, saveLang } = await import('./prefs.js')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const t = (key, vars) => {
  let s = dict.fr[key] ?? key
  Object.entries(vars || {}).forEach(([k, v]) => {
    s = s.replaceAll(`{${k}}`, String(v))
  })
  return s
}
const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const realFetch = globalThis.fetch

before(() => {
  // AudioContext n'existe pas dans jsdom : le bip du Desk doit rester silencieux.
  delete window.AudioContext
  delete window.webkitAudioContext
})

after(async () => {
  await settle(20)
  globalThis.fetch = realFetch
  for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
    try {
      delete globalThis[k]
    } catch {
      /* getter-only */
    }
  }
})

/* ---------------------------------------------------------------- harness */

const json = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => data,
  text: async () => JSON.stringify(data)
})

/**
 * Monte l'App avec un réseau simulé.
 * @param {object} routes réponses par préfixe d'URL, ou fonction (path, n) → réponse
 */
async function mountApp(routes = {}, { token = null, seed = null, strict = false, countCartWrites = false } = {}) {
  window.localStorage.clear()
  resetSafeStorage()
  // Langue forcée : les assertions comparent au texte `dict.fr`. Sans cela
  // l'app part sur la langue détectée (ar) et rien ne correspond.
  saveLang(safeStorage, 'fr')
  if (token) api.setToken(token)
  // Amorçage éventuel APRÈS le nettoyage du stockage (un seed fait avant
  // `mountApp` serait effacé par `localStorage.clear()`).
  if (seed) seed(safeStorage)
  const hits = {}
  globalThis.fetch = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    hits[path] = (hits[path] || 0) + 1
    const n = hits[path]
    for (const [prefix, value] of Object.entries(routes)) {
      if (path.startsWith(prefix)) {
        const out = typeof value === 'function' ? value(path, n) : value
        // `delay` permet de faire arriver une réponse APRÈS une plus récente :
        // c'est exactement la course que la garde de fraîcheur (B10) tranche.
        if (out && out.delay) await new Promise((r) => setTimeout(r, out.delay))
        return json(out.body ?? out, out.status ?? 200)
      }
    }
    return json({ ok: true })
  }
  window.fetch = globalThis.fetch

  // LOT 3.3 (B6) : compte les écritures du panier dans le stockage. En
  // StrictMode React rappelle les updaters : une écriture depuis un updater en
  // produisait donc DEUX pour une seule mutation.
  let cartWrites = 0
  // jsdom implémente `Storage` avec un Proxy : `localStorage.setItem = fn`
  // stockerait une CLÉ nommée « setItem » au lieu de remplacer la méthode.
  // L'interception se fait donc sur le prototype.
  const storageProto = Object.getPrototypeOf(window.localStorage)
  const realSetItem = storageProto.setItem
  if (countCartWrites) {
    storageProto.setItem = function patched(k, v) {
      if (String(k).startsWith('pcstar-cart-')) cartWrites += 1
      return realSetItem.call(this, k, v)
    }
  }

  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  const tree = strict ? React.createElement(React.StrictMode, null, React.createElement(App)) : React.createElement(App)
  await act(async () => {
    root.render(tree)
  })
  await settle(200)
  return {
    host,
    cartWrites: () => cartWrites,
    resetCartWrites: () => {
      cartWrites = 0
    },
    restoreSetItem: () => {
      storageProto.setItem = realSetItem
    },
    hits,
    text: () => clean(host),
    all: (selector) => [...host.querySelectorAll(selector)],
    byText: (selector, text_) => [...host.querySelectorAll(selector)].find((n) => clean(n) === text_) || null,
    byTextIncludes: (selector, text_) => [...host.querySelectorAll(selector)].find((n) => clean(n).includes(text_)) || null,
    toast: () => clean(host.querySelector('.pc-toast .toast-body')),
    unmount: async () => {
      await settle(20)
      root.unmount()
      host.remove()
      storageProto.setItem = realSetItem
      globalThis.fetch = realFetch
      await settle(20)
    }
  }
}

async function click(el) {
  assert.ok(el, 'élément cliquable trouvé')
  await act(async () => {
    el.click()
  })
  await settle(100)
}

/** Catalogue API minimal : produits réels + état dégradé paramétrable. */
const catalogResponse = ({ degraded = false, db = null, products = PRODUCTS } = {}) => ({
  ok: true,
  degraded,
  products: products.map((p) => ({ ...p })),
  ...(db ? { db } : {})
})

const MASTER_USER = {
  id: 'master-pcstar',
  role: 'master',
  email: 'master@test.pcstar.local',
  name: 'PC Star Desk',
  links: { google: null, meta: null }
}

/* ------------------------------------------------------------------ 3.16 */

describe('LOT 3.16 (B19) — le bandeau dégradé dit l’âge du repli', () => {
  it('repli `cache` → « dernière lecture réussie il y a … »', async () => {
    const asOf = Date.now() - 2 * 60 * 60 * 1000 // 2 h
    const m = await mountApp({
      '/api/health': { ok: true, driver: 'file' },
      '/api/catalog': catalogResponse({ degraded: true, db: { driver: 'file', reachable: false, error: 'ECONNREFUSED', asOf, source: 'cache' } }),
      '/api/meta': { ok: true, degraded: true, meta: { extraPanels: [], hiddenPanelIds: [] } }
    })
    try {
      const alert = m.host.querySelector('.alert-warning')
      assert.ok(alert, `bandeau dégradé absent — texte : ${m.text().slice(0, 200)}`)
      const txt = clean(alert)
      assert.ok(txt.includes(t('catalogDegraded').slice(0, 25)), 'avertissement de base conservé')
      assert.match(txt, /2\s*(heures|h|ساعت)/, `l'âge doit apparaître : ${txt}`)
      assert.ok(txt.includes('Dernière lecture réussie'), `formulation attendue : ${txt}`)
      assert.equal(txt.includes("catalogue d'origine"), false, 'ne pas annoncer un repli statique')
    } finally {
      await m.unmount()
    }
  })

  it('repli `static` (aucune lecture réussie) → âge inconnu annoncé comme tel', async () => {
    const m = await mountApp({
      '/api/health': { ok: true, driver: 'neon' },
      '/api/catalog': catalogResponse({ degraded: true, db: { driver: 'neon', reachable: false, error: 'DNS', asOf: null, source: 'static' } }),
      '/api/meta': { ok: true, degraded: true, meta: { extraPanels: [], hiddenPanelIds: [] } }
    })
    try {
      const alert = m.host.querySelector('.alert-warning')
      assert.ok(alert, 'bandeau dégradé absent')
      const txt = clean(alert)
      assert.ok(txt.includes("catalogue d'origine"), `repli statique attendu : ${txt}`)
      assert.equal(/il y a|ago|قبل/.test(txt), false, 'aucun âge inventé quand `asOf` est null')
    } finally {
      await m.unmount()
    }
  })

  it('base joignable → aucun bandeau dégradé', async () => {
    const m = await mountApp({
      '/api/health': { ok: true, driver: 'file' },
      '/api/catalog': catalogResponse({ degraded: false, db: { driver: 'file', reachable: true, error: null, asOf: Date.now(), source: 'db' } }),
      '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } }
    })
    try {
      assert.ok(!m.host.querySelector('.alert-warning'), 'pas d’avertissement quand la base répond')
    } finally {
      await m.unmount()
    }
  })
})

/* -------------------------------------------------------------- 3.8 (B11) */

describe('LOT 3.8 + 3.9 (B11 + B13) — session morte : le maître est prévenu', () => {
  it('401 sur le pull Desk → jeton purgé, mode local, toast « session expirée »', async () => {
    const m = await mountApp(
      {
        '/api/health': { ok: true, driver: 'file' },
        '/api/catalog': catalogResponse({}),
        '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } },
        '/api/me': { ok: true, user: MASTER_USER },
        '/api/orders': { status: 401, body: { ok: false, error: 'auth' } }
      },
      { token: 'jeton-expire' }
    )
    try {
      await settle(250)
      assert.equal(m.toast(), t('sessionExpired'), `toast : ${m.toast()}`)
      assert.equal(api.getToken(), null, 'le jeton mort doit être purgé')
      // L'app reste utilisable : la boutique s'affiche (repli local).
      assert.ok(m.text().length > 500, 'l’app continue de s’afficher en mode local')
      assert.equal(m.host.querySelector('.alert-warning') === null, true)
    } finally {
      await m.unmount()
    }
  })

  it('une seule alerte par session morte (pas de toast à chaque poll)', async () => {
    let calls401 = 0
    const m = await mountApp(
      {
        '/api/health': { ok: true, driver: 'file' },
        '/api/catalog': catalogResponse({}),
        '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } },
        '/api/me': { ok: true, user: MASTER_USER },
        '/api/orders': () => {
          calls401 += 1
          return { status: 401, body: { ok: false, error: 'auth' } }
        }
      },
      { token: 'jeton-expire' }
    )
    try {
      // Le jeton est purgé dès la première alerte : les pulls suivants ne
      // partent même plus avec un Authorization mort.
      await settle(300)
      assert.equal(calls401, 1, `pulls 401 : ${calls401}`)
      assert.equal(m.toast(), t('sessionExpired'))
    } finally {
      await m.unmount()
    }
  })
})

/* -------------------------------------------------------------- 3.11 (B16) */

describe('LOT 3.11 (B16) — commandes arrivées pendant l’absence du comptoir', () => {
  const order = (code, minutesAgo) => ({
    code,
    name: `Client ${code}`,
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '14h-16h',
    total: 10000,
    status: 'new',
    at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    items: [{ id: 'cpu-7800x3d', name: 'Ryzen 7', qty: 1, price: 10000 }]
  })

  it('réouverture du Desk → les résas plus récentes que le dernier pull sont annoncées', async () => {
    let ordersCalls = 0
    const m = await mountApp(
      {
        '/api/health': { ok: true, driver: 'file' },
        '/api/catalog': catalogResponse({}),
        '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } },
        '/api/me': { ok: true, user: MASTER_USER },
        // Le premier pull échoue : `seenOrderCodes` reste null, donc le pull
        // suivant est bien un « premier pull » au sens de B16.
        '/api/orders': () => {
          ordersCalls += 1
          if (ordersCalls === 1) return { status: 500, body: { ok: false, error: 'db' } }
          return { ok: true, orders: [order('PS-1', 30), order('PS-2', 10)] }
        }
      },
      {
        token: 'tok-master',
        // Dernier pull connu : il y a 1 h (persisté par la session précédente).
        seed: (st) => saveDeskSeenAt(st, Date.now() - 60 * 60 * 1000)
      }
    )
    try {
      assert.ok(loadDeskSeenAt(safeStorage) > 0, 'horodatage de la session précédente présent')
      await settle(200)
      assert.equal(m.toast(), '', 'rien à annoncer avant d’ouvrir le Desk')
      // Navigation vers le comptoir : l'effet se relance (dépendance `page`).
      await click(m.byTextIncludes('button,a', t('navDesk')))
      await settle(250)
      assert.equal(m.toast(), t('deskNewOrders', { n: 2 }), `toast : ${m.toast()}`)
      // L'horodatage a avancé : le prochain démarrage à froid ne réannoncera pas
      // ces deux commandes.
      assert.ok(loadDeskSeenAt(safeStorage) > Date.now() - 5000, 'horodatage du pull persisté')
    } finally {
      await m.unmount()
    }
  })

  it('aucun horodatage persisté → initialisation silencieuse (pas tout l’historique)', async () => {
    let ordersCalls = 0
    const m = await mountApp(
      {
        '/api/health': { ok: true, driver: 'file' },
        '/api/catalog': catalogResponse({}),
        '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } },
        '/api/me': { ok: true, user: MASTER_USER },
        '/api/orders': () => {
          ordersCalls += 1
          if (ordersCalls === 1) return { status: 500, body: { ok: false, error: 'db' } }
          return { ok: true, orders: [order('PS-OLD-1', 60 * 24 * 3), order('PS-OLD-2', 60 * 24 * 2)] }
        }
      },
      { token: 'tok-master' }
    )
    try {
      assert.equal(loadDeskSeenAt(safeStorage), 0, 'premier démarrage : aucun horodatage')
      await click(m.byTextIncludes('button,a', t('navDesk')))
      await settle(250)
      assert.equal(m.toast(), '', 'annoncer trois jours d’historique serait du bruit')
      assert.ok(loadDeskSeenAt(safeStorage) > 0, 'l’horodatage est initialisé')
    } finally {
      await m.unmount()
    }
  })
})

/* --------------------------------------------------------------- 3.5 (B8) */

describe('LOT 3.5 (B8) — garde de stock dans l’updater', () => {
  it('double-clic « Ajouter » avec stock 1 → UNE unité au panier', async () => {
    const target = PRODUCTS.find((p) => Number(p.stock) === 1)
    assert.ok(target, 'un produit avec stock 1 existe dans le catalogue')
    // Hors-ligne : le stock affiché vient du catalogue statique.
    const m = await mountApp({}, {})
    try {
      // LOT P4 (V3) : la grille est paginee a douze, la fiche au stock de 1 est
      // ailleurs dans le catalogue. On l'amene par la recherche de la page — le
      // meme chemin que le client, pas un contournement du composant.
      const champ = m.all('.filters-bar input')[0]
      assert.ok(champ, 'le champ de recherche de la vitrine est introuvable')
      await act(async () => {
        const proto = window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(champ, target.name)
        champ.dispatchEvent(new window.Event('input', { bubbles: true }))
      })
      await settle(120)
      const card = m.all('.product-bs-card').find((c) => clean(c.querySelector('.card-title')) === target.name)
      assert.ok(card, `carte de ${target.name} introuvable`)
      const btn = card.querySelector('button.btn-success')
      assert.ok(btn, 'bouton « Ajouter » présent')
      assert.equal(btn.disabled, false)
      // Les deux clics dans le MÊME lot React : c'est exactement la course
      // observée à l'audit (deux lectures du même état périmé).
      await act(async () => {
        btn.click()
        btn.click()
      })
      await settle(120)
      const cartBtn = m.all('button').find((b) => (b.getAttribute('aria-label') || '').startsWith(t('navCart')))
      assert.ok(cartBtn, 'bouton panier trouvé')
      assert.equal(cartBtn.getAttribute('aria-label'), `${t('navCart')} (1)`, `panier : ${cartBtn.getAttribute('aria-label')}`)
      const badge = cartBtn.querySelector('.badge')
      assert.equal(clean(badge), '1', 'une seule unité pour un stock de 1')
    } finally {
      await m.unmount()
    }
  })
})

/* ------------------------------------------------- 3.18 (R14) + 3.9 (B12) */

describe('LOT 3.18 (R14) + 3.9 (B12) — retour OAuth', () => {
  const CUSTOMER = {
    id: 'u-oauth',
    role: 'customer',
    email: 'oauth@test.dz',
    name: 'Client OAuth',
    links: { google: 'oauth@test.dz', meta: null }
  }
  const baseRoutes = {
    '/api/health': { ok: true, driver: 'file' },
    '/api/catalog': catalogResponse({}),
    '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } }
  }

  it('fragment `#oauth_token=` → session appliquée et URL nettoyée', async () => {
    window.history.replaceState({}, '', '/#oauth_token=tok-fragment&oauth_provider=google')
    const m = await mountApp({ ...baseRoutes, '/api/me': { ok: true, user: CUSTOMER } })
    try {
      await settle(400)
      assert.equal(api.getToken(), 'tok-fragment', 'le jeton du fragment est enregistré')
      assert.equal(window.location.hash, '', `le token doit disparaître de l'URL : ${window.location.href}`)
      assert.equal(window.location.search, '')
      assert.equal(m.toast(), t('authOk'), `toast : ${m.toast()}`)
      assert.ok(m.byText('button,a', t('navLogout')), 'session appliquée : déconnexion visible')
    } finally {
      window.history.replaceState({}, '', '/')
      await m.unmount()
    }
  })

  it('ancien format `?oauth_token=` encore accepté le temps de la transition', async () => {
    window.history.replaceState({}, '', '/?oauth_token=tok-legacy&oauth_provider=meta')
    const m = await mountApp({ ...baseRoutes, '/api/me': { ok: true, user: CUSTOMER } })
    try {
      await settle(400)
      assert.equal(api.getToken(), 'tok-legacy')
      assert.equal(window.location.search, '', `query nettoyée : ${window.location.href}`)
      assert.ok(m.byText('button,a', t('navLogout')), 'session appliquée')
    } finally {
      window.history.replaceState({}, '', '/')
      await m.unmount()
    }
  })

  it('API lente au retour OAuth → la session finit par s’appliquer (retry borné)', async () => {
    window.history.replaceState({}, '', '/#oauth_token=tok-lent')
    let meCalls = 0
    const m = await mountApp({
      ...baseRoutes,
      // Les deux premières tentatives échouent (503, pas 401) : c'est le cas
      // « API momentanément lente » qui coûtait autrefois la session.
      '/api/me': () => {
        meCalls += 1
        return meCalls <= 2 ? { status: 503, body: { ok: false, error: 'unavailable' } } : { ok: true, user: CUSTOMER }
      }
    })
    try {
      await settle(2600)
      assert.ok(meCalls >= 3, `tentatives : ${meCalls}`)
      assert.ok(m.byText('button,a', t('navLogout')), 'la session a fini par s’appliquer, sans rechargement')
      assert.equal(api.getToken(), 'tok-lent', 'le jeton n’a pas été purgé')
    } finally {
      window.history.replaceState({}, '', '/')
      await m.unmount()
    }
  })

  it('échec définitif (503 répétés) → message visible et jeton CONSERVÉ', async () => {
    window.history.replaceState({}, '', '/#oauth_token=tok-mort')
    const m = await mountApp({ ...baseRoutes, '/api/me': { status: 503, body: { ok: false, error: 'unavailable' } } })
    try {
      await settle(2600)
      assert.equal(m.toast(), t('authRetryFailed'), `toast : ${m.toast()}`)
      assert.equal(api.getToken(), 'tok-mort', 'un 503 ne doit pas purger le jeton : le prochain chargement retentera')
      assert.equal(window.location.hash, '', 'l’URL reste nettoyée')
    } finally {
      window.history.replaceState({}, '', '/')
      await m.unmount()
    }
  })
})

/* --------------------------------------------------------------- 3.7 (B10) */

describe('LOT 3.7 (B10) — garde de fraîcheur du catalogue', () => {
  const X = 'cpu-7800x3d'
  const withStock = (id, stock) => PRODUCTS.map((p) => (p.id === id ? { ...p, stock } : { ...p }))
  const order = (code) => ({
    code,
    name: `Client ${code}`,
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '14h-16h',
    total: 10000,
    status: 'new',
    at: new Date().toISOString(),
    items: [{ id: X, name: 'Ryzen 7', qty: 1, price: 10000 }]
  })

  it('réponses croisées : seule la DERNIÈRE requête partie s’applique', async () => {
    let catCalls = 0
    const m = await mountApp(
      {
        '/api/health': { ok: true, driver: 'file' },
        '/api/meta': { ok: true, degraded: false, meta: { extraPanels: [], hiddenPanelIds: [] } },
        '/api/me': { ok: true, user: MASTER_USER },
        '/api/orders/': (path) => ({
          ok: true,
          order: { ...order(decodeURIComponent(path.split('/')[3] || 'PS-B10-0001')), status: 'cancelled' }
        }),
        '/api/orders': { ok: true, orders: [order('PS-B10-0001'), order('PS-B10-0002')] },
        '/api/catalog': () => {
          catCalls += 1
          // 1ʳᵉ (démarrage) : rapide. 2ᵉ (annulation n°1) : LENTE, stock 9.
          // 3ᵉ (annulation n°2) : immédiate, stock 0 — c'est elle qui est partie
          // en dernier, donc elle qui doit gagner. Sans garde de fraîcheur, la
          // réponse lente arrivait APRÈS et écrasait le stock frais.
          if (catCalls === 1) return { body: catalogResponse({ products: withStock(X, 6) }) }
          if (catCalls === 2) return { delay: 700, body: catalogResponse({ products: withStock(X, 9) }) }
          return { body: catalogResponse({ products: withStock(X, 0) }) }
        }
      },
      { token: 'tok-master' }
    )
    try {
      await settle(300)
      const navDesk = m.byTextIncludes('button,a', t('navDesk'))
      assert.ok(navDesk, 'mode maître établi (navigation « Liste comptoir » présente)')
      await click(navDesk)
      await settle(200)
      const cancels = m.all('button').filter((b) => clean(b) === t('deskCancel'))
      assert.equal(cancels.length, 2, `deux commandes annulables (${cancels.length})`)
      // Deux annulations rapprochées → deux `refreshStock` qui se croisent.
      await click(cancels[0])
      await click(cancels[1])
      assert.ok(catCalls >= 3, `trois requêtes de catalogue parties (${catCalls})`)
      // La réponse lente arrive maintenant : elle doit être jetée.
      await settle(1000)
      const navShop = m.byTextIncludes('button,a', t('navShop'))
      assert.ok(navShop, 'navigation « Boutique »')
      await click(navShop)
      await settle(200)
      const name = PRODUCTS.find((p) => p.id === X).name
      const card = m.all('.product-bs-card').find((c) => clean(c.querySelector('.card-title')) === name)
      assert.ok(card, 'carte du produit suivie')
      const btn = card.querySelector('button.btn-success')
      assert.equal(btn.disabled, true, 'le stock le plus récent (0) doit gagner, pas la réponse lente (9)')
      assert.equal(clean(btn), t('soldOut'))
    } finally {
      await m.unmount()
    }
  })
})

/* --------------------------------------------------------------- 3.3 (B6) */

describe('LOT 3.3 (B6) — effets de bord hors des updaters React', () => {
  it('StrictMode : UNE seule écriture du panier par mutation', async () => {
    const target = PRODUCTS.find((p) => Number(p.stock) > 3)
    assert.ok(target, 'produit avec du stock')
    const m = await mountApp({}, { strict: true, countCartWrites: true })
    try {
      m.resetCartWrites()
      const card = m.all('.product-bs-card').find((c) => clean(c.querySelector('.card-title')) === target.name)
      assert.ok(card, `carte de ${target.name}`)
      await act(async () => {
        card.querySelector('button.btn-success').click()
      })
      await settle(150)
      assert.equal(m.cartWrites(), 1, `écritures du panier : ${m.cartWrites()} (StrictMode rappelle les updaters)`)
      // La valeur écrite est bien l'état final affiché, pas un état intermédiaire.
      const written = JSON.parse(window.localStorage.getItem('pcstar-cart-guest') || '[]')
      assert.equal(written.length, 1)
      assert.equal(written[0].id, target.id)
      assert.equal(written[0].qty, 1)
    } finally {
      await m.unmount()
    }
  })

  it('deux mutations successives → deux écritures, chacune sur l’état courant', async () => {
    const target = PRODUCTS.find((p) => Number(p.stock) > 3)
    const m = await mountApp({}, { countCartWrites: true })
    try {
      m.resetCartWrites()
      const card = m.all('.product-bs-card').find((c) => clean(c.querySelector('.card-title')) === target.name)
      const btn = card.querySelector('button.btn-success')
      await click(btn)
      await click(btn)
      assert.equal(m.cartWrites(), 2, `écritures : ${m.cartWrites()}`)
      const written = JSON.parse(window.localStorage.getItem('pcstar-cart-guest') || '[]')
      assert.equal(written[0].qty, 2, 'le miroir suit le dernier état')
    } finally {
      await m.unmount()
    }
  })
})
