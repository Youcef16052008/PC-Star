/** Simple in-memory rate limit (per IP + bucket). */
const buckets = new Map()
// P10 (P7-9) : bornage mémoire — au-delà de ce nombre de clés, on balaye les
// buckets expirés (une clé expirée = windowMs sans appel). Sans cela, sur une
// instance longue durée exposée publiquement, la Map grossissait sans fin
// (une entrée par IP observée, jamais purgée).
const SWEEP_THRESHOLD = 1024

/** Balayage des buckets expirés (test/observabilité + balayage interne). */
export function sweepExpired(now = Date.now(), windowMs = 60_000) {
  for (const [k, b] of buckets) {
    // P16 (#12) : chaque bucket garde SA fenêtre. Avant, le balayage
    // opportuniste lancé par un endpoint à 60 s supprimait aussi les buckets
    // de 24 h (backup, archive…) → leur compteur repartait de zéro.
    const w = Number(b.windowMs) > 0 ? Number(b.windowMs) : windowMs
    if (now - b.start > w) buckets.delete(k)
  }
}

export function rateLimit({ windowMs = 60_000, max = 30, key, now = Date.now() } = {}) {
  const k = key || 'global'
  // P10 (P7-9) : balayage opportuniste quand la Map est chargée.
  if (buckets.size >= SWEEP_THRESHOLD) sweepExpired(now, windowMs)
  let b = buckets.get(k)
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0, windowMs }
    buckets.set(k, b)
  }
  b.count += 1
  if (b.count > max) {
    return { ok: false, retryAfter: Math.ceil((b.start + windowMs - now) / 1000) }
  }
  return { ok: true }
}

// Export pour les tests (taille + reset) — pas d'autre usage.
export const __rateLimitInternals = { buckets, sweepExpired }

/**
 * P13 (S4) — `X-Forwarded-For` n'est cru que derrière un proxy de confiance.
 *
 * Avant, l'en-tête était pris aveuglément : en déploiement direct (hors
 * Vercel), un attaquant envoyait `X-Forwarded-For: 1.2.3.<n>` à chaque essai et
 * obtenait un budget illimité sur `/api/auth/login` (20/min autrement) →
 * brute-force du mot de passe master.
 *
 * Derrière le proxy, on lit le DERNIER saut de la chaîne : c'est celui que le
 * proxy ajoute, pas celui que le client écrit.
 *
 * `TRUST_PROXY=1` pour un reverse proxy maîtrisé (nginx, Caddy…). Sur Vercel,
 * `process.env.VERCEL` suffit.
 */
export function trustProxy() {
  return process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL)
}

export function clientIp(req) {
  if (trustProxy()) {
    const chain = String(req.headers?.['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (chain.length) return chain[chain.length - 1]
  }
  return req.socket?.remoteAddress || 'local'
}

export function clientKey(req, suffix = '') {
  return `${clientIp(req)}:${suffix}`
}
