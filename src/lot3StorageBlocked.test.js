import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 3.1 (F7 + F8) — sonde d'acceptation : avec un `localStorage` qui lève un
// `SecurityError` (iframe tierce, cookies tiers bloqués, navigation privée
// Safari), l'application **monte** et fonctionne sur son repli mémoire.
//
// Avant le correctif, les accès étaient faits dans les initializers de
// `useState` (`loadLang()`, `loadMeta()`, `loadSession()`, `loadUsers()`) donc
// PENDANT le rendu : le site entier tombait dans l'ErrorBoundary. Le wrapper
// `storage` d'App.jsx, ajouté précisément pour ces iframes, n'avait lui-même
// aucun try/catch.
//
// Ce fichier est volontairement isolé : le stockage y est cassé AVANT tout
// import de l'app, ce qu'aucun autre fichier de test ne peut faire.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

const securityError = () => {
  const e = new Error('The operation is insecure.')
  e.name = 'SecurityError'
  return e
}

/** `localStorage` dont CHAQUE accès lève — le cas réel des iframes tierces. */
const brokenStorage = {
  getItem() {
    throw securityError()
  },
  setItem() {
    throw securityError()
  },
  removeItem() {
    throw securityError()
  },
  key() {
    throw securityError()
  },
  clear() {
    throw securityError()
  },
  get length() {
    throw securityError()
  }
}

Object.defineProperty(window, 'localStorage', { value: brokenStorage, configurable: true, writable: true })
Object.defineProperty(globalThis, 'localStorage', { value: brokenStorage, configurable: true, writable: true })

window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Imports APRÈS la casse du stockage : c'est l'ordre réel d'un navigateur qui
// bloque `localStorage` dès le chargement de la page.
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('./App.jsx')
const { dict } = await import('./i18n.js')
const { PRODUCTS } = await import('./data.js')
const { isStorageBlocked, storageMode } = await import('./safeStorage.js')
const api = await import('./api.js')
const { loadLang, saveLang } = await import('./prefs.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const t = (key) => dict.fr[key] ?? key
const realFetch = globalThis.fetch

// Réseau mort : le scénario visé est la boutique hors-ligne dans une iframe.
globalThis.fetch = async () => {
  throw new TypeError('offline (test)')
}
window.fetch = globalThis.fetch

after(async () => {
  await settle(20)
  globalThis.fetch = realFetch
})

describe('LOT 3.1 (F7 + F8) — stockage navigateur bloqué : l’app monte quand même', () => {
  it('monte, affiche la boutique et dit que le stockage est en mémoire', async () => {
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)

    let renderError = null
    await act(async () => {
      try {
        root.render(React.createElement(App))
      } catch (err) {
        renderError = err
      }
    })
    await settle(200)

    try {
      assert.equal(renderError, null, `le rendu ne doit pas lever : ${renderError}`)
      // L'ErrorBoundary ne doit pas avoir pris la main.
      assert.ok(host.querySelectorAll('.product-bs-card').length > 50, 'la boutique affiche ses produits')
      assert.equal(isStorageBlocked(), true, 'le stockage est bien détecté comme bloqué')
      assert.equal(storageMode(), 'memory')
      const status = host.querySelector('.alert-secondary[role="status"]')
      assert.ok(status, 'le bandeau « stockage bloqué » doit être présent')
      // La langue affichée dépend de la détection du navigateur (ici `ar`) :
      // on accepte le libellé dans l'une des deux langues du site.
      const note = clean(status)
      const known = ['fr', 'en'].map((l) => dict[l].storageBlockedNote)
      assert.ok(known.includes(note), `texte inattendu : ${note}`)

      // Le panier fonctionne en mémoire : ajouter un produit met le badge à 1.
      const target = PRODUCTS[0]
      const card = [...host.querySelectorAll('.product-bs-card')].find(
        (c) => clean(c.querySelector('.card-title')) === target.name
      )
      assert.ok(card, `carte de ${target.name}`)
      await act(async () => {
        card.querySelector('button.btn-success').click()
      })
      await settle(120)
      const cartBtn = host.querySelector('.app .navbar button.btn-success')
      assert.ok(cartBtn, 'bouton panier trouvé')
      assert.equal(clean(cartBtn.querySelector('.badge')), '1', 'le panier en mémoire fonctionne')

      // La préférence de langue s'écrit et se relit en mémoire.
      saveLang(undefined, 'fr')
      assert.equal(loadLang(), 'fr', 'prefs en mémoire')

      // Le jeton API survit lui aussi en mémoire (getToken/setToken).
      api.setToken('tok-memoire')
      assert.equal(api.getToken(), 'tok-memoire')
    } finally {
      await settle(20)
      root.unmount()
      host.remove()
    }
  })
})
