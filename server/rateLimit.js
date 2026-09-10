/** Simple in-memory rate limit (per IP + bucket). */
const buckets = new Map()

export function rateLimit({ windowMs = 60_000, max = 30, key } = {}) {
  const now = Date.now()
  const k = key || 'global'
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

export function clientKey(req, suffix = '') {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket?.remoteAddress || 'local'
  return `${ip}:${suffix}`
}
