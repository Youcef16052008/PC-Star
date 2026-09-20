/**
 * LOT P3 (audit 19/09/2026, B14, B19, B22, B24, B25, B26) — la surface de la
 * vitrine : vignettes, panier, fenêtres,puces de marques, console.
 *
 * Quatre de ces six points ne se jugent pas sur une valeur de sortie mais sur
 * l'absence d'un comportement faux (une ligne de panier qui disparait, une
 * liste de puces qui ne correspond pas au stock) : les assertions mélangent
 * donc montage réel (jsdom) et garde statique, en disant lequel fait quoi.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { PRODUCTS } from './data.js'
import { BRANDS_DZ_PRIORITY } from './data.js'
import { brandsOnSale } from './productMeta.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const window = dom.window
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: PartThumb } = await import('./PartThumb.jsx')

after(() => {
  dom.window.close()
})

const codeDe = (fichier) =>
  fs
    .readFileSync(path.join(process.cwd(), fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

describe('P3/B25 — les puces de marques suivent le rayon', () => {
  it('les marques sans produit en rayon ne proposent plus de puce', () => {
    const inventaire = new Set(PRODUCTS.map((p) => p.brand))
    const absentes = BRANDS_DZ_PRIORITY.filter((b) => !inventaire.has(b))
    assert.ok(absentes.length > 0, 'plus aucune marque prioritaire sans produit : le test ne prouverait rien')
    const rendu = brandsOnSale(PRODUCTS, BRANDS_DZ_PRIORITY)
    for (const b of absentes) assert.equal(rendu.includes(b), false, `${b} sans produit est encore proposé`)
  })

  it('les marques du catalogue, y compris hors liste, sont toutes joignables', () => {
    const rendu = brandsOnSale(PRODUCTS, BRANDS_DZ_PRIORITY)
    const attendues = [...new Set(PRODUCTS.map((p) => p.brand))].filter(Boolean)
    for (const b of attendues) assert.ok(rendu.includes(b), `${b} (présente en rayon) reste infiltrable depuis la vitrine`)
    assert.equal(rendu.length, attendues.length, 'des puces en trop')
  })

  it('l’ordre de priorité gagne, le reste est trié', () => {
    const produits = [{ brand: 'Zeta' }, { brand: 'Alpha' }, { brand: 'Spirit of Gamer' }, { brand: 'Havit' }]
    assert.deepEqual(brandsOnSale(produits, ['Havit', 'Spirit of Gamer']), ['Havit', 'Spirit of Gamer', 'Alpha', 'Zeta'])
    assert.deepEqual(brandsOnSale([], ['Rien']), [])
    assert.deepEqual(brandsOnSale([{ brand: '' }, { brand: null }], []), [], 'une marque vide ne devient pas une puce')
  })

  it('la liste morte a disparu du partage de données', () => {
    const data = codeDe('src/data.js')
    assert.equal(/export const BRANDS =/.test(data), false, '`BRANDS` est ré-exporté — et lu par qui ?')
    assert.match(data, /export const BRANDS_DZ_PRIORITY = \[/)
  })
})

describe('P3/B19 — un « + » sur une rupture ne supprime plus la ligne', () => {
  it('le refus est posé avant l’écriture du panier', () => {
    const app = codeDe('src/App.jsx')
    const i = app.indexOf('function setQty(')
    assert.ok(i > 0, 'setQty introuvable')
    const corps = app.slice(i, i + 1400)
    const garde = corps.indexOf('if (max < 1) {')
    const ecriture = corps.indexOf('setCart((prev)')
    assert.ok(garde > 0, 'aucun refus explicite quand il ne reste aucun exemplaire')
    assert.ok(ecriture > garde, 'le panier est écrit avant le refus')
    assert.match(corps, /setToast\(t\('outOfStock'\)\)/, 'le refus n’est pas dit')
    // La descente à zéro doit rester le moyen de retirer la ligne.
    assert.match(corps, /\.filter\(\(i\) => i\.qty > 0\)/, 'retirer une ligne ne marche plus')
  })
})

describe('P3/B14 — la vignette repart de zéro quand la fiche change', () => {
  // Une image qui échoue fait monter `attempt` ; l'état vivait sur
  // l'INSTALLATION, pas sur la fiche. Or `App.jsx` ne remonte pas toujours
  // `PartThumb` quand le produit change (la page produit, elle, porte une
  // `key` ; les listes aussi — mais le composant est partagé, et un composant
  // partagé ne doit rien supposer de son parent).
  const hote = window.document.createElement('div')
  window.document.getElementById('root').appendChild(hote)

  const image = () => hote.querySelector('img')
  const propsDe = (n) => n[Object.keys(n).find((k) => k.startsWith('__reactProps'))]

  it('une vignette en échec rend le badge, puis l’image de la fiche suivante', async () => {
    const A = { id: 'a', name: 'A', category: 'gpu', photos: ['https://ex.test/a.webp'] }
    const B = { id: 'b', name: 'B', category: 'cpu', photos: ['https://ex.test/b.jpg'] }
    const root = createRoot(hote)
    await act(async () => root.render(React.createElement(PartThumb, { product: A })))
    assert.ok(image(), 'la première vignette ne rend pas d’image')
    // L'etat d'echec se regle pendant le rendu (voir `PartThumb.jsx`) : une
    // passe de plus le stabilise avant l'assertion.
    await act(async () => propsDe(image()).onError({}))
    assert.equal(image(), null, 'aucun repli rendu après la seule candidate')

    await act(async () => root.render(React.createElement(PartThumb, { product: B })))
    const rendue = image()
    assert.ok(rendue, "la fiche B hérite de l’état d’échec de A : aucune image rendue")
    assert.match(rendue.getAttribute('src') || '', /b\.jpg$/, "ce n'est pas l'image de B qui est rendue")
    root.unmount()
  })
})

describe('P3/B22, B24, B26 — ouverture, état mort, console', () => {
  it('openExternal coupe le lien d’origine sans perdre le repli', () => {
    const app = codeDe('src/App.jsx')
    const i = app.indexOf('function openExternal(')
    assert.ok(i > 0)
    const corps = app.slice(i, app.indexOf('\n}', i) + 2)
    assert.match(corps, /w\.opener = null/, 'la fenêtre ouverte garde la main sur la boutique')
    assert.equal(/'_blank', ?'noopener'/.test(corps), false, 'le 3e argument est revenu : `w` vaut null et le repli navigation s’applique deux fois')
    assert.match(corps, /window\.location\.href = href/, 'le repli sans popup est perdu')
  })

  it('B24 : un useRef écrit à chaque pull et jamais lu a été retiré', () => {
    const app = codeDe('src/App.jsx')
    assert.equal(/prevOrderCount/.test(app), false, 'l’état mort est réapparu (`src/App.jsx:323`, `:985` avant le lot)')
  })

  it('B26 : la reprise du contexte audio ne peut plus jeter en l’air', () => {
    const app = codeDe('src/App.jsx')
    assert.match(app, /deskAudioCtx\.resume\(\)\.catch\(\(\) => \{\}\)/, 're() non attendu et non rattrapé')
  })
})
