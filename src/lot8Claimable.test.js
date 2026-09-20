import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// LOT 8.3 (A3), adapté en phase 3 — une guest ne peut plus être reprise via
// téléphone. Une session masque donc toute copie guest locale; hors connexion,
// l'appareil guest peut seulement annuler sa propre copie locale neuve.
//
// Trois niveaux vérifiés ici :
//  · la règle pure (`canCancelHere`) — une seule définition pour le bouton et la
//    garde locale de `cancelMyOrder` ;
//  · le rendu réel de `OrdersPage` — séparation stricte session/guest ;
//  · `App` connecté en mode API — un 404 du serveur n'est plus annoncé comme une
//    panne (« Annulation impossible ») mais comme ce qu'il est.
// ---------------------------------------------------------------------------

import { canCancelHere, statusLabelKey } from './orderLogic.js'
import { dict, LANGS } from './i18n.js'

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
const { default: OrdersPage } = await import('./OrdersPage.jsx')
const { default: App } = await import('./App.jsx')
const { resetSafeStorage } = await import('./safeStorage.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const t = (key, vars) => {
  let s = dict.fr[key] ?? key
  Object.entries(vars || {}).forEach(([k, v]) => {
    s = s.replaceAll(`{${k}}`, String(v))
  })
  return s
}
const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const noop = () => {}
const realFetch = globalThis.fetch
const offlineFetch = async () => {
  throw new TypeError('offline (test)')
}

const USER = { id: 'demo-karim', name: 'Karim B.', role: 'customer', phone: '0550123456' }
const AT = '2026-09-16T10:00:00.000Z'

/** Trois commandes : non revendicable, normale, déjà en préparation. */
function seedOrders() {
  window.localStorage.setItem(
    'pcstar-orders',
    JSON.stringify([
      {
        code: 'PS-20260916-0001',
        status: 'new',
        name: 'Karim B.',
        total: 7500,
        userId: null,
        claimable: false,
        at: AT,
        items: [{ id: 'mousepad', name: 'Tapis G640', qty: 1 }]
      },
      {
        code: 'PS-20260916-0002',
        status: 'new',
        name: 'Karim B.',
        total: 9900,
        userId: 'demo-karim',
        at: AT,
        items: [{ id: 'ssd-1t', name: 'SSD 1 To', qty: 1 }]
      },
      {
        code: 'PS-20260916-0003',
        status: 'preparing',
        name: 'Karim B.',
        total: 1200,
        userId: 'demo-karim',
        at: AT,
        items: [{ id: 'cable', name: 'Câble', qty: 1 }]
      }
    ])
  )
}

async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(120)
  return {
    host,
    text: () => clean(host),
    byText: (selector, text) => [...host.querySelectorAll(selector)].find((n) => clean(n) === text) || null,
    unmount: async () => {
      root.unmount()
      host.remove()
      await settle(30)
    }
  }
}

async function click(el) {
  assert.ok(el, 'élément cliquable trouvé')
  await act(async () => {
    el.click()
  })
  await settle(80)
}

before(() => {
  resetSafeStorage()
  window.localStorage.clear()
  window.localStorage.setItem('pcstar-lang', 'fr')
  globalThis.fetch = offlineFetch
  window.fetch = globalThis.fetch
})

after(async () => {
  await settle(60)
  globalThis.fetch = realFetch
  window.fetch = realFetch
})

describe('Phase 3 — OrdersPage : frontière stricte entre session et guest', () => {
  async function mountOrders(over = {}) {
    return mount(
      React.createElement(OrdersPage, {
        t,
        user: USER,
        apiOnline: false,
        mode: 'local',
        onCancelOrder: noop,
        onBack: noop,
        ...over
      })
    )
  }

  it('une session connectée ne voit aucune commande guest locale', async () => {
    window.localStorage.clear()
    seedOrders()
    const m = await mountOrders()
    try {
      const cards = [...m.host.querySelectorAll('article')]
      assert.equal(cards.length, 2, 'seules les commandes du compte sont listées')
      const byCode = (code) => cards.find((c) => clean(c).includes(code))
      assert.equal(byCode('PS-20260916-0001'), undefined, 'une guest a été exposée à la session')

      const normal = byCode('PS-20260916-0002')
      assert.ok(normal.querySelector('button.btn-outline-danger'), 'bouton présent pour une commande neuve propre')
      assert.ok(!byCode('PS-20260916-0003').querySelector('button.btn-outline-danger'))
      assert.equal(m.host.querySelectorAll('button.btn-outline-danger').length, 1)
    } finally {
      await m.unmount()
    }
  })

  it('guest (sans compte) : l’appareil peut annuler sa copie locale neuve', async () => {
    window.localStorage.clear()
    seedOrders()
    const m = await mountOrders({ user: null })
    try {
      const cards = [...m.host.querySelectorAll('article')]
      const guest = cards.find((c) => clean(c).includes('PS-20260916-0001'))
      assert.ok(guest.querySelector('button.btn-outline-danger'), 'le guest garde son action locale')
      assert.ok(!clean(guest).includes(t('orderNotClaimable')))
    } finally {
      await m.unmount()
    }
  })

  it('claimable:true explicite → bouton présent (le drapeau ne bloque pas par excès)', async () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'pcstar-orders',
      JSON.stringify([
        { code: 'PS-20260916-0009', status: 'new', name: 'Karim B.', total: 500, userId: 'demo-karim', claimable: true, at: AT, items: [] }
      ])
    )
    const m = await mountOrders()
    try {
      assert.ok(m.host.querySelector('button.btn-outline-danger'), 'bouton rendu')
      assert.ok(!m.text().includes(t('orderNotClaimable')), 'aucune mention')
    } finally {
      await m.unmount()
    }
  })
})

