import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// ---------------------------------------------------------------------------
// LOT 4 — multi-appareil & données.
//
//  4.1 (F14) noms de photos uploadées : deux envois du même produit dans la
//            même milliseconde produisaient le MÊME nom → écrasement silencieux
//            (repli filesystem) ou échec de `put` (Vercel Blob,
//            `allowOverwrite: false`). Suffixe aléatoire.
//  4.2 (F15) sous Vercel sans `BLOB_READ_WRITE_TOKEN`, l'upload filesystem
//            écrit dans `/tmp` : la photo « montait » puis son URL mourait au
//            cold start. Refus explicite à l'upload, code d'erreur nommé.
//  4.3 (F16) supprimer un client laissait ses commandes en cours debout, sans
//            propriétaire : stock réservé pour personne, jamais rendu, invisible.
//            Annulation + rendu du stock + résumé renvoyé au master.
//  4.4 (R20) puis phase 3 : une commande GUEST n'est jamais récupérée par
//            égalité de téléphone — seule une session présente au checkout la
//            rattache à un compte. `claimable: false` marque toute ligne guest.
//  4.5 (U11) `GET /api/orders` remappait `pending → new` à l'affichage pendant
//            que `PATCH`/`DELETE` lisaient le statut brut. Migration des lignes
//            legacy + réponse fidèle.
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot4-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.PCSTAR_UPLOAD_DIR = path.join(root, 'uploads')

const { handler } = await import('../server/index.js')
const db = await import('../server/db.js')
const catalog = await import('../server/catalog.js')
const { savePhotoDataUrls } = await import('../server/masterApi.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

const DB_FILE = path.join(process.env.PCSTAR_DATA_DIR, 'store.json')
const UPLOAD_DIR = process.env.PCSTAR_UPLOAD_DIR
const PRODUCT = 'ssd-1t'

let server
let base

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

beforeEach(() => __rateLimitInternals.buckets.clear())

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

const readStore = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {})
const storeOrder = (code) => (readStore().orders || []).find((o) => o.code === code)

