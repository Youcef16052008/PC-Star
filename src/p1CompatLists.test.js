/**
 * LOT P1 (audit 19/09/2026, B11) — compatibilité multi-valeurs.
 *
 * `normalizeProductCompat` ne connaissait que la CHAÎNE unique :
 * `{ socket: ['AM5', 'LGA1700'] }` renvoyait `null`, donc `sanitizeProductPatch`
 * répondait `error: 'compat'` et le produit n'était pas enregistré. Or le format
 * liste est déjà la norme ailleurs : les ventirads du catalogue portent
 * `compat.socket` en tableau, `socketsMatch()` sait les comparer, la recherche
 * (`SearchPage`) et le configurateur les filtrent. Conséquences mesurées :
 *  · un ventirad édité depuis le panneau maître perdait ses supports ;
 *  · un CPU double socket (AM5 et LGA1700) était impossible à saisir ;
 *  · un `compat.memory` de carte mère en liste aurait fait refuser une barrette
 *    pourtant compatible (comparaison `===`).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import {
  COMPAT_FORMS,
  COMPAT_SOCKETS,
  compatIntersects,
  compatLabel,
  compatValues,
  normalizeProductCompat
} from './productMeta.js'
import { PRODUCTS } from './data.js'
import { caseFitsBoard, checkCompatibility, socketsMatch, specOf } from './data.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-compat-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.TRUST_PROXY
delete process.env.VERCEL

const { handler } = await import('../server/index.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

let server
let base
let masterToken = ''

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD })
  })
  masterToken = (await res.json()).token
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

async function call(method, pathname, { body, token = null } = {}) {
  __rateLimitInternals.buckets.clear()
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

describe('P1/B11 — normalisation : chaîne, liste ou séparation par virgules', () => {
  it('accepte une liste de sockets et la garde en liste', () => {
    assert.deepEqual(normalizeProductCompat({ socket: ['AM5', 'LGA1700'] }), { socket: ['AM5', 'LGA1700'] })
  })

  it('une valeur unique reste une chaîne (format historique du catalogue)', () => {
    assert.deepEqual(normalizeProductCompat({ socket: 'AM5' }), { socket: 'AM5' })
    assert.deepEqual(normalizeProductCompat({ socket: ['AM5'] }), { socket: 'AM5' })
    assert.deepEqual(normalizeProductCompat({ socket: 'AM5, AM5' }), { socket: 'AM5' })
  })

  it('accepte une chaîne séparée par des virgules', () => {
    assert.deepEqual(normalizeProductCompat({ socket: 'AM4,AM5 , LGA1700' }), {
      socket: ['AM4', 'AM5', 'LGA1700']
    })
  })

  it('range dans l’ordre de la liste de référence et casse la casse indifféremment', () => {
    assert.deepEqual(normalizeProductCompat({ socket: ['LGA1700', 'am4'] }), { socket: ['AM4', 'LGA1700'] })
    assert.deepEqual(normalizeProductCompat({ form: ['mini-itx', 'atx'] }), { form: ['ATX', 'Mini-ITX'] })
    assert.deepEqual(normalizeProductCompat({ memory: ['ddr5', 'DDR4'] }), { memory: ['DDR4', 'DDR5'] })
  })

  it('refuse dès qu’un terme est inconnu', () => {
    assert.equal(normalizeProductCompat({ socket: 'TR4' }), null)
    assert.equal(normalizeProductCompat({ socket: ['AM5', 'TR4'] }), null)
    assert.equal(normalizeProductCompat({ memory: ['DDR6'] }), null)
  })

  it('les champs numériques restent inchangés', () => {
    assert.deepEqual(normalizeProductCompat({ socket: ['AM4', 'AM5'], psuWatts: 850 }), {
      socket: ['AM4', 'AM5'],
      psuWatts: 850
    })
    assert.equal(normalizeProductCompat({ psuWatts: 90 }), null)
  })

  it('compatValues / compatLabel / compatIntersects', () => {
    assert.deepEqual(compatValues(['AM4', ' AM4 ', '', 'AM5']), ['AM4', 'AM5'])
    assert.deepEqual(compatValues('AM4, AM5'), ['AM4', 'AM5'])
    assert.deepEqual(compatValues(null), [])
    assert.equal(compatLabel(['AM4', 'AM5']), 'AM4 · AM5')
    assert.equal(compatLabel('AM5', '/'), 'AM5')
    assert.equal(compatLabel(['AM4', 'AM5'], '/'), 'AM4/AM5')
    assert.equal(compatIntersects('AM5', ['AM5', 'LGA1700']), true)
    assert.equal(compatIntersects(['DDR4'], ['DDR5']), false)
    assert.equal(compatIntersects(undefined, 'AM5'), false, 'un côté non déclaré n’est pas un recoupement')
  })
})

describe('P1/B11 — le configurateur et la cohérence suivent les listes', () => {
  it('socketsMatch et caseFitsBoard tolèrent les listes', () => {
    assert.equal(socketsMatch(['AM5', 'LGA1700'], 'LGA1700'), true)
    assert.equal(socketsMatch('TR4', ['AM5']), false)
    assert.equal(caseFitsBoard({ compat: { form: 'ATX' } }, { compat: { form: ['ATX', 'mATX'] } }), true)
    assert.equal(caseFitsBoard({ compat: { form: ['Mini-ITX', 'mATX'] } }, { compat: { form: 'mATX' } }), true)
    assert.equal(caseFitsBoard({ compat: { form: ['Mini-ITX'] } }, { compat: { form: 'ATX' } }), false)
    assert.equal(caseFitsBoard({ compat: {} }, { compat: { form: 'ATX' } }), false, 'boîtier sans format déclaré')
  })

  it('une carte mère double génération de mémoire n’exclut pas la barrette compatible', () => {
    const ram = { name: 'Barrette', category: 'memory', compat: { memory: 'DDR5' } }
    const ok = checkCompatibility([
      { name: 'Carte dual-gen', category: 'motherboard', compat: { memory: ['DDR4', 'DDR5'], form: 'ATX' } },
      ram
    ])
    assert.equal(ok.filter((w) => w.key === 'compatRamMismatch').length, 0)
    const bad = checkCompatibility([{ name: 'Carte DDR4', category: 'motherboard', compat: { memory: 'DDR4' } }, ram])
    assert.ok(bad.some((w) => w.key === 'compatRamMismatch'), 'vraie incompatibilité toujours signalée')
    assert.match(bad.find((w) => w.key === 'compatRamMismatch').vars.ramMem, /DDR5/)
  })

  it('un CPU double socket ne casse plus le couple carte mère / ventirad', () => {
    const warnings = checkCompatibility([
      { name: 'CPU double socket', category: 'cpu', compat: { socket: ['AM5', 'LGA1700'] } },
      { name: 'Carte AM5', category: 'motherboard', compat: { socket: 'AM5' } }
    ])
    assert.equal(warnings.filter((w) => w.key === 'compatSocketMismatch').length, 0)
    const labelled = checkCompatibility([
      { name: 'CPU', category: 'cpu', compat: { socket: ['AM5', 'LGA1700'] } },
      { name: 'Carte', category: 'motherboard', compat: { socket: ['TR4'] } }
    ]).find((w) => w.key === 'compatSocketMismatch')
    assert.equal(labelled.vars.cpuSocket, 'AM5 · LGA1700', 'la liste est nommée, pas [object Object]')
  })

  it('un ventirad à support unique est reconnu comme ventirad', () => {
    // La détection du ventirad ne doit plus dépendre du TYPE de la donnée :
    // même fiche, supports en liste ou supports en chaîne — même verdict.
    const hotCpu = PRODUCTS.find((p) => p.category === 'cpu' && specOf(p).tdp >= 125)
    assert.ok(hotCpu, 'le catalogue contient un CPU qui exige un ventirad dédié')
    const cooler = PRODUCTS.find((p) => p.id === 'cooler')
    assert.ok(Array.isArray(cooler.compat.socket) && cooler.compat.socket.length > 1, 'fiche de référence en liste')
    const asList = checkCompatibility([hotCpu, cooler])
    const asString = checkCompatibility([hotCpu, { ...cooler, compat: { ...cooler.compat, socket: cooler.compat.socket[0] } }])
    assert.equal(asString.filter((w) => w.key === 'compatNeedsCooler').length, 0, 'un support unique reste un ventirad')
    assert.deepEqual(
      asString.map((w) => w.key).sort(),
      asList.map((w) => w.key).sort(),
      'le même matériel doit produire le même verdict quel que soit le format'
    )
  })
})

describe('P1/B11 — le panneau maître peut enregistrer et relire une liste', () => {
  it('PUT /api/master/products/:id accepte un tableau de sockets', async () => {
    // `cooler` est un produit du catalogue de base dont la fiche EST déjà en
    // liste : avant le correctif, le simple fait de la ré-enregistrer échouait.
    const r = await call('PUT', '/api/master/products/cooler', {
      token: masterToken,
      body: { compat: { socket: ['AM4', 'AM5', 'LGA1700'] } }
    })
    assert.equal(r.status, 200, `fiche en liste refusée : ${JSON.stringify(r.data)}`)
    assert.deepEqual(r.data.product.compat.socket, ['AM4', 'AM5', 'LGA1700'])

    const relue = await call('GET', '/api/master/products', { token: masterToken })
    const found = (relue.data.products || []).find((p) => p.id === 'cooler')
    assert.deepEqual(found.compat.socket, ['AM4', 'AM5', 'LGA1700'])
  })

  it('une chaîne séparée par virgules passe par la même porte', async () => {
    const r = await call('PUT', '/api/master/products/cpu-7800x3d', {
      token: masterToken,
      body: { compat: { socket: 'AM5, LGA1700' } }
    })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.deepEqual(r.data.product.compat.socket, ['AM5', 'LGA1700'])
  })

  it('une valeur inconnue reste refusée (400 compat)', async () => {
    const r = await call('PUT', '/api/master/products/cooler', {
      token: masterToken,
      body: { compat: { socket: ['AM5', 'TR4'] } }
    })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'compat')
  })

  it('un produit créé par le maître conserve la liste à la création', async () => {
    const created = await call('POST', '/api/master/products', {
      token: masterToken,
      body: {
        name: 'Ventirad double support',
        price: 8900,
        stock: 4,
        category: 'cooling',
        compat: { socket: ['AM4', 'AM5'] }
      }
    })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    assert.deepEqual(created.data.product.compat.socket, ['AM4', 'AM5'])
  })

  it('le formulaire maitre présente des cases à cocher, plus une liste déroulante unique', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'MasterPage.jsx'), 'utf8')
    for (const field of ['socket', 'memory', 'form']) {
      assert.match(src, new RegExp(`CompatPicker id="master-compat-${field}"`), `${field} doit être multi-choix`)
      assert.doesNotMatch(
        src,
        new RegExp(`<select[^>]*value=\\{form\\.compat\\.${field}\\}`),
        `${field} n’est plus un <select> à valeur unique`
      )
    }
    assert.match(src, /function toggleCompat\(/)
    assert.match(src, /type="checkbox"/)
  })

  it('les champs de compatibilité sont lus en listes côté vitrine', () => {
    const fiche = fs.readFileSync(path.join(process.cwd(), 'src', 'ProductPage.jsx'), 'utf8')
    assert.match(fiche, /compatLabel\(c\.socket/, 'la fiche rend la liste, pas une chaîne supposée')
    const builder = fs.readFileSync(path.join(process.cwd(), 'src', 'BuilderPage.jsx'), 'utf8')
    assert.match(builder, /compatIntersects\(p\.compat\?\.memory, board\.compat\.memory\)/)
    assert.doesNotMatch(builder, /p\.compat\?\.memory === board\.compat\.memory/)
  })
})

/**
 * Rendu RÉEL de la fiche produit — test écrit parce que le premier correctif de
 * cette grappe cassait la page : `compatLabel` était utilisé dans
 * `ProductPage.jsx` sans être importé (le fichier importait déjà
 * `productMeta.js` pour deux autres fonctions). `ReferenceError` levée au
 * rendu, invisible à `node --check` comme à `esbuild --bundle=false` (syntaxe
 * seule) ; le crawl de la CI, lui, ne voyait plus le marqueur `.pdp-zoom`.
 * Un montage réel est le seul test qui parle.
 */
