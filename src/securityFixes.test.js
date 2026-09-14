// P13 — lot 1 : les 4 trous de sécurité du rapport d'audit.
//
//   S1 (#2)  OAuth démo → session MASTER
//   S2 (#9)  open redirect + fuite du token de session via returnUrl
//   S3 (#10) token persisté dans la base (donc dans chaque backup)
//   S4 (#11) rate-limit contournable par X-Forwarded-For
//
// Chaque test reproduit l'attaque, pas seulement le code de la correction.
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-sec-'))
process.env.PCSTAR_DATA_DIR = dir
process.env.FRONT_URL = 'http://127.0.0.1:5173'
delete process.env.TRUST_PROXY
delete process.env.VERCEL
const DB_FILE = path.join(dir, 'store.json')

const { handler } = await import('../server/index.js')
const { safeReturnUrl } = await import('../server/oauth.js')
const { clientKey, clientIp, trustProxy, __rateLimitInternals } = await import('../server/rateLimit.js')
const { readDb } = await import('../server/db.js')

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

// Les tests de rate-limit remplissent les buckets : on repart de zéro.
beforeEach(() => {
  __rateLimitInternals.buckets.clear()
})

async function call(method, pathname, { body, token } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { status: res.status, data, text, headers: res.headers }
}

/** Parcours OAuth démo complet : start → consentement → Location. */
async function oauthDemo(provider, email, { returnUrl, intent = 'login' } = {}) {
  const st = await call('POST', '/api/oauth/start', { body: { provider, intent, returnUrl } })
  assert.equal(st.status, 200, 'oauth/start')
  const state = new URL(`http://x${st.data.authorizeUrl}`).searchParams.get('state')
  const res = await fetch(`${base}/api/oauth/${provider}/demo`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, email, name: 'Test OAuth' })
  })
  return {
    status: res.status,
    location: res.headers.get('location'),
    text: await res.text(),
    token: new URLSearchParams((res.headers.get('location') || '').split('?')[1] || '').get('oauth_token')
  }
}

// Le fichier n'existe qu'après la première écriture (ensure() paresseux).
const readStore = () => (fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {})

describe('S1 (#2) — OAuth ne peut plus ouvrir une session master', () => {
  it('e-mail du magasin dans le consentement démo → 403, aucun token', async () => {
    const before = readStore().sessions || {}
    const beforeMaster = Object.values(before).filter((s) => s.userId === 'master-pcstar').length

    const r = await oauthDemo('google', 'pcstar.info31@gmail.com')
    assert.equal(r.status, 403, `attendu 403, reçu ${r.status}`)
    assert.equal(r.token, null, 'aucun token ne doit être émis')
    assert.equal(r.location, null, 'aucune redirection')
    assert.match(r.text, /mot de passe/)

    const after = readStore().sessions || {}
    const afterMaster = Object.values(after).filter((s) => s.userId === 'master-pcstar').length
    assert.equal(afterMaster, beforeMaster, 'aucune session master créée')
  })

  it('pareil via Meta', async () => {
    const r = await oauthDemo('meta', 'pcstar.info31@gmail.com')
    assert.equal(r.status, 403)
    assert.equal(r.token, null)
  })

  it('régression : un compte de démonstration s’ouvre toujours', async () => {
    const r = await oauthDemo('google', 'karim.oran@demo.dz')
    assert.equal(r.status, 302, `attendu 302, reçu ${r.status} — ${r.text.slice(0, 120)}`)
    assert.ok(r.token, 'token émis')
    const me = await call('GET', '/api/me', { token: r.token })
    assert.equal(me.status, 200)
    assert.equal(me.data.user.role, 'customer', 'rôle customer, jamais master')
    assert.equal(me.data.user.id, 'demo-karim')
  })

  it('le master garde son login par mot de passe', async () => {
    const r = await call('POST', '/api/auth/login', {
      body: { email: 'pcstar.info31@gmail.com', password: 'star31' }
    })
    assert.equal(r.status, 200)
    const me = await call('GET', '/api/me', { token: r.data.token })
    assert.equal(me.data.user.role, 'master')
  })
})

