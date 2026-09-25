import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'

// P17 — vérification du rapport d'analyse du 13/09.
// 2 affirmations confirmées et corrigées (#1 toast, #6 estimation),
// 1 piège UX documenté (#3), 1 durcissement (#2), 1 garde défensive (#5).
// Les 3 autres affirmations du rapport (#2 tel quel, #4, #7) sont réfutées —
// voir docs/BUGS-AND-FIXES.md § P17 pour les mesures.

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
      /* getter-only */
    }
  }
})

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MasterPage } = await import('./MasterPage.jsx')
const { default: BuilderPage } = await import('./BuilderPage.jsx')
const { PRODUCTS, BUILDER_SLOTS } = await import('./data.js')
const { dict } = await import('./i18n.js')
const { addProduct } = await import('./shopStore.js')
const { buildPowerRecap } = await import('./orderLogic.js')

const t = (key, vars) => {
  let s = String(key)
  for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

const mount = (element) => {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  act(() => root.render(element))
  return host
}

describe('P17 (#1) — toast de création de produit en mode local', () => {
  it('un échec de création annonce la création, pas le mot de passe', () => {
    const toasts = []
    const host = mount(
      React.createElement(MasterPage, {
        t,
        lang: 'fr',
        user: { id: 'master-pcstar', role: 'master', name: 'Desk', email: 'master@test.pcstar.local' },
        users: [],
        onUsers: () => {},
        products: PRODUCTS,
        masterCatalog: PRODUCTS,
        meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] },
        onMeta: () => {},
        basePanels: [],
        setToast: (m) => toasts.push(m),
        onBack: () => {},
        apiOnline: false,
        onStockRefresh: () => {}
      })
    )

    // Le formulaire produit est le premier <form> de la page (onglet « produits »).
    const form = host.querySelector('form')
    assert.ok(form, 'formulaire de création introuvable')
    // Nom laissé vide → addProduct retourne { ok:false }.
    act(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))

    assert.equal(toasts.length, 1, `un seul toast attendu, reçu : ${JSON.stringify(toasts)}`)
    assert.equal(toasts[0], 'masterCreateFail', `mauvaise clé de toast : ${toasts[0]}`)
    assert.notEqual(toasts[0], 'authErrorPassword', 'le toast « 6 caractères minimum » est de retour')
  })
})

describe('P17 (#2) — le SKU généré ne dégénère jamais en « PS- »', () => {
  const meta = () => ({ extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [] })

  it('nom normal → slug lisible (comportement inchangé)', () => {
    const r = addProduct(meta(), { name: 'Câble HDMI 15m', price: 2500, stock: 3, category: 'accessories' })
    assert.equal(r.ok, true)
    assert.match(r.product.sku, /^PS-.+/, `SKU dégénéré : ${r.product.sku}`)
  })

  it('nom composé uniquement de caractères invisibles → SKU non vide', () => {
    // `trim()` ne retire ni le BOM ni les zero-width : c’était le seul chemin
    // théorique vers un SKU illisible.
    const r = addProduct(meta(), { name: '\u200b\ufeff\u200b', price: 1500, stock: 1, category: 'accessories' })
    assert.equal(r.ok, true)
    assert.ok(r.product.sku.length > 'PS-'.length, `SKU illisible : ${JSON.stringify(r.product.sku)}`)
    assert.match(r.product.sku, /^PS-[A-Z0-9]+$/, `SKU invalide : ${JSON.stringify(r.product.sku)}`)
  })

  it('nom vide → refusé (garde déjà en place, vérifiée)', () => {
    assert.deepEqual(addProduct(meta(), { name: '   ', price: 1500 }).ok, false)
  })
})

