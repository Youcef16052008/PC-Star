/**
 * LOT P1 (audit 19/09/2026, B2 + B3) — ce que le serveur répond quand la
 * requête est mal formée, et ce qu'il ne répond JAMAIS.
 *
 * B3 : avant, chaque route décodait son segment à l'air libre dans le `try`
 * géant du handler. Une URI comme `/api/orders/%E0%A4%A` levait un `URIError`
 → le
 * `catch` global répondait **500**. Mesuré à l'audit, puis re-mesuré ici : c'est
 * un 400 typé (`invalid_code` / `invalid_id`) qui est attendu, et l'incohérence
 * entre routes (certaines ne décodant pas du tout) est refermée.
 *
 * B2 : le 500 portait `message: String(err.message)` — donc, vérifié en direct,
 * `EACCES: permission denied, open '/chemin/absolu/store.json.tmp'` : la
 * arborescence du serveur offerte à un appelant anonyme. Un 500 ne dit plus
 * qu'un code ; le détail reste dans le journal.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-http-errors-'))
process.env.PCSTAR_DATA_DIR = dir
const { handler } = await import('../server/index.js')

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
  const data = await res.json()
  masterToken = data.token
  assert.ok(masterToken, 'session maître ouverte pour les routes protégées')
})

after(
  () =>
    new Promise((resolve) => {
      fs.chmodSync(dir, 0o755)
      server.close(resolve)
    })
)

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
  return { status: res.status, data }
}

describe('P1/B3 — URI mal encodée : 400 typé, jamais 500', () => {
  const BROKEN = '%E0%A4%A' // séquence percent-encodée tronquée → URIError

  it('PATCH /api/orders/:code renvoie 400 invalid_code (et non 500)', async () => {
    const r = await call('PATCH', `/api/orders/${BROKEN}`, { body: { status: 'ready' }, token: masterToken })
    assert.equal(r.status, 400, `attendu 400, reçu ${JSON.stringify(r)}`)
    assert.equal(r.data.error, 'invalid_code')
    assert.equal(r.data.message, undefined, 'un 400 ne commente pas l’erreur interne')
  })

  it('la même URL sans session garde la priorité : 403 (autorisation d’abord)', async () => {
    const r = await call('PATCH', `/api/orders/${BROKEN}`, { body: { status: 'ready' } })
    assert.equal(r.status, 403)
    assert.equal(r.data.error, 'forbidden')
  })

  it('GET /api/stock/:id décode désormais son segment', async () => {
    const broken = await call('GET', `/api/stock/${BROKEN}`)
    assert.equal(broken.status, 400)
    assert.equal(broken.data.error, 'invalid_id')
    const ok = await call('GET', '/api/stock/cpu-7800x3d')
    assert.equal(ok.status, 200)
    assert.ok(Number.isFinite(ok.data.stock))
  })

  it('DELETE /api/customers/:id est aligné sur les autres routes maître', async () => {
    const r = await call('DELETE', `/api/customers/${BROKEN}`, { token: masterToken })
    assert.equal(r.status, 400)
    assert.equal(r.data.error, 'invalid_id')
    const gone = await call('DELETE', '/api/customers/u-inexistant', { token: masterToken })
    assert.equal(gone.status, 400, 'id valide mais inconnu : réponse métier inchangée')
  })

  it('aucun decodeURIComponent à l’air libre ne subsiste dans le handler', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8')
    const lignes = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      // lignes de commentaire ignorées ; la seule occurrence de code autorisée
      // est le `return` du helper `pathSegment()`
      .filter(({ line }) => line.includes('decodeURIComponent(') && !/^\s*(\/\/|\*)/.test(line))
      .filter(({ line }) => !/^\s*return decodeURIComponent/.test(line))
    assert.deepEqual(lignes, [], `sites de décodage non gardés : ${JSON.stringify(lignes)}`)
    assert.match(src, /err instanceof URIError/, 'le filet du catch global doit rester câblé')
  })
})

describe('P1/B2 — un 500 ne parle pas', () => {
  it('une panne d’écriture répond 500 { error: "server" } sans message ni chemin', async () => {
    const order = {
      name: 'Client 500',
      phone: '0550123456',
      wilaya: 'Oran',
      slot: '10:30',
      items: [{ id: 'cpu-7800x3d', qty: 1 }]
    }
    // Témoin : avec le répertoire de données accessible en écriture, ça passe.
    const avant = await call('POST', '/api/orders', { body: order })
    assert.equal(avant.status, 201, `commande de contrôle : ${JSON.stringify(avant.data)}`)

    fs.chmodSync(dir, 0o500) // r-x : plus aucune écriture (store.json.tmp, lock)
    let after = null
    try {
      after = await call('POST', '/api/orders', { body: { ...order, name: 'Client 500 bis' } })
    } finally {
      fs.chmodSync(dir, 0o755)
    }
    assert.equal(after.status, 500, `attendu 500, reçu ${JSON.stringify(after)}`)
    assert.equal(after.data.error, 'server')
    assert.equal(after.data.message, undefined, 'le message interne ne sort pas du serveur')
    assert.equal(
      JSON.stringify(after.data).includes('store.json'),
      false,
      'ni le nom du fichier de base, ni son chemin absolu'
    )
    assert.deepEqual(Object.keys(after.data).sort(), ['error', 'ok'])
  })

  it('le filet Vercel (`api/index.js`) observe la même règle', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'api', 'index.js'), 'utf8')
    assert.doesNotMatch(src, /message:\s*String\(/, 'le corps du 500 serverless ne porte plus err.message')
    assert.match(src, /console\.error\('api error', err\)/, 'le détail reste journalisé côté fonction')
  })
})
