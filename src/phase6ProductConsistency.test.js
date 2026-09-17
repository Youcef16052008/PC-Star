import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BASE_PANELS, checkCompatibility, splitWarnings } from './data.js'
import { caseFitsMotherboard } from './productMeta.js'
import { normalizeCustomPanel, normalizeCustomPanels, normalizeHiddenPanelIds } from './panelContract.js'
import { buildShopView } from './shopStore.js'
import { placeOrder, productForOrder, serverDay } from '../server/catalog.js'
import { normalizeDb } from '../server/db.js'
import { LANGS, t } from './i18n.js'

describe('Phase 6 — cohérence produit et interface', () => {
  it('applique la compatibilité directionnelle carte mère → boîtier', () => {
    assert.equal(caseFitsMotherboard('ATX', 'ATX'), true)
    assert.equal(caseFitsMotherboard('ATX', 'mATX'), true)
    assert.equal(caseFitsMotherboard('mATX', 'Mini-ITX'), true)
    assert.equal(caseFitsMotherboard('mATX', 'ATX'), false)
    assert.equal(caseFitsMotherboard('Mini-ITX', 'mATX'), false)

    const board = { id: 'board', name: 'Carte mATX', category: 'motherboard', compat: { form: 'mATX' } }
    const tinyCase = { id: 'case', name: 'Boîtier Mini-ITX', category: 'case', compat: { form: 'Mini-ITX' } }
    const warnings = splitWarnings(checkCompatibility([board, tinyCase])).blocks
    const mismatch = warnings.find((warning) => warning.key === 'compatCaseFormMismatch')
    assert.ok(mismatch, JSON.stringify(warnings))
    for (const { id: language } of LANGS) {
      const rendered = t(language, mismatch.key, mismatch.vars)
      assert.notEqual(rendered, mismatch.key)
      assert.equal(rendered.includes('{'), false)
    }
  })

  it('canonise le SKU, le nom et le jour d’une commande depuis le serveur', () => {
    const id = 'ssd-1t'
    const db = {
      orders: [],
      stock: { [id]: 2 },
      meta: { productOverrides: { [id]: { sku: 'CANON-SSD', name: 'SSD canonique', price: 12345 } } }
    }
    assert.equal(productForOrder(db, id).name, 'SSD canonique')
    const today = serverDay()
    const result = placeOrder(
      db,
      {
        name: 'Client',
        phone: '0550123456',
        day: '2099-12-31',
        items: [{ id, sku: 'FORGED-SKU', name: 'Produit inventé', qty: 1, price: 1 }]
      }
    )
    assert.equal(result.ok, true)
    assert.deepEqual(result.order.items, [{ id, sku: 'CANON-SSD', name: 'SSD canonique', qty: 1, price: 12345 }])
    assert.equal(result.order.day, today)
    assert.equal(result.order.code.startsWith(`PS-${today.replaceAll('-', '')}-`), true)
  })

  it('n’accepte que des panneaux personnalisés représentables par toutes les vues', () => {
    const panel = normalizeCustomPanel({
      id: 'panel-gaming',
      titles: { ar: 'ألعاب', fr: 'Gaming', en: 'Gaming' },
      categories: ['gpu', 'case']
    })
    assert.deepEqual(panel?.categories, ['gpu', 'case'])
    assert.equal(normalizeCustomPanel({ ...panel, categories: ['not-a-category'] }), null)
    assert.equal(normalizeCustomPanel({ ...panel, id: 'catalog' }), null)
    assert.equal(normalizeCustomPanel({ ...panel, categories: ['gpu', 'gpu'] }), null)
    assert.equal(normalizeCustomPanels(Array.from({ length: 13 }, (_, index) => ({ ...panel, id: `panel-${index}` }))), null)
    assert.deepEqual(normalizeHiddenPanelIds(['parts', 'parts'], BASE_PANELS), ['parts'])
    assert.equal(normalizeHiddenPanelIds(['not-real'], BASE_PANELS), null)

    const view = buildShopView(
      [{ id: 'gpu-1', name: 'GPU', category: 'gpu' }],
      [{ id: 'gpu', group: 'parts', match: () => true }],
      [{ id: 'parts', titleKey: 'panelParts' }],
      {
        extraProducts: [],
        hiddenProductIds: [],
        hiddenPanelIds: ['unknown'],
        // État hérité/corrompu : la vitrine l'ignore au lieu de créer un filtre
        // qui ne peut jamais être servi par le backend.
        extraPanels: [{ ...panel, categories: ['not-a-category'] }]
      }
    )
    assert.equal(view.panels.length, 1)
    assert.equal(view.lines.length, 1)
  })

  it('migre les métadonnées et libellés historiques sans effacer les panneaux encore valides', () => {
    const valid = {
      id: 'panel-valid',
      titles: { ar: 'صالح', fr: 'Valide', en: 'Valid' },
      categories: ['gpu']
    }
    const db = {
      users: [],
      orders: [{ code: 'OLD-1', userId: null, items: [{ id: 'ssd-1t', sku: 'forged', name: 'forged name', price: 1, qty: 1 }] }],
      stock: {},
      sessions: {},
      oauthPending: {},
      meta: {
        extraProducts: [],
        hiddenProductIds: [],
        hiddenPanelIds: ['parts', 'unknown'],
        extraPanels: [valid, { ...valid, id: 'bad id', categories: ['ghost'] }]
      }
    }
    assert.equal(normalizeDb(db), true)
    assert.deepEqual(db.meta.hiddenPanelIds, ['parts'])
    assert.deepEqual(db.meta.extraPanels.map((panel) => panel.id), ['panel-valid'])
    const catalog = productForOrder(db, 'ssd-1t')
    assert.equal(db.orders[0].items[0].sku, catalog.sku)
    assert.equal(db.orders[0].items[0].name, catalog.name)
    assert.equal(db.orders[0].items[0].price, 1, 'le prix historique n’est pas réécrit')
  })
})
