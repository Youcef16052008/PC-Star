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
import {
  createSession,
  isOAuthPendingExpired,
  newId,
  newToken,
  readDbAsync,
  updateDbAsync,
  publicUser
} from './db.js'

// LOT 3.13 (B18) : `OAUTH_DEMO` et `OAUTH_REDIRECT_BASE` étaient évalués UNE
// fois, à l'import du module. Conséquence : un test (ou tout rechargement à
// chaud) qui posait ces variables APRÈS le premier import continuait de voir
// celles du démarrage — mode démo impossible à désactiver, base de redirection
// impossible à changer en cours de route. Les deux deviennent des fonctions :
// chaque appel lit l'environnement courant.
export function oauthDemo() {
  return process.env.OAUTH_DEMO !== '0'
}

export function oauthBase() {
  return (
    process.env.OAUTH_REDIRECT_BASE ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:8787')
  )
}

export function oauthConfig() {
  return {
    demo: oauthDemo(),
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    metaConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    redirectBase: oauthBase()
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
    oauthBase(),
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

/**
 * LOT 1.13 / 1.18 — URL du front utilisée en REPLI, validée.
 *
 * Deux défauts distincts, corrigés ensemble :
 *
 * 1. `server/index.js` concaténait `process.env.FRONT_URL` brut dans un
 *    `Location:` porteur d'un token de session. `safeReturnUrl` validait le
 *    `returnUrl` fourni par le client, mais pas ce repli — une variable
 *    d'environnement malformée produisait donc une redirection non validée.
 *
 * 2. `safeReturnUrl` comparait `FRONT_URL` / `FRONT_ORIGIN` via
 *    `new URL(origin).origin`. Si l'administrateur pose `FRONT_URL=pcstar.dz`
 *    (sans schéma), `new URL()` lève, le `catch` renvoie `false`, et **toute**
 *    URL de retour légitime est rejetée — silencieusement, sans aucun log. Le
 *    symptôme visible est un retour OAuth qui part sur `127.0.0.1:5173`.
 *
 * Ici : chaque candidate est validée, un avertissement est journalisé UNE fois
 * par valeur invalide (pas à chaque requête), et le repli final est une origine
 * explicite.
 */
const warnedOrigins = new Set()

function warnOnce(key, message) {
  if (warnedOrigins.has(key)) return
  warnedOrigins.add(key)
  console.warn(message)
}

/** @returns {string|null} l'URL absolue valide (origine + chemin), ou null. */
function asAbsoluteUrl(raw, name) {
  const value = String(raw || '').trim()
  if (!value) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      warnOnce(name + ':' + value, `[pcstar-oauth] ${name}=${value} : schéma non http(s) — valeur ignorée.`)
      return null
    }
    // Origin + chemin (sans le slash final) : `FRONT_URL=https://x.dz/boutique`
    // doit garder son préfixe de chemin dans le `Location` de repli, sinon le
    // retour OAuth tombe à la racine du domaine. Le hash et les paramètres
    // d'origine sont écartés — on y recollera `?oauth_token=…`.
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    warnOnce(
      name + ':' + value,
      `[pcstar-oauth] ${name}=${value} n'est pas une URL absolue (schéma manquant ?).\n` +
        `  · cette valeur est IGNORÉE, et elle casse aussi la validation des returnUrl légitimes\n` +
        `  · attendu : https://mon-domaine.dz (ou http://127.0.0.1:5173 en local)`
    )
    return null
  }
}

export function configuredFrontUrl() {
  for (const [name, raw] of [
    ['FRONT_URL', process.env.FRONT_URL],
    ['FRONT_ORIGIN', process.env.FRONT_ORIGIN],
    ['OAUTH_REDIRECT_BASE', process.env.OAUTH_REDIRECT_BASE]
  ]) {
    const ok = asAbsoluteUrl(raw, name)
    if (ok) return ok
  }
  const fromVercel = asAbsoluteUrl(
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    'VERCEL_URL'
  )
  if (fromVercel) return fromVercel
  return oauthBase()
}

