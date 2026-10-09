import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// P20 — La page « À propos » doit proposer DEUX boutons WhatsApp, un par numéro
// du magasin (le 07… et le 06…).
//
// Ce test rend le VRAI composant `App` et clique sur l'onglet « À propos » : il
// vérifie le rendu réel, pas la table de données. Un bouton ajouté à
// `STORE_LINKS` mais cassé au rendu (classe CSS manquante, href vide, key
// dupliquée) serait attrapé ici.

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

before(() => {
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
    Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
  }
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.matchMedia =
    window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  window.matchMedia = globalThis.matchMedia
  // L'API est absente en test : `fetch` rejette, le front bascule en mode local.
  globalThis.fetch = async () => {
    throw new Error('hors ligne')
  }
  window.MessageChannel =
    window.MessageChannel ||
    class {
      constructor() {
        this.port1 = { onmessage: null, close() {} }
        this.port2 = { postMessage() {}, close() {} }
      }
    }
  globalThis.MessageChannel = window.MessageChannel
})

after(() => {
  for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']) {
    try {
      delete globalThis[k]
    } catch {
      /* getter-only */
    }
  }
})

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('./App.jsx')
const { STORE } = await import('./data.js')
const { dict } = await import('./i18n.js')

// La langue par défaut du navigateur de test peut être l'arabe : on cherche le
// bouton du menu par son libellé réel dans chacune des deux langues plutôt que
// sur un motif approximatif.
const ABOUT_LABELS = ['fr', 'en'].map((l) => String(dict[l]?.navAbout || '')).filter(Boolean)

describe('P20 — page « À propos » : deux boutons WhatsApp', () => {
  it('rend un bouton par numéro, avec les bons liens', async () => {
    const host = window.document.getElementById('root')
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(App))
    })

    // Navigation vers « À propos » via le vrai bouton du menu.
    const navBtn = [...host.querySelectorAll('button')].find((b) => {
      const label = (b.textContent || '').trim()
      return ABOUT_LABELS.some((l) => l === label)
    })
    assert.ok(navBtn, `bouton « À propos » introuvable (attendu un de : ${ABOUT_LABELS.join(' / ')})`)
    await act(async () => {
      navBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })

    const wa = [...host.querySelectorAll('a[href^="https://wa.me/"]')]
    // Le pied de page et le bouton flottant ajoutent chacun un lien WhatsApp :
    // on isole ceux de la page « À propos » (classe social-btn).
    const social = wa.filter((a) => (a.className || '').includes('social-btn'))
    assert.equal(social.length, 2, `attendu 2 boutons WhatsApp sociaux, reçu ${social.length} : ${social.map((a) => a.getAttribute('href')).join(', ')}`)

    const hrefs = social.map((a) => a.getAttribute('href'))
    assert.ok(hrefs.includes(`https://wa.me/${STORE.whatsapp}`), `lien du 1er numéro absent : ${hrefs.join(', ')}`)
    assert.ok(hrefs.includes(`https://wa.me/${STORE.whatsapp2}`), `lien du 2e numéro (06…) absent : ${hrefs.join(', ')}`)

    // Les deux doivent être distinguables à l'œil : le numéro est affiché.
    const texts = social.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
    assert.ok(texts.some((x) => x.includes('0770')), `le 07… n'est pas affiché : ${texts.join(' | ')}`)
    assert.ok(texts.some((x) => x.includes('0669')), `le 06… n'est pas affiché : ${texts.join(' | ')}`)

    // Les deux portent la classe verte WhatsApp (identité visuelle).
    for (const a of social) {
      assert.match(a.className, /social-whatsapp/, `classe WhatsApp manquante : ${a.className}`)
      assert.equal(a.getAttribute('target'), '_blank')
      assert.equal(a.getAttribute('rel'), 'noreferrer')
    }

    await act(async () => {
      root.unmount()
    })
  })
})
