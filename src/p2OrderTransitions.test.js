/**
 * LOT P2 (audit 19/09/2026, B6) — la table des statuts de commande, et qui a
 * le droit d'écrire.
 *
 * Deux choses distinctes, mesurées séparément :
 *
 *  1. la table autorisait deux **arrières** (`preparing → new`,
 *     `ready → preparing`) qu'aucun bouton du comptoir ne propose — donc
 *     atteignables uniquement par un appelant qui n'a pas l'état courant ;
 *  2. rien ne disait si l'appelant **était à jour**. Un onglet resté ouvert
 *     depuis dix minutes peut écrire un mouvement parfaitement légal
 *     (`new → ready`) sur une commande que le comptoir a déjà menée plus loin,
 *     et le serveur applique sans savoir.
 *
 * (1) se corrige dans la table, qui est unique et partagée avec le serveur
 * (`server/catalog.js` l'importe — LOT P22, bug G). (2) se corrige par un
 * `expectedStatus` fourni par l'écran qui écrit : désaccord → 409 `stale`,
 * avec la vérité dans la réponse pour que la carte se recale.
 *
 * Réserves, écrites telles quelles dans `docs/VERIFICATION-RAPPORT-AUDIT-4.md` :
 * le rapport visait un « double-clic au comptoir » qui n'existe pas (aucun
 * bouton vers l'arrière), et le stock n'est pas altéré par un aller-retour
 * (`4 = 5 − 1` dans les deux sens) — ce qui est perdu, c'est la file du
 * comptoir et le statut vu par le client.
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'
import { ORDER_TRANSITIONS, canTransition } from './orderLogic.js'
import { setOrderStatus } from '../server/catalog.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-b6-status-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.TRUST_PROXY
delete process.env.VERCEL

const { handler } = await import('../server/index.js')
const { __rateLimitInternals } = await import('../server/rateLimit.js')
const api = await import('./api.js')

const PAID_ID = 'cpu-7800x3d'
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
  assert.ok(masterToken, 'session maître ouverte pour PATCH /api/orders/:code')
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  __rateLimitInternals.buckets.clear()
})

async function call(method, pathname, { body, token = masterToken } = {}) {
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

const nouvelleCommande = async (over = {}) => {
  const r = await call('POST', '/api/orders', {
    token: null,
    body: { name: 'Client Décalé', phone: '0550123456', wilaya: 'Oran', slot: '10:30', items: [{ id: PAID_ID, qty: 1 }], ...over }
  })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  return r.data.order
}

/** Un db minimal, sans passer par le disque : `setOrderStatus` est pur. */
const dbAvec = (statut) => ({
  orders: [{ code: 'PS-20260919-0001', status: statut, items: [{ id: PAID_ID, qty: 1 }], total: 1000 }],
  stock: { [PAID_ID]: 4 },
  meta: {}
})

describe('P2/B6 — la table ne connaît plus que l’avant', () => {
  it('les deux arrières mesurés sont fermés', () => {
    assert.equal(canTransition('preparing', 'new'), false, 'preparing → new encore ouvert')
    assert.equal(canTransition('ready', 'preparing'), false, 'ready → preparing encore ouvert')
    assert.deepEqual(ORDER_TRANSITIONS.preparing, ['ready', 'picked', 'cancelled'])
    assert.deepEqual(ORDER_TRANSITIONS.ready, ['picked', 'cancelled'])
  })

  it('le parcours du comptoir reste entier', () => {
    for (const [de, vers] of [
      ['new', 'preparing'],
      ['new', 'ready'],
      ['new', 'picked'],
      ['pending', 'preparing'],
      ['preparing', 'ready'],
      ['preparing', 'picked'],
      ['ready', 'picked'],
      ['new', 'cancelled'],
      ['preparing', 'cancelled'],
      ['ready', 'cancelled']
    ]) {
      assert.equal(canTransition(de, vers), true, `${de} → ${vers} refusé`)
    }
    for (const terminal of ['picked', 'cancelled']) {
      assert.deepEqual(ORDER_TRANSITIONS[terminal], [], `${terminal} peut encore bouger`)
    }
  })

  it('la table reste unique : le serveur ne peut pas en redéfinir une', () => {
    const code = fs
      .readFileSync(path.join(process.cwd(), 'server/catalog.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')
    assert.match(code, /import\s*\{[^}]*ORDER_TRANSITIONS[^}]*\}\s*from\s*'\.\.\/src\/orderLogic\.js'/)
    assert.equal(/new: \['preparing'/.test(code), false, 'une table de transitions est réapparue côté serveur')
  })

  it('setOrderStatus refuse le recul comme le client', () => {
    const db = dbAvec('preparing')
    assert.deepEqual(setOrderStatus(db, 'PS-20260919-0001', 'new'), {
      ok: false,
      error: 'transition',
      from: 'preparing',
      to: 'new'
    })
    assert.equal(db.orders[0].status, 'preparing', 'le refus a quand même écrit')
    assert.equal(setOrderStatus(db, 'PS-20260919-0001', 'ready').ok, true)
    const db2 = dbAvec('ready')
    assert.equal(setOrderStatus(db2, 'PS-20260919-0001', 'preparing').error, 'transition')
    assert.equal(db2.orders[0].status, 'ready')
  })
})

