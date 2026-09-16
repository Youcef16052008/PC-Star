import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 8 — audit A→Z du 16/09/2026, partie RENDUE (App réel dans jsdom).
//
//  8.1 (A1) + 8.2 (A2), côté client : le serveur refuse désormais une commande
//  dont une ligne porte sur un produit retiré de la vente (`unavailable`, 409)
//  ou sur un id qu'il ne connaît pas (`unknown_product`, 400). Le front doit :
//    · dire POURQUOI et NOMMER la ligne (un message générique faisait renvoyer
//      la même commande en boucle),
//    · retirer ces lignes du panier — le refus est définitif pour elles, et le
//      repli hors-ligne finirait sinon par créer une commande locale sur un
//      article fantôme,
//    · conserver le reste du panier (l'utilisateur peut commander les autres).
//
// Avant le correctif, `orderApiFailure` classait le 409 `unavailable` en
// « rupture » : l'écran disait « stock insuffisant, réessayez » pour un article
// qui ne reviendrait pas, et le panier restait inchangé.
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

const PAD = PRODUCTS.find((p) => p.id === 'mousepad')
const GPU = PRODUCTS.find((p) => p.id === 'gpu-4070s') || PRODUCTS[3]
const GHOST = { id: 'produit-fantome', sku: 'GHOST', name: 'Fantôme', qty: 1, price: 99000 }
assert.ok(PAD && GPU, 'fixtures : deux références réelles du catalogue')

/** API pilotée par (method, chemin) — tout ce qui n'est pas listé répond 200 {}. */
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

const CATALOG = {
  status: 200,
  body: {
    ok: true,
    products: [PAD, GPU].map((p) => ({ ...p, stock: 5 })),
    meta: { extraProducts: [], hiddenProductIds: [], productOverrides: {}, photoOverrides: {} }
  }
}

