import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 2 — bloquants fonctionnels, partie UI (composants réels rendus dans
// jsdom). La logique pure (codes de commande, fusion, `needs`) est testée dans
// src/lot2Logic.test.js.
//
//  2.1 (F1)   `go('cart')` mort : « Ajouter la config » renvoyait sur la
//             boutique, panier fermé
//  2.4 (F6)   `reserved` jamais réinitialisé : le client suivant voyait la
//             confirmation (nom, créneau, total) du précédent
//  2.5 (F9)   contrôle de SKU sur le catalogue PUBLIC filtré : un SKU masqué ou
//             en rupture pouvait être dupliqué
//  2.7 (F11)  `submitPanel` ignorait le meta renvoyé par le serveur (troncature
//             à 12 invisible côté client)
//  2.8 (F12)  complété phase 3 : les commandes guest restent sur l'appareil
//             hors session et ne sont jamais affichées dans un compte
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

// Les globaux doivent exister AVANT les `await import(...)` : `src/App.jsx`
// capture `localStorage` à l'import du module (un `before()` serait trop tard).
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
const { default: MasterPage } = await import('./MasterPage.jsx')
const { default: OrdersPage } = await import('./OrdersPage.jsx')
const { dict } = await import('./i18n.js')
const { PRODUCTS, PART_LINES } = await import('./data.js')
// LOT 1.19 : le mode local n'utilise plus les mots de passe publiés du seed
// serveur — une valeur locale unique, `DEMO_LOCAL_PASSWORD`.
const { buildShopView, DEMO_LOCAL_PASSWORD } = await import('./shopStore.js')

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

/** Réseau mort par défaut : l'app tourne en mode local (ce que ces tests visent). */
const offlineFetch = async () => {
  throw new TypeError('offline (test)')
}
const realFetch = globalThis.fetch

before(() => {
  globalThis.fetch = offlineFetch
  window.fetch = globalThis.fetch
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
    byText: (selector, text) =>
      [...host.querySelectorAll(selector)].find((n) => clean(n) === text) || null,
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

/** Remplit un champ contrôlé React (setter natif + événement `input`). */
async function fill(input, value) {
  assert.ok(input, 'champ trouvé')
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/**
 * Appelle le gestionnaire `onSubmit` d'un formulaire EN l'attendant.
 * `dispatchEvent('submit')` ne le permet pas : React mettrait à jour l'état
 * après la fin du `act` (avertissement + assertion sur un DOM pas re-rendu).
 */
async function submit(form) {
  assert.ok(form, 'formulaire trouvé')
  const key = Object.keys(form).find((k) => k.startsWith('__reactProps'))
  await act(async () => {
    await form[key].onSubmit({ preventDefault: noop })
  })
  await settle(80)
}

/** Champ associé à un <label> donné (les formulaires master n'ont pas d'id). */
function inputByLabel(root, labelText) {
  const label = [...root.querySelectorAll('label')].find((l) => clean(l) === labelText)
  return label ? label.parentElement.querySelector('input,select') : null
}

/** Sélecteur « contient » — plusieurs boutons ont un titre ET un sous-titre. */
function byContains(root, selector, text) {
  return [...root.querySelectorAll(selector)].find((n) => clean(n).includes(text)) || null
}

// ---------------------------------------------------------------------------
// 2.1 (F1) — « Ajouter la config » ouvre le panier
// ---------------------------------------------------------------------------
describe('LOT 2.1 (F1) — depuis le configurateur, « Ajouter la config » ouvre le panier', () => {
  it('le panier s’ouvre et le configurateur reste affiché', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('pcstar-lang', 'fr')
    const m = await mount(React.createElement(App))
    try {
      await click(m.byText('button,a', t('navBuilder')))
      assert.ok(m.text().includes(t('builderTitle')), 'page configurateur atteinte')

      // Un préréglage remplit les emplacements obligatoires (carte mère, CPU,
      // RAM) d'un coup — c'est le chemin le plus court vers un `addBuild` actif.
      await click(byContains(m.host, 'button', t('presetStudent')))
      const addBtn = m.byText('button', t('addBuild'))
      assert.ok(addBtn, 'bouton « Ajouter la config au panier » présent')
      assert.equal(addBtn.disabled, false, 'la config est complète et compatible')

      await click(addBtn)

      // AVANT : `'cart'` absent de KNOWN_PAGES → réécrit en `'shop'` avant la
      // branche `next === 'cart'`, qui était morte. Les pièces partaient bien
      // dans le panier, mais l'utilisateur était renvoyé sur la boutique,
      // panier fermé — d'où l'impression d'un bouton qui « ne fait rien ».
      const offcanvas = m.host.querySelector('.offcanvas')
      assert.ok(offcanvas, 'le tiroir panier existe')
      assert.ok(offcanvas.classList.contains('show'), 'le panier est OUVERT après l’ajout de la config')
      assert.ok(m.text().includes(t('builderTitle')), 'on est toujours sur le configurateur (pas renvoyé sur la boutique)')
      // Et le panier contient bien les pièces de la config.
      assert.ok(clean(offcanvas).includes('G640') || clean(offcanvas).includes('MSI-B450M'), 'une référence de la config est dans le panier')
      assert.match(clean(offcanvas), /\d/, 'le panier affiche un total')
    } finally {
      await m.unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// 2.4 (F6) — la confirmation de commande ne survit pas au compte précédent
// ---------------------------------------------------------------------------
describe('LOT 2.4 (F6) — la confirmation du client précédent disparaît à la déconnexion', () => {
  const CODE_RE = /PS-\d{8}-\d{4}/

  it('logout → ouvrir le panier ne montre plus la confirmation (nom, code, total)', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('pcstar-lang', 'fr')
    // Session locale sur un compte de démonstration seedé par `loadUsers`.
    window.localStorage.setItem('pcstar-session', JSON.stringify({ userId: 'demo-karim' }))
    // Panier de ce compte : la réservation est possible sans clic produit.
    const pad = PRODUCTS.find((p) => p.id === 'mousepad')
    window.localStorage.setItem(
      'pcstar-cart-demo-karim',
      JSON.stringify([{ id: pad.id, sku: pad.sku, name: pad.name, price: pad.price, qty: 1 }])
    )

    const m = await mount(React.createElement(App))
    try {
      assert.ok(m.text().includes('Karim B.'), 'compte de démonstration connecté')

      // Ouvrir le panier et réserver (le formulaire est pré-rempli depuis le
      // profil : nom + mobile DZ).
      await click(m.host.querySelector('.app .navbar button.btn-success'))
      const offcanvas = m.host.querySelector('.offcanvas')
      assert.ok(offcanvas.classList.contains('show'), 'panier ouvert')
      const form = offcanvas.querySelector('form')
      await fill(form.querySelector('#name'), 'Karim B.')
      await fill(form.querySelector('#phone'), '0550123456')
      await submit(form)

      assert.match(m.text(), CODE_RE, 'une confirmation de réservation est affichée')
      assert.ok(m.text().includes(t('successTitle')), 'écran de confirmation')
      const code = m.text().match(CODE_RE)[0]
      assert.ok(m.text().includes('Karim B.'), 'le nom du client figure sur la confirmation')

      // Déconnexion.
      await click(m.byText('button', t('navLogout')))
      assert.ok(!m.text().includes('Karim B.'), 'le compte est bien déconnecté')

      // Rouvrir le panier : AVANT le correctif, `reserved` survivait au logout
      // et le visiteur suivant voyait « Réservation confirmée · Karim B. ·
      // 12:30 · 7 500 DA » — la confirmation d'un autre, avec ses données.
      await click(m.host.querySelector('.app .navbar button.btn-success'))
      const after = clean(m.host.querySelector('.offcanvas'))
      assert.ok(!after.includes(t('successTitle')), 'plus d’écran de confirmation')
      assert.ok(!after.includes(code), `le code ${code} du compte précédent ne doit plus s’afficher`)
      assert.ok(!CODE_RE.test(after), 'aucun code de réservation ne survit')
    } finally {
      await m.unmount()
    }
  })

  it('poste partagé : le client suivant retrouve SON panier, jamais la confirmation d’un autre', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('pcstar-lang', 'fr')
    window.localStorage.setItem('pcstar-session', JSON.stringify({ userId: 'demo-karim' }))
    const pad = PRODUCTS.find((p) => p.id === 'mousepad')
    const ssd = PRODUCTS.find((p) => p.id === 'ssd-1t')
    window.localStorage.setItem(
      'pcstar-cart-demo-karim',
      JSON.stringify([{ id: pad.id, sku: pad.sku, name: pad.name, price: pad.price, qty: 1 }])
    )
    // Le compte suivant a son propre panier : on vérifie à la fois l'absence de
    // fuite et le rechargement du bon panier (effet `authId`, src/App.jsx:589).
    window.localStorage.setItem(
      'pcstar-cart-demo-amina',
      JSON.stringify([{ id: ssd.id, sku: ssd.sku, name: ssd.name, price: ssd.price, qty: 1 }])
    )

    const m = await mount(React.createElement(App))
    try {
      await click(m.host.querySelector('.app .navbar button.btn-success'))
      await submit(m.host.querySelector('.offcanvas form'))
      assert.match(m.text(), CODE_RE, 'confirmation affichée pour Karim')
      const karimCode = m.text().match(CODE_RE)[0]

      // Poste partagé : Karim se déconnecte, Amina se connecte sur le même
      // appareil.
      await click(m.byText('button', t('navLogout')))
      await click(m.byText('button', t('navLogin')))
      const modal = m.host.querySelector('.modal')
      assert.ok(modal, 'le panneau de connexion s’ouvre')
      await fill(modal.querySelector('#auth-email'), 'amina.castors@demo.dz')
      await fill(modal.querySelector('#auth-pass'), DEMO_LOCAL_PASSWORD)
      await submit(modal.querySelector('form'))
      await settle(150)
      assert.ok(m.text().includes('Amina K.'), 'le second compte est connecté')

      await click(m.host.querySelector('.app .navbar button.btn-success'))
      const oc = m.host.querySelector('.offcanvas')
      const after = clean(oc)
      assert.ok(oc.classList.contains('show'), 'panier ouvert')
      assert.ok(!after.includes(t('successTitle')), 'la confirmation de Karim ne suit pas Amina')
      assert.ok(!after.includes(karimCode), `le code ${karimCode} de Karim ne doit plus s’afficher`)
      assert.ok(!CODE_RE.test(after), 'aucun code de réservation ne survit au changement de compte')
      assert.ok(!after.includes('Karim B.'), 'aucune donnée personnelle du compte précédent')
      // Et c'est bien SON panier qui est rechargé, pas celui de Karim.
      assert.ok(after.includes(ssd.name) || after.includes(ssd.sku), 'le panier d’Amina est affiché')
      assert.ok(!after.includes(pad.name), 'le panier de Karim a disparu')
      // Le formulaire de retrait reprend le profil du compte connecté.
      assert.equal(oc.querySelector('#name').value, 'Amina K.', 'nom pré-rempli depuis le profil d’Amina')
      assert.equal(oc.querySelector('#phone').value, '0669174617', 'mobile pré-rempli depuis le profil d’Amina')
    } finally {
      await m.unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// 2.5 (F9) — contrôle de SKU sur le catalogue COMPLET en mode local
// ---------------------------------------------------------------------------
describe('LOT 2.5 (F9) — un SKU masqué ou en rupture ne peut plus être dupliqué', () => {
  const BASE_PANELS = [{ id: 'parts', titleKey: 'panelParts' }]
  const outOfStock = PRODUCTS.find((p) => p.stock === 0)
  const hidden = PRODUCTS.find((p) => p.stock > 0)

  /** Reproduit exactement le câblage de src/App.jsx:1517-1518. */
  function metaWith(hiddenIds) {
    return {
      extraProducts: [],
      hiddenProductIds: hiddenIds,
      extraPanels: [],
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: {}
    }
  }

  async function mountMaster(meta, { onMeta, setToast }) {
    const shopView = buildShopView(PRODUCTS, PART_LINES, BASE_PANELS, meta)
    // `products` = catalogue PUBLIC filtré (stock > 0), `masterCatalog` = vue
    // master non filtrée par stock — les deux props telles que App les passe.
    const products = shopView.products.filter((p) => (Number(p.stock) || 0) > 0)
    return mount(
      React.createElement(MasterPage, {
        t,
        lang: 'fr',
        user: { id: 'master-pcstar', role: 'master', name: 'PC Star Desk' },
        users: [],
        onUsers: noop,
        products,
        masterCatalog: shopView.products,
        meta,
        onMeta,
        basePanels: BASE_PANELS,
        setToast,
        onBack: noop,
        apiOnline: false
      })
    )
  }

  async function tryCreate(m, sku) {
    const form = m.host.querySelector('form')
    assert.ok(clean(form).includes(t('masterAddProduct')), 'formulaire de création trouvé')
    await fill(inputByLabel(form, t('masterName')), 'Produit de test')
    await fill(inputByLabel(form, t('masterSku')), sku)
    await fill(inputByLabel(form, t('masterPrice')), '1500')
    await fill(inputByLabel(form, t('masterStock')), '3')
    await submit(form)
  }

  it('fixtures : les deux références visées sont bien absentes du catalogue public filtré', () => {
    assert.ok(outOfStock, 'une référence en rupture existe (stock 0)')
    const meta = metaWith([hidden.id])
    const shopView = buildShopView(PRODUCTS, PART_LINES, BASE_PANELS, meta)
    const products = shopView.products.filter((p) => (Number(p.stock) || 0) > 0)
    assert.ok(!products.some((p) => p.id === outOfStock.id), 'la rupture est filtrée du catalogue public')
    assert.ok(!products.some((p) => p.id === hidden.id), 'la référence masquée est filtrée aussi')
    // C'est ce qui rendait le contrôle aveugle : ni l'une ni l'autre n'était
    // dans la liste passée à `addProduct`.
    assert.ok(shopView.products.some((p) => p.id === outOfStock.id), 'mais présente dans la vue master')
  })

  it('SKU d’une référence en rupture → refus « SKU déjà utilisé »', async () => {
    const toasts = []
    let metaCalls = 0
    const m = await mountMaster(metaWith([]), {
      onMeta: () => {
        metaCalls += 1
      },
      setToast: (x) => toasts.push(x)
    })
    try {
      await tryCreate(m, outOfStock.sku)
      assert.deepEqual(toasts, [t('masterSkuTaken')], `toasts : ${JSON.stringify(toasts)}`)
      assert.equal(metaCalls, 0, 'aucun produit créé')
    } finally {
      await m.unmount()
    }
  })

  it('SKU d’une référence MASQUÉE → refus aussi', async () => {
    const toasts = []
    let metaCalls = 0
    const m = await mountMaster(metaWith([hidden.id]), {
      onMeta: () => {
        metaCalls += 1
      },
      setToast: (x) => toasts.push(x)
    })
    try {
      await tryCreate(m, hidden.sku)
      assert.deepEqual(toasts, [t('masterSkuTaken')], `toasts : ${JSON.stringify(toasts)}`)
      assert.equal(metaCalls, 0, 'un produit masqué reste une référence : son SKU ne se reprend pas')
    } finally {
      await m.unmount()
    }
  })

  it('SKU libre → création acceptée', async () => {
    const toasts = []
    const metas = []
    const m = await mountMaster(metaWith([]), {
      onMeta: (x) => metas.push(x),
      setToast: (x) => toasts.push(x)
    })
    try {
      await tryCreate(m, 'TEST-LIBRE-1')
      assert.deepEqual(toasts, [t('masterAdded')], `toasts : ${JSON.stringify(toasts)}`)
      assert.equal(metas.length, 1, 'le meta est propagé')
      assert.equal(metas[0].extraProducts.length, 1)
      assert.equal(metas[0].extraProducts[0].sku, 'TEST-LIBRE-1')
    } finally {
      await m.unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// 2.7 (F11 + B20) — la réponse du serveur est la source de vérité
// ---------------------------------------------------------------------------
describe('LOT 2.7 (F11 + B20) — panneaux : l’état client suit la réponse serveur', () => {
  const BASE_PANELS = [{ id: 'parts', titleKey: 'panelParts' }]
  const twelvePanels = Array.from({ length: 12 }, (_, i) => ({
    id: `panel-${i + 1}`,
    titles: { ar: `ل${i + 1}`, fr: `P${i + 1}`, en: `P${i + 1}` },
    categories: ['accessories'],
    custom: true
  }))

  function metaWith12() {
    return {
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: twelvePanels,
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: {}
    }
  }

  /**
   * API simulée, ÉTATFUL comme server/index.js PUT /api/master/panels :
   * `hiddenPanelIds` dédoublonné, `extraPanels` tronqué à 12, et la réponse
   * ne porte QUE ces deux champs (d'où la fusion côté client).
   */
  function stubApi(dbMeta = { hiddenPanelIds: [], extraPanels: twelvePanels.slice() }) {
    const calls = []
    const json = (body) => ({ ok: true, status: 200, json: async () => body })
    globalThis.fetch = async (url, opts = {}) => {
      const path = String(url)
      const method = opts.method || 'GET'
      calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null })
      if (path.endsWith('/api/master/panels') && method === 'PUT') {
        const sent = JSON.parse(opts.body)
        if (sent.hiddenPanelIds != null) dbMeta.hiddenPanelIds = [...new Set(sent.hiddenPanelIds)]
        if (sent.extraPanels != null) dbMeta.extraPanels = sent.extraPanels.slice(0, 12)
        return json({
          ok: true,
          meta: { hiddenPanelIds: [...dbMeta.hiddenPanelIds], extraPanels: [...dbMeta.extraPanels] }
        })
      }
      if (path.endsWith('/api/master/products')) return json({ ok: true, products: [] })
      if (path.endsWith('/api/customers')) return json({ ok: true, customers: [] })
      return json({ ok: true })
    }
    window.fetch = globalThis.fetch
    return calls
  }

  async function mountMasterApi(meta, onMeta) {
    return mount(
      React.createElement(MasterPage, {
        t,
        lang: 'fr',
        user: { id: 'master-pcstar', role: 'master', name: 'PC Star Desk' },
        users: [],
        onUsers: noop,
        products: [],
        masterCatalog: [],
        meta,
        onMeta,
        basePanels: BASE_PANELS,
        setToast: noop,
        onBack: noop,
        apiOnline: true
      })
    )
  }

  it('13ᵉ panneau : l’état client reflète la troncature serveur (12)', async () => {
    const calls = stubApi()
    const received = []
    const m = await mountMasterApi(metaWith12(), (x) => received.push(x))
    try {
      await click(m.byText('button', t('masterPanels')))
      const form = [...m.host.querySelectorAll('form')].find((f) => clean(f).includes(t('masterPanels')))
      assert.ok(form, 'formulaire d’ajout de panneau')
      await fill(inputByLabel(form, 'FR'), 'Panneau 13')
      await submit(form)

      const put = calls.find((c) => c.method === 'PUT' && c.path.endsWith('/api/master/panels'))
      assert.ok(put, 'PUT /api/master/panels envoyé')
      assert.equal(put.body.extraPanels.length, 13, 'le client propose bien un 13ᵉ')

      // AVANT : `onMeta(res.meta)` — le meta calculé LOCALEMENT par `addPanel`,
      // qui contient 13 panneaux. Le comptoir en affichait 13 alors que la base
      // n'en gardait que 12 : le 13ᵉ disparaissait au rechargement suivant, sans
      // aucun message.
      assert.equal(received.length, 1, 'onMeta appelé une fois')
      assert.equal(received[0].extraPanels.length, 12, 'l’état client doit suivre la troncature serveur')
      assert.deepEqual(
        received[0].extraPanels.map((p) => p.id),
        twelvePanels.map((p) => p.id),
        'ce sont les 12 panneaux conservés par le serveur'
      )
    } finally {
      await m.unmount()
      globalThis.fetch = offlineFetch
      window.fetch = globalThis.fetch
    }
  })

  it('masquer un panneau reprend la liste du serveur, pas le calcul local', async () => {
    // Divergence réaliste : le comptoir a un meta LOCAL à 13 panneaux (créé
    // avant la troncature, jamais resynchronisé) alors que la base n'en a que
    // 12. La réponse du PUT doit l'emporter — sinon l'écart survit
    // indéfiniment et le 13ᵉ « fantôme » disparaît au prochain rechargement.
    const stale13 = [...twelvePanels, { id: 'panel-13', titles: { ar: 'ل13', fr: 'P13', en: 'P13' }, categories: ['accessories'], custom: true }]
    const calls = stubApi({ hiddenPanelIds: [], extraPanels: twelvePanels.slice() })
    const received = []
    const meta = {
      extraProducts: [{ id: 'sku-test', sku: 'SKU-TEST', name: 'Test', price: 100, category: 'accessories' }],
      hiddenProductIds: [],
      extraPanels: stale13,
      hiddenPanelIds: [],
      photoOverrides: { 'ssd-1t': 'data:,x' },
      productOverrides: {}
    }
    const m = await mountMasterApi(meta, (x) => received.push(x))
    try {
      await click(m.byText('button', t('masterPanels')))
      // Les panneaux personnalisés n'ont pas de bascule : on masque un panneau
      // de base (bouton ON/OFF).
      const toggle = m.byText('button', 'ON')
      assert.ok(toggle, 'bouton ON d’un panneau de base trouvé')
      await click(toggle)

      const put = calls.find((c) => c.method === 'PUT' && c.path.endsWith('/api/master/panels'))
      assert.ok(put, 'PUT envoyé')
      assert.deepEqual(put.body.hiddenPanelIds, [BASE_PANELS[0].id], 'le client n’envoie que les masques')
      assert.equal(put.body.extraPanels, undefined, 'et ne renvoie pas ses panneaux sur un simple masque')

      assert.ok(received.length >= 1, 'onMeta appelé')
      const last = received[received.length - 1]
      assert.deepEqual(last.hiddenPanelIds, [BASE_PANELS[0].id], 'le masque vient de la réponse serveur')
      // AVANT : `onMeta({ ...meta, hiddenPanelIds: [...current] })` — les 13
      // panneaux périmés du client étaient conservés tels quels.
      assert.equal(last.extraPanels.length, 12, 'les panneaux de la BASE remplacent l’état périmé du client')
      assert.deepEqual(last.extraPanels.map((x) => x.id), twelvePanels.map((x) => x.id))
      // B20 : la réponse ne porte QUE les deux champs de panneaux — le reste du
      // meta client doit survivre à la fusion.
      assert.equal(last.extraProducts.length, 1, 'extraProducts préservé par la fusion')
      assert.deepEqual(last.photoOverrides, { 'ssd-1t': 'data:,x' }, 'photoOverrides préservé')
    } finally {
      await m.unmount()
      globalThis.fetch = offlineFetch
      window.fetch = globalThis.fetch
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — les commandes guest ne deviennent jamais celles d'un compte
// ---------------------------------------------------------------------------
describe('Phase 3 — commandes guest séparées de la session connectée', () => {
  const USER = { id: 'demo-karim', name: 'Karim B.', role: 'customer' }

  function seedOrders() {
    window.localStorage.setItem(
      'pcstar-orders',
      JSON.stringify([
        { code: 'PS-20260915-0001', status: 'new', name: 'Karim B.', total: 7500, userId: 'demo-karim', at: '2026-09-15T10:00:00.000Z', items: [{ id: 'mousepad', name: 'Pad', qty: 1 }] },
        { code: 'PS-20260915-0002', status: 'new', name: 'Karim B.', total: 12000, userId: null, at: '2026-09-15T11:00:00.000Z', items: [{ id: 'ssd-1t', name: 'SSD', qty: 1 }] },
        { code: 'PS-20260915-0003', status: 'new', name: 'Autre', total: 9000, userId: 'demo-amina', at: '2026-09-15T12:00:00.000Z', items: [] }
      ])
    )
  }

  async function mountOrders(user) {
    return mount(
      React.createElement(OrdersPage, {
        t,
        user,
        apiOnline: false,
        mode: 'local',
        onCancelOrder: noop,
        onBack: noop
      })
    )
  }

  it('connecté : seules les commandes explicitement liées à son compte sont listées', async () => {
    window.localStorage.clear()
    seedOrders()
    const m = await mountOrders(USER)
    try {
      const text = m.text()
      assert.ok(text.includes('PS-20260915-0001'), 'la commande du compte est listée')
      assert.ok(!text.includes('PS-20260915-0002'), 'une guest du navigateur a basculé dans le compte')
      assert.ok(!text.includes('PS-20260915-0003'), 'la commande d’un AUTRE compte ne fuit pas')
    } finally {
      await m.unmount()
    }
  })

  it('une commande guest locale n’est pas affichée sous une session connectée', async () => {
    window.localStorage.clear()
    seedOrders()
    const m = await mountOrders(USER)
    try {
      const cards = [...m.host.querySelectorAll('article')]
      assert.equal(cards.length, 1, 'la seule carte doit appartenir au compte')
      assert.ok(clean(cards[0]).includes('PS-20260915-0001'))
      assert.ok(!clean(cards[0]).includes(t('orderGuestBadge')))
    } finally {
      await m.unmount()
    }
  })

  it('sans compte : seules les commandes guest de l’appareil (comportement inchangé)', async () => {
    window.localStorage.clear()
    seedOrders()
    const m = await mountOrders(null)
    try {
      const text = m.text()
      assert.ok(text.includes('PS-20260915-0002'), 'la commande guest reste visible')
      assert.ok(!text.includes('PS-20260915-0001'), 'celle du compte connecté ne l’est pas')
      assert.ok(!text.includes('PS-20260915-0003'))
      assert.ok(!text.includes(t('orderGuestBadge')), 'pas de badge : tout est guest ici')
      assert.ok(text.includes(t('ordersGuestNote')), 'la note guest est affichée')
    } finally {
      await m.unmount()
    }
  })

  it('les clés ajoutées existent dans les deux langues du site', () => {
    for (const lang of ['fr', 'en']) {
      const v = dict[lang]?.orderGuestBadge
      assert.ok(typeof v === 'string' && v.length > 3, `[${lang}] orderGuestBadge : ${JSON.stringify(v)}`)
    }
    assert.notEqual(dict.en.orderGuestBadge, dict.fr.orderGuestBadge)
  })
})
