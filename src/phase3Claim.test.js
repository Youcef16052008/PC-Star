// Phase 3 (complément) — rattachement d'une commande guest par PREUVE réelle.
//
// Le plan de remédiation ferme la reprise par numéro de téléphone : aucune
// commande guest ne rejoint un compte parce qu'un profil a déclaré le même
// numéro. En contrepartie, le rattachement inter-appareil reste BESOIN réel du
// comptoir — un client réserve depuis son téléphone, puis crée son compte.
// La preuve disponible sans fournisseur OTP externe, c'est un code à usage
// unique émis par le maître au comptoir et remis en main propre.
//
// Ce fichier vérifie le chemin complet HTTP et les refus qui comptent :
//   · le maître émet, le client rattache — et la ligne disparaît de « guest » ;
//   · le code est à usage unique, refusé après consommation ou sur un inconnu ;
//   · une commande annulée/retirée ne peut plus être rattacher ni coder ;
//   · le brute force sur /claim est borné (rate limit) ;
//   · l'unitaire in-mutator : consommation DANS la mutation, jamais avant.
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-claim-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.FRONT_URL = 'http://127.0.0.1:5173'
delete process.env.TRUST_PROXY
delete process.env.VERCEL
const DB_FILE = path.join(dir, 'store.json')

const { handler } = await import('../server/index.js')
const { claimGuestOrder, issueClaimCode, normalizeClaimCode } = await import('../server/catalog.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')
const { readDb } = await import('../server/db.js')

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
    })
)

// Le test de rate limit remplit le bucket 'claim' : chaque test repart de zéro.
beforeEach(() => {
  __rateLimitInternals.buckets.clear()
})

