import { after, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ce fichier exerce le callback sans démarrer server/index.js : les échanges
// vers Google/Meta restent injectés/mimés et les tests ne dépendent pas de ws.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-oauth-callback-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.OAUTH_DEMO = '0'
process.env.OAUTH_REDIRECT_BASE = 'https://api.pcstar.test'
process.env.GOOGLE_CLIENT_ID = 'google-client-test'
process.env.GOOGLE_CLIENT_SECRET = 'google-secret-test'
process.env.META_APP_ID = 'meta-app-test'
process.env.META_APP_SECRET = 'meta-secret-test'

const db = await import('../server/db.js')
const oauth = await import('../server/oauth.js')

beforeEach(() => {
  db.resetDbCache()
  db.writeDb(db.emptyDb())
})

after(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

function response(data, ok = true) {
  return { ok, json: async () => data }
}

async function stateFor(provider, options = {}) {
  const started = await oauth.startOAuth(provider, options)
  assert.equal(started.ok, true, `${provider} start: ${JSON.stringify(started)}`)
  assert.equal(started.demo, false)
  const state = new URL(started.authorizeUrl).searchParams.get('state')
  assert.match(state || '', /^[a-f0-9]{48}$/)
  return { started, state }
}

function googleFetch(calls, { email = 'google.callback@test.dz', verified = true, id = 'google-sub-42' } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://oauth2.googleapis.com/token') return response({ access_token: 'google-access-token' })
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return response({ sub: id, email, email_verified: verified, name: 'Google Callback', picture: 'https://image.test/g.png' })
    }
    throw new Error(`unexpected url ${url}`)
  }
}

function metaFetch(calls, { email = 'meta.callback@test.dz', id = 'meta-user-42' } = {}) {
  return async (url) => {
    calls.push(String(url))
    const parsed = new URL(String(url))
    if (parsed.pathname.endsWith('/oauth/access_token')) return response({ access_token: 'meta-access-token' })
    if (parsed.pathname.endsWith('/me')) return response({ id, email, name: 'Meta Callback' })
    throw new Error(`unexpected url ${url}`)
  }
}

