#!/usr/bin/env node
/**
 * Inventaire des branches Neon du projet — le diagnostic qui manquait quand
 * « Create Neon Branch » échoue en quelques secondes.
 *
 * Ce pas de CI (`neon_workflow.yml`) crée une branche éphémère par PR. Quand il
 * tombe, le journal dit seulement que l'action a échoué : impossible de savoir
 * si c'est la clé (`NEON_API_KEY`), la variable (`NEON_PROJECT_ID`) ou le
 * plafond de branches du projet — trois causes qui demandent trois gestes
 * différents. Ce script interroge l'API Neon et imprime la réponse en clair.
 *
 * Il n'écrit RIEN : ni création, ni suppression. Il informe.
 *
 * Usage :
 *   NEON_API_KEY=... NEON_PROJECT_ID=... node scripts/neon-branches.mjs
 *
 * Sortie : code HTTP, nombre de branches, noms (préfixe `preview/` compté à
 * part : ce sont les branches de PR, celles qui s'accumulent quand la
 * suppression à la fermeture n'a pas eu lieu).
 */

/**
 * Dans la CI, chaque constat sort AUSSI en annotation de check
 * (`::notice::` / `::warning::`) : le journal d'un job n'est pas toujours
 * lisible (stockage de journaux filtré, poste sans accès), l'onglet Checks du
 * PR l'est toujours — et le message y tient en une ligne, sans le bruit.
 */
const estCI = process.env.GITHUB_ACTIONS === 'true'
const annonce = (niveau, message) => {
  if (estCI) console.log(`::${niveau} title=Inventaire Neon::${message.replace(/\s+/g, ' ').slice(0, 900)}`)
}

const key = process.env.NEON_API_KEY
const project = process.env.NEON_PROJECT_ID

if (!key) {
  console.log('[neon-branches] NEON_API_KEY absent : impossible d interroger l API.')
  console.log('[neon-branches] Si ce message sort dans la CI, le secret du depot a ete supprime ou renomme.')
  annonce('warning', 'NEON_API_KEY absente des secrets du depot : l API Neon ne peut pas etre interrogee.')
  process.exit(0)
}
if (!project) {
  console.log('[neon-branches] NEON_PROJECT_ID absent : l URL ne peut pas viser le projet.')
  console.log('[neon-branches] Si ce message sort dans la CI, la VARIABLE de depot (pas le secret) a disparu.')
  annonce('warning', 'NEON_PROJECT_ID absente des variables du depot : l URL ne peut pas viser le projet.')
  process.exit(0)
}

// `api_key` accepte le préfixe `Bearer` — l'API Neon refuse un jeton nu.
let res
try {
  res = await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches?limit=100`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
} catch (err) {
  console.log(`[neon-branches] réseau injoignable : ${err?.message || err}`)
  annonce('warning', `reseau injoignable depuis la CI : ${err?.message || err}`)
  process.exit(0)
}

const corps = await res.text()
console.log(`[neon-branches] HTTP ${res.status}`)
if (!res.ok) {
  // 401 = clé refusée (expirée / révoquée) · 404 = projet introuvable (variable
  // erronée) · 403 = plan/limite. On montre le message de l'API, jamais la clé.
  console.log(`[neon-branches] réponse : ${corps.slice(0, 400)}`)
  const cause =
    res.status === 401 ? 'cle refusee (revoquee ou expiree) — regenerer NEON_API_KEY'
    : res.status === 404 ? 'projet introuvable — corriger NEON_PROJECT_ID'
    : res.status === 403 ? 'acces refuse par le plan — quota de branches ou droits de la cle'
    : 'reponse inattendue de l API Neon'
  annonce('warning', `HTTP ${res.status} — ${cause}. API : ${corps.slice(0, 200)}`)
  process.exit(0)
}

let data = {}
try {
  data = JSON.parse(corps)
} catch {
  console.log('[neon-branches] réponse illisible :', corps.slice(0, 200))
  process.exit(0)
}
const branches = Array.isArray(data.branches) ? data.branches : []
const preview = branches.filter((b) => String(b.name || '').startsWith('preview/'))
console.log(`[neon-branches] ${branches.length} branche(s), dont ${preview.length} de PR (preview/*)`)
for (const b of branches.sort((a, c) => String(a.name).localeCompare(String(c.name)))) {
  const age = b.created_at ? ` (${b.created_at.slice(0, 10)})` : ''
  console.log(`  - ${b.name}${age}${b.expires_at ? ` → expire ${String(b.expires_at).slice(0, 10)}` : ''}`)
}
const resume = `HTTP 200 — ${branches.length} branche(s), dont ${preview.length} de PR (preview/*)`
if (preview.length >= 9) {
  console.log('[neon-branches] ATTENTION : la limite du plan gratuit (10 branches) est proche ou atteinte.')
  console.log('[neon-branches] Supprimer les `preview/pr-*` dont la PR est fermee, ou poser un plan superieur.')
  annonce('warning', `${resume} — plafond de branches proche : supprimer les preview/pr-* orphelines.`)
} else {
  annonce('notice', resume)
}
