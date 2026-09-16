import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { PRODUCTS } from './data.js'

// ---------------------------------------------------------------------------
// LOT 8 — audit A→Z du 16/09/2026, ROUTES HTTP RÉELLES (A1 + A2).
//
//  8.1 (A1) 🔴 reproduit en direct pendant l'audit : le maître masque une
//            référence, elle disparaît de `GET /api/catalog`, puis un VISITEUR
//            ANONYME la commande en visant son id → **HTTP 201**, commande
//            créée, stock décrémenté, WhatsApp envoyé au comptoir.
//  8.2 (A2) 🔴 un id inconnu mais présent dans `db.stock` (produit retiré de
//            src/data.js, migration, sauvegarde restaurée) était accepté et
//            tarifé **0 DA**. `normalizeDb` purge désormais ces entrées.
//
// La base est semée AVANT l'import du handler : c'est la condition pour voir la
// purge réellement persistée dans store.json (et pas seulement en mémoire).
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot8-'))
process.env.PCSTAR_DATA_DIR = dir
const DB_FILE = path.join(dir, 'store.json')

const GHOST = 'produit-fantome'
const REMOVED = 'cpu-5600' // retiré du catalogue au lot P21 — cas réel
const HIDDEN = PRODUCTS.find((p) => p.id === 'gpu-4070s') || PRODUCTS[3]
const VALID = PRODUCTS.find((p) => p.id === 'ssd-1t')

fs.writeFileSync(
  DB_FILE,
  JSON.stringify({
    users: [],
    orders: [],
    // Deux entrées orphelines (A2) à côté d'une entrée légitime qui doit survivre.
    stock: { [GHOST]: 5, [REMOVED]: 2, [VALID.id]: 9, [HIDDEN.id]: 4 },
    meta: {
      demoSeeded: true,
      extraProducts: [],
      hiddenProductIds: [],
      extraPanels: [],
      hiddenPanelIds: [],
      photoOverrides: {},
      productOverrides: { ghost: { price: 1 }, [VALID.id]: { price: 9500 } }
    }
  })
)

const { handler } = await import('../server/index.js')

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
      fs.rmSync(dir, { recursive: true, force: true })
      resolve()
    })
)

async function call(method, pathname, { body, token } = {}) {
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

async function masterToken() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, 'connexion maître (fixture de test)')
  return r.data.token
}

function place(items, over = {}) {
  return call('POST', '/api/orders', {
    body: {
      name: 'Client Lot8',
      phone: '0550123456',
      wilaya: 'Oran',
      slot: '12:30',
      items,
      ...over
    }
  })
}

async function orderCodes(token) {
  const r = await call('GET', '/api/orders', { token })
  assert.equal(r.status, 200)
  return (r.data.orders || []).map((o) => o.code)
}

describe('LOT 8.1 (A1) — POST /api/orders sur un produit masqué', () => {
  it('409 `unavailable`, aucune commande créée, stock intact', async () => {
    const token = await masterToken()

    // 1. le maître retire la référence de la vente
    const hide = await call('POST', `/api/master/products/${HIDDEN.id}/hide`, {
      token,
      body: { hidden: true }
    })
    assert.equal(hide.status, 200)
    const cat = await call('GET', '/api/catalog')
    assert.ok(!cat.data.products.some((p) => p.id === HIDDEN.id), 'absente du catalogue public')
    const stockAvant = (await call('GET', '/api/master/products', { token })).data.products.find(
      (p) => p.id === HIDDEN.id
    ).stock

    // 2. un VISITEUR ANONYME (aucun jeton) la commande en visant son id
    const before = await orderCodes(token)
    const r = await place([{ id: HIDDEN.id, sku: HIDDEN.sku, name: HIDDEN.name, qty: 1, price: 1 }])

    // AVANT le correctif : 201 + commande créée (reproduit en direct à l'audit).
    assert.equal(r.status, 409, `attendu 409, reçu ${r.status} ${JSON.stringify(r.data)}`)
    assert.equal(r.data.ok, false)
    assert.equal(r.data.error, 'unavailable')
    assert.deepEqual(r.data.unavailable, [{ id: HIDDEN.id, name: HIDDEN.name }], 'la ligne est nommée')

    const after = await orderCodes(token)
    assert.deepEqual(after, before, 'aucune commande créée')
    const stockApres = (await call('GET', '/api/master/products', { token })).data.products.find(
      (p) => p.id === HIDDEN.id
    ).stock
    assert.equal(stockApres, stockAvant, 'le stock n’est pas décrémenté')

    // 3. démasquer rend la référence de nouveau commandable (pas un bannissement)
    await call('POST', `/api/master/products/${HIDDEN.id}/hide`, { token, body: { hidden: false } })
    const ok = await place([{ id: HIDDEN.id, sku: HIDDEN.sku, name: HIDDEN.name, qty: 1 }])
    assert.equal(ok.status, 201, JSON.stringify(ok.data))
    assert.equal(ok.data.order.total, HIDDEN.price, 'tarifée depuis le catalogue, pas depuis le prix envoyé')
    // Nettoyage : la commande de contrôle est annulée, le stock rendu.
    await call('POST', `/api/orders/${ok.data.order.code}/cancel`, { token })
  })

  it('panier mixte (masqué + valide) : 409 global, la ligne valide n’est pas décrémentée', async () => {
    const token = await masterToken()
    await call('POST', `/api/master/products/${HIDDEN.id}/hide`, { token, body: { hidden: true } })
    const stockAvant = (await call('GET', '/api/master/products', { token })).data.products.find(
      (p) => p.id === VALID.id
    ).stock

    const r = await place([
      { id: VALID.id, sku: VALID.sku, name: VALID.name, qty: 1 },
      { id: HIDDEN.id, sku: HIDDEN.sku, name: HIDDEN.name, qty: 1 }
    ])
    assert.equal(r.status, 409)
    assert.equal(r.data.error, 'unavailable')

    const stockApres = (await call('GET', '/api/master/products', { token })).data.products.find(
      (p) => p.id === VALID.id
    ).stock
    assert.equal(stockApres, stockAvant, 'aucun commit partiel')
    await call('POST', `/api/master/products/${HIDDEN.id}/hide`, { token, body: { hidden: false } })
  })
})

