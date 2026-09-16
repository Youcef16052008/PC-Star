/**
 * LOT 7.3 — « aucun secret dans le bundle ».
 *
 * Jusqu'ici ce contrôle était **manuel** (`npm run build` puis `grep`), et le
 * plan le notait 🟡 partiel depuis le lot 1.2 : rien n'empêchait une régression
 * de repasser en revue sans être vue. Le lot 1.19 a montré pourquoi ce contrôle
 * compte — les trois mots de passe des comptes de démonstration étaient
 * **livrés au navigateur** via `DEMO_CUSTOMERS[].passwordPlain`, donc lisibles
 * par n'importe quel visiteur, alors même que le scanner de secrets du dépôt
 * (qui parcourt les fichiers **suivis**) passait au vert sur la forme publiée.
 *
 * Ce que le scanner du dépôt ne peut pas voir, et que ce script couvre :
 *  · une valeur d'**environnement** inlinée au build (Vite n'inline que
 *    `VITE_*`, mais un `define`, un plugin ou une future config peut le faire) ;
 *  · une URL de stockage privée écrite en dur (Vercel Blob, Azure, GCS) ;
 *  · une forme « mot de passe littéral » produite par le minifieur.
 *
 * Ce qui est **volontairement** hors périmètre :
 *  · les **e-mails**. `src/data.js` publie l'adresse de contact du magasin,
 *    affichée par l'UI ; interdire `MASTER_EMAIL` ferait échouer le build dès
 *    que l'exploitant utilise cette adresse comme identifiant — le cas
 *    documenté. Un identifiant n'est pas un secret ; le mot de passe, si.
 *  · `DEMO_LOCAL_PASSWORD` (`src/shopStore.js`) : valeur de la démo **locale**
 *    (comptes du navigateur seul, hachage FNV-1a annoncé par l'UI). Elle
 *    n'ouvre rien sur un déploiement — voir `docs/PLAN-CORRECTIONS.md` §9.
 *
 * Usage : `npm run check:bundle` (ou `npm run build`, qui l'enchaîne).
 * Sortie : 0 = propre, 1 = un secret dans `dist/`, 2 = `dist/` absent.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** Extensions réellement servies au navigateur. */
const SCANNED_EXT = /\.(js|mjs|cjs|css|html|json|svg|txt|xml|map)$/

/**
 * Variables d'environnement dont la valeur ne doit JAMAIS apparaître dans le
 * bundle. Les noms sont des motifs, pas des valeurs : aucune n'est écrite ici.
 */
const SENSITIVE_KEY = /(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|^DATABASE_URL$)/

/** Une valeur trop courte donnerait des faux positifs partout (`1`, `true`, …). */
const MIN_VALUE_LENGTH = 8

/** Guillet ou double guillemet, sans l'écrire littéralement (auto-détection). */
const QC = '[' + String.fromCharCode(39) + String.fromCharCode(34) + ']'

/**
 * @param {string} dir dossier à balayer (`dist/` en usage normal)
 * @param {{env?: NodeJS.ProcessEnv, forbid?: string[]}} [opts]
 * @returns {string[]} coups, `fichier — motif`
 */
export function scanBundle(dir, { env = process.env, forbid = [] } = {}) {
  if (!fs.existsSync(dir)) return ['(dossier absent)']
  const files = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SCANNED_EXT.test(entry.name)) files.push(full)
    }
  }
  walk(dir)

  // Valeurs d'environnement sensibles, réellement posées.
  const fromEnv = Object.entries(env)
    .filter(([key, value]) => SENSITIVE_KEY.test(key) && String(value || '').length >= MIN_VALUE_LENGTH)
    .map(([key, value]) => ({ nom: `variable d’environnement ${key}`, value: String(value) }))
  const fromForbid = [
    ...forbid,
    ...(env.PCSTAR_FORBIDDEN_SECRET ? [env.PCSTAR_FORBIDDEN_SECRET] : []),
    ...String(env.PCSTAR_FORBIDDEN_SECRETS || '')
      .split(',')
      .map((v) => v.trim())
  ]
    .filter((v) => v && v.length >= MIN_VALUE_LENGTH)
    .map((value) => ({ nom: 'valeur interdite', value }))

  // Formes structurelles, indépendantes de toute valeur connue.
  const shapes = [
    {
      nom: 'mot de passe littéral (forme « mot + 2 chiffres »)',
      re: new RegExp(['pass', '\\w*', '\\s*[:=]\\s*', QC, '[a-z]+\\d{2}', QC].join(''), 'i')
    },
    {
      nom: 'URL de stockage privée écrite en dur',
      re: /https:\/\/[a-z0-9.-]*(?:vercel-storage|blob\.core\.windows|storage\.googleapis|s3[.-][a-z0-9-]*amazonaws)[^\s"'<>)]*/i
    },
    {
      // `process.env.X` non remplacé au build : côté navigateur cela vaut
      // `undefined` (Vite ne définit pas `process`), donc un secret potentiel
      // devenu bug silencieux — signalé dans les deux cas.
      nom: 'lecture de process.env laissée dans le code client',
      re: /process\.env\.[A-Z_]+/
    }
  ]

  const hits = []
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/')
    const text = fs.readFileSync(file, 'utf8')
    for (const { nom, value } of [...fromEnv, ...fromForbid]) {
      if (text.includes(value)) hits.push(`${rel} — ${nom} présente dans le bundle`)
    }
    for (const shape of shapes) {
      const found = text.match(shape.re)
      if (found) hits.push(`${rel} — ${shape.nom} : ${String(found[0]).slice(0, 60)}`)
    }
  }
  return hits
}

/** Message lisible quand `dist/` n'existe pas encore. */
export function missingDistMessage(dir) {
  return (
    `\n[check-bundle] ${path.relative(ROOT, dir) || dir} est absent.\n` +
    '  · ce contrôle porte sur le build : lancez d’abord `npm run build`\n' +
    '  · `npm run build` l’enchaîne automatiquement (lot 7.3)\n'
  )
}

function main() {
  const dir = path.resolve(ROOT, process.argv[2] || 'dist')
  if (!fs.existsSync(dir)) {
    process.stderr.write(missingDistMessage(dir))
    process.exit(2)
  }
  const hits = scanBundle(dir)
  if (hits.length) {
    process.stderr.write(
      `\n[check-bundle] ${hits.length} coup(s) — le bundle publié contient un secret :\n` +
        hits.map((h) => '  · ' + h).join('\n') +
        '\n\n  · aucune valeur sensible ne doit être inlinée au build (Vite n’inline que VITE_*)\n' +
        '  · voir docs/PLAN-CORRECTIONS.md §9 « lot 1.19 » et docs/DEPLOY-VERCEL.md §8\n\n'
    )
    process.exit(1)
  }
  const count = (() => {
    let n = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name))
        else if (SCANNED_EXT.test(e.name)) n++
      }
    }
    walk(dir)
    return n
  })()
  process.stdout.write(`[check-bundle] ${count} fichier(s) publié(s) balayé(s) : aucun secret.\n`)
}

// Exécuté directement (pas importé par un test) ?
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main()
