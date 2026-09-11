import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashPass, verifyPass, hashPassLegacy } from '../server/db.js'
import { rateLimit, __rateLimitInternals } from '../server/rateLimit.js'

describe('password hashing', () => {
  it('verifies legacy sha256 seeds', () => {
    const leg = hashPassLegacy('star31')
    assert.equal(verifyPass('star31', leg), true)
    assert.equal(verifyPass('wrong', leg), false)
  })

  it('verifies new scrypt hashes', () => {
    const h = hashPass('secret99')
    assert.match(h, /^scrypt\$/)
    assert.equal(verifyPass('secret99', h), true)
    assert.equal(verifyPass('nope', h), false)
  })
})

describe('P10 (P7-9) — rate limit borné en mémoire (sweep des buckets expirés)', () => {
  it('compte les appels dans la fenêtre et rejette au-delà de max', () => {
    const t0 = 1_000_000
    assert.equal(rateLimit({ windowMs: 60_000, max: 2, key: 'k-a', now: t0 }).ok, true)
    assert.equal(rateLimit({ windowMs: 60_000, max: 2, key: 'k-a', now: t0 + 1 }).ok, true)
    const over = rateLimit({ windowMs: 60_000, max: 2, key: 'k-a', now: t0 + 2 })
    assert.equal(over.ok, false)
    assert.ok(over.retryAfter > 0)
  })

  it('balaye les buckets expirés quand la Map dépasse le seuil (pas de fuite)', () => {
    const { buckets } = __rateLimitInternals
    const before = buckets.size
    // 1200 clés EXPİRÉES (fenêtre 1000, now bien après) → la Map est chargée
    const tNow = 5_000_000
    for (let i = 0; i < 1200; i += 1) {
      rateLimit({ windowMs: 1000, max: 1, key: `old-${i}`, now: tNow - 60_000 })
    }
    assert.ok(buckets.size >= 1200, 'les buckets expirés s\'accumulent avant balayage')
    // un nouvel appel déclenche le sweep (size >= seuil)
    rateLimit({ windowMs: 1000, max: 1, key: 'fresh', now: tNow })
    const after = buckets.size
    // tous les anciens (expirés) sont partis, reste le « fresh » (+ avant)
    assert.ok(after < 10, `balayage attendu, size=${after}`)
    assert.ok(buckets.has('fresh'))
    assert.ok(!buckets.has('old-0'), 'les expirés sont purgés')
    assert.ok(after >= before - 5, 'on ne purge pas à l\'aveugle')
  })
})
