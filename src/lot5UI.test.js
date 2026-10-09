import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 5 — honnêteté de l'interface, partie RENDUE (composants réels dans jsdom).
//
//  5.1 (U1)   l'indicateur d'état était codé en dur : point vert + « SYS.ONLINE »
//             en permanence, y compris API morte ou base dégradée.
//  5.3 (U3)   le bouton d'enregistrement des photos disait « Photos
//             enregistrées » — au passé, avant d'enregistrer.
//  5.4 (U4)   les prix du panier restaient figés à l'ajout : le maître change un
//             prix, la vitrine suit, le panier/total/WhatsApp non.
//  5.8 (U8)   `PartThumb` annonçait un `sizes` sans aucun `srcSet` multi-largeurs.
//  5.9 (U9)   le bip du Desk posait le gain d'un coup → clic audible à chaque
//             commande annoncée au comptoir.
//  5.10 (U10) l'encadrement tiers n'est pas un scénario supporté : les en-têtes
//             l'interdisent, et les commentaires ne doivent plus dire l'inverse.
//  5.12 (U12) `URL.revokeObjectURL` immédiatement après `a.click()` coupait
//             parfois le téléchargement en plein vol.
//
// La logique pure (messages de stock, i18n, garde WhatsApp) est dans
// src/lot5Logic.test.js.
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
const { default: App, deskBeep, __resetDeskAudio, BEEP_PEAK_GAIN, BEEP_ATTACK_S, BEEP_DURATION_S } = await import(
  './App.jsx'
)
const { default: MasterPage } = await import('./MasterPage.jsx')
const { default: PartThumb } = await import('./PartThumb.jsx')
const { dict } = await import('./i18n.js')
const { PRODUCTS } = await import('./data.js')
const { saveLang } = await import('./prefs.js')
const { safeStorage, resetSafeStorage, isStorageBlocked } = await import('./safeStorage.js')

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

/** Réseau mort : l'app tourne en mode local (catalogue `data.js`). */
const offlineFetch = async () => {
  throw new TypeError('offline (test)')
}

/**
 * API pilotée par (method, chemin) — pour les états « en ligne » et « dégradé ».
 * Tout ce qui n'est pas listé répond `{ ok: true, data: {} }`.
 */
function stubApi(routes) {
  globalThis.fetch = async (url, opts = {}) => {
    const method = String(opts.method || 'GET').toUpperCase()
    const path = String(url).split('?')[0]
    const match = routes.find(([m, p]) => m === method && (p instanceof RegExp ? p.test(path) : p === path))
    // `api.req()` renvoie `{ ok: res.ok, status, data: <corps JSON> }` : le
    // corps du stub EST donc le `data` (pas une enveloppe `{ok,data}`).
    const spec = match ? match[2] : { status: 200, body: {} }
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => spec.body,
      text: async () => JSON.stringify(spec.body),
      blob: async () => new window.Blob(['code,total\nPC1,1000\n'], { type: 'text/csv' }),
      headers: { get: () => null }
    }
  }
  window.fetch = globalThis.fetch
}

before(() => {
  resetSafeStorage(window)
  window.localStorage.clear()
  saveLang(safeStorage, 'fr')
  globalThis.fetch = offlineFetch
  window.fetch = globalThis.fetch
})

after(async () => {
  // Les globaux jsdom restent en place : `App` peut avoir une reprise de
  // session en vol (`applyApiSession` retente après un délai) qui toucherait
  // `window` après la fin du fichier — supprimer les globaux ici transformait
  // cette activité tardive en `ReferenceError` non capturée.
  await settle(60)
  __resetDeskAudio()
  globalThis.fetch = realFetch
  window.fetch = realFetch
})

/** Extrait l'indicateur d'état de la topbar (texte court → échecs lisibles). */
function sysText(host) {
  const node = [...host.querySelectorAll('span')].find((n) => /SYS\.(ONLINE|DEGRADED|OFFLINE)/.test(clean(n)))
  return node ? clean(node) : ''
}

async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(150)
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

/* ------------------------------------------------------------- 5.1 (U1) */