describe('OAuth réel Google / Meta — callbacks serveur (phase 2)', () => {
  it('échange le code Google, exige un e-mail vérifié, consomme state et crée une session', async () => {
    const { started, state } = await stateFor('google', { intent: 'login', returnUrl: '/orders' })
    const authorization = new URL(started.authorizeUrl)
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://api.pcstar.test/api/oauth/google/callback')
    assert.equal(authorization.searchParams.get('scope'), 'openid email profile')

    const calls = []
    const done = await oauth.completeOAuthCallback('google', { state, code: 'google-code' }, { fetchImpl: googleFetch(calls) })
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal(done.user.email, 'google.callback@test.dz')
    assert.equal(done.returnUrl, '/orders')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token')
    assert.equal(calls[0].init.method, 'POST')
    assert.match(calls[0].init.body, /code=google-code/)
    assert.match(calls[0].init.body, /redirect_uri=https%3A%2F%2Fapi\.pcstar\.test%2Fapi%2Foauth%2Fgoogle%2Fcallback/)
    assert.equal(calls[1].init.headers.Authorization, 'Bearer google-access-token')

    const stored = db.readDb()
    assert.equal(stored.oauthPending[state], undefined, 'state consommé dans la mutation de session')
    assert.equal(db.findSession(stored, done.token)?.userId, done.user.id)
    assert.equal(JSON.stringify(stored).includes(done.token), false, 'le jeton OAuth brut n’est jamais persisté')
  })

  it('finalise Meta avec les endpoints officiels et le même state one-shot', async () => {
    const { started, state } = await stateFor('meta')
    const authorization = new URL(started.authorizeUrl)
    assert.equal(authorization.origin + authorization.pathname, 'https://www.facebook.com/v26.0/dialog/oauth')
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://api.pcstar.test/api/oauth/meta/callback')
    assert.equal(authorization.searchParams.get('scope'), 'email,public_profile')

    const calls = []
    const done = await oauth.completeOAuthCallback('meta', { state, code: 'meta-code' }, { fetchImpl: metaFetch(calls) })
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal(done.user.email, 'meta.callback@test.dz')
    assert.equal(calls.length, 2)
    assert.match(calls[0], /^https:\/\/graph\.facebook\.com\/v26\.0\/oauth\/access_token\?/)
    assert.equal(new URL(calls[0]).searchParams.get('code'), 'meta-code')
    assert.match(calls[1], /^https:\/\/graph\.facebook\.com\/v26\.0\/me\?/)
    assert.equal(new URL(calls[1]).searchParams.get('fields'), 'id,name,email')
    assert.equal(db.readDb().oauthPending[state], undefined)
  })

  it('refuse un profil Google dont le fournisseur ne confirme pas l’e-mail et invalide le state', async () => {
    const { state } = await stateFor('google')
    const calls = []
    const done = await oauth.completeOAuthCallback(
      'google',
      { state, code: 'unverified-code' },
      { fetchImpl: googleFetch(calls, { verified: false }) }
    )
    assert.deepEqual(done, { ok: false, error: 'oauth_provider' })
    assert.equal(calls.length, 2)
    assert.equal(db.readDb().oauthPending[state], undefined, 'pas de state rejouable après un échec fournisseur')
  })

  it('refuse Meta sans e-mail et consomme également le state', async () => {
    const { state } = await stateFor('meta')
    const done = await oauth.completeOAuthCallback(
      'meta',
      { state, code: 'meta-no-email' },
      { fetchImpl: metaFetch([], { email: '' }) }
    )
    assert.deepEqual(done, { ok: false, error: 'oauth_provider' })
    assert.equal(db.readDb().oauthPending[state], undefined)
  })

  it('refuse un state expiré avant tout appel réseau', async () => {
    const state = db.newToken()
    db.updateDb((stateDb) => {
      stateDb.oauthPending[state] = {
        provider: 'google',
        userId: null,
        intent: 'login',
        returnUrl: null,
        createdAt: Date.now() - db.PENDING_TTL_MS - 1
      }
      return stateDb
    })
    let calls = 0
    const done = await oauth.completeOAuthCallback(
      'google',
      { state, code: 'expired-code' },
      {
        fetchImpl: async () => {
          calls += 1
          return response({})
        }
      }
    )
    assert.deepEqual(done, { ok: false, error: 'state' })
    assert.equal(calls, 0, 'aucun code n’est envoyé à un fournisseur pour un state invalide')
  })

  it('consomme aussi le state lorsque le fournisseur renvoie une annulation', async () => {
    const { state } = await stateFor('google')
    let calls = 0
    const done = await oauth.completeOAuthCallback(
      'google',
      { state, error: 'access_denied' },
      {
        fetchImpl: async () => {
          calls += 1
          return response({})
        }
      }
    )
    assert.deepEqual(done, { ok: false, error: 'provider_cancelled' })
    assert.equal(calls, 0)
    assert.equal(db.readDb().oauthPending[state], undefined)
  })

  it('ne consomme un state concurrent qu’une fois et ne crée qu’une session', async () => {
    const { state } = await stateFor('google')
    const calls = []
    const fetchImpl = async (url, init) => {
      // Laisser les deux callbacks dépasser leur prélecture avant la mutation
      // finale reproduit la course qui existait avant le verrou de transaction.
      await new Promise((resolve) => setTimeout(resolve, 5))
      return googleFetch(calls)(url, init)
    }
    const outcomes = await Promise.all([
      oauth.completeOAuthCallback('google', { state, code: 'code-a' }, { fetchImpl }),
      oauth.completeOAuthCallback('google', { state, code: 'code-b' }, { fetchImpl })
    ])
    assert.equal(outcomes.filter((out) => out.ok).length, 1, JSON.stringify(outcomes))
    assert.equal(outcomes.filter((out) => out.error === 'state').length, 1, JSON.stringify(outcomes))
    const stored = db.readDb()
    assert.equal(stored.oauthPending[state], undefined)
    assert.equal(Object.values(stored.sessions).filter((session) => session?.auth === 'oauth:google').length, 1)
  })

  it('interdit OAuth au maître, au démarrage, par son e-mail et via une identité déjà liée', async () => {
    const master = db.readDb().users.find((user) => user.role === 'master')
    const forbiddenStart = await oauth.startOAuth('google', { intent: 'link', userId: master.id })
    assert.deepEqual(forbiddenStart, { ok: false, error: 'master_oauth_forbidden' })

    const byEmail = await stateFor('google')
    const masterAttempt = await oauth.completeOAuthCallback(
      'google',
      { state: byEmail.state, code: 'master-email' },
      { fetchImpl: googleFetch([], { email: master.email, id: 'master-provider-id' }) }
    )
    assert.deepEqual(masterAttempt, { ok: false, error: 'master_email' })

    const first = await stateFor('google')
    const firstDone = await oauth.completeOAuthCallback(
      'google',
      { state: first.state, code: 'first-owner' },
      { fetchImpl: googleFetch([], { email: 'owner@test.dz', id: 'shared-provider-id' }) }
    )
    assert.equal(firstDone.ok, true)
    const secondUser = { id: 'second-user', role: 'customer', email: 'second@test.dz', name: 'Second', links: { google: null, meta: null } }
    db.updateDb((stateDb) => {
      stateDb.users.push(secondUser)
      return stateDb
    })
    const second = await stateFor('google', { intent: 'link', userId: secondUser.id })
    const collision = await oauth.completeOAuthCallback(
      'google',
      { state: second.state, code: 'collision' },
      { fetchImpl: googleFetch([], { email: 'owner@test.dz', id: 'shared-provider-id' }) }
    )
    assert.deepEqual(collision, { ok: false, error: 'identity_linked' })
    assert.equal(db.readDb().oauthPending[second.state], undefined, 'le state de collision ne se rejoue pas')
  })
})