describe('S2 (#9) — returnUrl : plus d’open redirect ni de fuite de token', () => {
  it('safeReturnUrl : accepte le relatif strict et la même origine, refuse le reste', () => {
    assert.equal(safeReturnUrl('/orders'), '/orders')
    assert.equal(safeReturnUrl('/desk?day=2026-09-13'), '/desk?day=2026-09-13')
    assert.equal(safeReturnUrl('http://127.0.0.1:5173/builder'), 'http://127.0.0.1:5173/builder')
    assert.equal(safeReturnUrl('https://evil.example/steal'), null)
    assert.equal(safeReturnUrl('//evil.example/steal'), null, 'protocol-relative')
    assert.equal(safeReturnUrl('/\\evil.example'), null, 'antislash')
    assert.equal(safeReturnUrl('/%2F%2Fevil.example'), null, 'échappement encodé')
    assert.equal(safeReturnUrl('javascript:alert(1)'), null)
    assert.equal(safeReturnUrl('data:text/html,x'), null)
    assert.equal(safeReturnUrl('/a\r\nX-Injected: 1'), null, 'CRLF')
    assert.equal(safeReturnUrl(''), null)
    assert.equal(safeReturnUrl('pas-une-url'), null)
    assert.equal(safeReturnUrl(`https://evil.example/${'a'.repeat(600)}`), null, 'trop long')
  })

  it('returnUrl tiers → la redirection part vers le front, sans le domaine attaquant', async () => {
    // 1) le returnUrl est neutralisé DÈS la création du consentement
    const st = await call('POST', '/api/oauth/start', {
      body: { provider: 'google', intent: 'login', returnUrl: 'https://evil.example/steal' }
    })
    const state = new URL(`http://x${st.data.authorizeUrl}`).searchParams.get('state')
    const pending = (readStore().oauthPending || {})[state]
    assert.equal(pending.returnUrl, null, 'returnUrl tiers persisté dans le consentement')

    // 2) la redirection finale ne peut donc pas quitter le front
    const r = await oauthDemo('google', 'victime.s2@test.dz', { returnUrl: 'https://evil.example/steal' })
    assert.equal(r.status, 302)
    assert.ok(r.location, 'une redirection a lieu')
    assert.equal(r.location.includes('evil.example'), false, `fuite : ${r.location}`)
    assert.match(r.location, /^http:\/\/127\.0\.0\.1:5173\/\?oauth_token=/)
  })

  it('returnUrl relatif → Location relative : le token ne quitte jamais l’origine', async () => {
    // Cas dev/preview proxifiée : FRONT_URL peut être absent ou différent de
    // l'origine réellement utilisée par le navigateur.
    const saved = process.env.FRONT_URL
    delete process.env.FRONT_URL
    try {
      const r = await oauthDemo('google', 'relatif.pur@test.dz', { returnUrl: '/' })
      assert.equal(r.status, 302)
      assert.match(r.location, /^\/\?oauth_token=/, `Location = ${r.location}`)
      assert.equal(/^https?:\/\//.test(r.location), false, 'aucun hôte dans le Location')
    } finally {
      process.env.FRONT_URL = saved
    }
  })

  it('returnUrl relatif et même origine → conservés', async () => {
    const rel = await oauthDemo('google', 'rel.s2@test.dz', { returnUrl: '/orders' })
    assert.equal(rel.status, 302)
    assert.match(rel.location, /^\/orders\/\?oauth_token=/)

    const same = await oauthDemo('meta', 'same.s2@test.dz', { returnUrl: 'http://127.0.0.1:5173/desk' })
    assert.equal(same.status, 302)
    assert.match(same.location, /^http:\/\/127\.0\.0\.1:5173\/desk\/\?oauth_token=/)
  })
})

describe('S2 (#9, suite) — en démo, un e-mail ne suffit plus à prendre un compte réel', () => {
  it('compte client créé par inscription → OAuth démo refusé (403)', async () => {
    const reg = await call('POST', '/api/auth/register', {
      body: { email: 'client.reel@test.dz', password: 'secret1', name: 'Client Réel' }
    })
    assert.equal(reg.status, 201)

    const r = await oauthDemo('google', 'client.reel@test.dz')
    assert.equal(r.status, 403, `attendu 403, reçu ${r.status}`)
    assert.equal(r.token, null)

    // Le compte n'est pas lié non plus.
    const store = readStore()
    const u = store.users.find((x) => x.email === 'client.reel@test.dz')
    assert.equal(u.links.google, null, 'aucun lien Google posé par la démo')
  })

  it('un e-mail inconnu crée toujours un compte client (flux nominal)', async () => {
    const r = await oauthDemo('google', 'nouveau.visiteur@test.dz')
    assert.equal(r.status, 302)
    const me = await call('GET', '/api/me', { token: r.token })
    assert.equal(me.data.user.role, 'customer')
    assert.equal(me.data.user.email, 'nouveau.visiteur@test.dz')
  })
})

describe('S3 (#10) — aucun token de session dans la base ni les backups', () => {
  it('après un login OAuth réussi, la base ne contient pas _lastAuth', async () => {
    const r = await oauthDemo('google', 'check.s3@test.dz')
    assert.equal(r.status, 302)
    assert.ok(r.token, 'le token est bien renvoyé au client')
    const store = readStore()
    assert.equal('_lastAuth' in store, false, '_lastAuth persisté dans store.json')
    assert.ok(store.sessions[r.token], 'la session existe (c’est elle qui porte le token)')
    // Le token ne doit apparaître nulle part ailleurs que dans la table des sessions.
    const sansSessions = { ...store }
    delete sansSessions.sessions
    assert.equal(JSON.stringify(sansSessions).includes(r.token), false, 'token présent hors sessions')
  })

  it('une base déjà polluée est nettoyée à la lecture', () => {
    const store = readStore()
    store._lastAuth = { token: 'fuite-historique', user: { id: 'x' } }
    store._err = 'exists'
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2))

    const cleaned = readDb()
    assert.equal('_lastAuth' in cleaned, false)
    assert.equal('_err' in cleaned, false)
    const onDisk = readStore()
    assert.equal('_lastAuth' in onDisk, false, 'la copie sur disque est purgée')
    assert.equal('_err' in onDisk, false)
  })
})

