/**
 * LOT P28 / phase 2 — le configurateur, rejoué au clic sur le VRAI composant.
 *
 * Trois défauts relevés à la relecture du rapport P26 (mesurés avant correctif, sur
 * un état React qui évolue — pas sur une config figée) :
 *
 *  C. Le bouton « Ajouter la config » était `disabled` dès qu'un emplacement requis
 *     manquait : le clic n'atteignait jamais `addBuild`, donc les quatre messages
 *     qu'il porte (`toastPickBoard`, `toastNeedCore`, `toastSocket`, `toastHeat`)
 *     étaient inatteignables. P26 écrivait que « le toast lit les données » ; aucun
 *     client ne pouvait le voir. Il voyait un bouton gris, sans savoir pourquoi.
 *
 *  D. Le combo « Boîtier Gamemax Vista + alim GE-eco » (`gmx-vista`, 15 900 DA)
 *     répond aux emplacements boîtier ET alimentation. Depuis P26 (alimentation
 *     requise), le client qui le prenait en boîtier devait « choisir une
 *     alimentation » — la même boîte ; et s'il le posait aux deux places, il était
 *     compté deux fois : 143 800 DA au lieu de 127 900, deux unités au panier.
 *
 *  E. L'onglet « Accessoires » testait `group === 'accessories'`, un groupe qui
 *     n'existe plus depuis le 18/09 (les emplacements sont en `peripherals`) : après
 *     un clic, AUCUN onglet n'était actif, et l'emplacement « Réseau » (groupe
 *     `networking`) n'apparaissait dans aucune barre — seul le récap y menait.
 *
 * Décision client conservée (21/09) : « PSU et BOITIER sont requis, pas optionnels ».
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

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
  window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
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
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: BuilderPage } = await import('./BuilderPage.jsx')
const { PRODUCTS, BUILDER_SLOTS, checkCompatibility, money } = await import('./data.js')
const { buildParts, comboSlots, partsForCompat } = await import('./orderLogic.js')
const { dict } = await import('./i18n.js')

// Le vrai dictionnaire : les messages que le client lit, variables interpolées.
const t = (key, vars) => String(dict.fr[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => (vars && n in vars ? String(vars[n]) : `{${n}}`))

const P = (id) => {
  const p = PRODUCTS.find((x) => x.id === id)
  assert.ok(p, `produit de fixture absent du catalogue : ${id}`)
  return p
}
const emptyBuild = () => Object.fromEntries(BUILDER_SLOTS.map((s) => [s.key, null]))
const labelOf = (key) => {
  const l = t(`line_${key}`)
  return l !== `line_${key}` ? l : BUILDER_SLOTS.find((s) => s.key === key).label
}

/**
 * Monte le configurateur avec un VRAI état (`useState` dans un parent) : un choix
 * change la config, la config change l'écran — comme dans l'application.
 */
function monte(initial = emptyBuild()) {
  const journal = { toasts: [], panier: [], allerPanier: 0, build: null }
  function Hote() {
    const [build, setBuild] = useState(initial)
    journal.build = build
    return React.createElement(BuilderPage, {
      t,
      lang: 'fr',
      products: PRODUCTS,
      build,
      setBuild,
      liveStock: (p) => (typeof p.stock === 'number' && p.stock > 0 ? p.stock : 5),
      onAdd: (p) => journal.panier.push(p.id),
      onOpen: () => {},
      onGoCart: () => {
        journal.allerPanier += 1
      },
      setToast: (m) => journal.toasts.push(typeof m === 'string' ? m : JSON.stringify(m))
    })
  }
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  act(() => createRoot(host).render(React.createElement(Hote)))
  const clic = (el) => act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
  const boutons = () => [...host.querySelectorAll('button')]
  const ajouter = () => host.querySelector('button.btn.btn-success.w-100')
  /** Le bouton d'emplacement de la barre (pas le lien du récap). */
  const emplacement = (key) =>
    boutons().find((b) => b.className.includes('btn-sm') && !b.className.includes('btn-link') && (b.textContent || '').startsWith(labelOf(key)))
  const onglet = (cle) => boutons().find((b) => (b.textContent || '').trim() === t(cle))
  /** Choisir `id` dans l'emplacement `key` : ouvrir l'emplacement, cliquer « Choisir » sur sa carte. */
  const choisir = (key, id) => {
    const lien = [...host.querySelectorAll('.list-group button.btn-link')].find((b) => (b.textContent || '').trim() === labelOf(key))
    clic(emplacement(key) || lien)
    const nom = P(id).name
    const carte = [...host.querySelectorAll('.product-bs-card')].find((c) => (c.querySelector('h3')?.textContent || '').trim() === nom)
    assert.ok(carte, `${id} absent de la liste de l’emplacement ${key}`)
    const bouton = [...carte.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t('choose'))
    assert.ok(bouton, `${id} : bouton « ${t('choose')} » introuvable (déjà choisi ou indisponible)`)
    clic(bouton)
  }
  return { host, journal, clic, boutons, ajouter, emplacement, onglet, choisir }
}