export async function startOAuth(provider, { userId = null, intent = 'login', returnUrl = null } = {}) {
  if (provider !== 'google' && provider !== 'meta') {
    return { ok: false, error: 'provider' }
  }

  // AUDIT-2026-09-17 / phase 1 (P0) : le repli automatique vers l'écran
  // « démo » était dangereux. Avec OAUTH_DEMO=0, un état destiné à un vrai
  // fournisseur pouvait quand même être soumis à POST /demo, et
  // finishIdentity() lui faisait alors confiance comme à un e-mail vérifié.
  //
  // La décision est donc prise AVANT de créer/persister le state :
  //   - démo explicitement active → consentement simulé ;
  //   - démo désactivée + fournisseur absent → refus honnête, sans state mort ;
  //   - démo désactivée + fournisseur configuré → vrai flux OAuth.
  const demo = oauthDemo()
  const cfg = oauthConfig()
  const configured = provider === 'google' ? cfg.googleConfigured : cfg.metaConfigured
  if (!demo && !configured) return { ok: false, error: 'provider_not_configured' }

  const state = newToken()
  // P13 (S2) : validé à l'entrée, re-validé à la redirection.
  const safeReturn = safeReturnUrl(returnUrl)
  let startError = null
  await updateDbAsync((db) => {
    // Défense à la source : un navigateur déjà authentifié comme maître ne
    // reçoit même pas de state de rattachement. Le callback conserve la même
    // règle pour les états historiques ou forgés avant ce contrôle.
    if (intent === 'link') {
      const account = db.users.find((u) => u.id === userId)
      if (!account) {
        startError = 'auth_required'
        return db
      }
      if (account.role === 'master') {
        startError = 'master_oauth_forbidden'
        return db
      }
    }
    db.oauthPending[state] = {
      provider,
      userId,
      intent, // login | link
      returnUrl: safeReturn,
      createdAt: Date.now()
    }
    return db
  })
  if (startError) return { ok: false, error: startError }

  if (demo) {
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
      redirect_uri: `${oauthBase()}/api/oauth/google/callback`,
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
    redirect_uri: `${oauthBase()}/api/oauth/meta/callback`,
    state,
    scope: 'email,public_profile'
  })
  return { ok: true, demo: false, authorizeUrl: `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${params}` }
}

/**
 * Clôture atomique d'une identité OAuth.
 *
 * AUDIT-2026-09-17 / phase 2 : le `pending` est relu DANS la transaction qui
 * crée la session, puis supprimé dans cette même transaction. Lire le state
 * avant d'entrer dans `updateDbAsync` permettait à deux callbacks simultanés
 * de le réutiliser. La vérification de son âge est également locale à ce
 * chemin : elle reste effective lorsque Neon n'a pas encore purgé le JSONB.
 */
async function finishIdentity(provider, rawIdentity, stateKey, { trusted = false } = {}) {
  const identity = {
    id: String(rawIdentity?.id || '').trim().slice(0, 200),
    email: String(rawIdentity?.email || '').trim().toLowerCase().slice(0, 254),
    name: String(rawIdentity?.name || '').trim().slice(0, 120),
    picture: rawIdentity?.picture ? String(rawIdentity.picture).slice(0, 1000) : null
  }
  if (!identity.id) return { ok: false, error: 'identity' }

  let outcome = null
  await updateDbAsync((db) => {
    const pending = db.oauthPending?.[stateKey]
    if (!pending || pending.provider !== provider || isOAuthPendingExpired(pending)) {
      // Une entrée expirée spécifique est retirée dès qu'elle est rencontrée,
      // y compris sous Neon où une lecture seule ne persiste pas la purge.
      if (pending && db.oauthPending) delete db.oauthPending[stateKey]
      outcome = { ok: false, error: 'state' }
      return db
    }

    let user = null
    const byLink = db.users.find((u) => u.links?.[provider]?.id === identity.id) || null

    if (pending.intent === 'link' && pending.userId) {
      user = db.users.find((u) => u.id === pending.userId)
      if (!user) {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'state' }
        return db
      }
      // S1 : le compte maître n'a pas de fournisseur OAuth, ni à la connexion
      // ni au rattachement. Cela ferme aussi les anciens liens éventuels.
      if (user.role === 'master') {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'master_oauth_forbidden' }
        return db
      }
      // Une même identité fournisseur ne peut appartenir qu'à un seul compte.
      if (byLink && byLink.id !== user.id) {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'identity_linked' }
        return db
      }
      user.links = user.links || {}
      user.links[provider] = identity
    } else {
      // Un ancien lien OAuth sur le maître ne devient pas une porte dérobée.
      if (byLink?.role === 'master') {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'master_oauth_forbidden' }
        return db
      }

      const masterByEmail = Boolean(
        identity.email && db.users.some((u) => u.role === 'master' && u.email === identity.email)
      )
      if (masterByEmail && !byLink) {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'master_email' }
        return db
      }

      const byEmail =
        identity.email && !masterByEmail
          ? db.users.find((u) => u.email && u.email === identity.email) || null
          : null
      // En démo, l'e-mail saisi n'est pas une preuve : il ne peut viser qu'une
      // fixture démo ou une identité déjà liée. Un callback réel n'arrive ici
      // qu'après l'échange du code auprès du fournisseur (`trusted: true`).
      if (!trusted && byEmail && !byLink && byEmail.demo !== true) {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'demo_email' }
        return db
      }

      user = byLink || byEmail
      if (!user && !identity.email) {
        delete db.oauthPending[stateKey]
        outcome = { ok: false, error: 'no_email' }
        return db
      }
      if (!user) {
        user = {
          id: newId(provider === 'google' ? 'g' : 'm'),
          role: 'customer',
          email: identity.email,
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

    const token = createSession(db, user.id, { auth: `oauth:${provider}` })
    delete db.oauthPending[stateKey]
    outcome = { ok: true, token, user: publicUser(user), returnUrl: pending.returnUrl || null }
    return db
  })

  return outcome || { ok: false, error: 'state' }
}

