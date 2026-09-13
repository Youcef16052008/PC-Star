import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// P14 (#4) — `splitWarnings()` renvoie des objets `{ key, vars, block }`. Les
// rendre tels quels dans la liste GPU faisait lever « Objects are not valid as
// a React child » (React 19) → écran blanc du Builder. On rend le VRAI
// composant dans jsdom et on vérifie que les avertissements arrivent traduits.

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
const { default: BuilderPage } = await import('./BuilderPage.jsx')
const { PRODUCTS, BUILDER_SLOTS, checkCompatibility, splitWarnings } = await import('./data.js')

// Traducteur de test : `clé|var=valeur|…` — si un objet passait tel quel, on
// verrait `[object Object]` au lieu des variables interpolées.
const t = (key, vars) => [String(key), ...Object.entries(vars || {}).map(([k, v]) => `${k}=${v}`)].join('|')
const expected = (w) => t(w.key, w.vars)

const P = (id) => {
  const p = PRODUCTS.find((x) => x.id === id)
  assert.ok(p, `produit de fixture absent du catalogue : ${id}`)
  return p
}

const emptyBuild = () => Object.fromEntries(BUILDER_SLOTS.map((s) => [s.key, null]))

const mount = (build) => {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      React.createElement(BuilderPage, {
        t,
        products: PRODUCTS,
        build,
        setBuild: () => {},
        liveStock: (p) => (typeof p.stock === 'number' ? p.stock : 5),
        onAdd: () => {},
        onOpen: () => {},
        onGoCart: () => {},
        setToast: () => {}
      })
    )
  })
  return host
}

describe('P14 (#4) — le Builder traduit les avertissements de compatibilité', () => {
  it('récap : un blocage {key, vars} arrive traduit, pas en objet', () => {
    // GPU 4070 Super (700 W mini) sur une alim 550 W → `compatPsuWeak` (block).
    const board = P('mb-b650')
    const cpu = P('cpu-7800x3d')
    const gpu = P('gpu-4070s')
    const psu = P('psu-550-evga')
    const build = { ...emptyBuild(), motherboard: board, cpu, gpu, psu }

    const { blocks } = splitWarnings(checkCompatibility([board, cpu, gpu, psu]))
    assert.ok(blocks.length > 0, 'fixture : aucun blocage, le test ne prouverait rien')

    const host = mount(build)
    const text = host.textContent || ''
    assert.ok(text.length > 0, 'le Builder n’a rien rendu (écran blanc)')
    for (const w of blocks) {
      assert.ok(text.includes(expected(w)), `avertissement absent du rendu : ${expected(w)}`)
    }
    assert.ok(!text.includes('[object Object]'), 'objet rendu tel quel dans le récap')
  })

  it('liste GPU : la note par carte arrive traduite (le site exact du bug)', () => {
    const board = P('mb-b650')
    const cpu = P('cpu-7800x3d')
    const gpu = P('gpu-4070s')
    const build = { ...emptyBuild(), motherboard: board, cpu }

    // BuilderPage.jsx:51 calcule les avertissements par carte GPU.
    const { blocks, notes } = splitWarnings(checkCompatibility([board, cpu, gpu].filter(Boolean)))
    const shown = blocks[0] || notes[0]
    assert.ok(shown, 'fixture : aucune note GPU, le test ne prouverait rien')

    const host = mount(build)
    // Onglet « GPU » de la barre latérale.
    const gpuSlot = BUILDER_SLOTS.find((s) => s.key === 'gpu')
    const btn = [...host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(gpuSlot.label))
    assert.ok(btn, 'bouton d’onglet GPU introuvable')
    act(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))

    const text = host.textContent || ''
    assert.ok(text.includes(gpu.name), 'la liste GPU ne s’est pas affichée')
    assert.ok(text.includes(expected(shown)), `note GPU absente du rendu : ${expected(shown)}`)
    assert.ok(!text.includes('[object Object]'), 'objet rendu tel quel dans la liste GPU')
  })
})
