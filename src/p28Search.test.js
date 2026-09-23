/**
 * LOT P28 / phase 3 — la page Recherche : chaque référence a un rayon, et un
 * ajout au panier ne perd pas le client.
 *
 *  G. Dix références n'apparaissaient dans AUCUNE ligne de recherche, sauf « Tout »
 *     (et « Occasion » pour deux d'entre elles) — introuvables par rayon :
 *       · rangées dans `accessories` alors que leur rayon existe : trois routeurs
 *         (`tenda-ac8`, `tpl-archer`, `wifi-ax3000`), un vidéoprojecteur
 *         (`hav-pj221`), un siège gamer (`sog-demon-seat`) ;
 *       · quatre packs 4-en-1 (`sog-mkh3`, `hav-combo4m|w|b`) dont le nom ne
 *         nomme aucune pièce — aucune ligne périphérique ne les reconnaissait ;
 *       · un rouleau d'étiquettes (`con-label-100150`, tag `label`) que la ligne
 *         « Papier & rouleaux » ignorait (elle ne lisait que `paper`).
 *     Et au passage : `kindForCategory('monitor')` rendait `'part'` alors que les
 *     neuf écrans du catalogue sont `accessory` (un écran créé par le maître
 *     divergeait du rayon qu'il rejoint).
 *
 *  H. `ProductCard` était déclarée DANS `SearchPage` : un nouveau type de composant
 *     à chaque rendu, donc toutes les cartes démontées et remontées. Mesuré : après
 *     « Ajouter », le bouton cliqué était remplacé et le focus clavier retombait
 *     sur `<body>`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const window = dom.window
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'FormData', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
process.env.PCSTAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p28-search-'))

const { PART_LINES, PRODUCTS, CATEGORIES, kindForCategory } = await import('./data.js')
const { dict } = await import('./i18n.js')
const { default: SearchPage } = await import('./SearchPage.jsx')
const React = (await import('react')).default
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')

const t = (key, vars) => String(dict.fr[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => (vars && n in vars ? String(vars[n]) : `{${n}}`))
const ligne = (id) => {
  const l = PART_LINES.find((x) => x.id === id)
  assert.ok(l, `ligne absente : ${id}`)
  return l
}
const P = (id) => {
  const p = PRODUCTS.find((x) => x.id === id)
  assert.ok(p, `référence absente du catalogue : ${id}`)
  return p
}
// Les deux lignes transversales : elles ne rangent rien, elles montrent tout ou un état.
const TRANSVERSALES = new Set(['all', 'deals'])

describe('P28 (G) — chaque référence est joignable par au moins un rayon', () => {
  it('aucune référence n’est réservée à « Tout » et « Occasion »', () => {
    const orphelines = PRODUCTS.filter((p) => PART_LINES.every((l) => TRANSVERSALES.has(l.id) || !l.match(p)))
    assert.deepEqual(
      orphelines.map((p) => `${p.id} [${p.category}]`),
      [],
      'des références ne se trouvent qu’en tapant leur nom ou en parcourant tout le catalogue'
    )
  })

  it('les dix références relevées sont dans le rayon qu’un client ouvrirait', () => {
    const attendu = {
      'tenda-ac8': ['network', 'router'],
      'tpl-archer': ['network', 'router'],
      'wifi-ax3000': ['network', 'router'],
      'hav-pj221': ['multimedia', 'projector'],
      'sog-demon-seat': ['furniture', 'chairs'],
      'sog-mkh3': ['packs'],
      'hav-combo4m': ['packs'],
      'hav-combo4w': ['packs'],
      'hav-combo4b': ['packs'],
      'con-label-100150': ['paper']
    }
    for (const [id, lignes] of Object.entries(attendu)) {
      for (const l of lignes) assert.ok(ligne(l).match(P(id)), `${id} absent de la ligne ${l}`)
    }
  })

  it('« Packs & combos » ne ramasse que des packs marqués comme tels', () => {
    const packs = PRODUCTS.filter(ligne('packs').match)
    assert.ok(packs.length >= 6, `packs trouvés : ${packs.map((p) => p.id).join(', ')}`)
    for (const p of packs) {
      assert.ok((p.tags || []).includes('combo'), `${p.id} n’est pas marqué combo`)
      assert.equal(p.category, 'accessories', `${p.id} : un combo d’un autre rayon (boîtier, service) n’est pas un pack périphériques`)
    }
    assert.equal(ligne('packs').group, 'peripherals')
    assert.ok(t('line_packs') !== 'line_packs', 'la ligne n’a pas de libellé')
  })

  it('« Routeurs & Wi‑Fi » lit les deux traits d’union, et l’anglais', () => {
    const routeur = ligne('router').match
    const base = { category: 'network', short: '', id: 'x' }
    assert.ok(routeur({ ...base, name: 'Borne Wi-Fi 6' }), 'trait d’union ordinaire')
    assert.ok(routeur({ ...base, name: 'Borne Wi\u2011Fi 6' }), 'trait d’union insécable')
    assert.ok(routeur({ ...base, name: 'Wifi repeater' }))
    assert.ok(routeur({ ...base, name: 'AX3000', short: 'Wi-Fi 6 router' }))
    assert.equal(routeur({ ...base, name: 'Switch 8 ports' }), false)
  })

  it('aucun routeur ne reste dans les accessoires ; chaque rayon utilisé existe au filtre', () => {
    const routeurs = PRODUCTS.filter((p) => /routeur|router/i.test(`${p.name} ${p.short}`) && p.category === 'accessories')
    assert.deepEqual(routeurs.map((p) => p.id), [])
    for (const p of PRODUCTS) assert.ok(CATEGORIES.some((c) => c.id === p.category), `${p.id} : rayon ${p.category} inconnu du filtre`)
  })

  it('un écran créé par le maître prend le `kind` des écrans du catalogue', () => {
    assert.equal(kindForCategory('monitor'), 'accessory')
    for (const p of PRODUCTS) assert.equal(p.kind, kindForCategory(p.category), `${p.id} [${p.category}] : ${p.kind}`)
  })
})

describe('P28 (H) — « Ajouter » ne fait pas perdre le focus clavier', () => {
  it('le bouton cliqué reste le même nœud, et garde le focus', () => {
    const host = window.document.getElementById('root')
    const produits = PRODUCTS.filter((p) => p.stock > 0).slice(0, 12)
    function Parent() {
      // Le vrai déclencheur : un ajout change l'état du parent (le panier), donc
      // la page Recherche se rend à nouveau.
      const [, setN] = useState(0)
      return React.createElement(SearchPage, {
        t,
        products: produits,
        lines: PART_LINES,
        panels: [],
        lang: 'fr',
        liveStock: () => 5,
        onAdd: () => setN((x) => x + 1),
        onOpen: () => {}
      })
    }
    act(() => createRoot(host).render(React.createElement(Parent)))
    const bouton = [...host.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t('add'))
    assert.ok(bouton, 'bouton « Ajouter » introuvable dans la grille')
    const vignette = bouton.closest('.product-bs-card').querySelector('img')
    bouton.focus()
    act(() => bouton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    assert.equal(bouton.isConnected, true, 'la carte a été remontée : le bouton cliqué n’existe plus')
    assert.equal(window.document.activeElement, bouton, `le focus est parti sur <${window.document.activeElement?.tagName?.toLowerCase()}>`)
    if (vignette) assert.equal(vignette.isConnected, true, 'la vignette a été remplacée (rechargement de l’image)')
  })

  it('ProductCard est déclarée au niveau du module, pas dans le composant de page', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'SearchPage.jsx'), 'utf8')
    assert.match(src, /^function ProductCard\(/m, 'ProductCard n’est plus déclarée au niveau du module')
    assert.doesNotMatch(src, /^\s+function ProductCard\(/m, 'ProductCard est redevenue une fonction interne')
  })
})
