/**
 * LOT P3 (audit 19/09/2026, B8 + B9 + B21 + B17) — ce que l'écran doit dire.
 *
 * Quatre défauts sans consequence sur les données, mais qui laissent un
 * utilisateur sans information :
 *  · B8 — `401 demo_locked` n'était pas dans la table `AUTH_ERRORS` de
 *    `src/AuthPanel.jsx` : `fail()` fait `t(code)`, la CLÉ BRUTE s'affichait ;
 *  · B9 — `ProfilePage` : le bloc « comptes rattachés » était rendu au maître
 *    (que le serveur refuse quatre fois), et `link()` / `unlink()` ne disaient
 *    rien quand le serveur refusait — le clic ne produisait rien de visible ;
 *  · B21 — le bouton « Mes commandes » de l'écran de confirmation menait au
 *    PROFIL, d'où « Mes commandes » est sorti depuis le LOT 5.x ;
 *  · B17 — annuler une commande du serveur sans session affichait « Commande
 *    annulée — stock rétabli » alors que rien n'était annulé.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { JSDOM } from 'jsdom'
import { dict, LANGS } from './i18n.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p3-screens-'))
process.env.PCSTAR_DATA_DIR = dir
// B8 : le compte de démonstration doit être VERROUILLÉ pour que la route
// réponde `demo_locked` — c'est-à-dire aucun `DEMO_PASSWORD` posé.
delete process.env.DEMO_PASSWORD

const { AUTH_ERRORS } = await import('./AuthPanel.jsx')
const { default: ProfilePage } = await import('./ProfilePage.jsx')
const APP = fs
  .readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

const t = (key, vars) => {
  let out = String(dict.fr[key] ?? key)
  for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

describe('P3/B8 — la table des codes d’authentification est complète', () => {
  it(' chaque code mappé existe dans les deux langues et n’est pas renvoyé brut', () => {
    for (const [code, key] of Object.entries(AUTH_ERRORS)) {
      assert.ok(/^[a-z_]+$/.test(code), `code serveur inattendu : ${code}`)
      for (const l of LANGS) {
        const v = dict[l.id][key]
        assert.ok(typeof v === 'string' && v.trim().length > 8, `${l.id} : ${key} absent du dictionnaire (code ${code})`)
        assert.notEqual(v, key, `${l.id} : ${key} se traduit par son propre nom`)
      }
    }
    assert.equal(AUTH_ERRORS.demo_locked, 'authErrorDemoLocked')
  })

  it('le serveur répond bien demo_locked (la table ne sert pas à rien)', async () => {
    const server = http.createServer((await import('../server/index.js')).handler)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'karim.oran@demo.dz', password: 'importe' })
      })
      const data = await res.json()
      assert.equal(res.status, 401, JSON.stringify(data))
      assert.equal(data.error, 'demo_locked', 'le code attendu par la table a changé')
      assert.notEqual(t(AUTH_ERRORS[data.error]), data.error, 'l’écran afficherait le code brut')
      assert.ok(t(AUTH_ERRORS[data.error]).toLowerCase().includes('démonstration'), t(AUTH_ERRORS[data.error]))
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

/* -------------------------------------------------------------------------- */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const window = dom.window
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

function monter(user, surToast = () => {}) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      React.createElement(ProfilePage, {
        t,
        user,
        users: [],
        onUsers: () => {},
        onUser: () => {},
        setToast: surToast,
        onBack: () => {},
        apiOnline: true,
        mode: 'api'
      })
    )
  )
  return { host, root, de: () => host.textContent || '' }
}

describe('P3/B9 — le rattachement OAuth : rôle, échecs, confirmation', () => {
  before(() => {
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
      Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  })

  after(async () => {
    // Finir les promesses encore en vol AVANT de fermer le DOM : `link()`
    // s'achève sur un `setErr` qui touche `window.location`; fermé trop tôt, le
    // test suivant herite d'un `ReferenceError: window is not defined` hors de
    // toute assertion — et Node le signale comme activite asynchrone échappee.
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
      try {
        delete globalThis[k]
      } catch {
        /* getter en lecture seule sur Node 22 */
      }
    }
    window.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

/** Clic + attente d'une micro- et macro-tâche : `link()` n'est pas awaitable
 *  depuis le `onClick` du bouton — sans quoi sa mise à jour d'état tomberait
 *  après la fin du test (et React le fait savoir). */
const ticks = (n) => act(async () => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0))
})

