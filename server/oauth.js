/**
 * Google + Meta (Facebook) account linking.
 *
 * Demo mode (default): no real app secrets → simulated consent screens
 * that still create real link records in the DB.
 *
 * Production: set env
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   META_APP_ID, META_APP_SECRET
 *   OAUTH_REDIRECT_BASE (e.g. https://your-domain.dz)
 *   OAUTH_DEMO=0
 */

import crypto from 'node:crypto'
import { newId, newToken, readDbAsync, updateDbAsync, publicUser } from './db.js'

const DEMO = process.env.OAUTH_DEMO !== '0'
const BASE =
  process.env.OAUTH_REDIRECT_BASE ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:8787')

export function oauthConfig() {
  return {
    demo: DEMO,
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    metaConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    redirectBase: BASE
  }
}

/**
 * P13 (S2) — `returnUrl` vient du client et finit dans un `Location:` portant
 * un token de session : sans validation, c'est un open redirect qui exporte le
 * token vers le domaine de l'attaquant.
 *
 * Accepté : chemin relatif strict (`/desk`), ou URL absolue dont l'ORIGINE est
 * celle du front (FRONT_URL / FRONT_ORIGIN / OAUTH_REDIRECT_BASE / VERCEL_URL).
 * Tout le reste → null (le repli FRONT_URL s'applique).
 */
export function safeReturnUrl(raw) {
  const value = String(raw || '').trim()
  if (!value || value.length > 500) return null
  // Injection d'en-tête via CRLF dans le Location.
  if (/[\r\n\u0000]/.test(value)) return null
  // Relatif strict : ni protocol-relative (`//evil.com`), ni `/\evil.com`,
  // ni échappement encodé.
  if (value.startsWith('/')) {
    if (value.startsWith('//') || value.startsWith('/\\') || /^\/%2f/i.test(value)) return null
    return value
  }
  let u
  try {
    u = new URL(value)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const allowed = [
    BASE,
    process.env.FRONT_URL,
    process.env.FRONT_ORIGIN,
    process.env.OAUTH_REDIRECT_BASE,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null
  ].filter(Boolean)
  const ok = allowed.some((origin) => {
    try {
      return new URL(origin).origin === u.origin
    } catch {
      return false
    }
  })
  return ok ? value : null
}

export async function startOAuth(provider, { userId = null, intent = 'login', returnUrl = null } = {}) {
  if (provider !== 'google' && provider !== 'meta') {
    return { ok: false, error: 'provider' }
  }
  const state = newToken()
  // P13 (S2) : validé à l'entrée, re-validé à la redirection.
  const safeReturn = safeReturnUrl(returnUrl)
  await updateDbAsync((db) => {
    db.oauthPending[state] = {
      provider,
      userId,
      intent, // login | link
      returnUrl: safeReturn,
      createdAt: Date.now()
    }
    return db
  })

  const cfg = oauthConfig()
  if (DEMO || (provider === 'google' && !cfg.googleConfigured) || (provider === 'meta' && !cfg.metaConfigured)) {
    // Relative URL so Vite proxy / browser same-origin works in preview
    return {
      ok: true,
      demo: true,
      authorizeUrl: `/api/oauth/${provider}/demo?state=${state}`
    }
  }

  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${BASE}/api/oauth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account'
    })
    return { ok: true, demo: false, authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }
  }

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: `${BASE}/api/oauth/meta/callback`,
    state,
    scope: 'email,public_profile'
  })
  return { ok: true, demo: false, authorizeUrl: `https://www.facebook.com/v19.0/dialog/oauth?${params}` }
}

/**
 * P13 (S1/S3) — clôture une identité OAuth.
 *
 * S1 : le compte **master** ne se connecte QUE par mot de passe. Avant,
 * `finishIdentity` appariait par e-mail : en mode démo (défaut), taper
 * `pcstar.info31@gmail.com` dans l'écran de consentement donnait une session
 * master valide — escalade totale.
 *
 * S2 : en démo, l'e-mail n'est vérifié par personne. Seuls les comptes de
 * démonstration (`demo: true`) ou un lien déjà établi peuvent être ouverts ;
 * sinon n'importe qui prend le contrôle d'un compte client en tapant son
 * e-mail (celui d'une commande, par exemple).
 *
 * S3 : le token de session ne transite plus par la base (`db._lastAuth`) —
 * il était recopié dans `store.json` puis dans chaque backup.
 */
