#!/usr/bin/env node
/**
 * P12 (B25) — `npm run db:doctor`
 *
 * Diagnostic de la base : distingue « base injoignable » de « base vide »,
 * les deux causes d'une vitrine sans produits.
 *
 *   DATABASE_URL='postgresql://…' npm run db:doctor
 *
 * Aucune valeur sensible n'est affichée (le mot de passe de la chaîne n'est
 * jamais imprimé).
 */
import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import ws from 'ws'
import { dbUrlDiagnostics } from '../server/db.js'
import { publicCatalog } from '../server/catalog.js'

neonConfig.webSocketConstructor = ws

// LOT P3 (B30) : le diagnostic doit servir de PORTE. Un `✗` qui sort 0
// traverse un `npm run db:doctor && vercel deploy` comme un succès : la vitrine
// vide était diagnostiquée, puis déployée. Le `✗` lève donc un drapeau et le
// script sort 1 — sauf le cas « DATABASE_URL absente », état normal en dev, qui
// sort 0 avant d'ici.
let souci = 0
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const warn = (m) => console.log(`  \x1b[33m▲\x1b[0m ${m}`)
const bad = (m) => {
  souci = 1
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}
const info = (m) => console.log(`  · ${m}`)

const url = dbUrlDiagnostics()

console.log('\nPC Star — diagnostic base\n')

if (!url.configured) {
  bad("DATABASE_URL absente : l'API tourne sur server/data/store.json (local).")
  info("C'est normal en dev. En production (Vercel) il faut la chaîne pooled Neon.")
  console.log('')
  process.exit(0)
}

console.log('1) Chaîne de connexion')
info(`hôte      : ${url.host}`)
info(`endpoint  : ${url.endpoint || '?'}   région: ${url.region || '?'}`)
info(`base      : ${url.database || '?'}   user: ${url.user || '?'}`)
info(`sslmode   : ${url.sslmode || '(non précisé)'}`)
if (url.pooler) ok('endpoint -pooler : compatible driver HTTP (lectures) + Pool (écritures)')
else
  warn(
    "endpoint DIRECT (pas de « -pooler ») : les LECTURES via neon() échouent — " +
      'le shop tombe alors en mode dégradé. Utiliser la chaîne « Pooled connection » de Neon.'
  )

console.log('\n2) Connectivité')
let readsOk = false
let writesOk = false
const sql = neon(process.env.DATABASE_URL)
const t0 = Date.now()
try {
  await sql`SELECT 1 AS ping`
  readsOk = true
  ok(`lectures (driver HTTP) : OK en ${Date.now() - t0} ms`)
} catch (error) {
  bad(`lectures (driver HTTP) : ${String(error?.message || error)}`)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 })
const t1 = Date.now()
try {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    writesOk = true
    ok(`écritures (Pool TCP)  : OK en ${Date.now() - t1} ms`)
  } finally {
    client.release()
  }
} catch (error) {
  bad(`écritures (Pool TCP)  : ${String(error?.message || error)}`)
} finally {
  await pool.end().catch(() => {})
}

if (!readsOk && writesOk) {
  warn('Écritures OK mais lectures KO → cause n°1 de la vitrine vide : DATABASE_URL')
  warn("copiée sur l'endpoint direct. Prendre la chaîne « Pooled connection » (-pooler).")
}
if (!readsOk && !writesOk) {
  warn('Rien ne répond : compute Neon suspendu/supprimé, branche expirée ou supprimée')
  warn('(les branches d’aperçu de PR expirent après 14 jours), projet archivé, ou IP allowlist.')
}

if (!readsOk) {
  console.log('\nDiagnostic interrompu : impossible de lire la base.\n')
  process.exit(1)
}

console.log('\n3) Schéma')
const tables = await sql`SELECT to_regclass('public.pcstar_state') AS state, to_regclass('public.pcstar_archived_orders') AS archive, to_regclass('public.pcstar_backups') AS backups`
const hasState = Boolean(tables[0]?.state)
const hasArchive = Boolean(tables[0]?.archive)
const hasBackups = Boolean(tables[0]?.backups)
if (hasState) ok('table pcstar_state présente')
else bad('table pcstar_state ABSENTE → lancer : npm run db:migrate:neon')
if (hasArchive) ok('table pcstar_archived_orders présente')
else warn('table pcstar_archived_orders absente → lancer : npm run db:migrate:neon')
if (hasBackups) ok('table pcstar_backups présente')
else warn('table pcstar_backups absente → lancer : npm run db:migrate:neon')

if (!hasState) {
  console.log('')
  process.exit(1)
}

console.log('\n4) État stocké')
const rows = await sql`SELECT data, updated_at FROM pcstar_state WHERE id = 1`
if (!rows[0]) {
  bad('AUCUNE ligne id=1 : la table est vide (migration --reset ou branche neuve).')
  info("Conséquence : seuls les 250 SKU de base s'affichent ; les produits créés par le")
  info('master (extraProducts), les masquages et le stock réel sont perdus sur cette branche.')
  info('Restaurer : npm run db:import:neon -- server/data/store.json  (ou une sauvegarde)')
  console.log('')
  process.exit(1)
}

const state = rows[0].data
const meta = state?.meta || {}
const stock = state?.stock || {}
const zeroStock = Object.entries(stock).filter(([, v]) => (Number(v) || 0) <= 0)
const hidden = meta.hiddenProductIds || []
const publicProducts = publicCatalog(state)

info(`updated_at        : ${new Date(rows[0].updated_at).toISOString()}`)
info(`utilisateurs      : ${(state?.users || []).length}`)
info(`commandes         : ${(state?.orders || []).length}`)
info(`extraProducts     : ${(meta.extraProducts || []).length}`)
info(`hiddenProductIds  : ${hidden.length}`)
info(`stock overrides   : ${Object.keys(stock).length} (dont ${zeroStock.length} à zéro)`)
info(`produits publics  : ${publicProducts.length}`)

console.log('\n5) Verdict')
if (publicProducts.length > 0) {
  ok(`${publicProducts.length} produits servis au client — la base n'est PAS la cause d'une vitrine vide.`)
  info("Si le site n'affiche rien malgré ça : cache/CDN ou build front obsolète (redéployer).")
} else {
  bad('0 produit public → la vitrine est vide À CAUSE DE LA BASE. Causes possibles :')
  if (hidden.length > 0)
    warn(`  · ${hidden.length} produits masqués par le master (hiddenProductIds) — panneau Master → afficher`)
  if (zeroStock.length > 0)
    warn(`  · ${zeroStock.length} overrides de stock à 0 — le client ne voit plus les ruptures (volontaire)`)
  if (hidden.length === 0 && zeroStock.length === 0)
    warn("  · catalogue de base vidé ? vérifier src/data.js et le dernier déploiement")
}

const archived = await sql`SELECT count(*)::int AS n FROM pcstar_archived_orders`.catch(() => [{ n: 0 }])
const backups = await sql`SELECT count(*)::int AS n, max(created_at) AS newest FROM pcstar_backups`.catch(() => [{ n: 0, newest: null }])
info(`commandes archivées : ${archived[0]?.n ?? 0}`)
info(`snapshots Neon     : ${backups[0]?.n ?? 0}${backups[0]?.newest ? ` (dernier : ${new Date(backups[0].newest).toISOString()})` : ''}`)

console.log('')
process.exit(souci ? 1 : 0)