const OAUTH_REQUEST_TIMEOUT_MS = 10_000

/** Appel JSON borné vers une URL fournisseur codée en dur, sans journaliser de token. */
async function providerJson(fetchImpl, url, init = {}) {
  if (typeof fetchImpl !== 'function') return null
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS) : null
  try {
    const response = await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) })
    if (!response?.ok) return null
    const data = await response.json().catch(() => null)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function redirectUri(provider) {
  return `${oauthBase()}/api/oauth/${provider}/callback`
}

function providerIsConfigured(provider) {
  const cfg = oauthConfig()
  return provider === 'google' ? cfg.googleConfigured : provider === 'meta' ? cfg.metaConfigured : false
}

// Meta retire les versions Graph après environ deux ans. v19 est déjà obsolète
// en septembre 2026 : une intégration « réelle » doit partir d'une version
// maintenue. L'override permet une mise à niveau contrôlée sans modifier le
// flux; seules les formes vN.0 sont admises pour garder l'URL fournisseur fixe.
function metaGraphVersion() {
  const requested = String(process.env.META_GRAPH_VERSION || '').trim()
  return /^v\d+\.0$/.test(requested) ? requested : 'v26.0'
}

async function googleIdentity(code, fetchImpl) {
  const tokenBody = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri('google'),
    grant_type: 'authorization_code'
  })
  const token = await providerJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString()
  })
  const accessToken = String(token?.access_token || '')
  if (!accessToken) return null

  const profile = await providerJson(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  // Google fournit explicitement cette propriété OpenID. Ne jamais rattacher un
  // compte local par un e-mail que le fournisseur ne déclare pas vérifié.
  if (profile?.email_verified !== true || !profile?.sub || !profile?.email) return null
  return { id: profile.sub, email: profile.email, name: profile.name, picture: profile.picture }
}

async function metaIdentity(code, fetchImpl) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: redirectUri('meta'),
    code
  })
  const token = await providerJson(fetchImpl, `https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token?${params}`)
  const accessToken = String(token?.access_token || '')
  if (!accessToken) return null

  const profileParams = new URLSearchParams({ fields: 'id,name,email', access_token: accessToken })
  const profile = await providerJson(fetchImpl, `https://graph.facebook.com/${metaGraphVersion()}/me?${profileParams}`)
  // Meta ne fournit pas toujours l'e-mail : dans ce cas, on refuse plutôt que
  // de créer un compte impossible à retrouver ou de deviner une identité.
  if (!profile?.id || !profile?.email) return null
  return { id: profile.id, email: profile.email, name: profile.name, picture: profile.picture }
}

/** Consomme un state sans créer de session (annulation ou erreur fournisseur). */
async function consumePendingState(provider, state) {
  let consumed = false
  await updateDbAsync((db) => {
    const pending = db.oauthPending?.[state]
    if (!pending || pending.provider !== provider || isOAuthPendingExpired(pending)) {
      if (pending && db.oauthPending) delete db.oauthPending[state]
      return db
    }
    delete db.oauthPending[state]
    consumed = true
    return db
  })
  return consumed
}

/**
 * Callback OAuth réel : state vérifié avant ET pendant la transaction, code
 * échangé côté serveur seulement, puis profil récupéré sur l'API officielle.
 * `fetchImpl` injectable maintient le flux testable sans appeler Google/Meta.
 */
