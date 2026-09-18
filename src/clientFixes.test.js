import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 1 — corrections CLIENT (le serveur était déjà correct, l'UI ne suivait pas).
//
//  1.3  `hashPass` de src/shopStore.js est un FNV-1a 32 bits : impossible à
//       réparer côté navigateur sans embarquer un secret. La correction est
//       d'ASSUMER le mode local comme mode démonstration et de le dire dans
//       l'UI — le badge « Mode local (sans serveur) » ne le disait pas, et un
//       visiteur pouvait y créer un compte avec son vrai mot de passe.
//
//  1.4  `POST /api/me/password` exige `current` depuis P16 (#13), mais
//       `api.changePassword(password)` n'envoyait QUE `{ password }` et
//       ProfilePage n'avait aucun champ « mot de passe actuel » : la route
//       répondait 403 `current_password` à chaque appel. Fonctionnalité morte
//       pour 100 % des utilisateurs, et aucun test ne couvrait le chemin
//       client → serveur (c'est pour ça que 315 tests verts ne l'ont pas vu).
//
//  1.5  Le serveur révoque désormais les autres sessions et renvoie `revoked` ;
//       l'UI doit le dire plutôt que de laisser l'utilisateur découvrir des
//       appareils déconnectés sans explication.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

// Les globaux doivent exister AVANT les `await import(...)` des composants :
// plusieurs modules capturent `localStorage` / `document` à l'import.
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
const { default: AuthPanel } = await import('./AuthPanel.jsx')
const { default: ProfilePage } = await import('./ProfilePage.jsx')
const api = await import('./api.js')
const { dict } = await import('./i18n.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
const t = (key) => dict.fr[key]

/** Monte un composant seul dans un hôte jetable. */
async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(60)
  return {
    host,
    text: () => (host.textContent || '').replace(/\s+/g, ' '),
    unmount: async () => {
      root.unmount()
      host.remove()
      await settle(20)
    }
  }
}

/** Remplit un champ contrôlé React (le setter natif + l'événement `input`). */
async function fill(input, value) {
  const proto = Object.getPrototypeOf(input)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/**
 * Soumet le formulaire de mot de passe EN ATTENDANT le gestionnaire asynchrone.
 *
 * `dispatchEvent(new Event('submit'))` ne permet pas d'attendre `savePassword` :
 * React met à jour l'état après la fin du `act`, d'où l'avertissement
 * « not wrapped in act(...) » — et surtout une assertion sur un DOM pas encore
 * re-rendu. On appelle donc le gestionnaire lui-même (React 19 expose les props
 * sur le nœud DOM via `__props`) avec un événement minimal.
 */
async function submitPasswordForm(host) {
  const form = host.querySelector('#pf-pw-current').closest('form')
  const propsKey = Object.keys(form).find((k) => k.startsWith('__reactProps'))
  assert.ok(propsKey, `props React trouvées sur le <form> (clés : ${Object.keys(form).join(', ')})`)
  const onSubmit = form[propsKey].onSubmit
  assert.equal(typeof onSubmit, 'function', 'le <form> a bien un onSubmit')
  await act(async () => {
    await onSubmit({ preventDefault: noop })
  })
  await settle(20)
}

const noop = () => {}

// `fetch` est remplacé test par test : par défaut, réseau mort.
const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = async () => {
    throw new TypeError('offline (test)')
  }
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

// ---------------------------------------------------------------------------
// 1.3 — mode démo annoncé
// ---------------------------------------------------------------------------
describe('LOT 1.3 — le mode local est annoncé comme mode démonstration', () => {
  it('hors ligne : l’avertissement est rendu, et il nomme le hachage faible', async () => {
    const m = await mount(
      React.createElement(AuthPanel, {
        t,
        users: [],
        onUsers: noop,
        onSession: noop,
        onClose: noop,
        setToast: noop,
        apiOnline: false
      })
    )
    try {
      const alert = m.host.querySelector('.alert-warning')
      assert.ok(alert, 'un encart d’avertissement est rendu en mode local')
      const text = m.text()
      assert.ok(text.includes(t('demoModeTitle')), `titre « ${t('demoModeTitle')} » affiché`)
      assert.ok(text.includes(t('demoModeNote')), 'le corps de l’avertissement est affiché')
      // Le message doit dire POURQUOI : sinon c'est une précaution de style, pas
      // une information. Il nomme l'algorithme et interdit le vrai mot de passe.
      assert.ok(/FNV-1a/i.test(alert.textContent || ''), 'l’algorithme faible est nommé')
      assert.ok(
        /mot de passe/i.test(alert.textContent || ''),
        'l’avertissement parle explicitement des mots de passe'
      )
      // Annoncé à un lecteur d'écran, pas seulement visible.
      assert.equal(alert.getAttribute('role'), 'alert')
    } finally {
      await m.unmount()
    }
  })

  it('en ligne (API) : aucun avertissement de mode démo', async () => {
    const m = await mount(
      React.createElement(AuthPanel, {
        t,
        users: [],
        onUsers: noop,
        onSession: noop,
        onClose: noop,
        setToast: noop,
        apiOnline: true
      })
    )
    try {
      assert.ok(!m.host.querySelector('.alert-warning'))
      assert.ok(!m.text().includes(t('demoModeTitle')), 'pas de « mode démonstration » quand l’API répond')
    } finally {
      await m.unmount()
    }
  })

  it('les clés demoMode* existent dans les trois langues', async () => {
    for (const lang of ['fr', 'en']) {
      for (const key of ['demoModeTitle', 'demoModeNote']) {
        const v = dict[lang]?.[key]
        assert.ok(typeof v === 'string' && v.length > 3, `[${lang}] ${key} traduit : ${JSON.stringify(v)}`)
      }
    }
    // Deux langues, deux textes distincts (pas de copier-coller du français).
    assert.notEqual(dict.en.demoModeNote, dict.fr.demoModeNote)
  })
})

// ---------------------------------------------------------------------------
// 1.4 — `current` transmis par le client
// ---------------------------------------------------------------------------
describe('LOT 1.4 — le changement de mot de passe envoie le mot de passe actuel', () => {
  it('api.changePassword envoie { password, current }', async () => {
    let seen = null
    globalThis.fetch = async (url, opts) => {
      seen = { url, opts }
      return { ok: true, status: 200, json: async () => ({ ok: true, revoked: 0 }) }
    }
    window.fetch = globalThis.fetch
    api.setToken('tok-test-14')
    try {
      const r = await api.changePassword('nouveau1', 'ancien1')
      assert.equal(r.ok, true)
      assert.equal(seen.url, '/api/me/password')
      assert.equal(seen.opts.method, 'POST')
      assert.deepEqual(JSON.parse(seen.opts.body), { password: 'nouveau1', current: 'ancien1' })
      assert.equal(seen.opts.headers.Authorization, 'Bearer tok-test-14')
    } finally {
      api.setToken(null)
    }
  })

  it('ProfilePage rend un champ « mot de passe actuel » étiqueté', async () => {
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', phone: '0550000000', wilaya: 'Oran', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: noop,
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      const input = m.host.querySelector('#pf-pw-current')
      assert.ok(input, 'le champ existe')
      assert.equal(input.type, 'password')
      assert.equal(input.getAttribute('autocomplete'), 'current-password')
      const label = m.host.querySelector('label[for="pf-pw-current"]')
      assert.ok(label, 'un <label> réel lui est associé (pas seulement un placeholder)')
      assert.equal((label.textContent || '').trim(), t('currentPassword'))
      // Les deux autres champs sont étiquetés eux aussi.
      assert.ok(m.host.querySelector('label[for="pf-pw-new"]'), 'nouveau mot de passe étiqueté')
      assert.ok(m.host.querySelector('label[for="pf-pw-confirm"]'), 'confirmation étiquetée')
    } finally {
      await m.unmount()
    }
  })

  it('soumission sans mot de passe actuel → erreur explicite, aucun appel réseau', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    window.fetch = globalThis.fetch
    const toasts = []
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: (x) => toasts.push(x),
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      await fill(m.host.querySelector('#pf-pw-new'), 'nouveau1')
      await fill(m.host.querySelector('#pf-pw-confirm'), 'nouveau1')
      await submitPasswordForm(m.host)
      assert.equal(calls, 0, 'aucun appel réseau pour un champ vide (le rate-limit est à 5/10 min)')
      assert.ok(m.text().includes(t('authErrorCurrentPassword')), `erreur affichée : ${m.text().slice(0, 160)}`)
      assert.deepEqual(toasts, [], 'aucun toast de succès')
    } finally {
      await m.unmount()
    }
  })

  it('403 current_password → « mot de passe actuel incorrect », pas « 6 caractères minimum »', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: 'current_password' })
    })
    window.fetch = globalThis.fetch
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: noop,
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      await fill(m.host.querySelector('#pf-pw-current'), 'mauvais')
      await fill(m.host.querySelector('#pf-pw-new'), 'nouveau1')
      await fill(m.host.querySelector('#pf-pw-confirm'), 'nouveau1')
      await submitPasswordForm(m.host)
      const alert = m.host.querySelector('.alert-danger')
      assert.ok(alert, 'une erreur est affichée')
      assert.equal((alert.textContent || '').trim(), t('authErrorCurrentPassword'))
      assert.ok(!(alert.textContent || '').includes(t('authErrorPassword')), 'message non trompeur')
    } finally {
      await m.unmount()
    }
  })

  it('succès → champs vidés, toast, et révocation des autres sessions annoncée (1.5)', async () => {
    let body = null
    globalThis.fetch = async (_url, opts) => {
      body = JSON.parse(opts.body)
      return { ok: true, status: 200, json: async () => ({ ok: true, revoked: 2 }) }
    }
    window.fetch = globalThis.fetch
    const toasts = []
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: (x) => toasts.push(x),
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      await fill(m.host.querySelector('#pf-pw-current'), 'ancien1')
      await fill(m.host.querySelector('#pf-pw-new'), 'nouveau1')
      await fill(m.host.querySelector('#pf-pw-confirm'), 'nouveau1')
      await submitPasswordForm(m.host)
      assert.deepEqual(body, { password: 'nouveau1', current: 'ancien1' }, 'les deux mots de passe partent')
      assert.deepEqual(toasts, [t('passwordChanged')])
      assert.equal(m.host.querySelector('#pf-pw-current').value, '', 'champ actuel vidé')
      assert.equal(m.host.querySelector('#pf-pw-new').value, '', 'nouveau mot de passe vidé')
      assert.ok(!m.host.querySelector('.alert-danger'), 'aucune erreur')
      const status = m.host.querySelector('[role="status"]')
      assert.ok(status, 'la révocation est annoncée')
      assert.ok(
        (status.textContent || '').includes(t('passwordRevokedSessions')),
        `texte : ${status.textContent}`
      )
      assert.ok((status.textContent || '').includes('2'), 'le nombre de sessions révoquées est donné')
    } finally {
      await m.unmount()
    }
  })

  it('succès sans autre session (revoked: 0) → pas de ligne de révocation', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, revoked: 0 }) })
    window.fetch = globalThis.fetch
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: noop,
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      await fill(m.host.querySelector('#pf-pw-current'), 'ancien1')
      await fill(m.host.querySelector('#pf-pw-new'), 'nouveau1')
      await fill(m.host.querySelector('#pf-pw-confirm'), 'nouveau1')
      await submitPasswordForm(m.host)
      assert.ok(!m.host.querySelector('[role="status"]'))
    } finally {
      await m.unmount()
    }
  })

  it('les clés 1.4/1.5/1.9 existent dans les trois langues', () => {
    for (const lang of ['fr', 'en']) {
      for (const key of ['currentPassword', 'authErrorCurrentPassword', 'passwordRevokedSessions', 'authErrorName']) {
        const v = dict[lang]?.[key]
        assert.ok(typeof v === 'string' && v.length > 3, `[${lang}] ${key} traduit : ${JSON.stringify(v)}`)
      }
    }
  })

  it('LOT 1.9 — un nom trop long affiche un message traduit, pas le code brut', async () => {
    // `t()` retombe sur la CLÉ quand elle est inconnue : sans mappage dans
    // `ERR` (AuthPanel) et dans ProfilePage, l'utilisateur lisait
    // « name_too_long ».
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'name_too_long' })
    })
    window.fetch = globalThis.fetch
    const m = await mount(
      React.createElement(ProfilePage, {
        t,
        user: { id: 'u1', name: 'Karim B.', role: 'customer' },
        users: [],
        onUsers: noop,
        onUser: noop,
        setToast: noop,
        onBack: noop,
        apiOnline: true,
        mode: 'api'
      })
    )
    try {
      const form = m.host.querySelector('form')
      const propsKey = Object.keys(form).find((k) => k.startsWith('__reactProps'))
      await act(async () => {
        await form[propsKey].onSubmit({ preventDefault: noop })
      })
      await settle(20)
      const alert = m.host.querySelector('.alert-danger')
      assert.ok(alert, 'une erreur est affichée')
      assert.equal((alert.textContent || '').trim(), t('authErrorName'))
      assert.ok(!/name_too_long/.test(alert.textContent || ''), 'le code brut ne doit pas s’afficher')
    } finally {
      await m.unmount()
    }
  })
})
