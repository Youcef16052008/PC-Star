/**
 * LOT P2 (audit 19/09/2026, B7) — le compte de démonstration **revendiqué** par
 * une identité fournisseur doit cesser d'être un compte de démonstration.
 *
 * Le rapport #4 résumait ça par « OAuth ne déverrouille pas le mot de passe ».
 * Mesuré dans `server/oauth.js` : la branche qui **crée** l'utilisateur posait
 * `demo: false`, les deux branches qui **rattachent** une identité à un compte
 * existant ne touchaient pas le marqueur. Trois effets, vérifiés un par un ci
 * dessous : `normalizeDb` remet le mot de passe partagé à chaque lecture, la
 * garde S2 croit le compte encore démonstratif, et `/api/auth/login` lui
 * répond `demo_locked`.
 */
import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-b7-oauth-'))
process.env.PCSTAR_DATA_DIR = path.join(root, 'data')
process.env.OAUTH_DEMO = '0'
process.env.OAUTH_REDIRECT_BASE = 'https://api.pcstar.test'
process.env.GOOGLE_CLIENT_ID = 'google-client-b7'
process.env.GOOGLE_CLIENT_SECRET = 'google-secret-b7'
process.env.META_APP_ID = 'meta-app-b7'
process.env.META_APP_SECRET = 'meta-secret-b7'
process.env.DEMO_PASSWORD = 'mot-de-passe-demo-partage'

const SRC = fs.readFileSync(path.join(process.cwd(), 'server/oauth.js'), 'utf8')
const db = await import('../server/db.js')
const oauth = await import('../server/oauth.js')

const KARIM = 'demo-karim'
const KARIM_EMAIL = 'karim.oran@demo.dz'

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

/** `email_verified: true` : sans cette preuve, `finishIdentity` ne rattache rien. */
function googleFetch(calls, { email, id = 'google-b7-sub' } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url) === 'https://oauth2.googleapis.com/token') return response({ access_token: 'b7-access-token' })
    if (String(url) === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return response({ sub: id, email, email_verified: true, name: 'Titulaire réel', picture: null })
    }
    throw new Error(`unexpected url ${url}`)
  }
}

async function startState(provider, options = {}) {
  const started = await oauth.startOAuth(provider, options)
  assert.equal(started.ok, true, JSON.stringify(started))
  const url = new URL(started.authorizeUrl, 'https://api.pcstar.test')
  return { started, state: url.searchParams.get('state') }
}

/** Callback Google **réel** (échangé auprès du fournisseur) pour un e-mail donné. */
async function claimWithGoogle(email, id) {
  const { state } = await startState('google')
  const calls = []
  const done = await oauth.completeOAuthCallback(
    'google',
    { state, code: 'b7-code' },
    { fetchImpl: googleFetch(calls, { email, id }) }
  )
  return { done, state }
}

function userOf(id) {
  return db.readDb().users.find((u) => u.id === id)
}

