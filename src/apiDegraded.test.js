// P12 (B25) — une base injoignable ne doit JAMAIS vider la vitrine.
//
// Avant : `readDbAsync()` levait → 500 sur /api/catalog → le front marquait le
// catalogue « prêt » avec une liste vide → boutique sans AUCUN produit alors
// que Neon contenait tout. Ici on simule Neon mort (hôte .invalid, échec DNS
// immédiat) et on vérifie le repli catalogue + le mode dégradé affiché.
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-degraded-'))
process.env.PCSTAR_DATA_DIR = dir
// Endpoint pooled volontairement injoignable (TLD réservé .invalid).
process.env.DATABASE_URL =
  'postgresql://pcstar:secret@ep-dead-000000-pooler.invalid/neondb?sslmode=require'

const { handler } = await import('../server/index.js')
const { readDbSafe, dbUrlDiagnostics, emptyDb } = await import('../server/db.js')

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
  return { status: res.status, data }
}

describe('dbUrlDiagnostics (B25)', () => {
  it('détecte un endpoint -pooler vs direct, sans exposer le mot de passe', () => {
    const pooled = dbUrlDiagnostics(
      'postgresql://u:supersecret@ep-cool-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    )
    assert.equal(pooled.pooler, true)
    assert.equal(pooled.endpoint, 'ep-cool-123456')
    assert.equal(pooled.region, 'eu-central-1')
    assert.equal(pooled.database, 'neondb')
    assert.equal(JSON.stringify(pooled).includes('supersecret'), false, 'mot de passe jamais exposé')

    const direct = dbUrlDiagnostics(
      'postgresql://u:p@ep-cool-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    )
    assert.equal(direct.pooler, false, 'endpoint direct → lectures HTTP impossibles')

    assert.deepEqual(dbUrlDiagnostics(''), { configured: false })
    assert.equal(dbUrlDiagnostics('pas-une-url').parseError, true)
  })
})

describe('readDbSafe (B25)', () => {
  it('base injoignable → état de base + ok:false (pas d’exception)', async () => {
    const r = await readDbSafe()
    assert.equal(r.ok, false)
    assert.equal(r.driver, 'neon')
    assert.ok(r.error && r.error.length > 0)
    assert.equal(r.db.orders.length, 0)
    assert.ok(r.db.users.some((u) => u.role === 'master'), 'master toujours présent')
    assert.deepEqual(Object.keys(r.db.meta).sort(), Object.keys(emptyDb().meta).sort())
  })
})

describe('API en mode dégradé (B25)', () => {
  it('GET /api/catalog : 200 + catalogue de base complet + degraded:true', async () => {
    const { status, data } = await call('GET', '/api/catalog')
    assert.equal(status, 200, 'plus de 500 quand la base est morte')
    assert.equal(data.ok, true)
    // P21 : 223 SKU de base (27 « dz-hit » retirées), `speakers` en rupture
    // filtrée → 222 visibles.
    assert.ok(data.products.length >= 222, `catalogue non vide (${data.products.length})`)
    assert.equal(data.degraded, true)
    assert.equal(data.db.driver, 'neon')
    assert.equal(data.db.reachable, false)
    assert.ok(data.db.error)
    // LOT 3.16 (B19) : le repli est DATÉ et SOURCÉ, pour que le bandeau client
    // puisse dire depuis quand les prix affichés datent (au lieu de laisser
    // deviner s'ils ont cinq secondes ou trois mois).
    //  · `static` + `asOf: null` → aucune lecture n'a jamais abouti dans ce
    //    process : c'est le catalogue du build, âge inconnu ;
    //  · `cache` + `asOf` (ms) → la dernière lecture réussie, datée.
    assert.equal(data.db.source, 'static')
    assert.equal(data.db.asOf, null)
    const cpu = data.products.find((p) => p.id === 'cpu-7800x3d')
    assert.ok(cpu, 'produit de base servi')
    assert.equal(cpu.stock, 6, 'stock d’origine du catalogue')
  })

  it('GET /api/health : vivant, sans sonde DB, et annonce le driver', async () => {
    const { status, data } = await call('GET', '/api/health')
    assert.equal(status, 200)
    assert.equal(data.ok, true)
    assert.equal(data.db.driver, 'neon')
    assert.equal(data.db.configured, true)
    assert.equal(data.db.pooler, true)
    assert.equal(data.db.host, undefined, 'hôte de base non exposé publiquement')
  })

  it('GET /api/meta et /api/stock/:id : repli + degraded, pas de 500', async () => {
    const meta = await call('GET', '/api/meta')
    assert.equal(meta.status, 200)
    assert.equal(meta.data.degraded, true)
    assert.deepEqual(meta.data.meta.extraPanels, [])

    const stock = await call('GET', '/api/stock/cpu-7800x3d')
    assert.equal(stock.status, 200)
    assert.equal(stock.data.stock, 6)
    assert.equal(stock.data.degraded, true)
  })

  it('GET /api/db/status : réservé au master', async () => {
    const anon = await call('GET', '/api/db/status')
    assert.equal(anon.status, 403)
  })

  it('les ÉCRITURES restent strictes : une commande ne passe pas silencieusement', async () => {
    const r = await call('POST', '/api/orders', {
      body: { name: 'Karim', phone: '0550123456', items: [{ id: 'cpu-7800x3d', qty: 1 }] }
    })
    assert.equal(r.status, 500, 'base morte → échec explicite, jamais un faux succès')
    assert.equal(r.data.ok, false)
  })
})
