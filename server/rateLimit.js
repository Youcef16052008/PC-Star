/**
 * Rate-limit applicatif — compteurs **en mémoire**, par IP + bucket.
 *
 * LOT 3.19 (R17) — limite assumée et documentée : une `Map` en mémoire vit dans
 * UN process. Elle est exacte sur un serveur local (un seul process) mais, sur
 * Vercel, chaque instance serverless (cold start, montée en charge, région
 * différente) possède SES propres compteurs : un attaquant qui multiplie les
 * instances multiplie d'autant son budget. Ce n'est donc pas une frontière de
 * sécurité sur Vercel, c'est un frein — la défense réelle contre le
 * brute-force reste un `MASTER_PASSWORD` long + le hachage scrypt (+ le WAF
 * Vercel si besoin).
 *
 * Pour un comptage partagé : brancher `@upstash/ratelimit` (Upstash Redis) ou
 * Vercel KV en gardant le même contrat `{ ok, retryAfter }`. Détails et tableau
 * des cas dans `docs/DEPLOY-VERCEL.md` §7.
 */
const buckets = new Map()
// P10 (P7-9) : bornage mémoire — au-delà de ce nombre de clés, on balaye les
// buckets expirés (une clé expirée = windowMs sans appel). Sans cela, sur une
// instance longue durée exposée publiquement, la Map grossissait sans fin
// (une entrée par IP observée, jamais purgée).
const SWEEP_THRESHOLD = 1024
/**
 * LOT P5 — le seuil ne bornait RIEN tant que les clés étaient fraîches, et le
 * balayage coûtait O(taille) À CHAQUE appel une fois dépassé. Mesuré le
 * 19/09/2026, 20 000 clés distinctes dans la même fenêtre : `buckets.size`
 * = 20 000 (aucun plafond) et 2,07 s de temps CPU **pour ces seuls appels** —
 * soit ~100 µs de scan ajoutés à chaque requête légitime qui suivait, puisque
 * `rateLimit()` est sur le chemin de tout. Un attaquant qui fait tourner son
 * `X-Forwarded-For` (ou simplement son parc d'IP) ralentissait donc tout le
 * service et faisait grossir la Map sans fin : l'inverse de l'objectif.
 *
 * Deux gardes, dans cet ordre :
 *  · le balayage n'a pas lieu à chaque appel mais au plus une fois par
 *    `SWEEP_MIN_INTERVAL_MS` (coût amorti, plus de quadratique) ;
 *  · `MAX_BUCKETS` est un PLAFOND : si après balayage on est toujours dessus,
 *    les buckets les plus anciennement insérés sautent — donc en pratique ceux
 *    dont la fenêtre est la plus avancée. Un évincé repart sur une fenêtre
 *    neuve (il peut réessayer tout de suite) ; ce qui est garanti, c'est la
 *    mémoire et le temps de réponse, pas le comptage de chaque IP.
 */
const MAX_BUCKETS = 4096
const SWEEP_MIN_INTERVAL_MS = 1000
let dernierBalayage = 0

/** Balayage des buckets expirés (test/observabilité + balayage interne). */
export function sweepExpired(now = Date.now(), windowMs = 60_000) {
  dernierBalayage = now
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
  // P10 (P7-9) : balayage opportuniste quand la Map est chargée — LOT P5 :
  // rythme borné, puis plafond dur (voir le commentaire de `MAX_BUCKETS`).
  if (buckets.size >= SWEEP_THRESHOLD && now - dernierBalayage >= SWEEP_MIN_INTERVAL_MS) {
    sweepExpired(now, windowMs)
  }
  while (buckets.size >= MAX_BUCKETS) {
    const plusAncien = buckets.keys().next()
    if (plusAncien.done) break
    buckets.delete(plusAncien.value)
  }
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
export const RATE_LIMIT_MAX_BUCKETS = MAX_BUCKETS

export const __rateLimitInternals = { buckets, sweepExpired, MAX_BUCKETS, SWEEP_MIN_INTERVAL_MS }

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
