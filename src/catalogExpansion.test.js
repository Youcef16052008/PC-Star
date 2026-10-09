import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { CATALOG_SKU_VIEWS } from './catalogSkuViews.js'
import { CATALOG_EXTENSIONS } from './catalogExtensions.js'
import { photosForProduct } from './productPhotos.js'
import { CATEGORIES, PART_LINES, PRODUCTS, conditionOf, usesOf } from './data.js'

/**
 * Les nouveaux rayons sont des données métier, pas seulement des boutons.
 * Ces contrôles empêchent qu'un futur nettoyage de catalogue laisse une
 * catégorie visible sans référence, ou fasse disparaître l'occasion/POS de la
 * recherche.
 */
test('catalogue étendu : tous les rayons prioritaires ont des références navigables', () => {
  const priorityCategories = [
    'printer', 'scanner', 'pos', 'consumables',
    'desktop', 'allinone', 'tablet', 'server',
    'network', 'power', 'laptop_accessories',
    'multimedia', 'furniture', 'phone', 'monitor'
  ]

  assert.ok(CATALOG_EXTENSIONS.length >= 60, 'le catalogue élargi contient une sélection exploitable')
  assert.equal(new Set(CATALOG_EXTENSIONS.map((p) => p.id)).size, CATALOG_EXTENSIONS.length, 'ids de références uniques')
  assert.equal(new Set(CATALOG_EXTENSIONS.map((p) => p.sku)).size, CATALOG_EXTENSIONS.length, 'SKU de références uniques')

  for (const category of priorityCategories) {
    assert.ok(CATEGORIES.some((c) => c.id === category), `${category} est proposé au filtre boutique`)
    assert.ok(PRODUCTS.some((p) => p.category === category), `${category} a au moins une référence`)
    assert.ok(PART_LINES.filter((line) => line.id !== 'all').some((line) => PRODUCTS.some((p) => line.match(p) && p.category === category)), `${category} est joignable depuis la recherche`)
  }
})

test('catalogue étendu : occasion et usages sont des métadonnées filtrables', () => {
  const all = PART_LINES.find((line) => line.id === 'all')
  const laptopUsed = PART_LINES.find((line) => line.id === 'laptop_used')
  const pcUsed = PART_LINES.find((line) => line.id === 'pc_used')
  const printer = PART_LINES.find((line) => line.id === 'printer_laser')
  const pos = PART_LINES.find((line) => line.id === 'pos')

  assert.ok(all && PRODUCTS.every((product) => all.match(product)), 'le point d’entrée affiche tout le catalogue')
  assert.ok(PRODUCTS.some((product) => conditionOf(product) === 'used'), 'des articles occasion sont identifiés')
  assert.ok(PRODUCTS.some((product) => conditionOf(product) === 'refurbished'), 'des articles reconditionnés sont identifiés')
  assert.ok(PRODUCTS.some((product) => usesOf(product).includes('retail')), 'les produits commerce/POS sont identifiés')
  assert.ok(PRODUCTS.some(laptopUsed.match), 'un raccourci laptop occasion retourne des produits')
  assert.ok(PRODUCTS.some(pcUsed.match), 'un raccourci PC occasion retourne des produits')
  assert.ok(PRODUCTS.some(printer.match), 'un raccourci imprimante laser retourne des produits')
  assert.ok(PRODUCTS.some(pos.match), 'un raccourci POS retourne des produits')
})

test('P29 : packshot en tête et vues réelles livrées, sans chemin inventé', () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
  const ids = new Set(CATALOG_EXTENSIONS.map((p) => p.id))
  for (const id of Object.keys(CATALOG_SKU_VIEWS)) assert.ok(ids.has(id), `${id} : entrée de manifeste orpheline`)
  for (const product of CATALOG_EXTENSIONS) {
    const pack = `/photos/pack/${product.id}.jpg`
    const actualViews = [1, 2, 3].filter((n) => fs.existsSync(path.join(publicDir, `photos/sku/${product.id}-${n}.jpg`)))
    assert.deepEqual(CATALOG_SKU_VIEWS[product.id] || [], actualViews, `${product.id} : une vue livrée est oubliée, ou une vue absente est déclarée`)
    const expected = [pack, ...actualViews.map((n) => `/photos/sku/${product.id}-${n}.jpg`)]
    assert.equal(product.photoMode, 'packshot')
    assert.deepEqual(product.photos, expected, `${product.id} : conserver les deux sources, dans cet ordre`)
    assert.deepEqual(photosForProduct(product), expected, `${product.id} : le normaliseur ne doit pas modifier la galerie`)
    assert.equal(new Set(expected).size, expected.length)
    for (const src of expected) {
      assert.ok(fs.existsSync(path.join(publicDir, src)), `JPG absent : ${src}`)
      assert.ok(fs.existsSync(path.join(publicDir, src.replace(/\.jpg$/, '.webp'))), `WebP absent : ${src}`)
    }
  }
})

test('P29 : les quatre écrans sans trio gardent uniquement leur packshot', () => {
  for (const id of ['mon-samsung-g3-24', 'mon-lg-27-qhd', 'mon-dell-p2723de', 'mon-samsung-s6-32']) {
    const p = CATALOG_EXTENSIONS.find((p) => p.id === id)
    assert.ok(p)
    assert.deepEqual(p.photos, [`/photos/pack/${id}.jpg`])
    assert.equal(CATALOG_SKU_VIEWS[id], undefined)
  }
})

test('P29 : photos:wire --check est en lecture seule et le manifeste est à jour', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const files = ['src/catalogExtensions.js', 'src/catalogSkuViews.js']
  const before = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  const output = execFileSync(process.execPath, ['scripts/wirePackshots.mjs', '--check'], { cwd: root, encoding: 'utf8' })
  assert.match(output, /"cables":0/)
  assert.deepEqual(files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')), before)
})
