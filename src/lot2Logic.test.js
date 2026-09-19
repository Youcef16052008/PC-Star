import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  makeOrderCode,
  placeOrder,
  deleteOrder,
  cancelOrder,
  liveStockOf
} from '../server/catalog.js'
import {
  createProduct,
  listMasterProducts,
  normalizeNeeds,
  MAX_NEED_LINE,
  sanitizeProductPatch,
  updateProduct
} from '../server/masterApi.js'
import { mergeServerOrders, nextLocalOrderCode, nextOrderCode } from './orderLogic.js'
import { PRODUCTS } from './data.js'

// ---------------------------------------------------------------------------
// LOT 2 — bloquants fonctionnels, partie LOGIQUE PURE (sans DOM).
// La partie UI (panier, logout, page Master, panneaux, page Commandes) est dans
// src/lot2UI.test.js.
//
//  2.2 (F3 + F4)  codes de commande en collision après suppression
//  2.3 (F5)       commandes locales-only effacées par le premier merge réussi
//  2.6 (F10)      `needs` : chaîne à la création, tableau exigé au patch
// ---------------------------------------------------------------------------

function emptyDb() {
  return {
    users: [],
    orders: [],
    stock: {},
    sessions: {},
    oauthPending: {},
    meta: {
      demoSeeded: true,
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: {}
    }
  }
}

const DAY = '2026-09-15'

function place(db, over = {}) {
  return placeOrder(db, {
    name: 'Client Test',
    phone: '0550123456',
    wilaya: 'Oran',
    slot: '12:30',
    day: DAY,
    items: [{ id: 'mousepad', sku: 'G640', name: 'Pad', qty: 1 }],
    ...over
  })
}