describe('LOT 8.3 (A3) — App connecté : un 404 du serveur n’est plus annoncé comme une panne', () => {
  /** API pilotée par (method, chemin). */
  function stubApi(routes) {
    globalThis.fetch = async (url, opts = {}) => {
      const method = String(opts.method || 'GET').toUpperCase()
      const path = String(url).split('?')[0]
      const match = routes.find(([m, p]) => m === method && (p instanceof RegExp ? p.test(path) : p === path))
      const spec = match ? match[2] : { status: 200, body: {} }
      return {
        ok: spec.status >= 200 && spec.status < 300,
        status: spec.status,
        json: async () => spec.body,
        text: async () => JSON.stringify(spec.body),
        headers: { get: () => null }
      }
    }
    window.fetch = globalThis.fetch
  }

  it('clic sur « Annuler » → 404 → message dédié (ni « Annulation impossible », ni silence)', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('pcstar-lang', 'fr')
    window.localStorage.setItem('pcstar-api-token', 'token-de-test')
    // Copie locale d'une commande liée à la session : le bouton est rendu,
    // mais le serveur ne la reconnaît plus (supprimée par le maître, par exemple).
    // Une guest ne serait pas affichée dans une session connectée.
    window.localStorage.setItem(
      'pcstar-orders',
      JSON.stringify([
        {
          code: 'PS-20260916-0007',
          status: 'new',
          name: 'Karim B.',
          total: 7500,
          userId: 'demo-karim',
          at: AT,
          items: [{ id: 'mousepad', name: 'Tapis G640', qty: 1 }]
        }
      ])
    )
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/me', { status: 200, body: { ok: true, user: USER } }],
      ['GET', '/api/me/orders', { status: 200, body: { ok: true, orders: [] } }],
      ['GET', '/api/catalog', { status: 200, body: { ok: true, products: [], meta: {} } }],
      ['POST', /\/api\/me\/orders\/.*\/cancel$/, { status: 404, body: { ok: false, error: 'not_found' } }]
    ])

    const m = await mount(React.createElement(App))
    try {
      assert.ok(m.text().includes('Karim B.'), 'session API reprise (mode connecté)')
      await click(m.byText('a,button', t('navOrders')))
      assert.ok(m.text().includes('PS-20260916-0007'), 'page « Commandes » : la ligne est là')

      const btn = m.byText('button', t('orderCancel'))
      assert.ok(btn, 'le bouton « Annuler » est rendu (copie locale sans drapeau)')
      await click(btn)

      // AVANT : « Annulation impossible » — une panne apparente, donc on réessaie.
      assert.ok(m.text().includes(t('orderCancelNotMine')), `message dédié attendu, obtenu : ${m.text().slice(0, 400)}`)
      assert.ok(!m.text().includes(t('orderCancelFail')), 'le message générique n’est plus employé pour un 404')
    } finally {
      await m.unmount()
      globalThis.fetch = offlineFetch
      window.fetch = globalThis.fetch
    }
  })

  it('une vraie panne (500) garde le message « Annulation impossible » (non-régression)', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('pcstar-lang', 'fr')
    window.localStorage.setItem('pcstar-api-token', 'token-de-test')
    window.localStorage.setItem(
      'pcstar-orders',
      JSON.stringify([
        { code: 'PS-20260916-0008', status: 'new', name: 'Karim B.', total: 7500, userId: 'demo-karim', at: AT, items: [] }
      ])
    )
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/me', { status: 200, body: { ok: true, user: USER } }],
      ['GET', '/api/me/orders', { status: 200, body: { ok: true, orders: [] } }],
      ['GET', '/api/catalog', { status: 200, body: { ok: true, products: [], meta: {} } }],
      ['POST', /\/api\/me\/orders\/.*\/cancel$/, { status: 500, body: { ok: false, error: 'boom' } }]
    ])

    const m = await mount(React.createElement(App))
    try {
      await click(m.byText('a,button', t('navOrders')))
      await click(m.byText('button', t('orderCancel')))
      assert.ok(m.text().includes(t('orderCancelFail')), 'une panne reste annoncée comme une panne')
      assert.ok(!m.text().includes(t('orderCancelNotMine')), 'et pas comme une commande non rattachée')
    } finally {
      await m.unmount()
      globalThis.fetch = offlineFetch
      window.fetch = globalThis.fetch
    }
  })
})

