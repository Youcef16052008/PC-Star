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

after(async () => {
  // P21 : laisser le planificateur React vider sa file AVANT de retirer les
  // globaux. Sinon un rendu différé s'exécute après ce hook et meurt sur
  // `ReferenceError: window is not defined`, signalé comme fuite asynchrone.
  await new Promise((r) => setTimeout(r, 20))
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
    // 2 contacts + 1 « Rappeler » (PC-1002 est en préparation, téléphone OK ;
    // PC-1003 n'a pas de téléphone → pas de lien de rappel non plus).
    assert.equal(hrefs.length, 3, `2 contacts + 1 rappel attendus, liens trouvés : ${hrefs.join(' ')}`)
    for (const h of hrefs) {
      const num = h.replace('https://wa.me/', '').split('?')[0]
      assert.match(num, /^[1-9]\d{8,14}$/, `numéro wa.me invalide : ${h}`)
      assert.ok(!num.startsWith('0'), `wa.me refuse un 0 initial : ${h}`)
    }
    assert.ok(
      hrefs.some((h) => h.startsWith('https://wa.me/213550123456?text=')),
      `lien attendu pour 0550123456 absent : ${hrefs.join(' ')}`
    )
    // La date de retrait : le bouton « Rappeler » pointe vers le même format
    // wa.me/E.164, message dédié (préparation bientôt terminée).
    assert.ok(
      hrefs.some((h) => h.startsWith('https://wa.me/213669174617?text=deskRemindMsg')),
      `lien « Rappeler » attendu pour 0669174617 absent : ${hrefs.join(' ')}`
    )
  })

  it('une réservation sans téléphone n’a pas de lien WhatsApp', () => {
    const host = mount()
    const cards = [...host.querySelectorAll('a[href^="https://wa.me/"]')]
    // 2 contacts ; PC-1002 (préparation) ajoute un « Rappeler » — mais la
    // réservation SANS téléphone (PC-1003) n'en produit aucun, rappel inclus.
    assert.equal(cards.length, 3, 'la réservation sans téléphone ne doit pas produire de lien')
  })
})

// ---------------------------------------------------------------------------
// P21 — « je clique sur préparer / prêt / remis, rien ne change »
//
// Le Desk n'avait qu'un SEUL état `busy` partagé par toutes les commandes, et
// les cinq boutons testaient sa simple présence (`disabled={busy}`). Dès qu'une
// requête restait en attente — proxy capricieux, cold start serverless, réseau
// mobile — `busy` n'était jamais réinitialisé et TOUS les boutons de TOUTES les
// cartes restaient désactivés jusqu'au rechargement de la page. Le maître
// cliquait sans aucun effet, sans message d'erreur.
// ---------------------------------------------------------------------------
describe('P21 — un bouton en attente ne gèle plus les autres cartes', () => {
  const reservations = [
    { code: 'PC-2001', name: 'Karim Ben', phone: '0550123456', wilaya: 'Oran', status: 'new', at: '2026-09-14T09:00:00.000Z', total: 97000, items: [] },
    { code: 'PC-2002', name: 'Amina Castors', phone: '0669174617', wilaya: 'Oran', status: 'new', at: '2026-09-14T10:00:00.000Z', total: 45000, items: [] }
  ]

  const mountWith = (onStatus) => {
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        React.createElement(DeskPage, { t, lang: 'fr', reservations, onStatus, setToast: () => {} })
      )
    })
    return { host, root }
  }

  // Les boutons d'une carte : on les repère par leur libellé traduit (ici la
  // clé brute, puisque le `t` de test renvoie la clé telle quelle).
  const buttonsOf = (host, code) => {
    const card = [...host.querySelectorAll('.card')].find((c) => c.textContent.includes(code))
    return card ? [...card.querySelectorAll('button')] : []
  }
  const label = (b) => (b.textContent || '').trim()

  it('cliquer sur « préparer » d\'une carte laisse l\'autre carte utilisable', async () => {
    // Requête qui ne se termine jamais — le cas qui gelait tout le Desk.
    let resolveFirst
    const gate = new Promise((r) => { resolveFirst = r })
    const calls = []
    const { host, root } = mountWith((code, status) => {
      calls.push([code, status])
      return code === 'PC-2001' ? gate : Promise.resolve(true)
    })

    const first = buttonsOf(host, 'PC-2001').find((b) => label(b) === 'deskStartPrep')
    assert.ok(first, 'bouton « préparer » présent sur la première carte')
    assert.equal(first.disabled, false, 'bouton cliquable au départ')

    await act(async () => { first.click() })

    // La carte cliquée est bien verrouillée (double-clic impossible)…
    const lockedFirst = buttonsOf(host, 'PC-2001')
    assert.ok(lockedFirst.every((b) => b.disabled), 'la carte en attente est verrouillée')
    // …mais l'AUTRE carte reste pleinement utilisable : c'est le cœur du bug.
    const other = buttonsOf(host, 'PC-2002')
    assert.ok(other.length > 0, 'seconde carte trouvée')
    assert.ok(other.every((b) => !b.disabled), 'les boutons des autres cartes restent actifs')

    // La seconde carte peut donc être traitée pendant que la première attend.
    const secondPrep = other.find((b) => label(b) === 'deskStartPrep')
    await act(async () => { secondPrep.click() })
    assert.deepEqual(calls[1], ['PC-2002', 'preparing'], 'la seconde carte a bien été traitée')

    await act(async () => { resolveFirst(true) })
    assert.ok(buttonsOf(host, 'PC-2001').every((b) => !b.disabled), 'la première carte se déverrouille à la fin')
    root.unmount()
  })

  it('un onStatus qui lève une exception ne laisse pas la carte figée', async () => {
    const toasts = []
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        React.createElement(DeskPage, {
          t, lang: 'fr', reservations: [reservations[0]],
          onStatus: async () => { throw new Error('boom') },
          setToast: (m) => toasts.push(m)
        })
      )
    })
    const btn = buttonsOf(host, 'PC-2001').find((b) => label(b) === 'deskStartPrep')
    // Le `finally` doit libérer `busy` même sur exception — sinon la carte
    // reste désactivée définitivement, exactement comme avec une requête pendue.
    await act(async () => {
      btn.click()
      // Laisser la microtâche du rejet ET le planificateur React se vider à
      // l'intérieur de act() — sinon le rendu différé s'exécute après le hook
      // `after()` qui supprime `window`, et le test meurt sur une fuite.
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    assert.ok(buttonsOf(host, 'PC-2001').every((b) => !b.disabled), 'boutons réactivés après l\'erreur')
    assert.deepEqual(toasts, ['deskStatusFail'], 'un message d\'erreur est affiché au maître')
    root.unmount()
  })
})