describe('LOT 2.2 (F3 + F4) — code de commande : séquence par MAX, algorithme partagé', () => {
  it('créer 3 commandes, supprimer la 2ᵉ, en créer une 4ᵉ → aucun doublon', () => {
    const db = emptyDb()
    const codes = []
    for (let i = 0; i < 3; i += 1) {
      const r = place(db)
      assert.equal(r.ok, true, JSON.stringify(r))
      codes.push(r.order.code)
    }
    assert.deepEqual(codes, [
      `PS-${DAY.replace(/-/g, '')}-0001`,
      `PS-${DAY.replace(/-/g, '')}-0002`,
      `PS-${DAY.replace(/-/g, '')}-0003`
    ])

    const del = deleteOrder(db, codes[1])
    assert.equal(del.ok, true)

    // AVANT : `sameDay.length + 1` = 2 + 1 = 0003 — déjà attribué. Deux
    // `PS-20260915-0003` ont été observés en base pendant l'audit.
    const fourth = place(db)
    assert.equal(fourth.ok, true)
    assert.equal(fourth.order.code, `PS-${DAY.replace(/-/g, '')}-0004`, 'le trou ne doit pas être rebouché')

    const all = db.orders.map((o) => o.code)
    assert.equal(new Set(all).size, all.length, `doublon de code : ${all.join(', ')}`)
  })

  it('une commande ANNULÉE (encore présente) ne libère pas non plus sa séquence', () => {
    const db = emptyDb()
    const a = place(db)
    const b = place(db)
    assert.equal(cancelOrder(db, a.order.code).ok, true)
    const c = place(db)
    assert.equal(c.order.code, `PS-${DAY.replace(/-/g, '')}-0003`)
    const all = db.orders.map((o) => o.code)
    assert.equal(new Set(all).size, all.length, `doublon : ${all.join(', ')}`)
    assert.ok(all.includes(b.order.code), 'la commande annulée reste dans l’historique')
  })

  it('le serveur et le repli local dérivent du MÊME algorithme', () => {
    // F4 : `nextLocalOrderCode` (max + 1) côté client, `makeOrderCode`
    // (count + 1) côté serveur — deux vérités pour un même code.
    const db = emptyDb()
    place(db)
    place(db)
    deleteOrder(db, `PS-${DAY.replace(/-/g, '')}-0001`)

    const serverCode = makeOrderCode(db, DAY)
    const localCode = nextLocalOrderCode(db.orders.map((o) => o.code), new Date(2026, 8, 15, 12))
    const sharedCode = nextOrderCode(db.orders.map((o) => o.code), DAY)
    assert.equal(serverCode, localCode, 'serveur et client divergent encore')
    assert.equal(serverCode, sharedCode)
    assert.equal(serverCode, `PS-${DAY.replace(/-/g, '')}-0003`)
  })

  it('nextOrderCode accepte des codes OU des objets commande', () => {
    const codes = [`PS-${DAY.replace(/-/g, '')}-0007`]
    const objects = [{ code: codes[0], status: 'new' }]
    assert.equal(nextOrderCode(codes, DAY), `PS-${DAY.replace(/-/g, '')}-0008`)
    assert.equal(nextOrderCode(objects, DAY), `PS-${DAY.replace(/-/g, '')}-0008`)
  })

  it('vue partielle du client : le max connu décide, jamais la longueur', () => {
    // Le client ne voit que 2 des 5 commandes du jour (pagination, autre
    // appareil) : `length + 1` donnerait 0003, déjà pris.
    assert.equal(
      nextOrderCode([`PS-${DAY.replace(/-/g, '')}-0001`, `PS-${DAY.replace(/-/g, '')}-0005`], DAY),
      `PS-${DAY.replace(/-/g, '')}-0006`
    )
  })

  it('les autres journées et les formats inconnus sont ignorés', () => {
    const mixed = ['PS-20260914-0099', 'ABC', '', null, `PS-${DAY.replace(/-/g, '')}-0002`]
    assert.equal(nextOrderCode(mixed, DAY), `PS-${DAY.replace(/-/g, '')}-0003`)
    assert.equal(nextOrderCode([], DAY), `PS-${DAY.replace(/-/g, '')}-0001`)
  })

  it('une journée invalide retombe sur la journée locale courante', () => {
    const code = makeOrderCode(emptyDb(), 'pouet')
    const d = new Date()
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    assert.equal(code, `PS-${ymd}-0001`)
  })

  it('une séquence à 5 chiffres ne casse pas le calcul du max', () => {
    assert.equal(nextOrderCode([`PS-${DAY.replace(/-/g, '')}-10000`], DAY), `PS-${DAY.replace(/-/g, '')}-10001`)
  })

  it('nextOrderCode ne décale pas la journée passée en chaîne (fuseau)', () => {
    // `new Date('YYYY-MM-DD')` est interprété en UTC : à Oran (UTC+1) avant 1 h
    // du matin, la journée reculait d'un jour. Les composants sont posés un par
    // un, à midi local.
    for (const day of ['2026-01-01', '2026-03-31', '2026-12-31']) {
      assert.equal(nextOrderCode([], day), `PS-${day.replace(/-/g, '')}-0001`, day)
    }
  })
})

