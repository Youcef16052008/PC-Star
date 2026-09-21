import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('catalogue étendu : chaque référence a son illustration de rayon, ou sa photo livrée', () => {
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
  const groups = new Set()
  let packshots = 0
  for (const product of CATALOG_EXTENSIONS) {
    assert.equal(product.photos.length, 1, `${product.id} garde un seul visuel — pas de trio fantôme`)
    const src = product.photos[0]
    // P27 : deux formes honnêtes, et rien d'autre. Soit la référence a reçu sa
    // propre photo studio (`/photos/pack/<id>.jpg`, générée pour le rayon), soit
    // elle garde l'illustration de famille et le dit (`photoMode: 'category'`).
    if (product.photoMode === 'packshot') {
      packshots++
      assert.match(src, /^\/photos\/pack\/[a-z0-9-]+\.jpg$/, `${product.id} : chemin de packshot inattendu (${src})`)
      assert.deepEqual(photosForProduct(product), [src], `${product.id} ne déclenche pas les variantes /photos/sku`)
      const file = src.slice(1) // '/photos/pack/<id>.jpg' → 'photos/pack/<id>.jpg'
      assert.ok(fs.existsSync(path.join(publicDir, file)), `photo livrée absente : ${src}`)
      // Le webp est sondé en premier par `photoCandidates` : sans lui, chaque
      // vignette ferait un 404 avant de retomber sur le jpg.
      assert.ok(fs.existsSync(path.join(publicDir, file.replace(/\.jpg$/, '.webp'))), `webp absent pour ${src}`)
      continue
    }
    assert.equal(product.photoMode, 'category', `${product.id} déclare une illustration de catégorie`)
    assert.match(src, /^\/catalog\/[a-z-]+\.jpg$/, `${product.id} ne demande pas un faux chemin SKU`)
    assert.deepEqual(photosForProduct(product), [src], `${product.id} ne déclenche pas les variantes /photos/sku`)
    groups.add(src.slice('/catalog/'.length))
  }
  for (const file of groups) {
    assert.ok(fs.existsSync(path.join(publicDir, 'catalog', file)), `visuel généré livré : ${file}`)
  }
  assert.ok(packshots >= 2, `les référence qui ont reçu leur photo la déclarent (${packshots} aujourd'hui)`)
})