/* ------------------------------------------------------- 1. règle pure */

/* ------------------------------------------------------- 1. règle pure */

describe('LOT 8.3 (A3) — canCancelHere : une seule règle pour le bouton et la garde', () => {
  it('statut : neuve/pending annulable, au-delà non (règle historique conservée)', () => {
    assert.equal(canCancelHere({ status: 'new' }), true)
    assert.equal(canCancelHere({ status: 'pending' }), true)
    assert.equal(canCancelHere({ status: 'preparing' }), false)
    assert.equal(canCancelHere({ status: 'ready' }), false)
    assert.equal(canCancelHere({ status: 'picked' }), false)
    assert.equal(canCancelHere({ status: 'cancelled' }), false)
    // Statut absent → « neuve » (commandes locales hors-ligne).
    assert.equal(canCancelHere({ code: 'PS-X' }), true)
  })

  it('claimable: false → non annulable depuis un compte, mais annulable localement en guest', () => {
    assert.equal(canCancelHere({ status: 'new', claimable: false }), false)
    assert.equal(canCancelHere({ status: 'pending', claimable: false }), false)
    assert.equal(canCancelHere({ claimable: false }), false)
    assert.equal(canCancelHere({ status: 'new', claimable: false }, { allowGuest: true }), true)
  })

  it('claimable absent ou vrai → comportement habituel (commandes antérieures à R20)', () => {
    assert.equal(canCancelHere({ status: 'new', claimable: true }), true)
    assert.equal(canCancelHere({ status: 'new', claimable: undefined }), true)
    assert.equal(canCancelHere({ status: 'new', userId: 'demo-karim' }), true)
  })

  it('entrée invalide → false (un undefined qui traîne n’est pas une commande neuve)', () => {
    assert.equal(canCancelHere(null), false)
    assert.equal(canCancelHere(undefined), false)
    assert.equal(canCancelHere('PS-20260916-0001'), false)
  })

  it('les 2 nouvelles clés existent dans les deux langues du site', () => {
    for (const key of ['orderNotClaimable', 'orderCancelNotMine']) {
      for (const { id } of LANGS) {
        const v = dict[id]?.[key]
        assert.equal(typeof v, 'string', `${id}:${key} absent`)
        assert.ok(v.trim().length > 8, `${id}:${key} trop court`)
      }
    }
    // Le distinguo a du sens : les deux messages ne disent pas la même chose.
    assert.notEqual(dict.fr.orderNotClaimable, dict.fr.orderCancelFail)
    assert.notEqual(dict.fr.orderCancelNotMine, dict.fr.orderCancelFail)
    assert.equal(statusLabelKey('new'), 'orderStatus_new', 'non-régression statusLabelKey')
  })
})

describe('LOT 8.3 (A3) — la garde locale de `cancelMyOrder` partage la même règle', () => {
  it('App.jsx passe par canCancelHere avant d’annuler une copie locale', () => {
    // Le bouton est masqué dans OrdersPage, mais `cancelMyOrder` reste joignable
    // (appel direct, futur écran) : la règle doit être la même des deux côtés,
    // sinon un chemin annulerait ce que l'autre interdit. La branche locale
    // (hors-ligne / guest) n'est pas atteignable en rendu ici — d'où ce contrôle
    // à la source, comme pour `pricedCart` au lot 5.4.
    const src = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
    const start = src.indexOf('async function cancelMyOrder(code) {')
    assert.ok(start > 0, 'fonction cancelMyOrder trouvée')
    const body = src.slice(start, start + 2600)
    assert.ok(body.includes('canCancelHere(target, { allowGuest: !user })'), 'la garde locale appelle la règle partagée avec l’exception guest locale')
    assert.ok(body.includes('orderOnlyNew'), 'le message statut existant est conservé')
    // Et l'ancien test « à la main » sur le statut a bien disparu (une seule règle).
    assert.ok(
      !body.includes("target.status !== 'new' && target.status !== 'pending'"),
      'le doublon de la règle de statut a été retiré'
    )
  })
})
