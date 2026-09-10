import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'image-search')
const DST = path.join(ROOT, 'public/photos/sku')
const MAP = path.join(ROOT, 'scripts/skuPhotoMap.json')
fs.mkdirSync(DST, { recursive: true })

const map = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')) : {}

// CLI: node scripts/assignSkuPhotos.mjs id=prefix id2=prefix2 ...
for (const arg of process.argv.slice(2)) {
  const [id, prefix] = arg.split('=')
  if (id && prefix) map[id] = prefix
}
fs.writeFileSync(MAP, JSON.stringify(map, null, 2))

const files = fs.existsSync(SRC)
  ? fs.readdirSync(SRC).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
  : []

let complete = 0
let incomplete = []
for (const [id, prefix] of Object.entries(map)) {
  const matches = files.filter((f) => f.startsWith(prefix)).sort()
  let n = 0
  for (const f of matches) {
    if (n >= 3) break
    const out = path.join(DST, `${id}-${n + 1}.jpg`)
    // skip if already good
    if (fs.existsSync(out) && fs.statSync(out).size > 2000) {
      n++
      continue
    }
    try {
      execSync(
        `convert ${JSON.stringify(path.join(SRC, f))} -auto-orient -resize '900x900>' -strip -quality 82 ${JSON.stringify(out)}`,
        { stdio: 'pipe' }
      )
      if (!fs.existsSync(out) || fs.statSync(out).size < 1500) {
        if (fs.existsSync(out)) fs.unlinkSync(out)
        continue
      }
      n++
    } catch {
      /* skip */
    }
  }
  if (n >= 3) complete++
  else incomplete.push([id, n])
}

const skuCount = fs.readdirSync(DST).filter((f) => f.endsWith('.jpg')).length
console.log(JSON.stringify({ mapped: Object.keys(map).length, complete, incomplete: incomplete.length, skuFiles: skuCount, missing: incomplete.slice(0, 30) }))
