/**
 * LOT P0 (audit 19/09/2026, B1) — une panne de connexion Neon ne doit tuer que
 * la requête, jamais le processus.
 *
 * Le `Pool` de `@neondatabase/serverless` (le `pg` Pool embarqué) réémet sur son
 * EventEmitter toute erreur survenant sur un client **idle** ; sans auditeur,
 * Node jette hors de toute promesse et le serveur local s'arrête net. Mesuré à
 * l'audit contre un PostgreSQL factice cassant son socket juste après le
 * handshake :
 *
 *   Error: Connection terminated unexpectedly
 *       at …/@neondatabase/serverless/index.mjs:1010:76   → exit 1
 *
 * Ces tests verrouillent les deux gardes : l'auditeur `'error'` (avec son
 * compteur journalisé pour `GET /api/db/status`) et la reconstruction paresseuse
 * du pool. Ils jouent la panne **sans réseau** — `new Pool()` ne connecte pas,
 * et l'erreur est injectée par `emit('error')`, exactement comme le fait le
 * `makeIdleListener` du pilote.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const { transactionPool, peekTransactionPool, neonPoolStatus } = await import('../server/neonStore.js')

const BOGUS_A = 'postgres://u:p@ep-bogus-aaaa-pooler.invalid/db'
const BOGUS_B = 'postgres://u:p@ep-bogus-bbbb-pooler.invalid/db'

const noise = []
let realError
let realWarn

before(() => {
  realError = console.error
  realWarn = console.warn
  // Le correctif journalise la panne : on capture le bruit au lieu de l'imprimer.
  console.error = (...args) => noise.push(args)
  console.warn = (...args) => noise.push(args)
})

after(() => {
  console.error = realError
  console.warn = realWarn
})

/** Exécute un corps avec une `DATABASE_URL` imposée, puis restaure l'environnement. */
function withUrl(url, body) {
  const saved = process.env.DATABASE_URL
  if (url === null) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = url
  try {
    return body()
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = saved
  }
}

describe('P0/B1 — le pool Neon ne doit plus pouvoir tuer le processus', () => {
  it('sans DATABASE_URL : aucun pool construit, rien à garder', () => {
    withUrl(null, () => {
      assert.equal(transactionPool(), null)
      assert.equal(peekTransactionPool(), null)
      assert.equal(neonPoolStatus().active, false)
      assert.equal(neonPoolStatus().errorListeners, 0)
    })
  })

  it('avec DATABASE_URL : le pool porte l’auditeur « error » (le garde B1)', () => {
    withUrl(BOGUS_A, () => {
      const pool = transactionPool()
      assert.ok(pool, 'le pool doit être construit')
      assert.equal(transactionPool(), pool, 'il est mis en cache entre les écritures')
      assert.ok(
        pool.listenerCount('error') >= 1,
        "sans auditeur 'error', la panne d'un client idle remonte hors de toute promesse"
      )
      assert.equal(neonPoolStatus().active, true)
      assert.equal(neonPoolStatus().errorListeners, pool.listenerCount('error'))
    })
  })

  it('erreur sur un client idle : absorbée, journalisée, pool écarté puis reconstruit', () => {
    withUrl(BOGUS_A, () => {
      const pool = transactionPool()
      const before = neonPoolStatus()
      noise.length = 0

      pool.emit('error', new Error('Connection terminated unexpectedly'))

      const after = neonPoolStatus()
      assert.equal(after.idleErrors, before.idleErrors + 1, 'la panne doit être comptée')
      assert.match(String(after.lastError), /Connection terminated unexpectedly/)
      assert.ok(!Number.isNaN(Date.parse(String(after.lastErrorAt))), 'horodatage ISO')
      assert.equal(peekTransactionPool(), null, 'le pool fautif est écarté, jamais réutilisé')
      assert.equal(after.active, false)
      assert.ok(
        noise.some((args) => String(args.join(' ')).includes('client idle')),
        'la panne est journalisée côté serveur — jamais renvoyée au client'
      )

      const rebuilt = transactionPool()
      assert.ok(rebuilt, 'le pool suivant est créé à la prochaine écriture')
      assert.notEqual(rebuilt, pool, 'et c’est bien une instance neuve')
      assert.ok(rebuilt.listenerCount('error') >= 1, 'la garde survit à la reconstruction')
      assert.equal(neonPoolStatus().created, before.created + 1)
    })
  })

  it('rotation de DATABASE_URL : le pool figé sur l’ancienne base est écarté', () => {
    const saved = process.env.DATABASE_URL
    process.env.DATABASE_URL = BOGUS_A
    try {
      const first = transactionPool()
      process.env.DATABASE_URL = BOGUS_B
      const second = transactionPool()
      assert.notEqual(second, first, 'un cache inconditionnel survivrait à la rotation du secret')
      assert.ok(second.listenerCount('error') >= 1)
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = saved
    }
  })

  it('les rendus de client sont protégés, et le diagnostic ne charrie aucun secret', () => {
    const store = fs.readFileSync(path.join(ROOT, 'server', 'neonStore.js'), 'utf8')
    // Les quatre `finally { conn.release() }` doivent survivre à un pool écarté
    // en cours de requête : sans garde, une écriture réussie tournerait en 500.
    assert.equal(
      (store.match(/^\s*conn\.release\(\)$/gm) || []).length,
      0,
      'aucun release() brut ne doit revenir dans un finally'
    )
    assert.equal((store.match(/^\s*releaseQuietly\(conn\)$/gm) || []).length, 4)
    assert.match(store, /pool\.on\('error'/)

    const index = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
    assert.match(index, /neonPoolStatus\(\)/, 'la sonde master doit exposer l’état du pool')
    const status = neonPoolStatus()
    assert.deepEqual(
      Object.keys(status).sort(),
      ['active', 'created', 'errorListeners', 'idle', 'idleErrors', 'lastError', 'lastErrorAt', 'size']
    )
    assert.doesNotMatch(JSON.stringify(status), /postgres:\/\/|:p@|invalid/i, 'aucun fragment de chaîne de connexion')
  })
})
