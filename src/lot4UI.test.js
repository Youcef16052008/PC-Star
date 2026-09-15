import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 4 — multi-appareil & données, partie UI.
//
//  4.2 (F15) `errToast` nomme le refus de stockage durable (`upload_storage`)
//            au lieu d'un « échec » générique : le master sait quoi poser
//            (BLOB_READ_WRITE_TOKEN) au lieu de réessayer en boucle.
//  4.3 (F16) supprimer un compte client annonce ce que le serveur a fait —
//            commandes en cours annulées, stock rendu — au lieu d'un
//            « Client supprimé » muet.
//
// La partie serveur (noms de photos uniques, refus sous Vercel, purge du
// compte, commande guest non revendicable, migration `pending`) est dans
// src/lot4Server.test.js.
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
  'FileReader',
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
const { default: MasterPage, errToast, customerDeletedMessage } = await import('./MasterPage.jsx')
const { dict } = await import('./i18n.js')
const { saveLang } = await import('./prefs.js')
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
  resetSafeStorage(window)
  window.localStorage.clear()
  saveLang(safeStorage, 'fr')
})

after(() => {
  globalThis.fetch = realFetch
  window.close()
})

/** Réponses d'API pilotées par (method, chemin). */
function stubApi(routes) {
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase()
    const path = String(url).split('?')[0]
    calls.push({ method, path })
    const match = routes.find(([m, p]) => m === method && (p instanceof RegExp ? p.test(path) : p === path))
    const spec = match ? match[2] : { status: 200, body: { ok: true } }
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => spec.body,
      text: async () => JSON.stringify(spec.body),
      headers: { get: () => null }
    }
  }
  return calls
}

const baseProps = (over = {}) => ({
  t,
  lang: 'fr',
  user: { id: 'master-pcstar', role: 'master', name: 'PC Star Desk' },
  users: [],
  onUsers() {},
  products: [],
  masterCatalog: [],
  meta: {
    extraProducts: [],
    hiddenProductIds: [],
    extraPanels: [],
    hiddenPanelIds: [],
    productOverrides: {},
    stock: {}
  },
  onMeta() {},
  basePanels: [],
  setToast() {},
  onBack() {},
  apiOnline: true,
  onStockRefresh() {},
  ...over
})

/* ------------------------------------------------------------- 4.2 (F15) UI */

describe('4.2 (F15) — errToast nomme la cause', () => {
  it('refus de stockage durable → message dédié', () => {
    let msg = null
    errToast((m) => (msg = m), t, { ok: false, status: 500, data: { error: 'upload_storage' } }, 'masterActionFail')
    assert.equal(msg, t('masterPhotoNoStorage'))
    assert.match(msg, /BLOB_READ_WRITE_TOKEN/, 'le message doit nommer la variable à poser')
    assert.notEqual(msg, t('masterActionFail'), 'message générique servi pour un refus de stockage')
  })

  it('backend injoignable → offline, pas un refus serveur', () => {
    let msg = null
    errToast((m) => (msg = m), t, { ok: false, offline: true }, 'masterActionFail')
    assert.equal(msg, t('backendOffline'))
    errToast((m) => (msg = m), t, null, 'masterActionFail')
    assert.equal(msg, t('backendOffline'))
  })

  it('autre échec → le message de repli de l’écran', () => {
    let msg = null
    errToast((m) => (msg = m), t, { ok: false, status: 400, data: { error: 'photos' } }, 'masterActionFail')
    assert.equal(msg, t('masterActionFail'))
  })

  it('les trois langues portent la clé', () => {
    for (const lang of ['fr', 'en', 'ar']) {
      assert.ok(dict[lang].masterPhotoNoStorage, `masterPhotoNoStorage absent de ${lang}`)
      assert.ok(dict[lang].masterCustomerGoneOrders, `masterCustomerGoneOrders absent de ${lang}`)
    }
  })
})

/* ------------------------------------------------------------- 4.3 (F16) UI */