describe('P2/B6 — une écriture obsolète est refusée, pas appliquée', () => {
  it('désaccord sur l’état attendu : stale, avec la vérité au corps', () => {
    const db = dbAvec('preparing')
    // Le mouvement est LÉGAL (new → ready) : seule l'attente de l'appelant le
    // rend faux. C'est le cas que la table ne peut pas attraper.
    const r = setOrderStatus(db, 'PS-20260919-0001', 'ready', 'new')
    assert.equal(r.ok, false)
    assert.equal(r.error, 'stale')
    assert.equal(r.from, 'preparing')
    assert.equal(r.order.status, 'preparing', 'la réponse doit permettre au comptoir de se recaler')
    assert.equal(db.orders[0].status, 'preparing', 'le refus a quand même écrit')
  })

  it('aucun `expectedStatus` = comportement d’avant (clients anciens)', () => {
    // Trois appels identiques, trois bases neuves : reposer le MÊME statut
    // deux fois n'est pas une transition et serait refusé par la table.
    for (const attente of [undefined, '', null]) {
      const db = dbAvec('preparing')
      const r = setOrderStatus(db, 'PS-20260919-0001', 'ready', attente)
      assert.equal(r.ok, true, `${JSON.stringify(attente)} doit être traité comme une absence`)
      assert.equal(db.orders[0].status, 'ready')
    }
  })

  it('la garde s’applique aussi à l’annulation', () => {
    const db = dbAvec('picked')
    // `cancelOrder` court avant la table : sans la garde, un onglet qui croit la
    // commande « prête » pourrait l'annuler après le retrait en magasin.
    const r = setOrderStatus(db, 'PS-20260919-0001', 'cancelled', 'ready')
    assert.equal(r.ok, false)
    assert.equal(r.error, 'stale')
    assert.equal(db.orders[0].status, 'picked')
  })

  it('en direct : 409 avec le statut courant, puis 200 une fois recalé', async () => {
    const order = await nouvelleCommande()
    const code = order.code
    assert.equal(order.status, 'new')

    const premier = await call('PATCH', `/api/orders/${code}`, { body: { status: 'preparing', expectedStatus: 'new' } })
    assert.equal(premier.status, 200, JSON.stringify(premier.data))

    // Le vieil onglet, qui croit encore la commande en `new`.
    const perime = await call('PATCH', `/api/orders/${code}`, { body: { status: 'ready', expectedStatus: 'new' } })
    assert.equal(perime.status, 409, JSON.stringify(perime.data))
    assert.equal(perime.data.error, 'stale')
    assert.equal(perime.data.current, 'preparing')
    assert.equal(perime.data.order.status, 'preparing', 'la carte ne pourrait pas se recaler')

    // Le même écran, après relecture : ça passe.
    const recaler = await call('PATCH', `/api/orders/${code}`, { body: { status: 'ready', expectedStatus: 'preparing' } })
    assert.equal(recaler.status, 200, JSON.stringify(recaler.data))

    // Et les deux arrières retirés de la table sont refusés, même à jour.
    for (const [vers, attente] of [
      ['preparing', 'ready'],
      ['new', 'ready']
    ]) {
      const r = await call('PATCH', `/api/orders/${code}`, { body: { status: vers, expectedStatus: attente } })
      assert.equal(r.status, 400, `${vers} aurait dû être refusé : ${JSON.stringify(r.data)}`)
      assert.equal(r.data.error, 'transition')
    }
  })
})

describe('P2/B6 — le client envoie bien ce qu’il affiche', () => {
  it('patchOrder transmet expectedStatus quand on le lui donne', async () => {
    const garde = globalThis.fetch
    const vus = []
    globalThis.fetch = async (url, init = {}) => {
      vus.push({ url: String(url), body: JSON.parse(init.body || '{}') })
      return { ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() }
    }
    try {
      await api.patchOrder('PS-20260919-0007', 'ready', 'preparing')
      await api.patchOrder('PS-20260919-0007', 'ready')
      await api.patchOrder('PS-20260919-0007', 'ready', null)
    } finally {
      globalThis.fetch = garde
    }
    assert.equal(vus.length, 3)
    assert.deepEqual(vus[0].body, { status: 'ready', expectedStatus: 'preparing' })
    assert.deepEqual(vus[1].body, { status: 'ready' }, 'un appel sans attente ne doit rien inventer')
    assert.deepEqual(vus[2].body, { status: 'ready' })
    assert.match(vus[0].url, /\/api\/orders\/PS-20260919-0007$/)
  })

  it('le comptoir lit l’état affiché dans sa propre liste', () => {
    const app = fs
      .readFileSync(path.join(process.cwd(), 'src/App.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')
    const i = app.indexOf('async function handleOrderStatus')
    assert.ok(i > 0)
    const corps = app.slice(i, i + 1200)
    assert.match(corps, /reservationsRef\.current\.find\(\(o\) => o\?\.code === code\)\?\.status/)
    assert.match(corps, /api\.patchOrder\(code, status, visible\)/)
    assert.match(corps, /r\.status === 409 && r\.data\?\.error === 'stale'/, 'le 409 n’est pas traité')
    assert.match(corps, /deskStatusStale/, 'aucun message pour l’écran qui a perdu la main')
  })

  it('le message existe dans les deux langues', async () => {
    const { dict, LANGS, t } = await import('./i18n.js')
    for (const l of LANGS) {
      const v = dict[l.id].deskStatusStale
      assert.ok(typeof v === 'string' && v.length > 10, `${l.id} : ${JSON.stringify(v)}`)
      assert.notEqual(t(l.id, 'deskStatusStale'), 'deskStatusStale', 'clé morte')
    }
  })
})