async function finishIdentity(provider, identity, pending, stateKey) {
  // Un e-mail n'est une preuve que si le fournisseur l'a vérifié.
  const trusted = !DEMO
  let outcome = null

  await updateDbAsync((db) => {
    let user = null

    if (pending.intent === 'link' && pending.userId) {
      user = db.users.find((u) => u.id === pending.userId)
      if (!user) {
        outcome = { ok: false, error: 'state' }
        return db
      }
      user.links = user.links || {}
      user.links[provider] = identity
    } else {
      const byLink = db.users.find((u) => u.links?.[provider]?.id === identity.id) || null
      const masterByEmail = Boolean(
        identity.email && db.users.some((u) => u.role === 'master' && u.email === identity.email)
      )
      // S1 : l'e-mail du magasin n'entre jamais par OAuth.
      if (masterByEmail && !byLink) {
        outcome = { ok: false, error: 'master_email' }
        return db
      }
      const byEmail =
        identity.email && !masterByEmail
          ? db.users.find((u) => u.email && u.email === identity.email) || null
          : null
      // S2 : en démo, pas d'appropriation d'un compte réel par simple e-mail.
      if (!trusted && byEmail && !byLink && byEmail.demo !== true) {
        outcome = { ok: false, error: 'demo_email' }
        return db
      }
      user = byLink || byEmail
      // P16 : un fournisseur qui ne renvoie PAS d'e-mail (compte Google/Meta
      // sans e-mail vérifié) créait un utilisateur `email: ''` — impossible à
      // reconnecter, et tous les suivants se confondaient avec lui. On refuse
      // la création ; un compte déjà lié (`byLink`) reste utilisable.
      if (!user && !String(identity.email || '').trim()) {
        outcome = { ok: false, error: 'no_email' }
        return db
      }
      if (!user) {
        user = {
          id: newId(provider === 'google' ? 'g' : 'm'),
          role: 'customer',
          email: identity.email || '',
          passwordHash: '',
          name: identity.name || (provider === 'google' ? 'Google user' : 'Meta user'),
          phone: '',
          avatar: provider === 'google' ? 'star' : 'pad',
          accent: 'green',
          provider,
          wilaya: 'Oran',
          demo: false,
          links: { google: null, meta: null, [provider]: identity }
        }
        db.users.push(user)
      } else {
        user.links = user.links || { google: null, meta: null }
        user.links[provider] = identity
        if (!user.name && identity.name) user.name = identity.name
        if (!user.email && identity.email) user.email = identity.email
      }
    }

    const token = newToken()
    db.sessions[token] = { userId: user.id, at: Date.now() }
    if (stateKey) delete db.oauthPending[stateKey]
    // S3 : renvoyé par closure, jamais écrit dans la base.
    outcome = { ok: true, token, user: publicUser(user) }
    return db
  })

  return outcome || { ok: false, error: 'state' }
}

export async function completeDemo(provider, state, profile = {}) {
  const db = await readDbAsync()
  const pending = db.oauthPending[state]
  if (!pending || pending.provider !== provider) return { ok: false, error: 'state' }

  const identity =
    provider === 'google'
      ? {
          id: profile.id || `google-demo-${crypto.randomBytes(4).toString('hex')}`,
          email: profile.email || 'google.user@pcstar.dz',
          name: profile.name || 'Google Demo',
          picture: profile.picture || null
        }
      : {
          id: profile.id || `meta-demo-${crypto.randomBytes(4).toString('hex')}`,
          email: profile.email || 'meta.user@pcstar.dz',
          name: profile.name || 'Meta Demo',
          picture: profile.picture || null
        }

  // Déjà validé par startOAuth (S2) — le pending ne contient qu'une valeur sûre.
  const returnUrl = pending.returnUrl || null
  const done = await finishIdentity(provider, identity, pending, state)
  if (!done?.ok) return done
  return { ok: true, token: done.token, user: done.user, returnUrl }
}

export async function unlinkProvider(userId, provider) {
  if (provider !== 'google' && provider !== 'meta') return { ok: false, error: 'provider' }
  let user = null
  await updateDbAsync((db) => {
    const u = db.users.find((x) => x.id === userId)
    if (!u) return db
    u.links = u.links || {}
    u.links[provider] = null
    user = u
    return db
  })
  if (!user) return { ok: false, error: 'missing' }
  return { ok: true, user: publicUser(user) }
}

export function demoConsentHtml(provider, state) {
  const label = provider === 'google' ? 'Google' : 'Meta (Facebook)'
  const color = provider === 'google' ? '#4285F4' : '#1877F2'
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Lier ${label} · PC Star</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b1220;color:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#151d2e;border:1px solid #2a364c;border-radius:16px;padding:24px;max-width:400px;width:92%}
h1{font-size:20px;margin:0 0 8px}
p{color:#94a3b8;font-size:14px;line-height:1.5}
label{display:block;font-size:13px;font-weight:700;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a364c;background:#0b1220;color:#fff;box-sizing:border-box}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:10px;background:${color};color:#fff;font-weight:700;cursor:pointer}
.note{font-size:12px;margin-top:12px;color:#64748b}
</style></head><body>
<form class="card" method="POST" action="/api/oauth/${provider}/demo">
  <h1>Connexion ${label}</h1>
  <p>Mode démo PC Star — aucun secret OAuth réel. En production, branchez les clés ${label}.</p>
  <input type="hidden" name="state" value="${state}"/>
  <label>Nom</label>
  <input name="name" value="${provider === 'google' ? 'Google Demo' : 'Meta Demo'}" required/>
  <label>E-mail</label>
  <input name="email" type="email" value="${provider === 'google' ? 'google.user@pcstar.dz' : 'meta.user@pcstar.dz'}"/>
  <button type="submit">Autoriser ${label}</button>
  <p class="note">Vous serez renvoyé vers la boutique avec une session liée.</p>
</form>
</body></html>`
}
