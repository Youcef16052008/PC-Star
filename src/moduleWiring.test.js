/**
 * LOT P2 (outillage) — le garde-fou qui a manqué au LOT P1.
 *
 * Mesuré pendant le lot P1 : `src/ProductPage.jsx` rendait `compatLabel(…)` sans
 * l'avoir importé — le fichier importait déjà `./productMeta.js` pour deux
 * autres fonctions, et la ligne d'import était restée telle quelle. `node
 * --check` passe (syntaxe seule), le bundle esbuild passe (identifiant inconnu
 * = global supposé), `npm test` passait : seule la CI qui **monte** les pages
 * (`scripts/jsdom-crawl.mjs`, ~9 min) voyait la page produit tomber — et par un
 * marqueur absent, jamais par une erreur explicite.
 *
 * Ce fichier ferme les deux trous en secondes et sans navigateur :
 *  1. chaque module du projet doit se **charger** — un `import { x } from './m'`
 *     pour une exportation absente est une erreur de liaison ESM, elle crève ici ;
 *  2. aucun nom exporté par un module **déjà importé** ne peut être appelé dans
 *     un fichier sans y être importé — exactement le cas `compatLabel`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

/**
 * `src/main.jsx` est exclu : il appelle `createRoot(document.getElementById('root'))`
 * à l'importation — il n'existe que comme point d'entrée du bundle.
 */
const EXCLUS = new Set(['main.jsx'])

function modules() {
  const out = []
  for (const dir of ['src', 'server', 'api']) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/\.(js|jsx)$/.test(entry.name)) continue
      if (entry.name.endsWith('.test.js')) continue // les tests ne sont pas importés par l'appli
      if (EXCLUS.has(entry.name)) continue
      out.push({ rel: `${dir}/${entry.name}`, abs: path.join(abs, entry.name) })
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** Commentaires retirés — ils regorgent de `loadLang(…)` cités en prose. */
function retireCommentaires(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // `//` de fin de ligne, sauf ceux collés à un schéma d'URL (`https://`)
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')
}

/** Noms exportés par un module : déclarations nommées + `export { … }`. */
function exportedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim()
      if (!piece || piece === 'default') continue
      const as = piece.split(/\s+as\s+/)
      names.add((as[1] || as[0]).trim())
    }
  }
  return names
}

/** Tout ce qu'un fichier se donne comme noms disponibles (imports + liaisons locales). */
function availableNames(src) {
  const names = new Set()
  // import D, { a, b as c } from '…'  /  import * as ns from '…'
  for (const m of src.matchAll(/import\s+([^'"\n]*?)\s*from\s*['"][^'"]+['"]/g)) {
    const clause = m[1]
    const braces = clause.match(/\{([\s\S]*)\}/)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const piece = part.trim()
        if (!piece) continue
        const as = piece.split(/\s+as\s+/)
        names.add((as[1] || as[0]).trim())
      }
    }
    const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (star) names.add(star[1])
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').trim()
    if (/^[A-Za-z_$][\w$]*$/.test(def)) names.add(def)
  }
  // déclarations locales
  for (const m of src.matchAll(/(?:^|[\s;}])(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of src.matchAll(/(?:^|[\s;}])(?:const|let|var)\s+(\{[^{}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)/g)) {
    const target = m[1]
    if (target.startsWith('{') || target.startsWith('[')) {
      for (const part of target.slice(1, -1).split(',')) {
        const piece = part.trim()
        if (!piece) continue
        const as = piece.split(/\s*:\s*|\s+as\s+/)
        names.add((as[1] || as[0]).trim().split(/\s*=\s*/)[0])
      }
    } else names.add(target)
  }
  // fléchées à paramètre unique : `const Cta = (props) =>` / `props => `
  for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1])
  // listes de paramètres (fonctions nommées, fléchées, méthodes) — c'est là que
  // `t`, `lang` et consorts sont liés
  for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) {
    for (const piece of m[1].split(',')) {
      const clean = piece.trim().split(/\s*=\s*/)[0].trim()
      if (!clean) continue
      if (clean.startsWith('{') || clean.startsWith('[')) {
        for (const inner of clean.replace(/[[\]{}]/g, '').split(',')) {
          const id = inner.trim().split(/\s*:\s*/).pop().trim().split(/\s*=\s*/)[0].trim().replace(/^\.\.\./, '')
          if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id)
        }
        continue
      }
      const simple = clean.replace(/^\.\.\./, '').split(/\s*:\s*/).pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(simple)) names.add(simple)
    }
  }
  return names
}

describe('P2/outillage — le câblage des modules tient sans navigateur', () => {
  const files = modules()

  it('le balayage porte sur tout le projet', () => {
    // Un garde-fou qui ne regarde rien est pire que pas de garde-fou : la liste
    // est bornée pour que la disparition d'un répertoire se voie.
    assert.ok(files.length >= 40, `${files.length} module(s) balayé(s) — trop peu`)
    const rels = files.map((f) => f.rel)
    for (const attendu of ['src/App.jsx', 'src/ProductPage.jsx', 'src/productMeta.js', 'server/index.js', 'api/index.js']) {
      assert.ok(rels.includes(attendu), `${attendu} n'est plus balayé`)
    }
  })

  it('chaque module se charge sans erreur', async () => {
    const cassés = []
    for (const f of files) {
      try {
        await import(pathToFileURL(f.abs).href)
      } catch (err) {
        cassés.push(`${f.rel} — ${String(err.message).split('\n')[0]}`)
      }
    }
    assert.deepEqual(cassés, [], `modules en échec de chargement :\n${cassés.join('\n')}`)
  })

  it('aucun nom exporté par un module déjà importé n’est appelé sans être importé', () => {
    const exportsParFichier = new Map()
    for (const f of files) exportsParFichier.set(f.rel, exportedNames(retireCommentaires(fs.readFileSync(f.abs, 'utf8'))))

    const oublis = []
    for (const f of files) {
      const src = retireCommentaires(fs.readFileSync(f.abs, 'utf8'))
      const dispo = availableNames(src)
      // Seuls les modules que le fichier **importe déjà** entrent en ligne de
      // compte : c'est là que l'oubli se produit (une liste `{ a, b }` laissée
      // telle quelle quand `c` a été ajouté au module importé), et c'est ce qui
      // rend la règle sans faux positifs.
      const imports = [...src.matchAll(/from\s*['"](\.[^'"]+)['"]/g)]
        .map((m) => path.relative(ROOT, path.join(path.dirname(f.abs), m[1])).split(path.sep).join('/'))
        .filter((rel) => exportsParFichier.has(rel))
      for (const rel of imports) {
        for (const name of exportsParFichier.get(rel)) {
          if (name === 'default' || dispo.has(name)) continue
          const appele = new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(`).test(src)
          const jsx = new RegExp(`<${name}[\\s/>]`).test(src)
          if (!appele && !jsx) continue
          // le nom apparaît aussi en position de liaison (prop, paramètre passé
          // en objet, clé) : il est fourni localement, ce n'est pas un oubli
          if (new RegExp(`[=(:,{\\[]\\s*${name}\\s*[,):}=]`).test(src)) continue
          oublis.push(`${f.rel} appelle « ${name} » (exporté par ${rel}) sans l'importer`)
        }
      }
    }
    assert.deepEqual(oublis, [], `liaisons manquantes :\n${oublis.join('\n')}`)
  })
})
