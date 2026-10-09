/**
 * LOT P2 (audit 19/09/2026, B10) — une fiche sans `compat` doit rester une
 * fiche.
 *
 * `BuilderPage.jsx:37` comparait déjà les sockets avec tolérance (LOT 6.6 Q6),
 * mais le reste du chemin de compatibilité supposait l'objet présent :
 *
 *     src/data.js:921         cpu.compat.socket            ← TypeError si `compat` absent
 *     src/data.js:937         compatLabel(cpu.compat.socket)
 *     src/data.js:946-947     board.compat.memory / ram.compat.memory
 *     src/data.js:956,965     gpu.compat.psuMin
 *     src/BuilderPage.jsx:427 compatLabel(cpu.compat.socket)  ← rendu pile quand `!socketOk`
 *
 * `checkCompatibility` se appelle **dans le rendu** (`BuilderPage.jsx:26`,
 * `useMemo`), donc un `TypeError` y fait tomber toute la page — pas un message,
 * un écran blanc. Le rapport appelait ça « latent » : vérifié, les 301 produits
 * du catalogue portent bien un `compat`. Ce qui n'est pas le cas d'une fiche
 * créée par le maître (le serveur normalise `compat` en objet, **mais le mode
 * local sans serveur ne normalise rien**, et une sauvegarde antérieure au LOT
 * P1 non plus), ni d'un catalogue restauré d'un backup.
 *
 * Les tests ci-dessous prennent les formes de donnée telles qu'elles arrivent,
 * et montent réellement la page pour le site qui n'est pas une fonction pure.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { checkCompatibility, socketsMatch } from './data.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-b10-compat-'))
process.env.PCSTAR_DATA_DIR = dir

// Toutes les formes que `compat` peut réellement porter dans un JSON stocké.
const FORMES = {
  absent: undefined,
  nul: null,
  vide: {},
  clesNull: { socket: null, memory: null, psuWatts: null, psuMin: null },
  chaineVide: { socket: '', memory: '', psuWatts: 0, psuMin: 0 },
  liste: { socket: ['AM5'], memory: ['DDR5'], psuWatts: 650, psuMin: 550 }
}

/** La valeur de `compat` telle que le test la veut : `absent` = clé non posée. */
function compatOf(forme) {
  return forme === 'absent' ? undefined : FORMES[forme]
}

function piece(id, category, forme) {
  const p = { id, sku: id, name: id, price: 1000, stock: 2, category }
  const compat = compatOf(forme)
  if (compat !== undefined) p.compat = compat
  return p
}

describe('P2/B10 — checkCompatibility ne juge pas une fiche incomplète', () => {
  it('toutes les paires de formes, dans tous les emplacements, sans exception', () => {
    const formes = Object.keys(FORMES)
    const casses = []
    for (const formeCpu of formes) {
      for (const formeBoard of formes) {
        for (const troisieme of ['', 'ram', 'gpu', 'psu', 'cooler', 'case']) {
          const items = [piece('c1', 'cpu', formeCpu), piece('b1', 'motherboard', formeBoard)]
          if (troisieme === 'ram') items.push(piece('m1', 'memory', formeBoard), piece('m2', 'memory', 'absent'))
          if (troisieme === 'gpu') items.push(piece('g1', 'gpu', formeCpu))
          if (troisieme === 'psu') items.push(piece('p1', 'psu', formeBoard), piece('g2', 'gpu', 'liste'))
          if (troisieme === 'cooler') items.push(piece('k1', 'cooling', formeCpu), piece('k2', 'cooling', 'absent'))
          if (troisieme === 'case') items.push(piece('s1', 'case', formeBoard), piece('s2', 'case', 'absent'))
          try {
            const r = checkCompatibility(items)
            if (!Array.isArray(r)) casses.push(`${formeCpu}/${formeBoard}/${troisieme} → ${typeof r}`)
          } catch (err) {
            casses.push(`${formeCpu}/${formeBoard}/${troisieme} → ${err.constructor.name}: ${err.message}`)
          }
        }
      }
    }
    assert.deepEqual(casses, [], `checkCompatibility jette sur ${casses.length} combinaison(s) :\n${casses.slice(0, 6).join('\n')}`)
  })

  it('deux fiches sans socket ne s’accusent pas mutuellement', () => {
    const warnings = checkCompatibility([piece('c1', 'cpu', 'absent'), piece('b1', 'motherboard', 'absent')])
    assert.deepEqual(warnings.filter((w) => w.key === 'compatSocketMismatch'), [], 'incompatibilité inventée')
  })

  it('un vrai conflit reste signalé, chaîne ou liste', () => {
    const chaine = checkCompatibility([
      { ...piece('c1', 'cpu', 'liste'), compat: { socket: 'AM4' } },
      { ...piece('b1', 'motherboard', 'liste'), compat: { socket: 'AM5' } }
    ])
    assert.ok(chaine.some((w) => w.key === 'compatSocketMismatch' && w.block === true), 'conflige chaîne/chaîne non bloquant')
    const liste = checkCompatibility([
      { ...piece('c2', 'cpu', 'liste'), compat: { socket: ['AM4', 'LGA1700'] } },
      { ...piece('b2', 'motherboard', 'liste'), compat: { socket: ['AM5'] } }
    ])
    assert.ok(liste.some((w) => w.key === 'compatSocketMismatch'), 'conflit liste/liste non signalé')
    const recoupe = checkCompatibility([
      { ...piece('c3', 'cpu', 'liste'), compat: { socket: ['AM4', 'AM5'] } },
      { ...piece('b3', 'motherboard', 'liste'), compat: { socket: ['AM5'] } }
    ])
    assert.equal(recoupe.some((w) => w.key === 'compatSocketMismatch'), false, 'un socket commun doit suffire')
  })

  it('socketsMatch reste le seul prédicat, y compris sur null', () => {
    assert.equal(socketsMatch(null, 'AM5'), false)
    assert.equal(socketsMatch(undefined, undefined), false)
    assert.equal(socketsMatch([], 'AM5'), false)
    assert.equal(socketsMatch('AM5', ['AM5', 'AM4']), true)
  })
})

