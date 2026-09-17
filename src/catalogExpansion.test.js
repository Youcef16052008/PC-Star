import test from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG_EXTENSIONS } from './catalogExtensions.js'
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
    'multimedia', 'furniture', 'phone'
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