describe('S4 (#11) — X-Forwarded-For ne contourne plus le rate-limit', () => {
  it('clientIp : en-tête ignoré sans proxy de confiance, dernier saut avec', () => {
    const req = (xff, remote = '127.0.0.1') => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } })

    assert.equal(trustProxy(), false, 'TRUST_PROXY/VERCEL absents')
    assert.equal(clientIp(req('1.2.3.4')), '127.0.0.1', 'XFF forgé ignoré')
    assert.equal(clientKey(req('1.2.3.4'), 'login'), '127.0.0.1:login')

    process.env.TRUST_PROXY = '1'
    try {
      assert.equal(trustProxy(), true)
      assert.equal(clientIp(req('1.2.3.4')), '1.2.3.4', 'un seul saut → pris en compte')
      // Le client écrit « spoof », le proxy ajoute l'IP réelle à droite.
      assert.equal(clientIp(req('spoof, 203.0.113.9')), '203.0.113.9', 'dernier saut = celui du proxy')
      assert.equal(clientIp(req('')), '127.0.0.1', 'repli socket')
    } finally {
      delete process.env.TRUST_PROXY
    }
  })

  it('25 essais de mot de passe avec XFF tournant → 429 (brute-force stoppé)', async () => {
    let first429 = 0
    for (let i = 1; i <= 25; i += 1) {
      const r = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}` },
        body: JSON.stringify({ email: 'pcstar.info31@gmail.com', password: 'mauvais' })
      })
      if (r.status === 429) {
        first429 = i
        break
      }
    }
    assert.ok(first429 > 0 && first429 <= 21, `429 attendu au 21ᵉ au plus tard, obtenu : ${first429 || 'aucun'}`)
  })

  it('derrière un proxy déclaré, les vrais clients distincts gardent leur budget', async () => {
    process.env.TRUST_PROXY = '1'
    try {
      __rateLimitInternals.buckets.clear()
      const statuses = []
      for (let i = 1; i <= 3; i += 1) {
        const r = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i}` },
          body: JSON.stringify({ email: 'nobody@test.dz', password: 'mauvais' })
        })
        statuses.push(r.status)
      }
      assert.deepEqual(statuses, [401, 401, 401], '3 IPs distinctes → pas de 429')
    } finally {
      delete process.env.TRUST_PROXY
      __rateLimitInternals.buckets.clear()
    }
  })
})
