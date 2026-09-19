import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD } from '../scripts/test-env.mjs'

// ---------------------------------------------------------------------------
// P21 — « je clique sur préparer / prêt / remis, rien ne change ».
//
// Deux mécanismes pouvaient produire ce symptôme, et aucun n'était couvert :
//
//  1. CÔTÉ SERVEUR — si l'écriture du store échoue (système de fichiers en
//     lecture seule comme sur Vercel, disque plein, répertoire verrouillé),
//     une exception remontait de `updateDbAsync`. Il fallait vérifier qu'elle
//     est bien convertie en réponse JSON exploitable, et non en connexion
//     pendue : sans réponse, le client ne peut rien afficher.
//
//  2. CÔTÉ CLIENT — quand `onStatus` renvoie `false` (échec API), le Desk doit
//     le dire au maître et réactiver ses boutons, pas rester muet et figé.
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-wfail-'))
const upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-wfail-up-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.PCSTAR_UPLOAD_DIR = upDir
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
  return { status: res.status, data, contentType: res.headers.get('content-type') || '' }
}

describe('P21 — un échec d’écriture du store renvoie une réponse exploitable', () => {
  it('PATCH /api/orders/:code → 500 JSON quand le store ne peut pas être écrit', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { email: TEST_MASTER_EMAIL, password: TEST_MASTER_PASSWORD }
    })
    assert.equal(login.status, 200, 'login master')
    const token = login.data.token
    assert.ok(token, 'token master obtenu')

    const created = await call('POST', '/api/orders', {
      token,
      body: { items: [{ id: 'cpu-7800x3d', qty: 1 }], name: 'Test écriture', phone: '0550123456' }
    })
    assert.equal(created.status, 201, 'commande créée')
    const code = created.data.order.code
    assert.ok(code, 'code de commande')

    // Contrôle : tant que le store est écrivable, la transition passe.
    const ok = await call('PATCH', `/api/orders/${code}`, { token, body: { status: 'preparing' } })
    assert.equal(ok.status, 200, 'transition nominale')
    assert.equal(ok.data.ok, true)

    // On rend l'écriture impossible APRÈS le démarrage : `writeDb` écrit
    // `store.json.tmp` puis le renomme. Si ce chemin est un répertoire,
    // `writeFileSync` lève EISDIR — exactement la classe d'échec d'un
    // système de fichiers en lecture seule.
    const tmpPath = path.join(dir, 'store.json.tmp')
    fs.mkdirSync(tmpPath, { recursive: true })
    try {
      const fail = await call('PATCH', `/api/orders/${code}`, { token, body: { status: 'ready' } })
      // Le point crucial : une RÉPONSE existe, en JSON, avec ok:false.
      // Sans elle, `req()` côté client ne se règle pas et le Desk se fige.
      assert.equal(fail.status, 500, `attendu 500, reçu ${fail.status}`)
      assert.match(fail.contentType, /application\/json/, 'réponse JSON, pas une connexion pendue')
      assert.equal(fail.data.ok, false, 'ok:false explicite')
      assert.equal(fail.data.error, 'server')
      // LOT P1 (audit 19/09/2026, B2) : le motif réel ne part PLUS dans la
      // réponse. Ce test exigeait `message` — c'est-à-dire qu'il verrouillait la
      // fuite mesurée à l'audit (`EISDIR: illegal operation on a directory,
      // open '/chemin/store.json.tmp'`, donc l'arborescence du serveur offerte à
      // un appelant). Ce qui est vérifié ici n'était pas le contrat utile : la
      // réponse doit rester un JSON `ok:false` (le Desk ne se fige pas), sans en
      // dire plus. Le diagnostic reste dans le journal du serveur.
      assert.equal(fail.data.message, undefined, 'aucun détail interne dans le corps du 500')
      const indexSrc = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8')
      assert.match(indexSrc, /console\.error\(err\)/, 'le catch global journalise la panne')

      // Le store ne doit pas être tronqué par l'échec.
      const raw = fs.readFileSync(path.join(dir, 'store.json'), 'utf8')
      const db = JSON.parse(raw)
      assert.ok(Array.isArray(db.orders), 'store.json toujours lisible après l’échec')
      assert.ok(db.orders.some((o) => o.code === code), 'la commande existe encore')
    } finally {
      fs.rmdirSync(tmpPath)
    }

    // L'écriture redevient possible et la transition repasse.
    const recovered = await call('PATCH', `/api/orders/${code}`, { token, body: { status: 'ready' } })
    assert.equal(recovered.status, 200, 'reprise après réparation')
    assert.equal(recovered.data.order.status, 'ready')
  })
})