describe('5.1 (U1) — l’indicateur d’état dit la vérité', () => {
  it('API injoignable → SYS.OFFLINE en rouge, et une explication en français', async () => {
    globalThis.fetch = offlineFetch
    window.fetch = globalThis.fetch
    window.localStorage.clear()
    const m = await mount(React.createElement(App))
    const txt = sysText(m.host)
    assert.match(txt, /SYS\.OFFLINE/, 'l’indicateur doit annoncer l’état hors-ligne')
    assert.doesNotMatch(txt, /SYS\.ONLINE/, 'plus de « ONLINE » codé en dur')
    const dot = m.host.querySelector('span.text-danger')
    assert.ok(dot, 'le point doit passer en rouge (text-danger)')
    assert.equal(dot.textContent.trim(), '●')
    // L’explication est dans la langue de l’utilisateur (title + aria-label).
    const labelled = m.host.querySelector(`[aria-label="${t('sysState_offline')}"]`)
    assert.ok(labelled, 'l’état doit être expliqué en français, pas seulement en jargon')
    assert.equal(labelled.parentElement.getAttribute('title'), t('sysState_offline'))
    await m.unmount()
  })

  it('API debout, base saine → SYS.ONLINE en vert (comportement d’origine conservé)', async () => {
    stubApi([
      // `api.health()` renvoie le CORPS de la réponse, et `App` fait
      // `setApiOnline(Boolean(h?.ok))` : le corps doit donc porter `ok: true`.
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/me', { status: 200, body: { user: { id: 'demo-karim', role: 'customer', name: 'Karim B.', email: 'karim.oran@demo.dz' } } }],
      ['GET', '/api/catalog', { status: 200, body: { products: PRODUCTS.slice(0, 5), degraded: false } }]
    ])
    window.localStorage.clear()
    const m = await mount(React.createElement(App))
    const txt = sysText(m.host)
    assert.match(txt, /SYS\.ONLINE/, `topbar attendue en ligne, reçu : ${txt}`)
    assert.doesNotMatch(txt, /SYS\.OFFLINE|SYS\.DEGRADED/)
    assert.ok(m.host.querySelector('span.text-success'), 'le point reste vert quand tout vient du serveur')
    await m.unmount()
  })

  it('API debout mais base en repli → SYS.DEGRADED en orange (l’état le plus trompeur avant U1)', async () => {
    stubApi([
      ['GET', '/api/health', { status: 200, body: { ok: true } }],
      ['GET', '/api/me', { status: 200, body: { user: { id: 'demo-karim', role: 'customer', name: 'Karim B.', email: 'karim.oran@demo.dz' } } }],
      [
        'GET',
        '/api/catalog',
        { status: 200, body: { products: PRODUCTS.slice(0, 5), degraded: true, db: { asOf: new Date().toISOString(), source: 'fallback' } } }
      ]
    ])
    window.localStorage.clear()
    const m = await mount(React.createElement(App))
    const txt = sysText(m.host)
    assert.match(txt, /SYS\.DEGRADED/, `une base dégradée ne doit plus s’afficher « ONLINE » — reçu : ${txt}`)
    assert.doesNotMatch(txt, /SYS\.ONLINE/)
    assert.ok(m.host.querySelector('span.text-warning'), 'le point doit passer en orange')
    assert.ok(m.host.querySelector(`[aria-label="${t('sysState_degraded')}"]`), 'explication en français attendue')
    await m.unmount()
  })

  it('les 3 états sont traduits dans les deux langues', () => {
    for (const lang of ['fr', 'en']) {
      for (const state of ['online', 'degraded', 'offline']) {
        assert.ok(dict[lang][`sysState_${state}`], `${lang}.sysState_${state} manque`)
      }
    }
  })
})

/* ------------------------------------------------------------- 5.3 (U3) */

const masterProps = (over = {}) => ({
  t,
  lang: 'fr',
  user: { id: 'master-pcstar', role: 'master', name: 'PC Star Desk' },
  users: [],
  onUsers() {},
  products: [],
  masterCatalog: [],
  meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], productOverrides: {}, stock: {} },
  onMeta() {},
  basePanels: [],
  setToast() {},
  onBack() {},
  apiOnline: false,
  onStockRefresh() {},
  ...over
})