export async function completeOAuthCallback(provider, query = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (provider !== 'google' && provider !== 'meta') return { ok: false, error: 'provider' }
  if (oauthDemo()) return { ok: false, error: 'demo_enabled' }
  if (!providerIsConfigured(provider)) return { ok: false, error: 'provider_not_configured' }

  const state = String(query.state || '')
  if (!state) return { ok: false, error: 'state' }
  if (query.error) {
    // Même un refus utilisateur est une réponse terminale : consommer le state
    // sous le verrou empêche de conserver un état de consentement réutilisable.
    return { ok: false, error: (await consumePendingState(provider, state)) ? 'provider_cancelled' : 'state' }
  }

  const code = String(query.code || '')
  if (!code) return { ok: false, error: 'state' }

  // Evite tout échange externe pour un state absent, expiré ou prévu pour un
  // autre fournisseur. finishIdentity relit obligatoirement l'état sous verrou
  // afin que deux callbacks simultanés ne puissent pas le consommer deux fois.
  const before = await readDbAsync()
  const pending = before.oauthPending?.[state]
  if (!pending || pending.provider !== provider || isOAuthPendingExpired(pending)) return { ok: false, error: 'state' }

  const identity = provider === 'google' ? await googleIdentity(code, fetchImpl) : await metaIdentity(code, fetchImpl)
  if (!identity) {
    // Une réponse de code est terminale. Ne pas garder un state vivant après un
    // échange refusé/expiré par le fournisseur, sinon il peut être rejoué avec
    // un autre code pendant toute sa fenêtre de quinze minutes.
    await consumePendingState(provider, state)
    return { ok: false, error: 'oauth_provider' }
  }
  return finishIdentity(provider, identity, state, { trusted: true })
}

export async function completeDemo(provider, state, profile = {}) {
  // Défense en profondeur (AUDIT-2026-09-17 / phase 1) : même si une route
  // appelante oubliait sa garde, un formulaire démo ne doit jamais pouvoir
  // clôturer un état créé pour un fournisseur réel.
  if (!oauthDemo()) return { ok: false, error: 'demo_disabled' }
  if (provider !== 'google' && provider !== 'meta') return { ok: false, error: 'provider' }

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

  return finishIdentity(provider, identity, String(state || ''), { trusted: false })
}

export async function unlinkProvider(userId, provider) {
  if (provider !== 'google' && provider !== 'meta') return { ok: false, error: 'provider' }
  let user = null
  let forbidden = false
  await updateDbAsync((db) => {
    const u = db.users.find((x) => x.id === userId)
    if (!u) return db
    // Même si une base historique contenait un lien maître, les opérations OAuth
    // ne doivent plus pouvoir le manipuler : il sera refusé à la connexion.
    if (u.role === 'master') {
      forbidden = true
      return db
    }
    u.links = u.links || {}
    u.links[provider] = null
    user = u
    return db
  })
  if (forbidden) return { ok: false, error: 'master_oauth_forbidden' }
  if (!user) return { ok: false, error: 'missing' }
  return { ok: true, user: publicUser(user) }
}

/**
 * LOT 1.7 — échappement HTML.
 *
 * `demoConsentHtml` interpolait `state` directement dans un attribut :
 * `state` vient du query param brut (`server/index.js`, route
 * `/api/oauth/(google|meta)/demo`), donc entièrement contrôlé par le visiteur.
 * Reproduit à l'audit avec `?state="><img src=x onerror=alert(1)>` : la réponse
 * servait `<input type="hidden" name="state" value=""><img src=x onerror=…>"/>`.
 *
 * La CSP du serveur (`script-src 'self'`) empêche l'exécution du handler — la
 * nuance était exacte dans le rapport — mais pas l'injection de balisage :
 * hameçonnage sur la page de consentement, ajout de champs, détournement du
 * `form action`. D'où l'échappement, y compris pour `label`/`name`/`email`
 * qui, eux, sont des littéraux internes : une fonction d'échappement appliquée
 * partout évite d'avoir à décider quels interpolateurs sont « sûrs ».
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function demoConsentHtml(provider, state) {
  const label = provider === 'google' ? 'Google' : 'Meta (Facebook)'
  const color = provider === 'google' ? '#4285F4' : '#1877F2'
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Lier ${esc(label)} · PC Star</title>
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
  <input type="hidden" name="state" value="${esc(state || '')}"/>
  <label>Nom</label>
  <input name="name" value="${esc(provider === 'google' ? 'Google Demo' : 'Meta Demo')}" required/>
  <label>E-mail</label>
  <input name="email" type="email" value="${esc(provider === 'google' ? 'google.user@pcstar.dz' : 'meta.user@pcstar.dz')}"/>
  <button type="submit">Autoriser ${esc(label)}</button>
  <p class="note">Vous serez renvoyé vers la boutique avec une session liée.</p>
</form>
</body></html>`
}
