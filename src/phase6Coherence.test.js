// Phase 6 — cohérence produit et interface.
//
// Quatre points du plan de remédiation :
//   · le configurateur n'offre plus de combinaisons boîtier/carte impossibles
//     (règle partagée `caseFitsBoard`, mATX disponible au catalogue) ;
//   · les noms/SKU de commandes sont CANONIQUES (catalogue serveur), le texte
//     du client n'entre plus dans les lignes persistées ;
//   · l'horodatage de commande est estampillé par le serveur ;
//   · le panneau contractuel (BASE_PANELS + extraPanels) reste validé côté API.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { caseFitsBoard, PRODUCTS } from '../src/data.js'
import { CATALOG_EXTENSIONS } from '../src/catalogExtensions.js'
import { placeOrder, productRefOf } from '../server/catalog.js'

function fakeDb() {
  return { users: [], orders: [], stock: {}, meta: { extraProducts: [], hiddenProductIds: [] } }
}

describe('Phase 6 — configurateur : plus de combinaisons boîtier impossibles', () => {
  const mATX_BOARD = { id: 'mb-matx', compat: { socket: 'AM4', form: 'mATX' } }
  const ATX_BOARD = { id: 'mb-atx', compat: { socket: 'AM5', form: 'ATX' } }
  const FREE_BOARD = { id: 'mb-free', compat: {} }
  const ATX_CASE = { id: 'case-atx', compat: { form: 'ATX' } }
  const mATX_CASE = { id: 'case-matx', compat: { form: 'mATX' } }
  const UNDECLARED_CASE = { id: 'case-any', compat: {} }

  it('caseFitsBoard : une carte mATX tient dans tous les boîtiers', () => {
    assert.equal(caseFitsBoard(ATX_CASE, mATX_BOARD), true)
    assert.equal(caseFitsBoard(mATX_CASE, mATX_BOARD), true)
    assert.equal(caseFitsBoard(UNDECLARED_CASE, mATX_BOARD), true)
  })

  it('caseFitsBoard : une carte ATX exige un boîtier ATX', () => {
    assert.equal(caseFitsBoard(ATX_CASE, ATX_BOARD), true)
    assert.equal(caseFitsBoard(mATX_CASE, ATX_BOARD), false, 'un boîtier mATX ne prend pas une carte ATX')
    assert.equal(caseFitsBoard(UNDECLARED_CASE, ATX_BOARD), false, 'pas de promesse sans format déclaré')
  })

  it('caseFitsBoard : sans contrainte de carte, tout boîtier reste proposé', () => {
    assert.equal(caseFitsBoard(ATX_CASE, FREE_BOARD), true)
    assert.equal(caseFitsBoard(mATX_CASE, null), true)
  })

  it('le catalogue vend bien du mATX (carte mère et boîtiers) pour exercer la règle', () => {
    const catalog = [...PRODUCTS, ...CATALOG_EXTENSIONS]
    const mATXBoards = catalog.filter((p) => p.category === 'motherboard' && p.compat?.form === 'mATX')
    const mATXCases = catalog.filter((p) => p.category === 'case' && p.compat?.form === 'mATX')
    assert.ok(mATXBoards.length >= 1, 'au moins une carte mère mATX en vente')
    assert.ok(mATXCases.length >= 2, 'au moins deux boîtiers mATX en vente')
    // Chaque carte ATX du catalogue garde au moins un boîtier compatible :
    // le filtre ne doit jamais vider le rayon.
    const atxBoards = catalog.filter((p) => p.category === 'motherboard' && p.compat?.form === 'ATX')
    for (const board of atxBoards) {
      assert.ok(
        catalog.some((p) => p.category === 'case' && caseFitsBoard(p, board)),
        `aucun boîtier pour ${board.id}`
      )
    }
  })
})

describe('Phase 6 — commandes : SKU et libellés canoniques, date serveur', () => {
  const KNOWN = PRODUCTS.find((p) => Number(p.stock) > 0)

  it('le panier ne peut pas injecter son propre nom/SKU dans une commande', () => {
    const db = fakeDb()
    const r = placeOrder(db, {
      name: 'Client',
      phone: '0550000000',
      items: [{ id: KNOWN.id, sku: '<script>alert(1)</script>', name: 'Produit fantôme du client', qty: 1 }]
    })
    assert.equal(r.ok, true, JSON.stringify(r))
    const line = r.order.items[0]
    assert.equal(line.id, KNOWN.id)
    assert.equal(line.sku, KNOWN.sku, 'SKU imposé par le catalogue serveur')
    assert.equal(line.name, KNOWN.name, 'libellé imposé par le catalogue serveur')
    assert.notEqual(line.name, 'Produit fantôme du client')
  })

  it('l’override maître prime pour le libellé, comme pour le prix', () => {
    const db = fakeDb()
    db.meta.productOverrides = {
      [KNOWN.id]: { name: 'Référence renommée par le comptoir', sku: 'DESK-REF', price: KNOWN.price + 100 }
    }
    assert.deepEqual(productRefOf(db, KNOWN.id), { sku: 'DESK-REF', name: 'Référence renommée par le comptoir' })
    const r = placeOrder(db, {
      name: 'Client',
      items: [{ id: KNOWN.id, qty: 1 }]
    })
    assert.equal(r.ok, true)
    assert.equal(r.order.items[0].name, 'Référence renommée par le comptoir')
    assert.equal(r.order.items[0].price, KNOWN.price + 100)
  })

  it('les messages de refus d’un id inconnu gardent le texte du client (aucune fuite)', () => {
    const db = fakeDb()
    const r = placeOrder(db, {
      name: 'Client',
      items: [{ id: 'introuvable', name: 'Demande spéciale', qty: 1 }]
    })
    assert.equal(r.ok, false)
    assert.equal(r.error, 'unknown_product')
    assert.deepEqual(r.unknown, [{ id: 'introuvable', name: 'Demande spéciale' }])
  })

  it('l’horodatage de commande est posé par le serveur (ISO)', () => {
    const db = fakeDb()
    const r = placeOrder(db, { name: 'Client', items: [{ id: KNOWN.id, qty: 1 }] })
    assert.equal(r.ok, true)
    assert.match(r.order.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    assert.match(r.order.day, /^\d{4}-\d{2}-\d{2}$/)
  })
})