describe('4.3 (F16) — message de suppression d’un compte', () => {
  it('aucune commande en cours → message simple', () => {
    assert.equal(customerDeletedMessage(t, { ok: true, cancelled: [], releasedLines: 0 }), t('masterCustomerGone'))
    assert.equal(customerDeletedMessage(t, { ok: true }), t('masterCustomerGone'))
    assert.equal(customerDeletedMessage(t, null), t('masterCustomerGone'))
  })

  it('commandes annulées → nombre et codes annoncés', () => {
    const msg = customerDeletedMessage(t, {
      ok: true,
      cancelled: [
        { code: 'PC-2026-0915-01', status: 'new', items: 1 },
        { code: 'PC-2026-0915-02', status: 'preparing', items: 2 }
      ],
      releasedLines: 3
    })
    assert.equal(msg, t('masterCustomerGoneOrders', { n: 2, codes: 'PC-2026-0915-01, PC-2026-0915-02' }))
    assert.match(msg, /2/, 'le nombre de commandes doit apparaître')
    assert.match(msg, /PC-2026-0915-01/, 'les codes doivent apparaître')
  })

  it('au-delà de 4 commandes, les codes sont bornés mais le compte est exact', () => {
    const cancelled = Array.from({ length: 9 }, (_, i) => ({ code: `C-${i + 1}`, status: 'new', items: 1 }))
    const msg = customerDeletedMessage(t, { ok: true, cancelled, releasedLines: 9 })
    assert.match(msg, /9/, 'le nombre total doit rester exact')
    assert.match(msg, /C-1, C-2, C-3, C-4/, 'les 4 premiers codes')
    assert.equal(msg.includes('C-5'), false, 'le toast ne doit pas s’étaler')
  })
})

describe('4.3 (F16) — MasterPage réel : supprimer un client annonce les commandes annulées', () => {
  it('clic sur « Supprimer » → toast de résumé, fiche retirée', async () => {
    const toasts = []
    stubApi([
      ['GET', '/api/master/products', { status: 200, body: { ok: true, products: [] } }],
      ['GET', '/api/master/panels', { status: 200, body: { ok: true, panels: [] } }],
      [
        'GET',
        '/api/customers',
        {
          status: 200,
          body: {
            ok: true,
            customers: [{ id: 'c-lot4', role: 'customer', name: 'Karim Test', email: 'karim@test.dz', phone: '0550112233' }]
          }
        }
      ],
      [
        'DELETE',
        '/api/customers/c-lot4',
        {
          status: 200,
          body: {
            ok: true,
            cancelled: [{ code: 'PC-2026-0915-07', status: 'new', items: 1 }],
            releasedLines: 1,
            left: [{ code: 'PC-2026-0914-02', status: 'picked' }]
          }
        }
      ]
    ])

    const host = window.document.getElementById('root')
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(React.createElement(MasterPage, baseProps({ setToast: (m) => toasts.push(m) })))
      })
      await settle(20)

      // onglet « Clients »
      const tabBtn = [...host.querySelectorAll('button')].find((b) => clean(b) === t('masterCustomers'))
      assert.ok(tabBtn, 'onglet clients introuvable')
      await act(async () => tabBtn.click())
      await settle(20)
      assert.match(clean(host), /Karim Test/, 'la fiche client doit être affichée')

      const delBtn = [...host.querySelectorAll('button.btn-outline-danger')].find((b) => clean(b) === t('masterDelete'))
      assert.ok(delBtn, 'bouton supprimer introuvable')
      await act(async () => delBtn.click())
      await settle(30)

      assert.equal(toasts.length, 1, `toasts : ${JSON.stringify(toasts)}`)
      assert.equal(toasts[0], t('masterCustomerGoneOrders', { n: 1, codes: 'PC-2026-0915-07' }))
      assert.match(toasts[0], /PC-2026-0915-07/, 'le code de la commande annulée doit être dit au master')
      assert.notEqual(toasts[0], t('masterCustomerGone'), 'message muet servi alors que du stock a été rendu')
      // la fiche disparaît de l'écran
      assert.equal(clean(host).includes('Karim Test'), false, 'fiche client encore affichée')
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('échec de suppression → message d’échec, pas de résumé inventé', async () => {
    const toasts = []
    stubApi([
      ['GET', '/api/master/products', { status: 200, body: { ok: true, products: [] } }],
      [
        'GET',
        '/api/customers',
        { status: 200, body: { ok: true, customers: [{ id: 'c-x', role: 'customer', name: 'Amina Test' }] } }
      ],
      ['DELETE', '/api/customers/c-x', { status: 400, body: { ok: false } }]
    ])
    const host = window.document.getElementById('root')
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(React.createElement(MasterPage, baseProps({ setToast: (m) => toasts.push(m) })))
      })
      await settle(20)
      const tabBtn = [...host.querySelectorAll('button')].find((b) => clean(b) === t('masterCustomers'))
      await act(async () => tabBtn.click())
      await settle(20)
      const delBtn = [...host.querySelectorAll('button.btn-outline-danger')].find((b) => clean(b) === t('masterDelete'))
      await act(async () => delBtn.click())
      await settle(30)
      assert.equal(toasts.length, 1, JSON.stringify(toasts))
      assert.equal(toasts[0], t('masterActionFail'))
    } finally {
      await act(async () => root.unmount())
    }
  })
})