describe('P17 (#3) — le filtre « En stock » : documenté hier, retiré aujourd’hui', () => {
  /*
   * Le P17 avait mesuré le problème : en mode API, `publicCatalog` ne contient
   * que du stock > 0, donc « En magasin seulement » ne retirait jamais rien —
   * d'où le tooltip qui l'expliquait. Le LOT P4 (V4) a tranché autrement, sur
   * demande du client : le filtre est supprimé, la place prise par le rayon du
   * catalogue. Ce verrou n'est pas supprimé avec le filtre, il est RETOURNÉ :
   * il interdit désormais que la clé revienne sans que personne ne lise l'état
   * du stock, ce qui était le défaut d'origine.
   */
  const sansCommentaires = (fichier) =>
    fs
      .readFileSync(path.join(process.cwd(), fichier), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

  it('les clés sont absentes des deux langues, et la page ne les lit plus', () => {
    for (const lang of ['fr', 'en']) {
      for (const cle of ['inStoreOnly', 'inStoreOnlyHint']) {
        assert.equal(cle in (dict?.[lang] || {}), false, `${lang} : la cle ${cle} est revenue, sans lecteur pour l'afficher`)
      }
    }
    for (const fichier of ['src/SearchPage.jsx', 'src/App.jsx']) {
      const code = sansCommentaires(fichier)
      for (const motif of ['inStoreOnly', 'in-stock-hint', 'm-stock']) {
        assert.equal(code.includes(motif), false, `${fichier} lit encore « ${motif} » : le filtre fantome est revenu`)
      }
    }
  })

  it('le retrait est cohérent : la case à cocher n’est plus rendue à l’écran', async () => {
    await import('jsdom')
    const { default: SearchPage } = await import('./SearchPage.jsx')
    const React = (await import('react')).default
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { PART_LINES } = await import('./data.js')
    const t = (k) => dict.fr[k] ?? k
    const hote = window.document.createElement('div')
    window.document.body.appendChild(hote)
    const racine = createRoot(hote)
    try {
      await act(async () => {
        racine.render(
          React.createElement(SearchPage, {
            t,
            products: [{ id: 'gpu-x', name: 'Carte X', brand: 'Asus', category: 'gpu', price: 1000, stock: 1 }],
            lines: PART_LINES,
            // LOT P6 (S1) : la feuille « catalogue » groupe les rayons par panneau,
            // comme a l'ecran. Une liste vide ne prouvait plus rien ici.
            panels: [{ id: 'catalog', titleKey: 'panelCatalog' }, { id: 'parts', titleKey: 'panelParts' }],
            lang: 'fr',
            liveStock: () => 1,
            onAdd: () => {},
            onOpen: () => {}
          })
        )
      })
      await act(async () => new Promise((r) => setTimeout(r, 40)))
      const champs = [...window.document.querySelectorAll('input[type="checkbox"]')].map((i) => i.id)
      assert.equal(champs.includes('m-stock'), false, `case mobile encore rendue : ${champs.join(',')}`)
      assert.equal(/En magasin seulement/.test(hote.textContent), false, 'le filtre retire est affiche')
      // LOT P6 (S1) : ce qui avait remplace le filtre « En stock » n'est plus une
      // legende de l'aside, c'est la feuille d'un bouton. Le verrou suit la forme —
      // et il la verifie vraiment : un clic, puis le rayon est la.
      const boutonCatalogue = [...hote.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t('filterCatalog')))
      assert.ok(boutonCatalogue, 'plus de bouton « filtrer par catalogue » : le remplacement a saute')
      await act(async () => boutonCatalogue.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
      assert.match(hote.textContent.replace(/\s+/g, ' '), /Tout le catalogue|GPU/, 'le rayon du catalogue n’est pas atteignable depuis le bouton')
    } finally {
      act(() => racine.unmount())
      hote.remove()
    }
  })
})

describe('P17 (#5) — la garde socket tolère les sockets multiples', () => {
  it('un CPU « [AM5, LGA1700] » sur une carte AM5 n’est pas rejeté, un LGA1700 exclusif l’est', () => {
    // Aucun produit du catalogue n’a de socket en tableau (vérifié : 0/14 CPU,
    // 0/17 cartes mères) — la garde est défensive, donc testée sur des
    // produits synthétiques.
    const board = { id: 'mb-test', name: 'Carte AM5', category: 'motherboard', price: 100, stock: 5, compat: { socket: 'AM5', memory: 'DDR5', form: 'ATX' } }
    const cpuMulti = { id: 'cpu-multi', name: 'CPU multi-socket', category: 'cpu', price: 100, stock: 5, compat: { socket: ['AM5', 'LGA1700'] } }
    const cpuOther = { id: 'cpu-other', name: 'CPU LGA seulement', category: 'cpu', price: 100, stock: 5, compat: { socket: 'LGA1700' } }
    // La RAM est un slot REQUIS : sans elle le bouton reste désactivé pour une
    // tout autre raison (requiredReady) et le test ne prouverait rien.
    const ram = { id: 'ram-test', name: '16 Go DDR5', category: 'memory', price: 100, stock: 5, compat: { memory: 'DDR5' } }
    // LOT P26 : le boîtier et l'alimentation sont REQUIS (demande client du
    // 21/09/2026) — sans eux, le bouton d'ajout resterait grisé pour une raison
    // qui n'a rien à voir avec le socket, et ce verrou ne prouverait rien.
    const box = { id: 'case-test', name: 'Boîtier ATX', category: 'case', price: 100, stock: 5, compat: { form: 'ATX' } }
    const psu = { id: 'psu-test', name: 'Alim 650 W', category: 'case', price: 100, stock: 5, compat: { psuWatts: 650 } }
    const noop = () => {}

    // LOT P28 (C) : le bouton n'est plus `disabled` — son clic doit pouvoir dire
    // pourquoi la config ne part pas. Le verrou juge donc ce qui compte : ce que
    // le clic ajoute au panier, et l'état annoncé (`aria-disabled`).
    const clickAddFor = (cpu) => {
      const panier = []
      const host = mount(
        React.createElement(BuilderPage, {
          t,
          products: [board, cpu, cpuMulti, cpuOther, ram, box, psu],
          build: { ...Object.fromEntries(BUILDER_SLOTS.map((s) => [s.key, null])), motherboard: board, cpu, ram, case: box, psu },
          setBuild: noop,
          liveStock: () => 5,
          onAdd: (p) => panier.push(p.id),
          onOpen: noop,
          onGoCart: noop,
          setToast: noop
        })
      )
      // Le bouton « ajouter la config » est le seul `btn-success w-100`
      // (les boutons d'onglet sont `btn-sm`, ceux des cartes aussi).
      const btn = host.querySelector('button.btn.btn-success.w-100')
      if (btn) act(() => btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
      return { btn, panier }
    }

    const ok = clickAddFor(cpuMulti)
    assert.ok(ok.btn, 'bouton d’ajout introuvable (cas multi-socket)')
    assert.equal(ok.btn.getAttribute('aria-disabled'), 'false', 'un CPU multi-socket compatible a été refusé')
    assert.ok(ok.panier.includes('cpu-multi'), 'un CPU multi-socket compatible n’arrive pas au panier')

    const ko = clickAddFor(cpuOther)
    assert.ok(ko.btn, 'bouton d’ajout introuvable (cas incompatible)')
    assert.equal(ko.btn.getAttribute('aria-disabled'), 'true', 'un couple CPU/carte incompatible s’annonce prêt')
    assert.deepEqual(ko.panier, [], 'un couple CPU/carte incompatible a été accepté')
  })
})

describe('P17 (#6) — l’estimation de puissance tient compte du CPU', () => {
  const P = (id) => {
    const p = PRODUCTS.find((x) => x.id === id)
    assert.ok(p, `produit absent du catalogue : ${id}`)
    return p
  }

  it('un CPU sans GPU n’est plus estimé à un plancher de 150 W', () => {
    // specOf(cpu-14700k).tdp = 125 → 125 + 150 = 275 W.
    // Avant le correctif, `p.tdp` (inexistant) donnait 0 + 150 = 150 W.
    const r = buildPowerRecap([P('cpu-14700k'), P('mb-z790')])
    assert.equal(r.estimateWatts, 275, `estimation inattendue : ${JSON.stringify(r)}`)
    assert.equal(r.psuMinSuggested, 300)
  })

  it('le psuMin du vendeur reste le plancher quand il est plus exigeant', () => {
    const r = buildPowerRecap([P('cpu-14700k'), P('gpu-4070s'), P('mb-z790')])
    assert.equal(r.estimateWatts, 700, `psuMin 4070 Super = 700 W, reçu ${r.estimateWatts}`)
  })

  it('CPU + GPU s’additionnent quand aucun psuMin ne domine', () => {
    // 7800X3D (120 W) + RTX 4060 (115 W) + 150 W = 385 W ; le psuMin de la
    // 4060 (550 W) l’emporte → 550 W.
    const r = buildPowerRecap([P('cpu-7800x3d'), P('gpu-4060'), P('mb-b650')])
    assert.equal(r.estimateWatts, 550)
  })
})