describe('P28 (C) — le bouton d’ajout explique au lieu de rester gris', () => {
  it('sans carte mère : il le dit, et mène à l’emplacement', () => {
    const ui = monte()
    assert.equal(ui.ajouter().disabled, false, 'un bouton `disabled` ne peut rien expliquer')
    assert.equal(ui.ajouter().getAttribute('aria-disabled'), 'true', 'il doit s’annoncer indisponible')
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.toasts, [t('toastPickBoard')])
    assert.deepEqual(ui.journal.panier, [])
  })

  it('il manque le boîtier et l’alimentation : il les nomme, avant et après le clic, puis y mène', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650'), cpu: P('cpu-7800x3d'), ram: P('ram-32') })
    const attendu = t('toastNeedCore', { slots: [labelOf('case'), labelOf('psu')].join(', ') })
    // Écrit sous le bouton, sans clic : le client n'a pas à deviner.
    const note = ui.host.querySelector('#builder-missing')
    assert.ok(note, 'ce qui manque n’est écrit nulle part près du bouton')
    assert.equal(note.textContent.trim(), attendu)
    assert.equal(ui.ajouter().getAttribute('aria-describedby'), 'builder-missing')
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.toasts, [attendu])
    assert.deepEqual(ui.journal.panier, [], 'la config incomplète est partie au panier')
    // … et le clic ouvre le premier emplacement manquant (sa liste est affichée).
    assert.ok(ui.emplacement('case').className.includes('btn-success'), 'le clic ne mène pas au boîtier')
  })

  it('sockets incompatibles : le message socket, pas un bouton muet', () => {
    const ui = monte({
      ...emptyBuild(),
      motherboard: P('mb-b650'),
      cpu: P('cpu-14700k'),
      ram: P('ram-32'),
      case: P('case-atx'),
      psu: P('psu-750')
    })
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.toasts, [t('toastSocket')])
    assert.deepEqual(ui.journal.panier, [])
  })

  it('config qui chaufferait : le message de chauffe', () => {
    const build = {
      ...emptyBuild(),
      motherboard: P('mb-b650'),
      cpu: P('cpu-7800x3d'),
      ram: P('ram-32'),
      gpu: P('gpu-4070s'),
      case: P('case-atx'),
      psu: P('psu-550-evga')
    }
    assert.ok(checkCompatibility(Object.values(build).filter(Boolean)).some((w) => w.block), 'fixture : plus aucun blocage')
    const ui = monte(build)
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.toasts, [t('toastHeat')])
    assert.deepEqual(ui.journal.panier, [])
  })

  it('config complète : tout part au panier, une fois', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650'), cpu: P('cpu-7800x3d'), ram: P('ram-32'), case: P('case-atx'), psu: P('psu-750') })
    assert.equal(ui.ajouter().getAttribute('aria-disabled'), 'false')
    assert.equal(ui.host.querySelector('#builder-missing'), null)
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.panier.sort(), ['case-atx', 'cpu-7800x3d', 'mb-b650', 'psu-750', 'ram-32'])
    assert.equal(ui.journal.allerPanier, 1)
  })
})