/** Panier semé : une ligne valide + une ligne que le serveur va refuser. */
function seedCart(badLine) {
  window.localStorage.clear()
  window.localStorage.setItem('pcstar-lang', 'fr')
  window.localStorage.setItem(
    'pcstar-cart-guest',
    JSON.stringify([
      { id: PAD.id, sku: PAD.sku, name: PAD.name, price: PAD.price, qty: 1 },
      badLine
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

async function fill(input, value) {
  assert.ok(input, 'champ trouvé')
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/** Appelle `onSubmit` en l'attendant (voir src/lot2UI.test.js). */
async function submit(form) {
  assert.ok(form, 'formulaire trouvé')
  const key = Object.keys(form).find((k) => k.startsWith('__reactProps'))
  await act(async () => {
    await form[key].onSubmit({ preventDefault: noop })
  })
  await settle(80)
}

/** Ouvre le tiroir panier, remplit le retrait et envoie la commande. */
async function checkout(m) {
  await click(m.host.querySelector('.app .navbar button.btn-success'))
  const offcanvas = m.host.querySelector('.offcanvas')
  assert.ok(offcanvas?.classList.contains('show'), 'panier ouvert')
  const form = offcanvas.querySelector('form')
  await fill(form.querySelector('#name'), 'Karim B.')
  await fill(form.querySelector('#phone'), '0550123456')
  await submit(form)
  return m.host.querySelector('.offcanvas')
}

const storedCart = () => JSON.parse(window.localStorage.getItem('pcstar-cart-guest') || '[]')

before(() => {
  resetSafeStorage()
  window.localStorage.clear()
})

after(async () => {
  await settle(60)
  globalThis.fetch = realFetch
  window.fetch = realFetch
})

/* ------------------------------------------------------------------ 8.1 */

describe('LOT 8.1 (A1) — produit retiré de la vente : le client le dit, nomme la ligne et la retire', () => {
  it('409 `unavailable` → toast explicite + ligne retirée, le reste du panier conservé', async () => {
    seedCart({ id: GPU.id, sku: GPU.sku, name: GPU.name, price: GPU.price, qty: 1 })
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/catalog', CATALOG],
      [
        'POST',
        '/api/orders',
        {
          status: 409,
          body: { ok: false, error: 'unavailable', unavailable: [{ id: GPU.id, name: GPU.name }] }
        }
      ]
    ])

    const m = await mount(React.createElement(App))
    try {
      await checkout(m)
      const text = m.text()
      // 1. le motif est dit — et ce n'est PAS une rupture
      const prefix = dict.fr.orderUnavailableDetail.split('{lines}')[0].trim()
      assert.ok(prefix.length > 5, 'préfixe du message introuvable dans le dictionnaire')
      assert.ok(text.includes(prefix), `message attendu « ${prefix}… », obtenu : ${text.slice(0, 300)}`)
      assert.ok(!text.includes(dict.fr.stockShortDetail.split('{lines}')[0].trim()), 'pas de « stock insuffisant »')
      // 2. la ligne refusée est NOMMÉE
      assert.ok(text.includes(GPU.name.split(' ')[0]), 'le produit retiré de la vente est nommé')
      // 3. elle est retirée du panier (état + persistance), l'autre reste
      assert.deepEqual(storedCart().map((c) => c.id), [PAD.id], 'la ligne refusée a quitté le panier persisté')
      const offcanvas = m.host.querySelector('.offcanvas')
      assert.ok(!clean(offcanvas).includes(GPU.sku), 'plus affichée dans le tiroir')
      assert.ok(clean(offcanvas).includes(PAD.sku) || clean(offcanvas).includes(PAD.name), 'la ligne valide reste')
      // 4. aucune confirmation de commande (rien n'a été accepté)
      assert.ok(!text.includes(t('successTitle')), 'pas d’écran de confirmation')
      assert.doesNotMatch(text, /PS-\d{8}-\d{4}/, 'aucun code de commande')
    } finally {
      await m.unmount()
    }
  })
})

/* ------------------------------------------------------------------ 8.2 */

describe('LOT 8.2 (A2) — id inconnu du catalogue : mêmes exigences côté client', () => {
  it('400 `unknown_product` → toast « introuvable au catalogue » + ligne retirée', async () => {
    // Un produit sorti du catalogue survit au panier local : `pricedCart` garde
    // le snapshot (`if (!live) return i`, src/App.jsx). C'est exactement la
    // ligne que le serveur refuse désormais au lieu de la tarifer 0 DA.
    seedCart({ ...GHOST })
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/catalog', CATALOG],
      [
        'POST',
        '/api/orders',
        {
          status: 400,
          body: { ok: false, error: 'unknown_product', unknown: [{ id: GHOST.id, name: GHOST.name }] }
        }
      ]
    ])

    const m = await mount(React.createElement(App))
    try {
      await checkout(m)
      const text = m.text()
      const prefix = dict.fr.orderUnknownDetail.split('{lines}')[0].trim()
      assert.ok(text.includes(prefix), `message attendu « ${prefix}… », obtenu : ${text.slice(0, 300)}`)
      assert.ok(text.includes(GHOST.name), 'la ligne fantôme est nommée')
      assert.deepEqual(storedCart().map((c) => c.id), [PAD.id], 'la ligne inconnue a quitté le panier')
      assert.doesNotMatch(text, /PS-\d{8}-\d{4}/, 'aucune commande créée')
      // Et surtout : pas de commande LOCALE de repli sur un article fantôme.
      const local = JSON.parse(window.localStorage.getItem('pcstar-orders') || '[]')
      assert.deepEqual(local, [], 'le repli hors-ligne n’a rien créé')
    } finally {
      await m.unmount()
    }
  })

  it('toutes les lignes refusées → panier vidé, on revient au panier vide (pas de formulaire mort)', async () => {
    seedCart({ ...GHOST })
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/catalog', CATALOG],
      [
        'POST',
        '/api/orders',
        {
          status: 400,
          body: {
            ok: false,
            error: 'unknown_product',
            unknown: [
              { id: GHOST.id, name: GHOST.name },
              { id: PAD.id, name: PAD.name }
            ]
          }
        }
      ]
    ])

    const m = await mount(React.createElement(App))
    try {
      await checkout(m)
      assert.deepEqual(storedCart(), [], 'panier vidé')
      const offcanvas = m.host.querySelector('.offcanvas')
      assert.ok(
        clean(offcanvas).includes(t('emptyCartTitle')),
        'état « panier vide » plutôt qu’un formulaire de retrait'
      )
      assert.ok(!offcanvas.querySelector('#name'), 'le formulaire de retrait n’est plus affiché')
    } finally {
      await m.unmount()
    }
  })
})

/* --------------------------------------------------- non-régression 5.2 */

describe('non-régression — la rupture (409 `stock`) garde le comportement du LOT 5.2', () => {
  it('message de stock détaillé, panier INTACT (rien à retirer : ça reviendra)', async () => {
    seedCart({ id: GPU.id, sku: GPU.sku, name: GPU.name, price: GPU.price, qty: 1 })
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/catalog', CATALOG],
      [
        'POST',
        '/api/orders',
        {
          status: 409,
          body: {
            ok: false,
            error: 'stock',
            shortages: [{ id: GPU.id, name: GPU.name, need: 1, left: 0 }]
          }
        }
      ]
    ])

    const m = await mount(React.createElement(App))
    try {
      await checkout(m)
      const text = m.text()
      assert.ok(text.includes(dict.fr.stockShortDetail.split('{lines}')[0].trim()), 'message de rupture affiché')
      assert.ok(text.includes(GPU.name.split(' ')[0]), 'la ligne en manque est nommée')
      assert.deepEqual(storedCart().map((c) => c.id), [PAD.id, GPU.id], 'le panier est conservé tel quel')
    } finally {
      await m.unmount()
    }
  })
})
