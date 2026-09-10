#!/usr/bin/env node
/**
 * Validate / normalize SKU photos under public/photos/sku/{id}-1|2|3.jpg
 * Usage:
 *   node scripts/ingestSkuPhotos.mjs              # report
 *   node scripts/ingestSkuPhotos.mjs --fix       # pad/resize to ≥800, reject <200px source
 *   node scripts/ingestSkuPhotos.mjs --webp        # emit .webp siblings (quality 80)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DST = path.join(ROOT, 'public/photos/sku')
const MIN_OK = 800
const MIN_SRC = 200
const fix = process.argv.includes('--fix')
const webp = process.argv.includes('--webp')

function identify(file) {
  try {
    const out = execFileSync('identify', ['-format', '%w %h %b', file], { encoding: 'utf8' })
    const [w, h, b] = out.trim().split(/\s+/)
    return { w: Number(w), h: Number(h), bytes: Number(String(b).replace(/[^0-9]/g, '')) || fs.statSync(file).size }
  } catch {
    return null
  }
}

const files = fs.readdirSync(DST).filter((f) => /^\S+-[123]\.jpe?g$/i.test(f))
const byId = new Map()
for (const f of files) {
  const m = f.match(/^(.+)-([123])\.(jpe?g)$/i)
  if (!m) continue
  const id = m[1]
  if (!byId.has(id)) byId.set(id, {})
  byId.get(id)[m[2]] = path.join(DST, f)
}

let complete = 0
let incomplete = 0
let tiny = 0
let fixed = 0
let webpN = 0

for (const [id, slots] of [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const missing = [1, 2, 3].filter((n) => !slots[n])
  if (missing.length) {
    incomplete++
    console.warn(`INCOMPLETE ${id} missing ${missing.join(',')}`)
    continue
  }
  complete++
  for (const n of [1, 2, 3]) {
    const file = slots[n]
    const meta = identify(file)
    if (!meta) {
      console.warn(`BAD ${file}`)
      continue
    }
    if (Math.min(meta.w, meta.h) < MIN_SRC) {
      tiny++
      console.warn(`TINY ${id}-${n} ${meta.w}x${meta.h}`)
      continue
    }
    if (fix && (Math.min(meta.w, meta.h) < MIN_OK || meta.w !== meta.h)) {
      const tmp = `${file}.tmp.jpg`
      execFileSync(
        'convert',
        [
          file,
          '-colorspace',
          'sRGB',
          '-filter',
          'Lanczos',
          '-resize',
          `${MIN_OK}x${MIN_OK}<`,
          '-background',
          '#0f172a',
          '-gravity',
          'center',
          '-extent',
          `${MIN_OK}x${MIN_OK}`,
          '-quality',
          '88',
          tmp
        ],
        { stdio: 'pipe' }
      )
      fs.renameSync(tmp, file)
      fixed++
    }
    if (webp) {
      const out = file.replace(/\.jpe?g$/i, '.webp')
      try {
        execFileSync('convert', [file, '-quality', '80', out], { stdio: 'pipe' })
        webpN++
      } catch {
        /* convert webp may work without cwebp */
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      skus: byId.size,
      complete,
      incomplete,
      tiny,
      fixed,
      webp: webpN,
      minOk: MIN_OK
    },
    null,
    2
  )
)
