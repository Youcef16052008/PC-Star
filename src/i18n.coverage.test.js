// P3 — Couverture i18n : toute clé appelée par t('...') (statique ou dynamique
// tag_*/line_*/cat_*) doit exister en ar, fr et en.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict, LANGS } from './i18n.js'
import { CATEGORIES, PART_LINES, PRODUCTS } from './data.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(SRC)
  .filter((f) => (f.endsWith('.js') || f.endsWith('.jsx')) && !f.endsWith('.test.js') && f !== 'i18n.js')

const staticKeys = new Set()
const tagPrefix = new Set()
const tagValues = new Set()

for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8')
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*'([^']+)'/g)) staticKeys.add(m[1])
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([^"]+)"/g)) staticKeys.add(m[1])
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*`((?:tag|line|cat)_)\$\{/g)) tagPrefix.add(m[1])
  for (const m of src.matchAll(/tags:\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/['"]([^'"]+)['"]/g)) tagValues.add(v[1])
  }
}

const dynamicKeys = new Set()
for (const p of tagPrefix) {
  if (p === 'tag_') tagValues.forEach((v) => dynamicKeys.add(`tag_${v}`))
  if (p === 'line_') PART_LINES.forEach((l) => dynamicKeys.add(`line_${l.id}`))
  if (p === 'cat_') CATEGORIES.forEach((c) => dynamicKeys.add(`cat_${c.id}`))
}

// Les ids de tags utilisés par le code (d.badge, p.tags) — garde-fou supplémentaire.
PRODUCTS.forEach((p) => (p.tags || []).forEach((v) => tagValues.add(v)))

const allKeys = new Set([...staticKeys, ...dynamicKeys])

test(`i18n: ${allKeys.size} clés statiques + dynamiques toutes présentes en ar/fr/en`, () => {
  const missing = []
  for (const key of allKeys) {
    for (const { id } of LANGS) {
      const v = dict[id]?.[key]
      if (typeof v !== 'string' || !v.trim()) missing.push(`${id}:${key}`)
    }
  }
  assert.equal(missing.length, 0, 'clés manquantes → ' + missing.join(', '))
})

test('i18n: les 3 langues ont le même nombre de clés (pas de bloc déséquilibré)', () => {
  const counts = LANGS.map((l) => Object.keys(dict[l.id]).length)
  assert.equal(new Set(counts).size, 1, `compte inégal: ${LANGS.map((l, i) => `${l.id}=${counts[i]}`).join(' ')}`)
})
