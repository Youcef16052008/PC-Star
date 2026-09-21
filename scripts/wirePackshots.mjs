#!/usr/bin/env node
/**
 * Câble les photos livrées au catalogue élargi.
 *
 * Une photo générée pour une référence est rangée dans
 * `public/photos/pack/<id>.jpg` (+ son `.webp`). Ce script relève les entrées de
 * `src/catalogExtensions.js` qui ont désormais un fichier et pose
 * `packshot: '/photos/pack/<id>.jpg'` en tête de leurs options — la fiche passe
 * alors en `photoMode: 'packshot'` (`photosForProduct` sert ce fichier tel quel,
 * le badge « illustration de catégorie » disparaît).
 *
 * Idempotent : relançable après chaque lot d'images sans doublon.
 * CLI : node scripts/wirePackshots.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'src/catalogExtensions.js')
const PACK = path.join(ROOT, 'public/photos/pack')
let src = fs.readFileSync(FILE, 'utf8')

const restants = []
let cables = 0
for (const m of src.matchAll(/\bp\('([a-z0-9-]+)'/g)) {
  const id = m[1]
  const rel = `/photos/pack/${id}.jpg`
  if (!fs.existsSync(path.join(PACK, `${id}.jpg`))) {
    restants.push(id)
    continue
  }
  if (src.includes(`packshot: '${rel}'`)) continue
  const at = src.indexOf(`p('${id}',`)
  const brace = at < 0 ? -1 : src.indexOf('{', at)
  if (brace < 0 || brace - at > 400) {
    console.log('OPTIONS INTROUVABLES', id)
    continue
  }
  const glue = /^[A-Za-z_$]/.test(src.slice(brace + 1)) ? ' ' : ''
  src = `${src.slice(0, brace + 1)} packshot: '${rel}',${glue}${src.slice(brace + 1)}`
  cables++
}

fs.writeFileSync(FILE, src)
console.log(JSON.stringify({ cables, restants: restants.length }))
if (restants.length) console.log('à livrer :', restants.join(' '))