describe('LOT 8.2 (A2) — POST /api/orders sur un id inconnu', () => {
  it('400 `unknown_product`, aucune commande à 0 DA', async () => {
    const token = await masterToken()
    const before = await orderCodes(token)

    const r = await place([{ id: GHOST, sku: 'GHOST', name: 'Fantôme', qty: 1, price: 99000 }])
    // AVANT le correctif : 201, total 0 DA, code PS-…-0001 créé.
    assert.equal(r.status, 400, `attendu 400, reçu ${r.status} ${JSON.stringify(r.data)}`)
    assert.equal(r.data.error, 'unknown_product')
    assert.deepEqual(r.data.unknown, [{ id: GHOST, name: 'Fantôme' }])
    assert.deepEqual(await orderCodes(token), before, 'aucune commande créée')
  })

  it('ligne sans identifiant → 400 `unknown_product` (elle passait en « stock » avant)', async () => {
    const r = await place([{ qty: 2, name: 'Sans id' }])
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'unknown_product')
  })

  it('un produit maître créé via l’API reste commandable (pas de faux positif)', async () => {
    const token = await masterToken()
    const created = await call('POST', '/api/master/products', {
      token,
      body: { name: 'Câble LOT8', price: 900, stock: 2, category: 'usb' }
    })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    const id = created.data.product.id
    const r = await place([{ id, sku: created.data.product.sku, name: 'Câble LOT8', qty: 1 }])
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.order.total, 900, 'tarifé depuis la fiche maître')
    await call('POST', `/api/orders/${r.data.order.code}/cancel`, { token })
  })
})

describe('LOT 8.2 (A2) — purge persistée des références orphelines', () => {
  it('store.json ne porte plus les ids inconnus, les entrées valides survivent', async () => {
    // Une lecture suffit : la normalisation du premier accès est persistée
    // (LOT 3.2, B2) — c'est elle qui écrit la purge.
    await call('GET', '/api/catalog')
    const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    assert.equal(onDisk.stock[GHOST], undefined, 'entrée fantôme purgée')
    assert.equal(onDisk.stock[REMOVED], undefined, 'entrée d’un produit retiré du catalogue purgée')
    assert.equal(onDisk.meta.productOverrides.ghost, undefined, 'override orphelin purgé')
    assert.equal(onDisk.stock[VALID.id], 9, 'le stock légitime est conservé')
    assert.deepEqual(onDisk.meta.productOverrides[VALID.id], { price: 9500 }, 'l’override légitime aussi')
    assert.ok(typeof onDisk.stock[HIDDEN.id] === 'number', 'un produit MASQUÉ n’est pas un orphelin')
  })

  it('après purge, l’id fantôme n’ouvre plus aucun chemin de commande', async () => {
    const r = await place([{ id: GHOST, qty: 1 }])
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'unknown_product')
    const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    assert.equal(onDisk.stock[GHOST], undefined, 'toujours absent de la base')
    assert.ok(!(onDisk.orders || []).some((o) => Number(o.total) === 0), 'aucune commande à 0 DA en base')
  })
})