describe('LOT 2.3 (F5) — mergeServerOrders conserve les commandes locales-only', () => {
  const server = [
    { code: 'PS-20260915-0001', status: 'new', name: 'Karim' },
    { code: 'PS-20260915-0002', status: 'ready', name: 'Amina' }
  ]
  const offlineOrder = {
    code: 'PS-20260915-0009',
    status: 'new',
    name: 'Hors-ligne',
    total: 7500,
    items: [{ id: 'mousepad', qty: 1 }],
    localOnly: true
  }

  it('une commande créée hors-ligne survit au premier merge réussi', () => {
    const local = [offlineOrder, ...server]
    const merged = mergeServerOrders(server, local, Date.now(), new Map())
    const codes = merged.map((o) => o.code)
    assert.ok(codes.includes('PS-20260915-0009'), `perdue : ${codes.join(', ')}`)
    const kept = merged.find((o) => o.code === 'PS-20260915-0009')
    assert.equal(kept.localOnly, true, 'le marqueur est conservé (sinon elle disparaît au merge suivant)')
    assert.equal(kept.name, 'Hors-ligne')
    assert.equal(kept.total, 7500)
  })

  it('elle survit aussi quand le serveur ne renvoie RIEN', () => {
    const merged = mergeServerOrders([], [offlineOrder], Date.now(), new Map())
    assert.deepEqual(merged.map((o) => o.code), ['PS-20260915-0009'])
    assert.equal(merged[0].localOnly, true)
  })

  it('elle est placée devant (plus récente que la liste serveur)', () => {
    const merged = mergeServerOrders(server, [offlineOrder], Date.now(), new Map())
    assert.equal(merged[0].code, 'PS-20260915-0009')
    assert.deepEqual(merged.slice(1), server)
  })

  it('une copie locale SANS marqueur ne ressuscite pas une commande supprimée', () => {
    // Le scénario que le marqueur explicite évite : le maître supprime une
    // commande depuis un autre appareil ; la copie locale de ce navigateur n'a
    // jamais été `localOnly` (elle venait de l'API) et ne doit pas réapparaître.
    const stale = { code: 'PS-20260915-0003', status: 'new', name: 'Supprimée ailleurs' }
    const merged = mergeServerOrders(server, [stale, ...server], Date.now(), new Map())
    assert.deepEqual(merged.map((o) => o.code), ['PS-20260915-0001', 'PS-20260915-0002'])
  })

  it('si le serveur connaît finalement le code, c’est lui qui gagne', () => {
    // Collision de séquence (le bug F4 d'origine) : la commande locale et une
    // commande serveur portent le même code. L'objet serveur est la vérité, et
    // le marqueur tombe — la carte ne ment plus sur son origine.
    const localTwin = { ...offlineOrder, code: 'PS-20260915-0002', name: 'Doublon local' }
    const merged = mergeServerOrders(server, [localTwin], Date.now(), new Map())
    assert.equal(merged.length, 2, 'pas de ligne en double')
    const twin = merged.find((o) => o.code === 'PS-20260915-0002')
    assert.equal(twin.name, 'Amina', 'l’objet serveur gagne')
    assert.equal(twin.localOnly, undefined)
  })

  it('la règle P21 (statut local plus récent) est inchangée', () => {
    const local = [{ code: 'PS-20260915-0001', status: 'preparing', name: 'Karim' }]
    const editedAt = new Map([['PS-20260915-0001', 2000]])
    const merged = mergeServerOrders(server, local, 1000, editedAt)
    assert.equal(merged.find((o) => o.code === 'PS-20260915-0001').status, 'preparing')
    const mergedOld = mergeServerOrders(server, local, 3000, editedAt)
    assert.equal(mergedOld.find((o) => o.code === 'PS-20260915-0001').status, 'new')
  })

  it('entrées dégénérées : pas de Map → liste serveur, listes absentes → vides', () => {
    assert.deepEqual(mergeServerOrders(server, [], 1000, null), server)
    assert.deepEqual(mergeServerOrders(server, null, 1000, new Map()), server)
    // Une liste serveur absente ou vide ne DOIT plus effacer une commande
    // locale-only : c'est précisément le bug F5 (le magasin n'a encore aucune
    // commande synchronisée, la seule qui existe est celle prise hors-ligne).
    assert.deepEqual(
      mergeServerOrders(null, [offlineOrder], 1000, new Map()).map((o) => o.code),
      ['PS-20260915-0009']
    )
    // Sans marqueur, rien n'est réinjecté.
    assert.deepEqual(mergeServerOrders(null, [{ code: 'X' }], 1000, new Map()), [])
  })
})

