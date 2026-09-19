/**
 * LOT P1 (audit 19/09/2026, B20 + B13) — les gardes de la commande.
 *
 * B20 : la « journée » (`YYYY-MM-DD`) n'était contrôlée que par une regex,
 * recopiée cinq fois. `2026-02-31` (jour inexistant) passait partout : il
 * entrait dans `order.day`, dans le code de commande `PS-20260231-0001`, dans le
 * nom de l'export CSV et dans le filtre de la liste du comptoir. `normalizeDay`
 * valide maintenant la date réelle (aller-retour dans un `Date`), et tous les
 * points d'entrée partagent cette fonction.
 *
 * B13 : une ligne connue du catalogue mais non tarifable (`priceOf` renvoie 0
 * pour un prix saisi en texte ou remis à zéro) était normalisée à `0` et la
 * commande était ACCEPTÉE. Rejoué à l'audit : `POST /api/orders` avec
 * `{id:'desk-info'}` → 201, `total: 0`. Le comptoir encaisse au retrait ; un
 * total à 0 est une vente offerte. Ces lignes sont maintenant refusées, et le
 * panier s'en décharge comme pour un produit retiré de la vente.
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { normalizeDay, orderApiFailure, orderBlockedMessage, dropCartLines, nextOrderCode, localDay } from './orderLogic.js'
import { t as translate, dict } from './i18n.js'
import { setOrderPickupDate } from '../server/catalog.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-guards-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.TRUST_PROXY
delete process.env.VERCEL

const { handler } = await import('../server/index.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')

const PAID_ID = 'cpu-7800x3d' // au catalogue, 97 000 DA
const FREE_ID = 'desk-info' // au catalogue, SANS prix (0)

let server
let base
let masterToken = ''

before(async () => {
  server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD })
  })
  masterToken = (await res.json()).token
})

after(
  () =>
    new Promise((resolve) => {
      server.close(resolve)
    })
)

beforeEach(() => {
  __rateLimitInternals.buckets.clear()
})

async function call(method, pathname, { body, token = null } = {}) {
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
  return { status: res.status, data, headers: res.headers }
}

const order = (over = {}) => ({
  name: 'Garde Client',
  phone: '0550123456',
  wilaya: 'Oran',
  slot: '10:30',
  items: [{ id: PAID_ID, qty: 1 }],
  ...over
})

describe('P1/B20 — normalizeDay : la date, pas le motif', () => {
  it('accepte une date réelle, y compris un 29 février bissextile', () => {
    assert.equal(normalizeDay('2026-09-19'), '2026-09-19')
    assert.equal(normalizeDay('2028-02-29'), '2028-02-29')
    assert.equal(normalizeDay(' 2026-12-31 '), '2026-12-31')
  })

  it('rejette les jours inexistants et les mois impossibles', () => {
    for (const bad of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-04-31', '9999-99-99', '0000-00-00', '0000-99-99']) {
      assert.equal(normalizeDay(bad), '', `${bad} doit être refusé`)
    }
  })

  it('rejette tout ce qui ne ressemble pas à une date ISO', () => {
    for (const bad of ['', null, undefined, '2026-9-5', '19/09/2026', '2026-09', '2026-09-19T12:00:00Z', 20260919, {}, [], 'true']) {
      assert.equal(normalizeDay(bad), '', `${JSON.stringify(bad)} doit être refusé`)
    }
  })

  it('ne décale rien selon le fuseau (composants, pas `new Date(chaîne)`)', () => {
    // Un parse de la chaîne en UTC reculerait d'un jour avant 1 h à Oran.
    assert.equal(normalizeDay('2026-01-01'), '2026-01-01')
    const d = new Date(2026, 0, 1, 12)
    assert.equal(localDay(d), '2026-01-01')
  })

  it('nextOrderCode retombe sur la journée réelle quand `day` est faux', () => {
    assert.equal(nextOrderCode(['PS-20260919-0004'], '2026-09-19'), 'PS-20260919-0005')
    const code = nextOrderCode(['PS-20260231-0004'], '2026-02-31')
    assert.match(code, new RegExp(`^PS-${localDay(new Date()).replace(/-/g, '')}-\\d{4}$`))
  })
})

describe('P1/B20 — le serveur ne stocke plus une date fantôme', () => {
  it('un `day` inexistant retombe sur la journée locale, sans code PS-20260231', async () => {
    const r = await call('POST', '/api/orders', { body: order({ day: '2026-02-31' }) })
    assert.equal(r.status, 201, `commande de contrôle : ${JSON.stringify(r.data)}`)
    assert.equal(r.data.order.day, localDay(new Date()))
    assert.ok(r.data.order.code.startsWith(`PS-${localDay(new Date()).replace(/-/g, '')}-`), r.data.order.code)
  })

  it('un `pickupDate` inexistant est refusé (400 pickup_date)', async () => {
    for (const bad of ['2026-02-31', '2026-13-01', 'au-plus-tot', '']) {
      const r = await call('POST', '/api/orders', { body: order({ pickupDate: bad }) })
      if (bad === '') {
        // Chaîne vide = « pas de choix explicite » (comportement existant) :
        // la date du jour sert de retrait, ce n'est pas une erreur.
        assert.equal(r.status, 201, JSON.stringify(r.data))
        assert.equal(r.data.order.pickupDate, r.data.order.day)
        continue
      }
      assert.equal(r.status, 400, `${bad} aurait dû être refusé : ${JSON.stringify(r.data)}`)
      assert.equal(r.data.error, 'pickup_date')
    }
    const ok = await call('POST', '/api/orders', { body: order({ pickupDate: '2026-12-24' }) })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.order.pickupDate, '2026-12-24')
  })

  it('le comptoir ne peut plus écrire une date inexistante dans une commande', () => {
    const db = { orders: [{ code: 'PS-20260919-0001', pickupDate: '2026-09-19' }] }
    assert.deepEqual(setOrderPickupDate(db, 'PS-20260919-0001', '2026-02-31'), { ok: false, error: 'pickup_date' })
    assert.equal(db.orders[0].pickupDate, '2026-09-19', 'la date d’origine est restée')
    const r = setOrderPickupDate(db, 'PS-20260919-0001', ' 2026-12-24 ')
    assert.equal(r.ok, true)
    assert.equal(r.order.pickupDate, '2026-12-24')
  })

  it('l’export CSV ignore une journée inexistante au lieu de produire un fichier vide', async () => {
    const hier = await call('GET', '/api/orders/export.csv?day=2026-02-31', { token: masterToken })
    assert.equal(hier.status, 200)
    const disposition = hier.headers.get('content-disposition') || ''
    assert.ok(!disposition.includes('2026-02-31'), `nom de fichier pollué : ${disposition}`)

    const jour = await call('GET', `/api/orders/export.csv?day=${localDay(new Date())}`, { token: masterToken })
    assert.equal(jour.status, 200)
    assert.ok(jour.headers.get('content-disposition').includes(localDay(new Date())))
  })

  it('une seule implémentation de la validation de date dans le projet', () => {
    const sources = ['server/catalog.js', 'server/index.js', 'src/orderLogic.js', 'api/index.js']
    for (const f of sources) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      const copies = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(l))
      assert.deepEqual(copies, [], `${f} reteste encore une date à la main : ${JSON.stringify(copies)}`)
    }
    assert.match(fs.readFileSync(path.join(process.cwd(), 'server', 'catalog.js'), 'utf8'), /normalizeDay/)
  })
})

describe('P1/B13 — une ligne sans prix n’est pas une commande', () => {
  it('POST /api/orders refuse le produit non tarifé (400 unpriced)', async () => {
    const r = await call('POST', '/api/orders', { body: order({ items: [{ id: FREE_ID, qty: 1 }] }) })
    assert.equal(r.status, 400, `la commande à 0 DA doit être refusée : ${JSON.stringify(r.data)}`)
    assert.equal(r.data.error, 'unpriced')
    const [line] = r.data.unpriced
    assert.equal(line.id, FREE_ID)
    assert.ok(String(line.name || '').length > 3, `la ligne doit être nommée, reçu ${JSON.stringify(line)}`)
  })

  it('le refus porte sur toute la commande : rien n’est décrémenté', async () => {
    const stockAvant = (await call('GET', `/api/stock/${PAID_ID}`)).data.stock
    const r = await call('POST', '/api/orders', { body: order({ items: [{ id: PAID_ID, qty: 2 }, { id: FREE_ID, qty: 1 }] }) })
    assert.equal(r.status, 400)
    assert.equal(r.data.unpriced.length, 1)
    assert.equal((await call('GET', `/api/stock/${PAID_ID}`)).data.stock, stockAvant)
  })

  it('une commande entièrement tarifée passe, et son total n’est jamais 0', async () => {
    const r = await call('POST', '/api/orders', { body: order({ items: [{ id: PAID_ID, qty: 1 }] }) })
    assert.equal(r.status, 201)
    assert.ok(r.data.order.total > 0, 'total strictement positif')
  })

  it('le client classe le refus et retire la ligne du panier', () => {
    const fail = orderApiFailure({ ok: false, status: 400, data: { error: 'unpriced', unpriced: [{ id: FREE_ID, name: 'X' }] } })
    assert.equal(fail.kind, 'unpriced')
    assert.deepEqual(fail.lines, [{ id: FREE_ID, name: 'X' }])
    assert.deepEqual(dropCartLines([{ id: FREE_ID, qty: 1 }, { id: PAID_ID, qty: 1 }], fail.lines), [{ id: PAID_ID, qty: 1 }])
  })

  it('le message nommé existe dans les deux langues et n’est pas réutilisé ailleurs', () => {
    const fr = (key, vars) => translate('fr', key, vars)
    const en = (key, vars) => translate('en', key, vars)
    for (const d of [dict.fr, dict.en]) {
      assert.ok(d.orderUnpriced && d.orderUnpricedDetail, 'clés présentes dans chaque langue')
      assert.notEqual(d.orderUnpriced, d.orderUnavailable, 'refus non tarifé ≠ produit retiré de la vente')
    }
    assert.equal(orderBlockedMessage([{ id: FREE_ID, name: 'Information comptoir' }], fr, 'unpriced'), fr('orderUnpricedDetail', { lines: 'Information comptoir' }))
    assert.ok(!orderBlockedMessage([], en, 'unpriced').includes('orderUnpriced'), 'rendu, pas une clé brute')
    assert.match(orderBlockedMessage([{ name: 'A' }, { name: 'B' }], fr, 'unpriced'), /A · B/)
  })

  it('le branchement UI est câblé dans App.jsx', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    assert.match(src, /fail\.kind === 'unpriced'/)
    assert.match(src, /orderBlockedMessage\(fail\.lines, t, fail\.kind\)/)
  })
})
