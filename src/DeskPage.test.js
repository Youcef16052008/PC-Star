import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// P14 (#3) — les liens WhatsApp du comptoir. Avant, le `phone` stocké
// (`normalizePhone` garde 10 chiffres, ex. `0550123456`) partait tel quel dans
// `https://wa.me/…` : wa.me rejette un numéro qui commence par 0 → tous les
// boutons WhatsApp du Desk étaient morts.

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom

before(() => {
  // `navigator` est en lecture seule sur Node 22 → defineProperty obligatoire.
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle']) {
    Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
  }
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia =
    window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})

after(() => {
  for (const k of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']) {
    try {
      delete globalThis[k]
    } catch {
      /* getter-only : on laisse */
    }
  }
})

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: DeskPage } = await import('./DeskPage.jsx')
const { waNumber } = await import('./orderLogic.js')

const t = (key, vars) => {
  let s = String(key)
  for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

describe('P14 (#3) — waNumber : format E.164 pour wa.me', () => {
  it('un mobile DZ à 10 chiffres gagne l’indicatif 213 et perd son 0', () => {
    assert.equal(waNumber('0550123456'), '213550123456')
    assert.equal(waNumber('0669174617'), '213669174617')
    assert.equal(waNumber('0770123456'), '213770123456')
  })

  it('les formes déjà internationales ne sont pas doublées', () => {
    assert.equal(waNumber('213550123456'), '213550123456')
    assert.equal(waNumber('+213 550 123 456'), '213550123456')
    assert.equal(waNumber('00213550123456'), '213550123456')
  })

  it('un 9 chiffres (indicatif sans le 0) et les espaces/tirets passent', () => {
    assert.equal(waNumber('550123456'), '213550123456')
    assert.equal(waNumber('05 50 12 34 56'), '213550123456')
    assert.equal(waNumber('05-50-12-34-56'), '213550123456')
  })

  it('numéro non exploitable → chaîne vide (donc pas de lien wa.me bancal)', () => {
    // Portée volontaire : mobiles DZ (05/06/07). Un numéro étranger n'est pas
    // deviné — la boutique est à Oran, et un lien wa.me faux vaut pire qu'un
    // bouton absent (`waLink` renvoie alors null).
    for (const bad of ['', null, undefined, '   ', 'abc', '12345', '0150123456', '0450123456', '05501234567890', '+33612345678']) {
      assert.equal(waNumber(bad), '', `${JSON.stringify(bad)} devrait être rejeté`)
    }
  })
})

describe('P14 (#3) — DeskPage rend des liens wa.me valides', () => {
  const reservations = [
    { code: 'PC-1001', name: 'Karim Ben', phone: '0550123456', wilaya: 'Oran', status: 'new', at: '2026-09-13T09:00:00.000Z', total: 152000, items: [{ id: 'cpu-7800x3d', qty: 1, price: 97000 }] },
    { code: 'PC-1002', name: 'Amina Castors', phone: '+213 669 174 617', wilaya: 'Oran', status: 'preparing', at: '2026-09-13T10:00:00.000Z', total: 45000, items: [] },
    { code: 'PC-1003', name: 'Sans téléphone', phone: '', wilaya: 'Alger', status: 'ready', at: '2026-09-13T11:00:00.000Z', total: 12000, items: [] }
  ]

  const mount = () => {
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        React.createElement(DeskPage, {
          t,
          lang: 'fr',
          reservations,
          onStatus: async () => true,
          setToast: () => {}
        })
      )
    })
    return host
  }

  it('chaque lien WhatsApp est en E.164, sans 0 initial', () => {
    const host = mount()
    const hrefs = [...host.querySelectorAll('a[href^="https://wa.me/"]')].map((a) => a.getAttribute('href'))
    assert.equal(hrefs.length, 2, `2 réservations ont un téléphone exploitable, liens trouvés : ${hrefs.join(' ')}`)
    for (const h of hrefs) {
      const num = h.replace('https://wa.me/', '').split('?')[0]
      assert.match(num, /^[1-9]\d{8,14}$/, `numéro wa.me invalide : ${h}`)
      assert.ok(!num.startsWith('0'), `wa.me refuse un 0 initial : ${h}`)
    }
    assert.ok(
      hrefs.some((h) => h.startsWith('https://wa.me/213550123456?text=')),
      `lien attendu pour 0550123456 absent : ${hrefs.join(' ')}`
    )
  })

  it('une réservation sans téléphone n’a pas de lien WhatsApp', () => {
    const host = mount()
    const cards = [...host.querySelectorAll('a[href^="https://wa.me/"]')]
    assert.equal(cards.length, 2, 'la réservation sans téléphone ne doit pas produire de lien')
  })
})
