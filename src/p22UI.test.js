import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// P22 (suite) — les trois points laissés ouverts par docs/AUDIT-P22.md, corrigés.
//
//  E. Le bouton « profil » affichait `{user.name}` seul. La clé `navProfile`
//     existait dans les 3 langues sans jamais être rendue, et un lecteur
//     d'écran n'avait aucun moyen de savoir que ce bouton ouvre le profil.
//     Un compte nommé « A » donnait un bouton d'un caractère.
//
//  F. `STORE_LINKS` contenait `'Les Castors, Oran'` en dur : le sous-titre du
//     bouton Google Maps restait français en interface arabe et anglaise.
//
//  G. Le client (`canTransition`) et le serveur (`setOrderStatus`) avaient
//     chacun leur table de transitions, et elles divergeaient. La table vit
//     désormais dans src/orderLogic.js et le serveur l'importe.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

// IMPORTANT : `src/App.jsx:59` capture `const storage = typeof localStorage
// !== 'undefined' ? localStorage : null` à l'import du MODULE. Les globaux
// doivent donc exister AVANT le `await import('./App.jsx')` ci-dessous — un
// hook `before()` s'exécute trop tard et `storage` vaudrait `null` (langue
// retombant sur l'arabe, aucun utilisateur seedé).
window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Le fetch de Node ne résout pas les URL relatives : sans ce stub, le bootstrap
// de session lève et App efface la session. On répond « hors ligne », ce qui
// laisse l'app en mode local — exactement ce qu'on teste ici.
globalThis.fetch = async () => {
  throw new TypeError('offline (test)')
}
window.fetch = globalThis.fetch

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

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: App } = await import('./App.jsx')
const { dict } = await import('./i18n.js')
const { STORE_LINKS } = await import('./data.js')
const { canTransition, ORDER_TRANSITIONS, ORDER_STATUSES } = await import('./orderLogic.js')
const { setOrderStatus } = await import('../server/catalog.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
// LOT 1.1 : le compte maître n'est plus seedé côté client (`master-pcstar`
// n'existe plus en mode local). Le test porte sur le nom visible du compte
// connecté, quel qu'il soit : on utilise un compte de démonstration.
const USER_NAME = 'Karim B.'

/** Monte App dans `lang` avec une session locale, rend le DOM racine. */
async function renderIn(lang) {
  window.localStorage.clear()
  window.localStorage.setItem('pcstar-lang', lang)
  // `loadUsers` seed les comptes de démonstration sous des ids fixes.
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

/**
 * `STORE_LINKS` n'est rendu que dans le bloc `page === 'about'`
 * (App.jsx:1142) : il faut d'abord ouvrir cette page via la nav.
 */
async function gotoAbout(host) {
  const wanted = (await import('./i18n.js')).dict[window.localStorage.getItem('pcstar-lang')].navAbout
  const btn = [...host.querySelectorAll('button,a')].find(
    (b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === wanted
  )
  assert.ok(btn, `lien de nav « ${wanted} » trouvé`)
  await act(async () => {
    btn.click()
  })
  await settle(150)
}

describe('P22 bug E — le bouton profil est nommé pour un lecteur d’écran', () => {
  for (const lang of ['fr', 'en']) {
    it(`[${lang}] aria-label = fonction + nom visible, title = fonction`, async () => {
      const { host, root } = await renderIn(lang)
      try {
        const btn = [...host.querySelectorAll('button')].find(
          (b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === USER_NAME
        )
        assert.ok(btn, `bouton « ${USER_NAME} » rendu en ${lang}`)
        const label = btn.getAttribute('aria-label') || ''
        // WCAG 2.5.3 « label in name » : le nom accessible doit contenir le
        // texte visible, sinon la commande vocale ne peut pas le cibler.
        assert.ok(label.includes(USER_NAME), `aria-label contient le nom visible : ${JSON.stringify(label)}`)
        assert.ok(
          label.includes(dict[lang].navProfile),
          `aria-label contient « ${dict[lang].navProfile} » : ${JSON.stringify(label)}`
        )
        assert.equal(btn.getAttribute('title'), dict[lang].navProfile)
      } finally {
        root.unmount()
        await settle(30)
      }
    })
  }

  it('la clé navProfile n’est plus morte', async () => {
    const { host, root } = await renderIn('fr')
    try {
      const hit = [...host.querySelectorAll('[aria-label]')].some((el) =>
        (el.getAttribute('aria-label') || '').includes(dict.fr.navProfile)
      )
      assert.ok(hit, 'navProfile apparaît bien dans le DOM rendu')
    } finally {
      root.unmount()
      await settle(30)
    }
  })
})

describe('P22 bug F — le sous-titre Google Maps est traduit', () => {
  it('STORE_LINKS porte une clé i18n pour l’entrée maps', () => {
    const maps = STORE_LINKS.find((l) => l.id === 'maps')
    assert.equal(maps.subKey, 'storeMapSub')
  })

  for (const lang of ['fr', 'en']) {
    it(`[${lang}] le bouton Maps affiche ${JSON.stringify(dict[lang].storeMapSub)}`, async () => {
      const { host, root } = await renderIn(lang)
      try {
        await gotoAbout(host)
        const link = [...host.querySelectorAll('a.social-maps')][0]
        assert.ok(link, 'bouton Google Maps rendu')
        const sub = (link.querySelector('span') || {}).textContent || ''
        assert.equal(sub, dict[lang].storeMapSub)
      } finally {
        root.unmount()
        await settle(30)
      }
    })
  }

})

describe('P22 bug G — une seule table de transitions, client et serveur d’accord', () => {
  const FROMS = ['new', 'pending', 'preparing', 'ready', 'picked', 'cancelled']

  it('canTransition lit exactement ORDER_TRANSITIONS', () => {
    for (const from of FROMS) {
      for (const to of ORDER_STATUSES) {
        assert.equal(
          canTransition(from, to),
          (ORDER_TRANSITIONS[from] || []).includes(to),
          `${from} → ${to}`
        )
      }
    }
  })

  it('les retours en arrière que le serveur autorisait sont maintenant alignés', () => {
    assert.equal(canTransition('preparing', 'new'), true, 'le serveur l’accepte (mesuré HTTP 200)')
    assert.equal(canTransition('ready', 'preparing'), true, 'le serveur l’accepte')
  })

  it('les états terminaux restent verrouillés', () => {
    for (const to of ORDER_STATUSES) {
      assert.equal(canTransition('picked', to), false, `picked → ${to}`)
      assert.equal(canTransition('cancelled', to), false, `cancelled → ${to}`)
    }
  })

  it('setOrderStatus (serveur) applique la même table que canTransition (client)', () => {
    for (const from of FROMS) {
      for (const to of ORDER_STATUSES) {
        // `cancelled` passe par cancelOrder côté serveur : on isole la table.
        if (to === 'cancelled' || from === 'cancelled') continue
        const db = { orders: [{ code: 'X', status: from, items: [] }], stock: {} }
        const res = setOrderStatus(db, 'X', to)
        assert.equal(
          res.ok,
          canTransition(from, to),
          `divergence serveur/client sur ${from} → ${to} (serveur ok=${res.ok}, client=${canTransition(from, to)})`
        )
      }
    }
  })
})
