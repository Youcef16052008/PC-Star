// P3 — checkCompatibility retourne des objets { key, vars, block } et chaque
// clé se rend proprement (variables interpolées) en ar/fr/en.
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCompatibility, splitWarnings, PRODUCTS } from './data.js'
import { t, LANGS } from './i18n.js'

const P = (id) => PRODUCTS.find((p) => p.id === id)

// Produits synthétiques pour forcer des tiers/tdp précis (specOf lit name/id).
const cpu = (name) => ({ id: 'x-cpu', sku: '', name, short: '', category: 'cpu', compat: { socket: 'AM5' } })
const gpu = (name, psuMin = 350) => ({ id: 'x-gpu', sku: '', name, short: '', category: 'gpu', compat: { psuMin } })
const box = (name, form = 'ATX') => ({ id: 'x-case', sku: '', name, short: '', category: 'case', compat: { form } })

// Combos choisis pour déclencher un maximum de clés distinctes.
const COMBOS = [
  [P('cpu-7800x3d'), P('mb-z790')], // socket mismatch (AM5 vs LGA1700)
  [P('cpu-14900k'), P('mb-b650')], // VRM overheat (253W > 180) + socket
  [P('cpu-14700k'), P('mb-b450m')], // VRM hot (125W dans 119..140) + socket
  [P('cpu-7800x3d')], // needs board
  [P('mb-b650'), P('mag-ddr4-16')], // RAM DDR4 vs board DDR5
  [P('gpu-4070s'), P('gmx-vp600')], // PSU weak (700 > 600)
  [P('gpu-4070s')], // needs PSU
  [P('cpu-5500'), gpu('NVIDIA GeForce RTX 4080')], // gap high (5→8)
  [P('cpu-7600'), P('gpu-7800xt')], // gap one (4→6) + needs PSU
  [P('mb-a520m'), gpu('AMD Radeon RX 7900 XTX')], // entry board + tier 8
  [P('mb-a520m'), P('gpu-7800xt')], // heavy for board (tier 6)
  [P('cpu-14900k'), P('cm-212')], // cooler weak (253W > 150)
  [P('cpu-14700k')], // needs cooler (125W)
  [gpu('NVIDIA GeForce RTX 4080'), box('MSI PS15 Slim')], // case overheat (320W, air 1)
  [P('gpu-7800xt'), box('MSI PS15 Slim')], // case airflow (263W, air 1)
  [gpu('NVIDIA GeForce RTX 4080'), box('Fractal TD300 mATX', 'mATX')], // case tight (3-slot, mATX, air 1)
  [P('cpu-14900k'), gpu('NVIDIA GeForce RTX 4080')] // total load (253+320)
]

test('checkCompatibility retourne des objets { key, vars, block }', () => {
  const w = checkCompatibility(COMBOS[0])
  assert.ok(w.length > 0)
  for (const x of w) {
    assert.equal(typeof x.key, 'string')
    assert.equal(typeof x.vars, 'object')
    assert.equal(typeof x.block, 'boolean')
  }
  const { blocks, notes } = splitWarnings(w)
  assert.ok(blocks.every((b) => b.block))
  assert.ok(notes.every((n) => !n.block))
  assert.equal(blocks.length + notes.length, w.length)
})

test('chaque avertissement se rend sans variable résiduelle (ar/fr/en)', () => {
  const seen = new Set()
  for (const items of COMBOS) {
    for (const w of checkCompatibility(items)) {
      seen.add(w.key)
      for (const { id } of LANGS) {
        const s = t(id, w.key, w.vars)
        assert.notEqual(s, w.key, `${id} manquant pour ${w.key}`)
        assert.ok(!s.includes('{'), `${id} variable non interpolée dans ${w.key} → ${s}`)
      }
    }
  }
  // 17 clés déclenchées (pcieDowngrade défensive + socketShort dans le JSX).
  assert.ok(seen.size >= 15, `combos couvrent ${seen.size} clés` + ' : ' + [...seen].join(', '))
})
