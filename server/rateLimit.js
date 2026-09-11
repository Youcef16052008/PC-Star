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
    if (now - b.start > windowMs) buckets.delete(k)
  }
}

export function rateLimit({ windowMs = 60_000, max = 30, key, now = Date.now() } = {}) {
  const k = key || 'global'
  // P10 (P7-9) : balayage opportuniste quand la Map est chargée.
  if (buckets.size >= SWEEP_THRESHOLD) sweepExpired(now, windowMs)
  let b = buckets.get(k)
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 }
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

export function clientKey(req, suffix = '') {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket?.remoteAddress || 'local'
  return `${ip}:${suffix}`
}
