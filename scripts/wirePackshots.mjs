#!/usr/bin/env node
/**
 * Câble les packshots et inventorie les vues réelles du catalogue élargi.
 *
 * P29 / décision client : conserver les DEUX sources. Le packshot reste en
 * première position, suivi des vues /photos/sku/<id>-1..3 effectivement livrées.
 * Le manifeste est du JavaScript statique importable par le navigateur : pas de
 * sondes réseau ni de chemins déduits pour les quatre écrans sans trio.
 * Chaque vue exige son JPG ET son WebP. Aucun fichier image n'est modifié.
 *
 * npm run photos:wire           met à jour le câblage et le manifeste
 * npm run photos:wire -- --check vérifie leur fraîcheur, sans écrire
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'src/catalogExtensions.js')
const MANIFEST = path.join(ROOT, 'src/catalogSkuViews.js')
const PUBLIC = path.join(ROOT, 'public')
const check = process.argv.includes('--check')
const initial = fs.readFileSync(FILE, 'utf8')
let src = initial
const paired = (url) => [url, url.replace(/\.jpg$/, '.webp')]
  .every((p) => fs.existsSync(path.join(PUBLIC, p)))

const restants = []
const galleries = {}
let cables = 0
for (const m of initial.matchAll(/\bp\('([a-z0-9-]+)'/g)) {
  const id = m[1]
  const views = [1, 2, 3].filter((n) => paired(`/photos/sku/${id}-${n}.jpg`))
  if (views.length) galleries[id] = views

  const rel = `/photos/pack/${id}.jpg`
  if (!paired(rel)) {
    restants.push(id)
    continue
  }
  if (src.includes(`packshot: '${rel}'`)) continue
  const at = src.indexOf(`p('${id}',`)
  const brace = at < 0 ? -1 : src.indexOf('{', at)
  if (brace < 0 || brace - at > 400) {
    throw new Error(`Options introuvables pour ${id}`)
  }
  const glue = /^[A-Za-z_$]/.test(src.slice(brace + 1)) ? ' ' : ''
  src = `${src.slice(0, brace + 1)} packshot: '${rel}',${glue}${src.slice(brace + 1)}`
  cables++
}

const entries = Object.entries(galleries).sort(([a], [b]) => a.localeCompare(b))
const manifest = `// Généré par npm run photos:wire — ne contient que les vues JPG + WebP livrées.\n` +
  `// Un id absent n'a pas de trio : ne jamais lui inventer de chemins.\n` +
  `export const CATALOG_SKU_VIEWS = {\n` +
  entries.map(([id, views]) => `  '${id}': [${views.join(', ')}]`).join(',\n') + '\n}\n'

if (check) {
  const saved = fs.existsSync(MANIFEST) ? fs.readFileSync(MANIFEST, 'utf8') : ''
  if (src !== initial || saved !== manifest) {
    console.error('Galeries non synchronisées : lancer npm run photos:wire puis versionner le résultat.')
    process.exitCode = 1
  }
} else {
  if (src !== initial) fs.writeFileSync(FILE, src)
  fs.writeFileSync(MANIFEST, manifest)
}
console.log(JSON.stringify({ cables, restants: restants.length, galeriesReelles: entries.length, vuesReelles: entries.reduce((n, [, views]) => n + views.length, 0) }))
if (restants.length) console.log('packshots incomplets ou à livrer :', restants.join(' '))
