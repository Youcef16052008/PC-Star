import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashPass, verifyPass, hashPassLegacy } from '../server/db.js'

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