describe('LOT 2.6 (F10) — `needs` : chaîne et tableau acceptés, normalisés en tableau', () => {
  it('normalizeNeeds : chaîne, tableau, multiligne, vide', () => {
    assert.deepEqual(normalizeNeeds('Socket AM5'), ['Socket AM5'])
    assert.deepEqual(normalizeNeeds(['Socket AM5', 'BIOS à jour']), ['Socket AM5', 'BIOS à jour'])
    assert.deepEqual(normalizeNeeds('Ligne 1\nLigne 2\r\nLigne 3'), ['Ligne 1', 'Ligne 2', 'Ligne 3'])
    assert.deepEqual(normalizeNeeds(''), [])
    assert.deepEqual(normalizeNeeds(null), [])
    assert.deepEqual(normalizeNeeds(undefined), [])
    assert.deepEqual(normalizeNeeds(['  ', 'x']), ['x'], 'les éléments vides sautent')
    // Une virgule fait partie du texte : la découper serait une interprétation.
    assert.deepEqual(normalizeNeeds('Alim 750W, 20 cm'), ['Alim 750W, 20 cm'])
    // Plafond conservé (12).
    assert.equal(normalizeNeeds(Array.from({ length: 30 }, (_, i) => `n${i}`)).length, 12)
  })

  it('une ligne est bornée comme les autres champs texte du patch', () => {
    // `name` ≤ 120, `short` ≤ 200, `brand` ≤ 60, `sku` ≤ 40 : `needs` était le
    // seul champ texte non borné. Sans coupe, une ligne de 4 Ko partait en base,
    // puis dans la fiche produit, l'export CSV et le message WhatsApp.
    const long = 'x'.repeat(4000)
    const out = normalizeNeeds(long)
    assert.equal(out.length, 1, 'une seule ligne')
    assert.equal(out[0].length, MAX_NEED_LINE, `bornée à ${MAX_NEED_LINE} caractères`)
    const patched = sanitizeProductPatch({ needs: ['ok', long] })
    assert.equal(patched.ok, true)
    assert.equal(patched.patch.needs[1].length, MAX_NEED_LINE)
    // Les lignes courtes ne bougent pas.
    assert.deepEqual(normalizeNeeds('Socket AM5\nBIOS à jour'), ['Socket AM5', 'BIOS à jour'])
  })

  it('le patch accepte une CHAÎNE (le bug : 400 `needs`)', () => {
    const out = sanitizeProductPatch({ needs: 'Socket AM5' })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(out.patch.needs, ['Socket AM5'])
  })

  it('le patch accepte un tableau, comme avant', () => {
    const out = sanitizeProductPatch({ needs: ['a', 'b'] })
    assert.equal(out.ok, true)
    assert.deepEqual(out.patch.needs, ['a', 'b'])
  })

  it('createProduct stocke un tableau, plus une chaîne', () => {
    const db = emptyDb()
    const r = createProduct(db, { name: 'Test SKU', price: 1000, stock: 2, needs: 'Socket AM5' }, 'sku-needs-1')
    assert.equal(r.ok, true, JSON.stringify(r))
    const stored = db.meta.extraProducts.find((p) => p.id === 'sku-needs-1')
    assert.ok(Array.isArray(stored.needs), `needs stocké : ${JSON.stringify(stored.needs)}`)
    assert.deepEqual(stored.needs, ['Socket AM5'])
  })

  it('créer puis éditer `needs` fonctionne — le chemin qui échouait', () => {
    const db = emptyDb()
    assert.equal(createProduct(db, { name: 'Test SKU', price: 1000, stock: 2, sku: 'TS-1' }, 'sku-needs-2').ok, true)
    // AVANT : 400 `needs` sur un produit créé avec une chaîne.
    const first = updateProduct(db, 'sku-needs-2', { needs: 'Socket AM5' })
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.deepEqual(first.product.needs, ['Socket AM5'])
    const second = updateProduct(db, 'sku-needs-2', { needs: ['Socket AM5', 'BIOS à jour'] })
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.deepEqual(second.product.needs, ['Socket AM5', 'BIOS à jour'])
    const cleared = updateProduct(db, 'sku-needs-2', { needs: '' })
    assert.equal(cleared.ok, true)
    assert.deepEqual(cleared.product.needs, [])
  })

  it('éditer `needs` d’un produit master l’enregistre vraiment (2ᵉ volet de F10)', () => {
    // La branche « extraProducts » de `updateProduct` ne reprenait pas `needs` :
    // le champ était validé puis jeté, la route répondait 200 avec un produit
    // inchangé. Pire qu'un 400 — le maître croyait avoir enregistré.
    const db = emptyDb()
    assert.equal(createProduct(db, { name: 'P', price: 900, stock: 1, sku: 'P-1' }, 'p-needs').ok, true)
    const r = updateProduct(db, 'p-needs', { needs: ['Socket AM5'] })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(r.product.needs, ['Socket AM5'], 'la réponse doit porter le champ enregistré')
    assert.deepEqual(
      db.meta.extraProducts.find((p) => p.id === 'p-needs').needs,
      ['Socket AM5'],
      'et la base aussi'
    )
    // Les autres champs ne sont pas affectés.
    assert.equal(r.product.name, 'P')
    assert.equal(r.product.sku, 'P-1')
  })

  it('les produits déjà stockés avec une chaîne sont migrés à la lecture', () => {
    const db = emptyDb()
    // Base antérieure au correctif : `needs` en chaîne (et même absent).
    db.meta.extraProducts = [
      { id: 'old-1', sku: 'OLD-1', name: 'Ancien 1', price: 500, stock: 1, needs: 'Socket AM5' },
      { id: 'old-2', sku: 'OLD-2', name: 'Ancien 2', price: 500, stock: 1, needs: '' },
      { id: 'old-3', sku: 'OLD-3', name: 'Ancien 3', price: 500, stock: 1 }
    ]
    const listed = listMasterProducts(db)
    for (const id of ['old-1', 'old-2', 'old-3']) {
      const p = listed.find((x) => x.id === id)
      assert.ok(Array.isArray(p.needs), `${id} : needs = ${JSON.stringify(p.needs)}`)
    }
    assert.deepEqual(listed.find((x) => x.id === 'old-1').needs, ['Socket AM5'])
    assert.deepEqual(listed.find((x) => x.id === 'old-2').needs, [])
    // La migration a bien écrit dans la base, pas seulement dans la réponse.
    assert.ok(Array.isArray(db.meta.extraProducts[0].needs))
    // Et le patch suivant ne retombe pas sur une chaîne.
    assert.equal(updateProduct(db, 'old-1', { name: 'Ancien 1 bis' }).ok, true)
    assert.ok(Array.isArray(db.meta.extraProducts[0].needs))
  })

  it('le reste du patch reste validé (le type non convertible ne bloque plus tout)', () => {
    // Un 400 sur `needs` bloquait l'enregistrement du RESTE du patch.
    const out = sanitizeProductPatch({ name: 'Nom', price: 1200, needs: 42 })
    assert.equal(out.ok, true, JSON.stringify(out))
    assert.deepEqual(out.patch.needs, ['42'])
    assert.equal(out.patch.name, 'Nom')
    // Les autres validations ne sont pas touchées.
    assert.equal(sanitizeProductPatch({ price: 0 }).ok, false, 'LOT 1.12 toujours en place')
    assert.equal(sanitizeProductPatch({ name: '' }).ok, false)
    assert.equal(sanitizeProductPatch({ category: 'inconnue' }).ok, false)
  })

  it('le catalogue de base garde `needsKey` (aucune régression d’affichage)', () => {
    const withKey = PRODUCTS.filter((p) => p.needsKey)
    assert.ok(withKey.length >= 10, `${withKey.length} références portent un needsKey`)
    // `needs` n'est pas un champ du catalogue de base : la normalisation ne
    // concerne que les produits créés par le maître.
    assert.equal(PRODUCTS.filter((p) => p.needs != null).length, 0)
  })

  it('le stock n’est pas affecté par la migration', () => {
    const db = emptyDb()
    db.meta.extraProducts = [{ id: 'mig-1', sku: 'MIG-1', name: 'M', price: 500, stock: 4, needs: 'x' }]
    // `liveStockOf` lit `db.stock` (posé par `createProduct`/`setStock`), pas le
    // champ `stock` de la fiche : un produit de base inconnu vaut 0 sinon.
    db.stock['mig-1'] = 4
    const listed = listMasterProducts(db)
    assert.equal(liveStockOf(db, 'mig-1'), 4)
    assert.equal(listed.find((p) => p.id === 'mig-1').stock, 4, 'la migration ne touche pas au stock')
    assert.deepEqual(listed.find((p) => p.id === 'mig-1').needs, ['x'])
  })
})