describe('5.3 (U3) — le bouton annonce une action, pas un résultat', () => {
  it('l’éditeur de photos propose « Enregistrer les photos », pas « Photos enregistrées »', async () => {
    window.localStorage.clear()
    const product = { ...PRODUCTS[0], photos: ['/photos/sku/x-1.jpg'] }
    const m = await mount(React.createElement(MasterPage, masterProps({ products: [product], masterCatalog: [product] })))

    const opener = m.byText('button', t('masterEditPhotos'))
    assert.ok(opener, 'le bouton « Modifier les photos » doit exister')
    await act(async () => {
      opener.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await settle(60)

    const save = m.byText('button', t('masterSavePhotos'))
    assert.ok(save, 'le bouton d’enregistrement doit porter un libellé d’action')
    // Le libellé au passé reste réservé au toast de confirmation.
    assert.equal(m.byText('button', t('masterPhotosSaved')), null, 'aucun bouton ne doit dire « Photos enregistrées »')
    await m.unmount()
  })

  it('la clé du toast de confirmation existe toujours (U3 ne supprime pas la confirmation)', () => {
    for (const lang of ['fr', 'en']) {
      assert.ok(dict[lang].masterPhotosSaved, `${lang}.masterPhotosSaved manque`)
      assert.ok(dict[lang].masterSavePhotos, `${lang}.masterSavePhotos manque`)
      assert.notEqual(dict[lang].masterPhotosSaved, dict[lang].masterSavePhotos, 'les deux libellés doivent différer')
    }
  })
})

/* ------------------------------------------------------------- 5.4 (U4) */

describe('5.4 (U4) — les prix du panier suivent le catalogue', () => {
  const live = PRODUCTS[0] // cpu-7800x3d, 97 000 DA

  it('un panier persisté à un prix périmé est recalé, et le client est prévenu', async () => {
    globalThis.fetch = offlineFetch
    window.fetch = globalThis.fetch
    window.localStorage.clear()
    // Le maître a changé le prix pendant la visite ; le panier localStorage
    // porte encore l'ancien (c'est exactement le cas du panier rechargé).
    const stalePrice = Math.round(live.price * 0.8)
    window.localStorage.setItem(
      'pcstar-cart-guest',
      JSON.stringify([{ id: live.id, sku: live.sku, name: live.name, qty: 2, price: stalePrice }])
    )

    const m = await mount(React.createElement(App))

    // 1. le stockage est recalé sur le prix live
    const stored = JSON.parse(window.localStorage.getItem('pcstar-cart-guest'))
    assert.equal(stored[0].price, live.price, 'le panier persisté doit porter le prix du catalogue')
    assert.notEqual(stored[0].price, stalePrice)

    // 2. l'écran affiche le total au prix live (2 × 97 000, pas 2 × 77 600)
    const totalLive = 2 * live.price
    const flat = m.text().replace(/[\s\u00a0\u202f]/g, '')
    assert.ok(flat.includes(String(totalLive)), `le total live ${totalLive} doit apparaître`)
    assert.ok(!flat.includes(String(2 * stalePrice)), 'le total périmé ne doit plus apparaître')

    // 3. et le changement est ANNONCÉ (pas de prix qui bouge en silence)
    const prefix = dict.fr.cartPriceUpdated.split('{lines}')[0].trim()
    assert.ok(prefix.length > 5, 'préfixe du toast introuvable dans le dictionnaire')
    assert.ok(
      m.text().includes(prefix),
      `un toast doit annoncer la mise à jour des prix (attendu « ${prefix}… »)`
    )
    // Le prix corrigé est nommé dans l'annonce, et le libellé reste court
    // (2 produits au plus, puis « … ») : un toast n'est pas un ticket de caisse.
    const announced = m.text().slice(m.text().indexOf(prefix), m.text().indexOf(prefix) + 160)
    assert.match(announced.replace(/[\s\u00a0\u202f]/g, ''), new RegExp(String(live.price)), 'le nouveau prix doit être dit')
    assert.match(announced, new RegExp(live.name.split(' ')[0]), 'le produit concerné doit être nommé')
    assert.ok(isStorageBlocked() === false, 'le test suppose un stockage fonctionnel')
    await m.unmount()
  })

  it('un panier déjà à jour ne déclenche aucun toast (pas de bruit)', async () => {
    window.localStorage.clear()
    window.localStorage.setItem(
      'pcstar-cart-guest',
      JSON.stringify([{ id: live.id, sku: live.sku, name: live.name, qty: 1, price: live.price }])
    )
    const m = await mount(React.createElement(App))
    assert.doesNotMatch(m.text(), /Prix mis à jour/, 'aucune annonce quand rien n’a changé')
    const stored = JSON.parse(window.localStorage.getItem('pcstar-cart-guest'))
    assert.equal(stored[0].price, live.price)
    await m.unmount()
  })

  it('le message WhatsApp et le récapitulatif portent les prix live', async () => {
    const { buildWaMessage } = await import('./orderLogic.js')
    // Vue « prix live » : c'est elle qui alimente total, payload et wa.me.
    const pricedCart = [{ qty: 1, name: live.name, sku: live.sku, price: live.price }]
    const total = pricedCart.reduce((s, i) => s + i.qty * i.price, 0)
    const msg = buildWaMessage(pricedCart, total, { name: 'Karim B.' }, t)
    assert.equal(total, live.price)
    assert.match(msg.replace(/[\s\u00a0\u202f]/g, ''), new RegExp(String(live.price)))
    // Le code d'App.jsx construit ces trois vues depuis `pricedCart` : on le
    // vérifie à la source, parce qu'un retour en arrière sur `cart` ne se voit
    // pas dans un rendu unique (le panier est déjà recalé au montage).
    const src = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
    assert.match(src, /const total = pricedCart\.reduce/, 'le total doit venir de pricedCart')
    assert.match(src, /items: pricedCart\.map/, 'le payload de commande doit venir de pricedCart')
    assert.match(src, /buildWaMessage\(pricedCart/, 'le message WhatsApp doit venir de pricedCart')
    assert.match(src, /\{pricedCart\.map\(\(i\) => \(/, 'le panier affiché doit venir de pricedCart')
  })
})

/* ------------------------------------------------------------- 5.8 (U8) */

describe('5.8 (U8) — PartThumb n’annonce plus de responsive inexistant', () => {
  const product = { ...PRODUCTS[0], photos: ['/photos/sku/cpu-7800x3d-1.jpg'] }

  it('aucun attribut `sizes` sur les images rendues', async () => {
    const m = await mount(React.createElement(PartThumb, { product }))
    const imgs = [...m.host.querySelectorAll('img')]
    assert.ok(imgs.length > 0, 'une vignette doit être rendue')
    for (const img of imgs) {
      assert.equal(img.getAttribute('sizes'), null, '`sizes` sans srcSet multi-largeurs ne sert à rien')
      assert.ok(img.getAttribute('width'), 'width reste (ratio réservé, pas de décalage de mise en page)')
      assert.ok(img.getAttribute('height'), 'height reste')
    }
    await m.unmount()
  })

  it('passer `sizes` ne fait plus rien (la prop a disparu de la signature)', async () => {
    const m = await mount(React.createElement(PartThumb, { product, sizes: '100vw' }))
    for (const img of m.host.querySelectorAll('img')) assert.equal(img.getAttribute('sizes'), null)
    await m.unmount()
  })

  it('la source ne mentionne plus `sizes` comme prop (hors commentaire explicatif)', () => {
    const src = readFileSync(new URL('./PartThumb.jsx', import.meta.url), 'utf8')
    assert.doesNotMatch(src, /sizes\s*=\s*\{/, 'plus de `sizes={...}` dans le JSX')
    assert.doesNotMatch(src, /sizes\s*=\s*'\(max-width/, 'plus de valeur par défaut')
    assert.match(src, /srcSet|<picture>/, 'le vrai choix (format) reste en place')
  })
})

/* ------------------------------------------------------------- 5.9 (U9) */

describe('5.9 (U9) — le bip du Desk a une enveloppe (plus de clic)', () => {
  /** Enregistre l'automation de gain + les horodatages start/stop. */
  function fakeAudioContext() {
    const events = { gain: [], start: [], stop: [], resumes: 0 }
    const param = {
      value: null,
      setValueAtTime: (v, at) => events.gain.push(['set', v, at]),
      exponentialRampToValueAtTime: (v, at) => events.gain.push(['exp', v, at]),
      linearRampToValueAtTime: (v, at) => events.gain.push(['lin', v, at])
    }
    class Ctx {
      constructor() {
        this.state = 'running'
        this.currentTime = 1.5
        this.destination = {}
      }
      createOscillator() {
        return { frequency: { value: 0 }, connect() {}, start: (at) => events.start.push(at), stop: (at) => events.stop.push(at) }
      }
      createGain() {
        return { gain: param, connect() {} }
      }
      resume() {
        events.resumes += 1
      }
      close() {
        this.state = 'closed'
      }
    }
    return { Ctx, events }
  }

  it('attaque puis retombée exponentielle AVANT l’arrêt, sur le même horodatage', () => {
    const { Ctx, events } = fakeAudioContext()
    window.AudioContext = Ctx
    __resetDeskAudio()
    deskBeep()

    // 1. départ quasi-silencieux (pas de saut d'amplitude = pas de clic)
    assert.deepEqual(events.gain[0], ['set', 0.0001, 1.5], 'le gain doit partir du silence')
    // 2. attaque jusqu'au pic
    assert.deepEqual(events.gain[1], ['exp', BEEP_PEAK_GAIN, 1.5 + BEEP_ATTACK_S])
    // 3. retombée vers le silence AVANT la fin du bip
    assert.deepEqual(events.gain[2], ['exp', 0.0001, 1.5 + BEEP_DURATION_S])
    // 4. start/stop calés sur currentTime (pas Date.now), stop après la retombée
    assert.deepEqual(events.start, [1.5])
    assert.equal(events.stop.length, 1)
    assert.ok(events.stop[0] >= 1.5 + BEEP_DURATION_S, 'l’oscillateur ne doit pas couper l’enveloppe')
    // 5. aucun `gain.value = pic` posé d'un coup (le clic d'origine)
    assert.equal(events.gain.filter(([k, v]) => k === 'set' && v === BEEP_PEAK_GAIN).length, 0)
    __resetDeskAudio()
    delete window.AudioContext
  })

  it('le contexte est réveillé s’il naît suspendu (autoplay)', () => {
    const { Ctx, events } = fakeAudioContext()
    class Suspended extends Ctx {
      constructor() {
        super()
        this.state = 'suspended'
      }
    }
    window.AudioContext = Suspended
    __resetDeskAudio()
    deskBeep()
    assert.equal(events.resumes, 1)
    __resetDeskAudio()
    delete window.AudioContext
  })

  it('un seul contexte partagé pour plusieurs bips (P9 conservé)', () => {
    const { Ctx } = fakeAudioContext()
    let built = 0
    window.AudioContext = class extends Ctx {
      constructor() {
        super()
        built += 1
      }
    }
    __resetDeskAudio()
    deskBeep()
    deskBeep()
    deskBeep()
    assert.equal(built, 1, 'Chrome plafonne les AudioContext : un seul, réutilisé')
    __resetDeskAudio()
    delete window.AudioContext
  })

  it('pas d’AudioContext (jsdom pur) → aucun throw', () => {
    delete window.AudioContext
    delete window.webkitAudioContext
    __resetDeskAudio()
    assert.doesNotThrow(() => deskBeep())
  })

  it('l’enveloppe est bornée : pic faible et bip court (pas une sirène)', () => {
    assert.ok(BEEP_PEAK_GAIN > 0 && BEEP_PEAK_GAIN <= 0.1, 'pic audible mais discret')
    assert.ok(BEEP_ATTACK_S > 0 && BEEP_ATTACK_S < BEEP_DURATION_S, 'attaque plus courte que le bip')
    assert.ok(BEEP_DURATION_S <= 0.5, 'un bip de comptoir, pas une alarme')
  })
})

/* ------------------------------------------------------------ 5.10 (U10) */

describe('5.10 (U10) — encadrement interdit, et les commentaires le disent', () => {
  it('vercel.json pose X-Frame-Options SAMEORIGIN et frame-ancestors \'self\'', () => {
    const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const flat = JSON.stringify(v)
    assert.match(flat, /X-Frame-Options/)
    assert.match(flat, /SAMEORIGIN/)
    assert.match(flat, /frame-ancestors/)
    assert.match(flat, /frame-ancestors 'self'/, 'la CSP doit interdire l’encadrement par un tiers')
  })

  it('le serveur local pose les mêmes en-têtes sur ses pages HTML', () => {
    const src = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
    assert.match(src, /'X-Frame-Options': 'SAMEORIGIN'/)
    assert.match(src, /frame-ancestors 'self'/)
  })

  it('aucun commentaire ne présente l’iframe tierce comme un scénario supporté', () => {
    const files = ['safeStorage.js', 'api.js', 'prefs.js', 'shopStore.js', 'App.jsx', 'ContactPicker.jsx']
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/\{\/\*/.test(l))
        .join('\n')
      // Le code ne doit pas *autoriser* l'encadrement ; les commentaires ne
      // doivent plus le présenter comme un usage prévu.
      assert.doesNotMatch(code, /frame-ancestors\s+\*/, `${f} : CSP ouverte à l'encadrement`)
      for (const bad of ['aperçu intégré', 'aperçus iframe', 'iframe tierce (aperçu']) {
        assert.ok(!src.includes(bad), `${f} : « ${bad} » décrit une conception qui n'existe pas`)
      }
    }
  })

  it('la décision est documentée pour l’opérateur (DEPLOY-VERCEL.md)', () => {
    const doc = readFileSync(new URL('../docs/DEPLOY-VERCEL.md', import.meta.url), 'utf8')
    assert.match(doc, /Encadrement \(iframe\)/)
    assert.match(doc, /clickjack/i, 'la raison de sécurité doit être écrite')
    assert.match(doc, /frame-ancestors/, 'la marche à suivre pour un assouplissement délibéré')
  })

  it('le repli mémoire reste en place (stockage bloqué ≠ encadrement)', () => {
    assert.equal(typeof isStorageBlocked, 'function')
    assert.equal(isStorageBlocked(), false)
  })
})

/* ------------------------------------------------------------ 5.12 (U12) */

describe('5.12 (U12) — la révocation d’URL ne coupe plus le téléchargement', () => {
  it('revokeObjectURL est différé, et appelé exactement une fois', async () => {
    const { downloadOrdersCsv, REVOKE_DELAY_MS } = await import('./api.js')
    assert.ok(REVOKE_DELAY_MS >= 1000, 'le téléchargement doit avoir le temps de s’amorcer')

    stubApi([['GET', /\/api\/orders\/export\.csv/, { status: 200, body: { ok: true } }]])

    const revoked = []
    const created = []
    // `api.js` appelle le `URL` GLOBAL (celui de node sous jsdom), pas
    // `window.URL` : c'est donc là qu'il faut stubber, sinon node valide le
    // Blob et lève ERR_INVALID_ARG_TYPE.
    const realCreate = globalThis.URL.createObjectURL
    const realRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = (b) => {
      assert.ok(b instanceof window.Blob, 'createObjectURL doit recevoir un Blob')
      const u = `blob:test/${created.length}`
      created.push(u)
      return u
    }
    globalThis.URL.revokeObjectURL = (u) => revoked.push(u)

    // `setTimeout` capturé : on déclenche la révocation à la main (test rapide).
    const realTimeout = globalThis.setTimeout
    const pending = []
    globalThis.setTimeout = (fn, ms) => {
      pending.push({ fn, ms })
      return 0
    }
    window.setTimeout = globalThis.setTimeout

    let clicked = 0
    const realClick = window.HTMLAnchorElement.prototype.click
    window.HTMLAnchorElement.prototype.click = function () {
      clicked += 1
      // Au moment du clic, l'URL doit encore être valable.
      assert.deepEqual(revoked, [], 'révoquer avant/après le clic coupait le téléchargement')
    }

    try {
      const r = await downloadOrdersCsv('2026-09-16')
      assert.equal(r.ok, true)
      assert.equal(clicked, 1)
      assert.equal(created.length, 1)
      assert.deepEqual(revoked, [], 'rien de révoqué de façon synchrone')
      assert.equal(pending.length, 1, 'une révocation différée doit être programmée')
      assert.equal(pending[0].ms, REVOKE_DELAY_MS)
      pending[0].fn()
      assert.deepEqual(revoked, created, 'l’URL créée finit libérée (pas de fuite)')
    } finally {
      globalThis.setTimeout = realTimeout
      window.setTimeout = realTimeout
      window.HTMLAnchorElement.prototype.click = realClick
      globalThis.URL.createObjectURL = realCreate
      globalThis.URL.revokeObjectURL = realRevoke
    }
  })

  it('la source ne révoque plus dans la foulée du clic', () => {
    const src = readFileSync(new URL('./api.js', import.meta.url), 'utf8')
    assert.doesNotMatch(src, /a\.click\(\)\s*\n\s*URL\.revokeObjectURL/, 'révocation synchrone interdite')
    assert.match(src, /setTimeout\(\(\) => \{[\s\S]{0,200}revokeObjectURL/, 'révocation différée attendue')
  })
})