async function loginMaster() {
  const r = await call('POST', '/api/auth/login', {
    body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
  })
  assert.equal(r.status, 200, `login maître : ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.token
}

let seq = 0
async function registerClient(phone = null) {
  seq += 1
  const email = `lot4.${seq}.${Date.now()}@test.dz`
  const r = await call('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name: `Client Lot4 ${seq}` }
  })
  assert.equal(r.status, 201, `inscription : ${r.status} ${JSON.stringify(r.data)}`)
  if (phone) {
    const up = await call('PUT', '/api/me', { body: { phone }, token: r.data.token })
    assert.equal(up.status, 200, `téléphone : ${up.status} ${JSON.stringify(up.data)}`)
  }
  return { email, phone, token: r.data.token, id: r.data.user?.id }
}

const items = (qty = 1) => [{ id: PRODUCT, sku: 'SN770', name: 'SN770 1To', qty, price: 1 }]
const stockOf = async (id = PRODUCT) => (await call('GET', `/api/stock/${id}`)).data.stock

// Une « image » valide pour le parseur data-URL (≥ 32 octets, ≤ MAX_BYTES) :
// le contenu n'est jamais décodé, seule la taille compte.
const pngDataUrl = () => `data:image/png;base64,${Buffer.alloc(256, 7).toString('base64')}`

/* ------------------------------------------------------------------ 4.1 F14 */

describe('4.1 (F14) — noms de photos uploadées uniques', () => {
  it('deux envois du même produit dans la même milliseconde → deux fichiers distincts', async () => {
    const realNow = Date.now
    const frozen = 1_700_000_000_000
    Date.now = () => frozen
    let first
    let second
    try {
      first = await savePhotoDataUrls('sku-collision', [pngDataUrl()])
      second = await savePhotoDataUrls('sku-collision', [pngDataUrl()])
    } finally {
      Date.now = realNow
    }
    assert.equal(first.length, 1, 'premier envoi enregistré')
    assert.equal(second.length, 1, 'second envoi enregistré (aucun échec)')
    assert.notEqual(first[0], second[0], 'même milliseconde, même produit → noms identiques')
    // Les deux fichiers existent vraiment (avant : le second écrasait le premier).
    for (const url of [...first, ...second]) {
      const name = decodeURIComponent(url.split('/').pop())
      assert.ok(fs.existsSync(path.join(UPLOAD_DIR, name)), `fichier absent : ${name}`)
    }
  })

  it('plusieurs photos d’un même envoi portent des noms distincts et sûrs', async () => {
    const urls = await savePhotoDataUrls('sku-lot4', [pngDataUrl(), pngDataUrl(), pngDataUrl()])
    assert.equal(urls.length, 3)
    const names = urls.map((u) => decodeURIComponent(u.split('/').pop()))
    assert.equal(new Set(names).size, 3, `doublons : ${names.join(', ')}`)
    for (const n of names) {
      assert.match(n, /^sku-lot4-[a-z0-9]+-[0-9a-f]{6}-\d+\.png$/, n)
      assert.ok(n.length <= 200, 'nom au-delà de la borne de safeUploadName')
      assert.equal(n.includes('..'), false)
      assert.equal(n.includes('/'), false)
    }
  })

  it('la branche Blob fixe addRandomSuffix: false (la clé = le nom stocké en base)', () => {
    // Contrat de LOT 1.11 : la base stocke `/api/upload-file?name=<clé>`, et
    // `resolveBlobUrl`/`deleteBlob` reconstruisent cette clé. Si Vercel Blob
    // ajoutait un suffixe aléatoire (option `addRandomSuffix`), chaque photo
    // pointerait vers une clé inexistante — affichage 404 et suppression ratée.
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/blobStore.js'), 'utf8')
    const start = src.indexOf('await blob.put(')
    assert.ok(start > 0, 'appel blob.put introuvable')
    // l'appel complet, options comprises : de `blob.put(` jusqu'au `})` qui le ferme
    const put = src.slice(start, src.indexOf('})', start) + 2)
    assert.match(put, /access:\s*'public'/, 'accès public absent')
    assert.match(put, /addRandomSuffix:\s*false/, 'addRandomSuffix non fixé explicitement')
    assert.equal(put.includes('allowOverwrite: true'), false, 'écrasement silencieux réactivé')
  })
})

/* ------------------------------------------------------------------ 4.2 F15 */

describe('4.2 (F15) — pas d’upload éphémère sous Vercel', () => {
  const runChild = (env) => {
    const script = `
      const { uploadBlob } = await import(${JSON.stringify(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/blobStore.js')
      )})
      const fs = await import('node:fs')
      try {
        const r = await uploadBlob('photo-lot4.jpg', Buffer.alloc(256, 3), 'image/jpeg')
        console.log('RESULT:ok:' + r.storage + ':' + r.url)
      } catch (err) {
        console.log('RESULT:throw:' + (err && err.code ? err.code : 'nocode'))
      }
      const dir = process.env.PCSTAR_UPLOAD_DIR
      console.log('FILES:' + (dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length : 0))
    `
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...env },
      encoding: 'utf8'
    })
    return { out: String(res.stdout || ''), err: String(res.stderr || ''), status: res.status }
  }

  it('sous Vercel sans BLOB_READ_WRITE_TOKEN : refus explicite, rien d’écrit', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-lot4-tmp-'))
    try {
      const { out, err, status } = runChild({
        VERCEL: '1',
        BLOB_READ_WRITE_TOKEN: '',
        PCSTAR_UPLOAD_DIR: tmp
      })
      assert.equal(status, 0, `processus fils en échec : ${err.slice(0, 400)}`)
      assert.match(out, /RESULT:throw:UPLOAD_STORAGE_UNAVAILABLE/, `sortie : ${out}`)
      assert.match(out, /FILES:0/, 'un fichier a été écrit dans /tmp malgré le refus')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('hors serverless : le repli filesystem fonctionne toujours', async () => {
    const urls = await savePhotoDataUrls('sku-local', [pngDataUrl()])
    assert.equal(urls.length, 1)
    const name = decodeURIComponent(urls[0].split('/').pop())
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, name)), 'photo locale absente')
  })

  it('les routes photo traduisent le refus en erreur nommée (pas un 500 muet)', () => {
    // Les trois routes passent par `savePhotoDataUrlsSafe`, qui mappe
    // `UPLOAD_STORAGE_UNAVAILABLE` → `error: 'upload_storage'` ; sans lui,
    // l'exception partait dans le gestionnaire global et le master voyait
    // « server » sans savoir quoi faire.
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/index.js'),
      'utf8'
    )
    assert.match(src, /UPLOAD_STORAGE_UNAVAILABLE/, 'code d’erreur non traduit côté route')
    assert.match(src, /error: 'upload_storage'/, 'code applicatif absent de la réponse')
    // L'appel direct ne subsiste QUE dans le helper (une fois) ; les trois routes
    // photo (création produit, édition, panneau photos) passent par le helper.
    const direct = (src.match(/await savePhotoDataUrls\(/g) || []).length
    assert.equal(direct, 1, `appels directs hors helper : ${direct}`)
    const viaHelper = (src.match(/await savePhotoDataUrlsSafe\(/g) || []).length
    assert.equal(viaHelper, 3, `routes photo protégées : ${viaHelper} sur 3`)
  })
})

/* ------------------------------------------------------------------ 4.3 F16 */

describe('4.3 (F16) — suppression d’un client : commandes en cours et stock', () => {
  it('purgeUser annule new/preparing/ready, rend le stock, laisse picked/cancelled', () => {
    const d = db.emptyDb()
    db.normalizeDb(d)
    d.users.push({ id: 'c1', role: 'customer', email: 'c1@test.dz', phone: '0550000001' })
    d.sessions[db.hashToken('tok-c1')] = { userId: 'c1', at: Date.now() }
    d.stock[PRODUCT] = 10
    d.orders = [
      { code: 'A-1', userId: 'c1', status: 'new', items: [{ id: PRODUCT, qty: 2 }], at: '2026-09-01T10:00:00.000Z' },
      { code: 'A-2', userId: 'c1', status: 'preparing', items: [{ id: PRODUCT, qty: 3 }], at: '2026-09-02T10:00:00.000Z' },
      { code: 'A-3', userId: 'c1', status: 'ready', items: [{ id: PRODUCT, qty: 1 }], at: '2026-09-03T10:00:00.000Z' },
      { code: 'A-4', userId: 'c1', status: 'picked', items: [{ id: PRODUCT, qty: 5 }], at: '2026-09-04T10:00:00.000Z' },
      { code: 'A-5', userId: 'c1', status: 'cancelled', items: [{ id: PRODUCT, qty: 4 }], at: '2026-09-05T10:00:00.000Z' },
      { code: 'B-1', userId: 'autre', status: 'new', items: [{ id: PRODUCT, qty: 7 }], at: '2026-09-06T10:00:00.000Z' }
    ]

    const r = catalog.purgeUser(d, 'c1')
    assert.equal(r.ok, true)
    // 2 + 3 + 1 rendus ; `picked` (5) reste consommé, `cancelled` (4) déjà rendu.
    assert.equal(catalog.liveStockOf(d, PRODUCT), 16, `stock : ${catalog.liveStockOf(d, PRODUCT)}`)
    assert.deepEqual(
      r.cancelled.map((c) => c.code).sort(),
      ['A-1', 'A-2', 'A-3'],
      'commandes annulées'
    )
    assert.equal(r.releasedLines, 3)
    assert.deepEqual(
      r.left.map((c) => c.code).sort(),
      ['A-4', 'A-5'],
      'commandes non touchées'
    )
    const byCode = Object.fromEntries(d.orders.map((o) => [o.code, o]))
    assert.equal(byCode['A-1'].status, 'cancelled')
    assert.ok(byCode['A-1'].cancelledAt, 'trace d’annulation absente')
    assert.equal(byCode['A-4'].status, 'picked', 'une commande retirée ne doit pas être annulée')
    assert.equal(byCode['A-5'].status, 'cancelled')
    assert.equal(byCode['B-1'].status, 'new', 'commande d’un autre compte touchée')
    // l'historique reste lisible : userId délié, pas supprimé
    assert.equal(byCode['A-1'].userId, null)
    assert.equal(d.users.some((u) => u.id === 'c1'), false)
    assert.equal(d.sessions[db.hashToken('tok-c1')], undefined, 'sessions du compte encore présentes')
  })

  it('purgeUser est idempotent : le stock n’est pas rendu deux fois', () => {
    const d = db.emptyDb()
    db.normalizeDb(d)
    d.users.push({ id: 'c2', role: 'customer', email: 'c2@test.dz' })
    d.stock[PRODUCT] = 10
    d.orders = [{ code: 'C-1', userId: 'c2', status: 'new', items: [{ id: PRODUCT, qty: 2 }], at: '2026-09-01T10:00:00.000Z' }]
    catalog.purgeUser(d, 'c2')
    assert.equal(catalog.liveStockOf(d, PRODUCT), 12)
    // repasser sur la même commande (userId déjà null) ne doit rien rendre
    d.orders[0].userId = 'c2'
    catalog.purgeUser(d, 'c2')
    assert.equal(catalog.liveStockOf(d, PRODUCT), 12, 'double rendu de stock')
  })

  it('bout en bout : supprimer un client avec une commande « new » rend le stock et le dit au master', async () => {
    const master = await loginMaster()
    const phone = '0550112200'
    const client = await registerClient(phone)
    const before = await stockOf()
    const ord = await call('POST', '/api/orders', { body: { name: 'Client Lot4', phone, items: items(2) }, token: client.token })
    assert.equal(ord.status, 201, JSON.stringify(ord.data))
    assert.equal(await stockOf(), before - 2, 'le stock doit être réservé')

    const del = await call('DELETE', `/api/customers/${client.id}`, { token: master })
    assert.equal(del.status, 200, `suppression : ${del.status} ${JSON.stringify(del.data)}`)
    assert.equal(del.data.ok, true)
    assert.deepEqual(
      (del.data.cancelled || []).map((c) => c.code),
      [ord.data.order.code],
      'la commande en cours doit être annoncée comme annulée'
    )
    assert.equal(del.data.releasedLines, 1)
    assert.equal(await stockOf(), before, 'le stock réservé n’a pas été rendu')

    const stored = storeOrder(ord.data.order.code)
    assert.equal(stored.status, 'cancelled')
    assert.equal(stored.userId, null, 'la commande reste à un compte supprimé')
    assert.ok(stored.name && stored.phone, 'l’historique perd son identité snapshotée')
  })
})

/* ------------------------------------------------------------------ 4.4 R20 */

describe('4.4 (R20) — commande guest au numéro d’un compte existant', () => {
  it('elle n’entre pas dans l’historique du titulaire et il ne peut pas l’annuler', async () => {
    const master = await loginMaster()
    const phone = '0550333444'
    const holder = await registerClient(phone)

    const guest = await call('POST', '/api/orders', {
      body: { name: 'Un tiers', phone, items: items(1) }
    })
    assert.equal(guest.status, 201, `commande guest refusée : ${guest.status} ${JSON.stringify(guest.data)}`)
    const code = guest.data.order.code

    assert.equal(storeOrder(code).claimable, false, 'la commande doit être marquée non revendicable')
    assert.equal(storeOrder(code).userId, null, 'une commande guest ne doit pas être rattachée au compte')

    const mine = await call('GET', '/api/me/orders', { token: holder.token })
    assert.equal(mine.status, 200)
    assert.equal(
      (mine.data.orders || []).some((o) => o.code === code),
      false,
      'la commande d’un tiers apparaît dans le compte du titulaire du numéro'
    )

    const cancel = await call('POST', `/api/me/orders/${code}/cancel`, { token: holder.token })
    assert.equal(cancel.status, 404, `annulation par un tiers : ${cancel.status}`)
    assert.equal(storeOrder(code).status, 'new', 'la commande a été annulée par un tiers')

    // Le comptoir, lui, la voit toujours : c'est une vraie commande.
    const all = await call('GET', '/api/orders', { token: master })
    assert.ok((all.data.orders || []).some((o) => o.code === code), 'commande invisible au comptoir')
  })

  it('numéro libre : une inscription ultérieure ne revendique pas une commande guest', async () => {
    const phone = '0550777888'
    const guest = await call('POST', '/api/orders', { body: { name: 'Futur client', phone, items: items(1) } })
    assert.equal(guest.status, 201)
    const code = guest.data.order.code
    assert.equal(storeOrder(code).claimable, false, 'toute commande guest doit être explicitement non revendicable')

    // Saisir le même numéro au profil n'est pas une possession vérifiée : aucun
    // compte ne doit donc récupérer ou annuler la commande serveur.
    const owner = await registerClient(phone)
    const mine = await call('GET', '/api/me/orders', { token: owner.token })
    assert.equal((mine.data.orders || []).some((o) => o.code === code), false)
    const cancel = await call('POST', `/api/me/orders/${code}/cancel`, { token: owner.token })
    assert.equal(cancel.status, 404, `annulation par simple numéro : ${cancel.status}`)
  })

  it('le titulaire qui commande lui-même reste propriétaire de sa commande', async () => {
    const phone = '0550999000'
    const holder = await registerClient(phone)
    const ord = await call('POST', '/api/orders', {
      body: { name: 'Titulaire', phone, items: items(1) },
      token: holder.token
    })
    assert.equal(ord.status, 201)
    const stored = storeOrder(ord.data.order.code)
    assert.equal(stored.userId, holder.id)
    assert.equal(stored.claimable, undefined, 'sa propre commande ne doit pas être marquée')
    const mine = await call('GET', '/api/me/orders', { token: holder.token })
    assert.ok((mine.data.orders || []).some((o) => o.code === ord.data.order.code))
  })

  it('un AUTRE compte connecté qui livre à ce numéro ne pollue pas le titulaire', async () => {
    const holderPhone = '0550222333'
    const holder = await registerClient(holderPhone)
    const other = await registerClient('0550444555')
    const ord = await call('POST', '/api/orders', {
      body: { name: 'Cadeau', phone: holderPhone, items: items(1) },
      token: other.token
    })
    assert.equal(ord.status, 201)
    const code = ord.data.order.code
    assert.equal(storeOrder(code).userId, other.id, 'la commande appartient à l’acheteur')
    assert.equal(storeOrder(code).claimable, undefined, 'une commande déjà rattachée ne porte pas de drapeau guest')

    const holderSees = await call('GET', '/api/me/orders', { token: holder.token })
    assert.equal((holderSees.data.orders || []).some((o) => o.code === code), false)
    const otherSees = await call('GET', '/api/me/orders', { token: other.token })
    assert.ok((otherSees.data.orders || []).some((o) => o.code === code), 'l’acheteur ne voit plus sa commande')
  })

  it('une commande guest, y compris au numéro du magasin, reste non revendicable', async () => {
    const master = await loginMaster()
    const masterPhone = '0770650387'
    const guest = await call('POST', '/api/orders', { body: { name: 'Client magasin', phone: masterPhone, items: items(1) } })
    assert.equal(guest.status, 201)
    assert.equal(storeOrder(guest.data.order.code).claimable, false)
    const all = await call('GET', '/api/orders', { token: master })
    assert.ok((all.data.orders || []).some((o) => o.code === guest.data.order.code))
  })
})

/* ------------------------------------------------------------------ 4.5 U11 */

describe('4.5 (U11) — commandes legacy « pending »', () => {
  it('migrées en « new » à la lecture, et la migration est persistée', async () => {
    const store = readStore()
    store.orders = store.orders || []
    store.orders.push({
      code: 'LG-PENDING-1',
      day: '2026-09-15',
      name: 'Legacy',
      phone: '0550000111',
      items: [],
      total: 0,
      userId: null,
      at: '2026-01-01T10:00:00.000Z',
      status: 'pending'
    })
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2))

    const master = await loginMaster()
    const all = await call('GET', '/api/orders', { token: master })
    assert.equal(all.status, 200)
    const row = (all.data.orders || []).find((o) => o.code === 'LG-PENDING-1')
    assert.ok(row, 'commande legacy introuvable')
    assert.equal(row.status, 'new', 'statut legacy encore servi')
    assert.equal((all.data.orders || []).some((o) => o.status === 'pending'), false, 'un `pending` subsiste dans la réponse')
    assert.equal(storeOrder('LG-PENDING-1').status, 'new', 'migration non persistée')
  })

  it('la réponse du comptoir est le statut RÉEL (plus de remapping d’affichage)', async () => {
    const master = await loginMaster()
    const ord = await call('POST', '/api/orders', { body: { name: 'Statut réel', phone: '0550000222', items: items(1) } })
    assert.equal(ord.status, 201)
    const code = ord.data.order.code
    const patch = await call('PATCH', `/api/orders/${code}`, { body: { status: 'preparing' }, token: master })
    assert.equal(patch.status, 200, JSON.stringify(patch.data))

    const all = await call('GET', '/api/orders', { token: master })
    const row = (all.data.orders || []).find((o) => o.code === code)
    assert.equal(row.status, 'preparing', 'le statut servi diffère du statut en base')
    assert.equal(storeOrder(code).status, 'preparing')
  })

  it('la route du comptoir ne remappe plus le statut à l’affichage', () => {
    // U11 : `GET /api/orders` renvoyait `pending → new` à l'affichage pendant
    // que `PATCH`/`DELETE` lisaient le statut brut. La migration rend ce
    // remapping inutile ; le laisser serait ré-introduire un écart entre ce que
    // le comptoir voit et ce que la base contient (et masquerait une régression
    // de la migration elle-même).
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/index.js'),
      'utf8'
    )
    const route = src.slice(src.indexOf("pathname === '/api/orders'"), src.indexOf("pathname === '/api/orders'", src.indexOf("pathname === '/api/orders'") + 10))
    assert.ok(route.length > 0, 'route GET /api/orders introuvable')
    assert.equal(route.includes("o.status === 'pending' ? 'new'"), false, 'remapping d’affichage encore présent')
  })

  it('une commande migrée suit les transitions de « new »', async () => {
    const master = await loginMaster()
    const patch = await call('PATCH', '/api/orders/LG-PENDING-1', { body: { status: 'preparing' }, token: master })
    assert.equal(patch.status, 200, `transition depuis une commande migrée : ${patch.status} ${JSON.stringify(patch.data)}`)
    assert.equal(storeOrder('LG-PENDING-1').status, 'preparing')
  })
})
