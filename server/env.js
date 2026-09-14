/**
 * P16 (#16) — charge `.env` sans dépendance (`dotenv` n'est pas installé, et un
 * déploiement Vercel n'a de toute façon pas de fichier à lire).
 *
 * Règles :
 *  - une variable déjà présente dans `process.env` N'EST JAMAIS écrasée : les
 *    vraies variables d'environnement (Vercel, shell, CI) gagnent sur le
 *    fichier ;
 *  - fichier absent = no-op silencieux (cas Vercel) ;
 *  - `#` en début de ligne = commentaire, `export FOO=bar` accepté, les guillemets
 *    entourant la valeur sont retirés.
 *
 * Importé en tout début de `server/index.js` (et des scripts qui en ont besoin)
 * pour que `DATABASE_URL`, `FRONT_ORIGIN`, `TRUST_PROXY`… soient lus au
 * chargement des modules.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Parse le contenu d'un fichier .env → objet (sans toucher à process.env). */
export function parseEnv(content) {
  const out = {}
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    let key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    const quoted = value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/**
 * Charge `.env` (et `.env.local`) depuis la racine du dépôt.
 * @returns {{loaded: string[], applied: string[]}} ce qui a été lu/appliqué.
 */
export function loadEnv(root = ROOT) {
  const loaded = []
  const applied = []
  for (const file of ['.env', '.env.local']) {
    const full = path.join(root, file)
    let content
    try {
      content = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    loaded.push(file)
    for (const [key, value] of Object.entries(parseEnv(content))) {
      if (process.env[key] === undefined) {
        process.env[key] = value
        applied.push(key)
      }
    }
  }
  return { loaded, applied }
}

export default loadEnv()