// ---------------------------------------------------------------------------
// LOT P5 — compter et couper en CARACTÈRES, pas en unités UTF-16.
//
// Mesuré le 19/09/2026 sur trois champs : un libellé de vitrine « a » + 48 🧰
// (49 caractères) était stocké en 48 UNITÉS, le dernier étant U+D83E seul — une
// moitié de paire de substituts, resservie telle quelle au site public, à
// l'export CSV et au message WhatsApp. Un nom de 33 emoji (66 unités) était de
// son côté REFUSÉ comme trop long. Les deux erreurs viennent de la même
// habitude : `.length` et `.slice(0, N)` parlent en unités.
// ---------------------------------------------------------------------------
describe('LOT P5 — la coupe de texte ne sépare jamais un caractère en deux', () => {
  const EMOJI = '\u{1F9F0}' // 🧰 : deux unités UTF-16, un caractère

  it('countChars / clipChars : le compte est en points de code', async () => {
    const { countChars, clipChars } = await import('./textClip.js')
    assert.equal(countChars(''), 0)
    assert.equal(countChars('abc'), 3)
    assert.equal(countChars(EMOJI), 1, 'un emoji compte 1, pas 2')
    assert.equal(countChars(EMOJI.repeat(33)), 33, '33 emoji = 33 caracteres (66 unites : c est le compte qui mentait)')
    assert.equal(countChars(null), 0)
    assert.equal(countChars(undefined), 0)

    assert.equal(clipChars('abcdef', 3), 'abc')
    assert.equal(clipChars('abc', 10), 'abc')
    assert.equal(clipChars('abcdef', 0), '')
    assert.equal(clipChars('abcdef', -2), '')
    assert.equal(clipChars(null, 4), '')
    // Le cas qui corrompait la base : couper au milieu d une paire. Deux
    // caracteres = « a » + l emoji ENTIER, pas « a » + une moitie de paire.
    assert.equal(clipChars('a' + EMOJI.repeat(5), 2), 'a' + EMOJI)
    assert.equal(clipChars('a' + EMOJI.repeat(5), 1), 'a')
    assert.equal(clipChars(EMOJI.repeat(50), 48), EMOJI.repeat(48))
    for (const t of [clipChars('a' + EMOJI.repeat(5), 2), clipChars('a' + EMOJI.repeat(5), 1), clipChars(EMOJI.repeat(50), 49)]) {
      const dernier = t.charCodeAt(t.length - 1)
      const premier = t.charCodeAt(0)
      assert.equal(dernier >= 0xd800 && dernier <= 0xdbff, false, 'une tete de paire orpheline en fin de chaine')
      assert.equal(premier >= 0xdc00 && premier <= 0xdfff, false, 'une queue de paire orpheline en debut de chaine')
    }
    // Identite stricte quand rien n est coupe (aucun appelant ne depend de ceci,
    // mais une copie inutile a chaque champ de chaque fiche serait du gaspillage).
    const court = 'AM5'
    assert.equal(clipChars(court, 40), court)
  })

  it('cleanProductText et normalizeNeeds coupent large, sans moitie de paire', async () => {
    const { cleanProductText, BRAND_LIMIT } = await import('./productMeta.js')
    const borne = cleanProductText('  ' + 'a' + EMOJI.repeat(80) + '  ', BRAND_LIMIT)
    assert.equal(borne.charCodeAt(borne.length - 1) >= 0xd800 && borne.charCodeAt(borne.length - 1) <= 0xdbff, false, 'cleanProductText laisse une tete de paire seule')
    assert.equal([...borne].length <= BRAND_LIMIT, true, 'plus de caracteres que la borne')
    assert.equal(cleanProductText(EMOJI.repeat(BRAND_LIMIT), BRAND_LIMIT), EMOJI.repeat(BRAND_LIMIT), `${BRAND_LIMIT} emoji doivent passer entiers`)

    const lignes = normalizeNeeds(Array(30).fill(EMOJI.repeat(MAX_NEED_LINE + 40)))
    assert.equal(lignes.length, 12, 'le nombre de lignes reste borne')
    for (const l of lignes) {
      const d = l.charCodeAt(l.length - 1)
      assert.equal(d >= 0xd800 && d <= 0xdbff, false, 'une ligne de `needs` se termine par une moitie de paire')
      assert.equal([...l].length <= MAX_NEED_LINE, true)
    }
  })

  it('les bornes qui REFUSENT comptent des caracteres, pas des unites', async () => {
    const { NAME_LIMIT } = await import('./productMeta.js')
    const { createProduct } = await import('../server/masterApi.js')
    const db = { meta: {}, products: {}, stock: {} }
    // 60 emoji = 120 unites = 60 caracteres : la fiche est acceptee ENTIERE.
    const nom = EMOJI.repeat(60)
    const cree = createProduct(db, { name: nom, price: 1000 }, 'p5-1')
    assert.equal(cree.ok, true, JSON.stringify(cree))
    assert.equal(cree.product.name, nom, 'le nom a ete tronque alors qu il tient dans la borne')
    // 121 caracteres : refuse, pas tronque (le nom est une identite).
    assert.deepEqual(
      createProduct(db, { name: 'x'.repeat(NAME_LIMIT + 1), price: 1000 }, 'p5-2').error,
      'name_too_long'
    )
  })

  it('les routes ne recomptent plus a la main en unites UTF-16', async () => {
    // Un `.length > LIMITE` sur du texte saisi est le meme defaut sous un autre
    // nom : la borne dit « caracteres » au client et decide en unites.
    const index = fs.readFileSync('server/index.js', 'utf8')
    assert.equal(/orderName\.length > 64/.test(index), false, 'le nom de commande est recompte en unites')
    const master = fs.readFileSync('server/masterApi.js', 'utf8')
    assert.equal(/name\.length > NAME_LIMIT/.test(master), false, 'le nom produit est recompte en unites')
    // Et elles comparent via `excedeChars` (arret au premier caractere de trop),
    // pas `countChars(...) >` qui parcourt tout le corps recu pour dire non.
    for (const [nom, source] of [['server/index.js', index], ['server/masterApi.js', master], ['src/shopStore.js', fs.readFileSync('src/shopStore.js', 'utf8')]]) {
      assert.match(source, /excedeChars\(/, `${nom} ne borne plus la longueur en caracteres`)
      assert.equal(/countChars\([^)]*\) > /.test(source), false, `${nom} mesure la totalite d'une saisie pour la refuser`)
    }

    // A la relecture, deux autres plafonds du meme texte libre comptaient encore
    // des unites : l'inscription (`regName.length > 64`) et la wilaya du profil
    // (`String(...).trim().slice(0, 32)`). La regle ne vaut pas pour trois lignes
    // citees mais pour tout le texte saisi qui entre par la porte.
    const propre = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')
    assert.equal((index.match(/excedeChars\(/g) || []).length, 3, 'une route de la porte borne encore un nom en unites')
    assert.equal(/\b\w*[Nn]ame\.length > \d/.test(propre(index)), false, 'un nom est encore compare a une borne en unites UTF-16')
    assert.equal(/trim\(\)\.slice\(0, *\d+\)/.test(propre(index)), false, 'un texte libre est encore coupe en unites UTF-16 dans la porte')
  })

  it('la troncature de secours du message WhatsApp ne sépare pas une paire', async () => {
    /*
     * Le message que recoit le comptoir est borne en caracteres pour tenir dans
     * une URL `wa.me`, et la troncature de secours (un seul article énorme)
     * faisait `msg.slice(0, limit - 1) + '…'` : `slice` compte des unités, donc
     * coupait un emoji en deux et laissait la moitié orpheline juste devant le « … ».
     * La borne de longueur, elle, reste en unités : c'est la taille de l'URL qui
     * est en jeu ici, pas le nombre de signes visibles — d'ou deux mesures
     * differentes, volontairement.
     */
    const { buildWaMessage } = await import('./orderLogic.js')
    const { repairPaires } = await import('./textClip.js')
    const EMOJI = '\u{1F9F0}'
    const t = (k, v) => (v ? Object.values(v).map((x) => String(x ?? '')).join(' | ') : k)
    const cart = [{ qty: 1, name: 'Ryzen 7 ' + EMOJI.repeat(40), sku: 'cpu-7800x3d' }]
    const pickup = { name: 'Ali', phone: '0770650387', slot: '19/09 14:00' }
    let vue = 0
    for (let limit = 20; limit <= 80; limit += 3) {
      const msg = buildWaMessage(cart, 260000, pickup, t, { limit, lang: 'fr' })
      assert.equal(repairPaires(msg), msg, `le message tronque a ${limit} contient une moitie de paire`)
      assert.equal(msg.length <= limit, true, `la borne de ${limit} n'est plus respectee`)
      if (msg.length === limit) vue += 1
    }
    assert.ok(vue > 0, 'aucun cas ne touchait la troncature : le verrou ne regardait rien')
  })

  it('excedeChars : meme reponse que le compte, sans le cout du compte', async () => {
    const { excedeChars, countChars } = await import('./textClip.js')
    const EMOJI = '\u{1F9F0}'
    assert.equal(excedeChars('', 64), false)
    assert.equal(excedeChars(null, 64), false)
    assert.equal(excedeChars('a'.repeat(64), 64), false, 'a la borne exactement : on passe')
    assert.equal(excedeChars('a'.repeat(65), 64), true, 'un de plus : on refuse')
    assert.equal(excedeChars(EMOJI.repeat(33), 64), false, '33 emoji = 66 unites, mais 33 caracteres')
    assert.equal(excedeChars(EMOJI.repeat(65), 64), true)
    assert.equal(excedeChars('abc', 0), true, 'une borne nulle ne laisse rien passer')
    assert.equal(excedeChars('', 0), false, 'rien a dire sur une chaine vide')
    assert.equal(excedeChars('abc', NaN), false, "une borne invalide n'invente pas un refus")

    // Accord parfait avec le compte integral sur un echantillon mele.
    for (let n = 0; n < 120; n += 7) {
      const t = 'a'.repeat(n % 3) + EMOJI.repeat(n)
      assert.equal(excedeChars(t, 50), countChars(t) > 50, `divergence a n=${n}`)
      assert.equal(excedeChars(t, 1), countChars(t) > 1, `divergence a n=${n} (borne 1)`)
    }

    // Une saisie qui FINIT sur une tete de paire orpheline est le cas ou une borne
    // mal ecrite INVENTERAIT un refus (2 unites vues la ou il y a 1 caractere) :
    // la reponse doit rester celle du compte.
    for (const bout of ['a'.repeat(50) + '\\uD83E', 'a'.repeat(49) + '\\uD83E', 'a'.repeat(51) + '\\uD83E']) {
      assert.equal(excedeChars(bout, 50), countChars(bout) > 50, 'divergence sur une saisie terminee par une moitie de paire')
    }

    // Le propriete qui justifie l'existence de la fonction : refuser ne doit pas
    // couter le prix du texte refuse. 4 Mo de « a » (le maximum qu'un corps de
    // requete peut raisonnablement porter ici) compares a 64 en O(64).
    const enormissime = 'a'.repeat(4 * 1024 * 1024)
    const t0 = process.hrtime.bigint()
    assert.equal(excedeChars(enormissime, 64), true)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    assert.ok(ms < 5, `${ms.toFixed(1)} ms pour refuser un nom de 4 Mo : la borne parcourt le corps de la requete`)
  })
})
