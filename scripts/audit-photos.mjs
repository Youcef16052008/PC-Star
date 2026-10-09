#!/usr/bin/env node
/** Inventaire des sources et des fichiers réellement servis par le catalogue. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCTS } from '../src/data.js'
import { catalogPhotoKind } from '../src/productPhotos.js'
import { photoCandidates } from '../src/media.js'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const photos = new Set(PRODUCTS.flatMap((p) => p.photos || []))
const restants = PRODUCTS.filter((p) => !(p.photos || []).some((src) => catalogPhotoKind(src)))
const mix = PRODUCTS.filter((p) => p.photos.some((src) => catalogPhotoKind(src) === 'generated') && p.photos.some((src) => catalogPhotoKind(src) === 'catalog'))
const generatedOnly = PRODUCTS.filter((p) => p.photos.some((src) => catalogPhotoKind(src) === 'generated') && !p.photos.some((src) => catalogPhotoKind(src) === 'catalog'))
const missing = []
for (const src of photos) {
  for (const candidate of photoCandidates(src)) {
    if (!candidate.startsWith('/photos/') && !candidate.startsWith('/catalog/')) continue
    if (!fs.existsSync(path.join(publicDir, candidate))) missing.push(candidate)
  }
}
console.log(`catalogue : ${PRODUCTS.length} références, ${photos.size} images référencées`)
console.log(`sources : ${[...photos].filter((p) => catalogPhotoKind(p) === 'generated').length} illustrations générées, ${[...photos].filter((p) => catalogPhotoKind(p) === 'catalog').length} photos catalogue`)
console.log(`galeries mixtes : ${mix.length} ; illustrations seules : ${generatedOnly.length}`)
console.log(`sans visuel par référence : ${restants.length}`)
for (const p of restants) console.log([p.id, p.category, p.name].join('\t'))
if (generatedOnly.length) console.log('sans vue réelle livrée :', generatedOnly.map((p) => p.id).join(', '))
console.log(`fichiers absents (JPG/WebP) : ${missing.length}`)
for (const file of missing) console.error(`ABSENT ${file}`)
if (missing.length) process.exitCode = 1