describe('P2/B7 — la revendication OAuth retire le statut démonstratif', () => {
  it('avant le correctif, le fixture revendiqué était bien ouvrable au mot de passe partagé', () => {
    const u = userOf(KARIM)
    assert.equal(u.demo, true)
    assert.equal(db.verifyPass(process.env.DEMO_PASSWORD, u.passwordHash), true, 'pré-condition du repro')
  })

  it('le rattachement par e-mail vérifié retire le marqueur et le mot de passe partagé', async () => {
    const stored = db.readDb()
    // Une session ouverte avec le mot de passe partagé avant la revendication.
    db.putSession(stored, 'jeton-du-partage', KARIM)
    db.writeDb(stored)
    assert.ok(db.findSession(db.readDb(), 'jeton-du-partage'), 'la session témoin doit exister avant')

    const { done } = await claimWithGoogle(KARIM_EMAIL, 'google-b7-sub')
    assert.equal(done.ok, true, JSON.stringify(done))
    assert.equal(done.user.id, KARIM, 'c’est bien le fixture qui est repris, pas un doublon créé')

    const apres = userOf(KARIM)
    assert.equal(apres.demo, false, 'le compte revendiqué n’est plus une démo')
    assert.equal(db.verifyPass(process.env.DEMO_PASSWORD, apres.passwordHash), false, 'le mot de passe partagé ne vaut plus rien')

    // L'inverse de la régression : `normalizeDb` re-positonne l'empreinte à
    // chaque lecture tant que `demo === true`. Une deuxième lecture prouve que
    // l'état est stable et non pas « corrigé jusqu'au prochain relus ».
    db.resetDbCache()
    const relu = userOf(KARIM)
    assert.equal(relu.demo, false)
    assert.equal(relu.passwordHash, null)
    assert.equal(db.verifyPass(process.env.DEMO_PASSWORD, relu.passwordHash), false, 're-verrouillé par normalizeDb')

    // Et les sessions ouvertes avec le mot de passe partagé sont coupées.
    assert.ok(!db.findSession(db.readDb(), 'jeton-du-partage'), 'session de l’ancien partage encore valide')
  })

  it('le rattachement depuis une session ouverte (intent link) retire le marqueur aussi', async () => {
    const stored = db.readDb()
    const token = db.createSession(stored, KARIM, { auth: 'password' })
    db.writeDb(stored)

    const { state } = await startState('google', { intent: 'link', userId: KARIM })
    const calls = []
    const done = await oauth.completeOAuthCallback(
      'google',
      { state, code: 'b7-code' },
      { fetchImpl: googleFetch(calls, { email: 'autre.adresse@test.dz', id: 'google-b7-link' }) }
    )
    assert.equal(done.ok, true, JSON.stringify(done))
    const apres = userOf(KARIM)
    assert.equal(apres.demo, false)
    assert.equal(apres.passwordHash, null)
    assert.ok(!db.findSession(db.readDb(), token), 'la session ouverte par le mot de passe partagé court encore')
  })

  it('la garde S2 devient effective sur un compte revendiqué', async () => {
    const { done } = await claimWithGoogle(KARIM_EMAIL, 'google-b7-sub')
    assert.equal(done.ok, true)

    // Un callback **non vérifié** (mode démo) qui présente la même adresse ne
    // doit plus pouvoir recoller une identité sur ce compte : avant le
    // correctif, `demo === true` le lui permettait.
    process.env.OAUTH_DEMO = '1'
    try {
      const { state } = await startState('google')
      const refus = await oauth.completeDemo('google', state, {
        id: 'intrus-sans-preuve',
        email: KARIM_EMAIL,
        name: 'Intrus'
      })
      assert.deepEqual(refus, { ok: false, error: 'demo_email' }, 'compte revendiqué encore rattachable sans preuve')
      assert.equal(userOf(KARIM).links?.google?.id, 'google-b7-sub', 'le lien du titulaire a été écrasé')
    } finally {
      process.env.OAUTH_DEMO = '0'
    }
  })

  it('en mode démo, rien n’est retiré : les fixtures restent ouvrables', async () => {
    process.env.OAUTH_DEMO = '1'
    try {
      const { state } = await startState('google')
      const ok = await oauth.completeDemo('google', state, { id: 'demo-sub', email: 'nimportimporte@x.dz', name: 'Visite' })
      assert.equal(ok.ok, true, JSON.stringify(ok))
    } finally {
      process.env.OAUTH_DEMO = '0'
    }
    const u = userOf(KARIM)
    assert.equal(u.demo, true, 'une identité simulée ne doit pas revendiquer un fixture')
    assert.equal(db.verifyPass(process.env.DEMO_PASSWORD, u.passwordHash), true)
  })
})

describe('P2/B7 — le code ne peut plus oublier une des deux branches', () => {
  it('les deux rattachements passent par claimDemoAccount', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')
    assert.equal((code.match(/if \(trusted\) claimDemoAccount\(db, user\)/g) || []).length, 2)
    assert.match(code, /function claimDemoAccount\(db, user\) \{[\s\S]*?user\.demo = false[\s\S]*?user\.passwordHash = null/)
    // Le marqueur ne se retire qu'à un seul endroit : le helper. Une branche
    // qui le retirerait pour son propre compte divergence forcément (c'est
    // exactement l'oubli qui a produit B7).
    assert.equal((code.match(/user\.demo = false/g) || []).length, 1, 'un `demo = false` hors de claimDemoAccount')
  })
})