const reactDom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const reactWindow = reactDom.window
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ProductPage } = await import('./ProductPage.jsx')

describe('P1/B11 — la fiche produit rend les listes (montage jsdom)', () => {
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
  })

  const tr = (key, vars) => {
    let out = String(key)
    for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }

  function renderProduct(product) {
    const host = window.document.createElement('div')
    window.document.getElementById('root').appendChild(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        React.createElement(ProductPage, {
          t: tr,
          lang: 'fr',
          product,
          photoIndex: 0,
          setPhotoIndex: () => {},
          left: 3,
          onBack: () => {},
          onAdd: () => {},
          onOpen: () => {},
          liveStock: () => 3,
          onAddRelated: () => {},
          catalog: PRODUCTS
        })
      )
    )
    return host
  }

  it('rend « AM4/AM5 » quand la fiche déclare plusieurs supports', () => {
    const base = PRODUCTS.find((p) => p.category === 'cooling') || PRODUCTS[0]
    const host = renderProduct({ ...base, compat: { socket: ['AM4', 'AM5'], memory: 'DDR5', psuWatts: 750 } })
    const texte = host.textContent || ''
    assert.ok(texte.includes('AM4/AM5'), `liste de sockets absente du rendu : ${texte.slice(0, 200)}`)
    assert.ok(!texte.includes('[object Object]'), 'aucun objet rendu brut')
  })

  it('rend une fiche à support unique comme avant', () => {
    const base = PRODUCTS.find((p) => p.category === 'cpu') || PRODUCTS[0]
    const host = renderProduct({ ...base, compat: { socket: 'AM5', memory: ['DDR4', 'DDR5'] } })
    const texte = host.textContent || ''
    assert.ok(texte.includes('AM5'), 'support unique conservé')
    assert.ok(texte.includes('DDR4/DDR5'), `générations multiples absentes : ${texte.slice(0, 200)}`)
  })
})
