import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// P22 (piège 2) — `src/App.jsx` capturait son accès au stockage à l'évaluation
// du module :
//
//     const storage = typeof localStorage !== 'undefined' ? localStorage : null
//
// Dans tout contexte où `localStorage` n'existe pas encore à l'import, la
// constante restait figée à `null` pour toute la vie du module. L'app
// retombait alors sur la langue du navigateur et `loadUsers(null)` ne seedait
// aucun compte : plus de bouton profil. Le symptôme ressemblait à un bug
// applicatif alors que la logique de l'app était correcte.
//
// Ce test reproduit l'ordre qui déclenchait le piège — import du module AVANT
// la pose des globaux — et vérifie que l'app suit désormais le stockage réel.
// Avec l'ancienne ligne, il échoue.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

// Volontairement AUCUN global posé ici : c'est la condition du piège.
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('./App.jsx') // ← évalué sans localStorage
const { dict } = await import('./i18n.js')

// …et les globaux n'arrivent qu'APRÈS l'import.
window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.fetch = async () => {
  throw new TypeError('offline (test)')
}
window.fetch = globalThis.fetch

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
// LOT 1.1 : le compte maître n'est plus seedé côté client (`master-pcstar`
// n'existe plus en mode local). Le test porte sur le fait que les comptes sont
// seedés et que le bouton profil porte le nom du compte connecté — on utilise
// donc un compte de démonstration.
const USER_NAME = 'Karim B.'

before(() => {})

after(async () => {
  await new Promise((r) => setTimeout(r, 20))
  for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
    try {
      delete globalThis[k]
    } catch {
      /* getter-only */
    }
  }
})

async function renderIn(lang) {
  window.localStorage.clear()
  window.localStorage.setItem('pcstar-lang', lang)
  window.localStorage.setItem('pcstar-session', JSON.stringify({ userId: 'demo-karim' }))
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(App))
  })
  await settle(150)
  return { host, root }
}

describe('P22 piège 2 — le stockage est résolu à l’usage, pas à l’import du module', () => {
  for (const lang of ['fr', 'en']) {
    it(`[${lang}] la langue stockée est respectée même si le module a été importé avant localStorage`, async () => {
      const { host, root } = await renderIn(lang)
      try {
        // Le lien « À propos » porte le libellé de la langue demandée. Avec
        // l'ancienne capture figée à null, loadLang() retombait sur la langue
        // du navigateur (arabe) et ce libellé était introuvable.
        const labels = [...host.querySelectorAll('button,a')].map((b) =>
          (b.textContent || '').replace(/\s+/g, ' ').trim()
        )
        assert.ok(
          labels.includes(dict[lang].navAbout),
          `libellé « ${dict[lang].navAbout} » présent (${lang})`
        )
        assert.ok(
          !labels.includes(dict.ar.navAbout),
          `l'arabe n'est pas servi par défaut en mode ${lang}`
        )
      } finally {
        root.unmount()
        await settle(30)
      }
    })
  }

  it('les comptes sont seedés : le bouton profil existe', async () => {
    const { host, root } = await renderIn('fr')
    try {
      // loadUsers(null) renvoyait une liste vide → aucun `user` → pas de
      // bouton profil, seulement « Connexion ».
      const btn = [...host.querySelectorAll('button')].find(
        (b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === USER_NAME
      )
      assert.ok(btn, `bouton « ${USER_NAME} » rendu — les comptes ont bien été seedés`)
    } finally {
      root.unmount()
      await settle(30)
    }
  })

  it('un changement de langue est bien persisté dans le vrai localStorage', async () => {
    const { host, root } = await renderIn('fr')
    try {
      const en = [...host.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'EN'
      )
      assert.ok(en, 'sélecteur EN trouvé')
      await act(async () => {
        en.click()
      })
      await settle(120)
      assert.equal(window.localStorage.getItem('pcstar-lang'), 'en', 'préférence écrite')
    } finally {
      root.unmount()
      await settle(30)
    }
  })
})