async function call(method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { status: res.status, data, text }
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
async function registerClient() {
  seq += 1
  const email = `claim.${seq}.${Date.now()}@test.dz`
  const r = await call('POST', '/api/auth/register', {
    body: { email, password: 'motdepasse123', name: `Client Claim ${seq}` }
  })
  assert.equal(r.status, 201, `inscription : ${r.status} ${JSON.stringify(r.data)}`)
  return { email, token: r.data.token, id: r.data.user?.id }
}

async function guestOrder(name = 'Client comptoir') {
  const r = await call('POST', '/api/orders', {
    body: {
      name,
      phone: `05509900${String(seq % 10).padStart(2, '0')}`,
      items: [{ id: 'ssd-1t', sku: 'SN770', name: 'SSD NVMe 1 To', qty: 1, price: 1 }]
    }
  })
  assert.equal(r.status, 201, `commande guest : ${r.status} ${JSON.stringify(r.data)}`)
  return r.data.order
}

describe('Phase 3 — code de retrait comptoir : chemin nominal', () => {
  it('maître émet → client rattache → la commande rejoint SON historique', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const order = await guestOrder()

    // Une route non maîtresse ne peut pas émettre de code.
    const forbidden = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/claim-code`, {
      token: client.token
    })
    assert.equal(forbidden.status, 403)

    const issued = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/claim-code`, { token: master })
    assert.equal(issued.status, 200, JSON.stringify(issued.data))
    const claimCode = issued.data.claimCode
    assert.match(claimCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, 'code dictable : 4+4 sans caractères ambigus')

    // Seule l'empreinte est persistée — jamais le code en clair.
    assert.equal(JSON.stringify(readStore()).includes(claimCode), false)
    assert.ok(storeOrder(order.code).claimCodeHash, 'empreinte du code stockée')

    // Le code normalisé tolère la saisie : minuscules, espaces, tirets.
    const typed = claimCode.toLowerCase().replace('-', ' ')
    const claimed = await call('POST', '/api/me/orders/claim', { body: { code: typed }, token: client.token })
    assert.equal(claimed.status, 200, JSON.stringify(claimed.data))
    assert.equal(claimed.data.order.userId, client.id)

    const stored = storeOrder(order.code)
    assert.equal(stored.userId, client.id, 'la commande appartient au client')
    assert.equal(stored.claimable, undefined, 'le drapeau guest est retiré')
    assert.equal(stored.claimCodeHash, undefined, 'code consommé : plus aucune empreinte')
    assert.ok(stored.claimedAt, 'rattachement tracé')

    const mine = await call('GET', '/api/me/orders', { token: client.token })
    assert.ok((mine.data.orders || []).some((o) => o.code === order.code), 'visible dans « Mes commandes »')
  })

  it('le client rattaché peut ensuite annuler sa commande comme les autres', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const order = await guestOrder()
    const issued = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/claim-code`, { token: master })
    assert.equal(issued.status, 200)
    const claimed = await call('POST', '/api/me/orders/claim', { body: { code: issued.data.claimCode }, token: client.token })
    assert.equal(claimed.status, 200)

    const cancel = await call('POST', `/api/me/orders/${encodeURIComponent(order.code)}/cancel`, { token: client.token })
    assert.equal(cancel.status, 200, `annulation après rattachement : ${cancel.status} ${JSON.stringify(cancel.data)}`)
    assert.equal(storeOrder(order.code).status, 'cancelled')
  })
})

describe('Phase 3 — code de retrait : refus et usage unique', () => {
  it('code inconnu, code rejoué : 404, aucune fuite sur l’existence', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const order = await guestOrder()
    const issued = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/claim-code`, { token: master })
    const claimCode = issued.data.claimCode

    const replay = await call('POST', '/api/me/orders/claim', { body: { code: claimCode }, token: client.token })
    assert.equal(replay.status, 200, 'première utilisation : OK')
    const second = await call('POST', '/api/me/orders/claim', { body: { code: claimCode }, token: client.token })
    assert.equal(second.status, 404, 'un code consommé ne dit rien de la commande')
    assert.equal(second.data.error, 'not_found')

    const unknown = await call('POST', '/api/me/orders/claim', { body: { code: 'ZZZZ-ZZZZ' }, token: client.token })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.data.error, 'not_found')

    const malformed = await call('POST', '/api/me/orders/claim', { body: { code: 'bonjour' }, token: client.token })
    assert.equal(malformed.status, 404)
  })

  it('commande déjà rattachée : le comptoir ne peut plus émettre de code', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const r = await call('POST', '/api/orders', {
      body: {
        name: 'Titulaire',
        phone: '0550111222',
        items: [{ id: 'ssd-1t', sku: 'SN770', name: 'SSD NVMe 1 To', qty: 1, price: 1 }]
      },
      token: client.token
    })
    assert.equal(r.status, 201)
    const issued = await call('POST', `/api/orders/${encodeURIComponent(r.data.order.code)}/claim-code`, { token: master })
    assert.equal(issued.status, 400)
    assert.equal(issued.data.error, 'attached')
  })

  it('commande annulée : ni code ni rattachement (statut contrôlé dans la mutation)', async () => {
    const master = await loginMaster()
    const client = await registerClient()
    const order = await guestOrder()
    const cancelled = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/cancel`, { token: master })
    assert.equal(cancelled.status, 200)

    const issued = await call('POST', `/api/orders/${encodeURIComponent(order.code)}/claim-code`, { token: master })
    assert.equal(issued.status, 409)
    assert.equal(issued.data.error, 'status')

    // Un code émis avant l'annulation ne doit pas non plus rattacher.
    const order2 = await guestOrder('Second comptoir')
    const issued2 = await call('POST', `/api/orders/${encodeURIComponent(order2.code)}/claim-code`, { token: master })
    assert.equal(issued2.status, 200)
    await call('POST', `/api/orders/${encodeURIComponent(order2.code)}/cancel`, { token: master })
    const claimed2 = await call('POST', '/api/me/orders/claim', { body: { code: issued2.data.claimCode }, token: client.token })
    assert.equal(claimed2.status, 409)
    assert.equal(claimed2.data.error, 'status')
    assert.equal(storeOrder(order2.code).userId, null, 'la commande annulée reste guest')
  })

  it('le brute force sur /claim est borné (429 au-delà de la fenêtre)', async () => {
    const client = await registerClient()
    let last = null
    for (let i = 0; i < 12; i += 1) {
      last = await call('POST', '/api/me/orders/claim', { body: { code: 'AAAA-AAAA' }, token: client.token })
      if (last.status === 429) break
    }
    assert.equal(last.status, 429, `la 11ᵉ tentative doit être refusée, reçu ${last?.status}`)
  })

  it('sans session : ni émission ni rattachement', async () => {
    const issued = await call('POST', '/api/orders/PS-20260918-9999/claim-code')
    assert.equal(issued.status, 403)
    const claimed = await call('POST', '/api/me/orders/claim', { body: { code: 'AAAA-BBBB' } })
    assert.equal(claimed.status, 401)
  })
})

describe('Phase 3 — unitaire : la consommation du code vit DANS la mutation', () => {
  it('claimGuestOrder ne mute qu’en présence d’un code valide, issueClaimCode refuse les non-guest', () => {
    const db = readDb()
    const guest = { code: 'PS-CLAIM-0001', status: 'new', userId: null, claimable: false, items: [] }
    const owned = { code: 'PS-CLAIM-0002', status: 'new', userId: 'u-1', items: [] }
    db.orders = [guest, owned]

    assert.equal(normalizeClaimCode(' ab2c-9d4f '), 'AB2C9D4F', 'saisie tolérante, stockage compact')
    assert.equal(normalizeClaimCode('O0I1L'), null, 'caractères ambigus hors alphabet')

    const bad = claimGuestOrder(db, 'ZZZZ-ZZZZ', 'u-2')
    assert.equal(bad.ok, false)
    assert.equal(guest.userId, null, 'aucune mutation sur code inconnu')
    assert.equal(guest.claimable, false)

    const attached = issueClaimCode(db, 'PS-CLAIM-0002')
    assert.deepEqual(attached, { ok: false, error: 'attached' })
    assert.equal(owned.claimCodeHash, undefined)

    const unknownOrder = issueClaimCode(db, 'PS-CLAIM-9999')
    assert.equal(unknownOrder.ok, false)

    const issued = issueClaimCode(db, 'PS-CLAIM-0001')
    assert.equal(issued.ok, true)
    assert.ok(guest.claimCodeHash)
    assert.ok(issued.claimCode)

    const claimed = claimGuestOrder(db, issued.claimCode, 'u-2')
    assert.equal(claimed.ok, true)
    assert.equal(guest.userId, 'u-2')
    assert.equal(guest.claimable, undefined)
    assert.equal(guest.claimCodeHash, undefined)
  })
})