describe('P28 (D) — un combo boîtier + alimentation est une seule pièce', () => {
  const COMBO = 'gmx-vista'

  it('les données : le combo répond aux deux emplacements', () => {
    const combo = P(COMBO)
    assert.ok((combo.tags || []).includes('combo'))
    assert.deepEqual(BUILDER_SLOTS.filter((s) => s.pick(combo)).map((s) => s.key), ['case', 'psu'])
    assert.deepEqual(comboSlots(BUILDER_SLOTS, combo, 'case', emptyBuild()).map((s) => s.key), ['psu'])
    // Un emplacement déjà choisi n'est jamais remplacé.
    assert.deepEqual(comboSlots(BUILDER_SLOTS, combo, 'case', { ...emptyBuild(), psu: P('psu-750') }), [])
    // Un produit qui n'est PAS marqué combo ne remplit rien d'autre, même s'il
    // répond par hasard à plusieurs motifs : on ne décide pas pour le client.
    const simple = P('webcam')
    assert.equal((simple.tags || []).includes('combo'), false, 'fixture : la webcam est devenue un combo')
    assert.deepEqual(comboSlots(BUILDER_SLOTS, simple, 'webcam', emptyBuild()), [])
  })

  it('même règle pour un pack périphériques : choisi en clavier, il remplit souris et casque', () => {
    // `sog-mkh500` — « Clavier + souris + tapis + casque », marqué `combo` dans les
    // données : une seule boîte, donc une seule ligne de prix.
    const pack = P('sog-mkh500')
    assert.ok((pack.tags || []).includes('combo'))
    const ui = monte()
    ui.clic(ui.onglet('catalogAcc'))
    ui.choisir('keyboard', 'sog-mkh500')
    assert.equal(ui.journal.build.mouse?.id, 'sog-mkh500')
    assert.equal(ui.journal.build.headset?.id, 'sog-mkh500')
    assert.deepEqual(buildParts(BUILDER_SLOTS, ui.journal.build).map((p) => p.id), ['sog-mkh500'])
  })

  it('choisi en boîtier, il remplit l’alimentation — et le dit', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650'), cpu: P('cpu-7800x3d'), ram: P('ram-32') })
    ui.choisir('case', COMBO)
    assert.equal(ui.journal.build.case?.id, COMBO)
    assert.equal(ui.journal.build.psu?.id, COMBO, 'l’alimentation reste « Requis » alors que le combo en contient une')
    assert.ok(ui.journal.toasts.includes(t('builderComboFills', { name: P(COMBO).name, slots: labelOf('psu') })), 'le remplissage n’est pas annoncé')
    assert.equal(ui.host.querySelector('#builder-missing'), null, 'la config se dit encore incomplète')
  })

  it('compté une fois : total, récap et panier', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650'), cpu: P('cpu-7800x3d'), ram: P('ram-32') })
    ui.choisir('case', COMBO)
    const attendu = ['mb-b650', 'cpu-7800x3d', 'ram-32', COMBO].reduce((s, id) => s + P(id).price, 0)
    const recap = ui.host.querySelector('aside')
    assert.ok(recap.textContent.includes(money(attendu, 'fr')), `total attendu ${money(attendu, 'fr')}`)
    assert.ok(recap.textContent.includes(t('builderComboIncluded', { slot: labelOf('case') })), 'la seconde ligne recompte le prix du combo')
    ui.clic(ui.ajouter())
    assert.deepEqual(ui.journal.panier.filter((id) => id === COMBO), [COMBO], 'le combo part deux fois au panier')
  })

  it('une alimentation déjà choisie n’est pas remplacée, et son wattage seul compte', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650'), cpu: P('cpu-7800x3d'), ram: P('ram-32'), gpu: P('gpu-4070s'), psu: P('psu-750') })
    ui.choisir('case', COMBO)
    assert.equal(ui.journal.build.psu?.id, 'psu-750', 'l’alimentation choisie par le client a été remplacée')
    // Le combo ne sert que de boîtier : ses 600 W ne doivent pas lever un faux
    // « alimentation trop faible » face à la 4070 Super (700 W mini).
    const vus = partsForCompat(BUILDER_SLOTS, ui.journal.build)
    assert.equal(vus.find((p) => p.id === COMBO).compat.psuWatts, undefined)
    assert.equal(checkCompatibility(vus).some((w) => w.key === 'compatPsuWeak'), false, 'faux blocage : le wattage d’un combo qui n’alimente rien')
  })

  it('buildParts : la même référence dans deux emplacements est une pièce', () => {
    const combo = P(COMBO)
    const parts = buildParts(BUILDER_SLOTS, { ...emptyBuild(), case: combo, psu: combo, motherboard: P('mb-b650') })
    assert.deepEqual(parts.map((p) => p.id), ['mb-b650', COMBO])
  })
})

describe('P28 (E) — les deux onglets couvrent tous les emplacements', () => {
  it('« Accessoires » devient actif et montre ses emplacements, « Réseau » compris', () => {
    const ui = monte()
    ui.clic(ui.onglet('catalogAcc'))
    assert.ok(ui.onglet('catalogAcc').className.includes('btn-success'), 'aucun onglet actif après le clic sur « Accessoires »')
    assert.equal(ui.onglet('catalogAcc').getAttribute('aria-pressed'), 'true')
    assert.ok(!ui.onglet('catalogParts').className.includes('btn-success'))
    for (const key of ['keyboard', 'monitor', 'network']) {
      assert.ok(ui.emplacement(key), `l’emplacement ${key} n’apparaît pas sous « Accessoires »`)
    }
    assert.equal(ui.emplacement('cpu'), undefined, 'les pièces PC restent affichées sous « Accessoires »')
    ui.clic(ui.onglet('catalogParts'))
    assert.ok(ui.onglet('catalogParts').className.includes('btn-success'))
    assert.ok(ui.emplacement('motherboard'))
  })

  it('chaque emplacement des données appartient à exactement un onglet atteignable', () => {
    const ui = monte()
    const vus = new Set()
    for (const cle of ['catalogParts', 'catalogAcc']) {
      ui.clic(ui.onglet(cle))
      for (const s of BUILDER_SLOTS) if (ui.emplacement(s.key)) vus.add(s.key)
    }
    assert.deepEqual([...vus].sort(), BUILDER_SLOTS.map((s) => s.key).sort(), 'un emplacement n’est joignable que par le récap')
  })

  it('ouvrir « Réseau » depuis le récap active l’onglet qui le porte', () => {
    const ui = monte({ ...emptyBuild(), motherboard: P('mb-b650') })
    const lien = [...ui.host.querySelectorAll('.list-group button.btn-link')].find((b) => (b.textContent || '').trim() === labelOf('network'))
    assert.ok(lien, 'lien « Réseau » du récap introuvable')
    ui.clic(lien)
    assert.ok(ui.onglet('catalogAcc').className.includes('btn-success'), 'l’emplacement s’ouvre sous un onglet inactif')
    assert.ok(ui.emplacement('network').className.includes('btn-success'))
  })
})