/* --------------------------------------------------------------------------
 * Le site qui n'est pas une fonction pure : l'alerte de socket du
 * configurateur se rend quand `socketOk` est faux — donc y compris quand le CPU
 * ne déclare aucun socket, le cas précis où `cpu.compat.socket` jetait.
 * -------------------------------------------------------------------------- */
const reactDom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const reactWindow = reactDom.window
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: BuilderPage } = await import('./BuilderPage.jsx')

describe('P2/B10 — le configurateur rend avec une fiche sans compat (montage jsdom)', () => {
  const window = reactWindow
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
        /* getter en lecture seule sur Node 22 */
      }
    }
    window.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const tr = (key, vars) => {
    let out = String(key)
    for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }

  function rend(build) {
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        React.createElement(BuilderPage, {
          t: tr,
          lang: 'fr',
          products: [...catalogue(), build.motherboard, build.cpu].filter(Boolean),
          build,
          setBuild: () => {},
          liveStock: () => 5,
          onAdd: () => {},
          onOpen: () => {},
          onGoCart: () => {},
          setToast: () => {}
        })
      )
    )
    return host
  }

  function catalogue() {
    return [
      piece('b1', 'motherboard', 'liste'),
      piece('c1', 'cpu', 'absent'),
      piece('m1', 'memory', 'liste'),
      piece('p1', 'psu', 'liste'),
      piece('k1', 'cooling', 'liste'),
      piece('s1', 'case', 'liste')
    ]
  }

  it('rend l’alerte sans support côté CPU, sans exception', () => {
    const cpu = piece('c1', 'cpu', 'absent') // aucune clé `compat`
    const board = { ...piece('b1', 'motherboard', 'liste'), compat: { socket: 'AM5' } }
    const host = rend({ cpu, motherboard: board })
    const texte = host.textContent || ''
    assert.ok(texte.includes('compatSocketShort'), `aucune alerte de socket rendue : ${texte.slice(0, 160)}`)
    assert.ok(!/\[object Object\]|undefined/.test(texte.replace(/undefined\w/g, '')), 'des étiquettes rendues brutes')
  })

  it('rend la page entière avec chaque forme de compat', () => {
    for (const forme of Object.keys(FORMES)) {
      const cpu = piece('c1', 'cpu', forme)
      const board = piece('b1', 'motherboard', forme === 'absent' ? 'liste' : forme)
      let erreur = null
      try {
        rend({ cpu, motherboard: board })
      } catch (err) {
        erreur = err
      }
      assert.equal(erreur, null, `montage en échec pour compat « ${forme} » : ${erreur && erreur.message}`)
    }
  })
})