async function cliquer(b) {
  await act(async () => {
    b[Object.keys(b).find((k) => k.startsWith('__reactProps'))].onClick({ preventDefault: () => {} })
  })
  // `req()` de `src/api.js` enchaîne plusieurs micro- et macro-tâches avant de
  // passer par `setErr` : tout finir ici, sinon la promesse se résout après le
  // démontage du DOM du test suivant et `window` n'existe plus.
  await ticks(14)
}

  function bouton(host, libelle) {
    return [...host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(libelle)) || null
  }

  it('le maître ne voit pas de bouton de rattachement', () => {
    const m = monter({ id: 'm', role: 'master', name: 'Magasin', email: 'm@x.dz', links: {} })
    try {
      assert.ok(!m.de().includes(t('linkedAccounts')), 'le bloc est rendu au maître')
      assert.equal(bouton(m.host, t('linkGoogle')), null, 'un bouton de liaison est visible pour le maître')
      assert.equal(bouton(m.host, t('unlinkGoogle')), null, 'un bouton de déliaison est visible pour le maître')
    } finally {
      m.root.unmount()
    }
  })

  it('un client, lui, le voit', () => {
    const c = monter({ id: 'c1', role: 'customer', name: 'Karim', email: 'k@x.dz', links: {} })
    try {
      assert.ok(c.de().includes(t('linkedAccounts')), 'le bloc a disparu pour un client')
      assert.ok(bouton(c.host, t('linkGoogle')), 'aucun bouton Google')
    } finally {
      c.root.unmount()
    }
  })

  it('un rattachement refusé se LIT', async () => {
    const garde = globalThis.fetch
    let appeles = 0
    globalThis.fetch = async () => {
      appeles += 1
      return { ok: false, status: 403, json: async () => ({ ok: false, error: 'master_oauth_forbidden' }), headers: new Headers() }
    }
    window.fetch = globalThis.fetch
    const c = monter({ id: 'c2', role: 'customer', name: 'Karim', email: 'k@x.dz', links: {} })
    try {
      const b = bouton(c.host, t('linkGoogle'))
      assert.ok(b, 'bouton de rattachement absent')
      await cliquer(b)
      assert.equal(appeles, 1)
      assert.ok(c.de().includes(t('oauthLinkFail')), `le refus n’est pas annoncé : ${c.de().slice(-200)}`)
      assert.ok(!/master_oauth_forbidden/.test(c.de()), 'le code brut de l’API est affiché')
    } finally {
      c.root.unmount()
      globalThis.fetch = garde
      window.fetch = garde
    }
  })

  it('détacher demande confirmation, et n’envoie rien sans accord', async () => {
    const garde = globalThis.fetch
    let appeles = 0
    let demande = null
    globalThis.fetch = async () => {
      appeles += 1
      return { ok: true, status: 200, json: async () => ({ ok: true, user: { id: 'c3', role: 'customer', links: {} } }), headers: new Headers() }
    }
    window.fetch = globalThis.fetch
    window.confirm = (message) => {
      demande = String(message)
      return false
    }
    const c = monter({ id: 'c3', role: 'customer', name: 'Karim', email: 'k@x.dz', links: { google: { id: 'g1' } } })
    try {
      const b = bouton(c.host, t('unlinkGoogle'))
      assert.ok(b, 'bouton de détachement absent')
      await cliquer(b)
      assert.ok(demande && demande.includes('Google'), `pas de confirmation explicite : ${JSON.stringify(demande)}`)
      assert.ok(demande.startsWith('Délier'), `la confirmation ne parle pas de délier : ${JSON.stringify(demande)}`)
      assert.equal(appeles, 0, 'la requête est partie sans accord de l’utilisateur')
    } finally {
      c.root.unmount()
      globalThis.fetch = garde
      window.fetch = garde
      delete window.confirm
    }
  })
})

describe('P3/B21 + B17 — destination du bouton et annulation mensongère', () => {
  it('« Mes commandes » mène à la page des commandes', () => {
    const i = APP.indexOf('{t(\'viewMyOrders\')}')
    assert.ok(i > 0, 'le libellé n’est plus dans App.jsx')
    const avant = APP.slice(Math.max(0, i - 500), i)
    assert.match(avant, /go\('orders'\)/, 'le bouton ne mène plus à « orders »')
    assert.equal(/go\('profile'\)/.test(avant), false, 'le CTA renvoie encore au profil')
  })

  it('une commande du serveur ne se fait pas annuler en local sans session', () => {
    const i = APP.indexOf('async function cancelMyOrder')
    assert.ok(i > 0)
    const corps = APP.slice(i, i + 2600)
    const garde = corps.indexOf("target.localOnly !== true && !user")
    assert.ok(garde > 0, 'garde B17 absente')
    assert.ok(corps.indexOf('orderCancelNeedsLogin') > garde, 'le refus n’est pas annoncé')
    assert.ok(corps.indexOf('commitReservations((prev)') > garde, 'la copie locale est modifiée AVANT le refus')
    for (const l of LANGS) {
      const v = dict[l.id].orderCancelNeedsLogin
      assert.ok(typeof v === 'string' && v.length > 20, `${l.id} : message absent`)
    }
  })
})
