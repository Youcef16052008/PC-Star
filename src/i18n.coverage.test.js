// P3 — Couverture i18n : toute clé appelée par t('...') (statique ou dynamique
// tag_*/line_*/cat_*) doit exister dans les DEUX langues du site (`fr`, `en`) :
// la troisième (arabe) a été retirée de la vitrine, la phrase ci-dessus
// datait d'avant. 633 clés de chaque côté, parité vérifiée à chaque exécution.
//
// LOT 8.9 (A9) — et le sens INVERSE, qui manquait : toute clé du dictionnaire
// doit être **référencée** par le corpus, ou appartenir à une famille dynamique
// déclarée dont les valeurs viennent de données vivantes. Sans ce verrou, le
// dictionnaire se re-remplit à chaque fonctionnalité abandonnée : 62 clés mortes
// (186 chaînes, ~5,1 Ko) y traînaient — authentification SMS, comparateur de
// produits, paiement 3×/CCP/BaridiMob, thème clair/sombre (supprimé au lot 6.3,
// clés restées), avatars de profil… Autant de **fausses promesses** pour qui
// ouvre `i18n.js` : le code ne fait rien de tout cela.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict, LANGS } from './i18n.js'
import { CATEGORIES, PART_LINES, PRODUCTS } from './data.js'
import { ORDER_STATUSES } from './orderLogic.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(SRC)
  .filter((f) => (f.endsWith('.js') || f.endsWith('.jsx')) && !f.endsWith('.test.js') && f !== 'i18n.js')

const staticKeys = new Set()
const tagPrefix = new Set()
const tagValues = new Set()

for (const f of files) {
  const src = readFileSync(join(SRC, f), 'utf8')
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*'([^']+)'/g)) staticKeys.add(m[1])
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([^"]+)"/g)) staticKeys.add(m[1])
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*`((?:tag|line|cat)_)\$\{/g)) tagPrefix.add(m[1])
  for (const m of src.matchAll(/tags:\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/['"]([^'"]+)['"]/g)) tagValues.add(v[1])
  }
}

const dynamicKeys = new Set()
for (const p of tagPrefix) {
  if (p === 'tag_') tagValues.forEach((v) => dynamicKeys.add(`tag_${v}`))
  if (p === 'line_') PART_LINES.forEach((l) => dynamicKeys.add(`line_${l.id}`))
  if (p === 'cat_') CATEGORIES.forEach((c) => dynamicKeys.add(`cat_${c.id}`))
}

// Les ids de tags utilisés par le code (d.badge, p.tags) — garde-fou supplémentaire.
PRODUCTS.forEach((p) => (p.tags || []).forEach((v) => tagValues.add(v)))

const allKeys = new Set([...staticKeys, ...dynamicKeys])

test(`i18n: ${allKeys.size} clés statiques + dynamiques toutes présentes en ar/fr/en`, () => {
  const missing = []
  for (const key of allKeys) {
    for (const { id } of LANGS) {
      const v = dict[id]?.[key]
      if (typeof v !== 'string' || !v.trim()) missing.push(`${id}:${key}`)
    }
  }
  assert.equal(missing.length, 0, 'clés manquantes → ' + missing.join(', '))
})

test('i18n: les 2 langues ont le même nombre de clés (pas de bloc déséquilibré)', () => {
  const counts = LANGS.map((l) => Object.keys(dict[l.id]).length)
  assert.equal(new Set(counts).size, 1, `compte inégal: ${LANGS.map((l, i) => `${l.id}=${counts[i]}`).join(' ')}`)
})

/* ------------------------------------------------------------------------ */
/* LOT 8.9 (A9) — balayage INVERSE : aucune clé morte ne doit subsister.     */
/* ------------------------------------------------------------------------ */

const ROOT = join(SRC, '..')

/**
 * Le corpus : tout ce qui peut référencer une clé de traduction.
 *
 * `i18n.js` est exclu (c'est le dictionnaire lui-même — s'y trouver ne prouve
 * rien) ainsi que les fichiers de test et les artefacts de build. La
 * documentation n'est pas dans le corpus non plus : un guide qui décrit une
 * fonctionnalité supprimée ne la rend pas vivante.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const CORPUS_DIRS = ['src', 'server', 'api', 'scripts', 'e2e']
const CORPUS_FILES = ['index.html', 'vercel.json']

const corpusPaths = []
for (const d of CORPUS_DIRS) {
  const abs = join(ROOT, d)
  if (existsSync(abs)) walk(abs, corpusPaths)
}
for (const f of CORPUS_FILES) {
  const abs = join(ROOT, f)
  if (existsSync(abs)) corpusPaths.push(abs)
}

const corpus = corpusPaths
  .filter((f) => /\.(js|jsx|mjs|html|json)$/.test(f))
  .filter((f) => !f.endsWith('i18n.js'))
  .filter((f) => !/\.test\.(js|jsx|mjs)$/.test(f))
  .filter((f) => !f.includes('/dist/') && !f.includes('/node_modules/') && !f.includes('package-lock.json'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

/**
 * Familles de clés construites dynamiquement.
 *
 * Chacune déclare **où** elle est construite et **quelles données vivantes**
 * produisent ses suffixes : une clé `cat_gpu` n'a pas d'occurrence littérale
 * dans le code, mais elle est légitime tant que `CATEGORIES` contient `gpu` et
 * qu'un `labelOr(t, \`cat_${…}\`)` existe. Si la donnée ou l'appel disparaît,
 * la famille entière doit disparaître avec — c'est vérifié plus bas.
 */
const SYS_STATES = ['online', 'degraded', 'offline'] // src/App.jsx:1333

const DYNAMIC_FAMILIES = [
  {
    prefix: 'cat_',
    values: () => CATEGORIES.map((c) => c.id),
    usage: /`cat_\$\{/,
    where: 'labelOr(t, `cat_${…}`) — App.jsx, MasterPage.jsx, media.js'
  },
  {
    prefix: 'line_',
    values: () => PART_LINES.map((l) => l.id),
    usage: /`line_\$\{/,
    where: 't(`line_${…}`) — BuilderPage.jsx, SearchPage.jsx'
  },
  {
    prefix: 'orderStatus_',
    values: () => ORDER_STATUSES,
    usage: /`orderStatus_\$\{/,
    where: 'statusLabelKey() — orderLogic.js'
  },
  {
    prefix: 'sysState_',
    values: () => SYS_STATES,
    usage: /`sysState_\$\{/,
    where: 't(`sysState_${…}`) — App.jsx'
  }
]

test(`A9 — aucune clé morte : les ${Object.keys(dict.fr).length} clés sont référencées ou dérivées de données vivantes`, () => {
  const dead = []
  for (const key of Object.keys(dict.fr)) {
    if (corpus.includes(key)) continue
    const family = DYNAMIC_FAMILIES.find((f) => key.startsWith(f.prefix))
    if (family && family.values().includes(key.slice(family.prefix.length))) continue
    dead.push(key)
  }
  assert.deepEqual(
    dead,
    [],
    `${dead.length} clé(s) morte(s) — aucune occurrence dans ${corpusPaths.length} fichiers du corpus, ` +
      `aucune donnée vivante ne les produit : ${dead.join(', ')}`
  )
})

test('A9 — chaque famille dynamique est réellement construite par le code', () => {
  for (const family of DYNAMIC_FAMILIES) {
    assert.match(
      corpus,
      family.usage,
      `plus aucune construction \`${family.prefix}\${…}\` dans le corpus (${family.where}) : ` +
        `la famille est morte, ses clés et cette entrée doivent partir ensemble`
    )
  }
})

test('A9 — chaque famille couvre exactement ses données (ni clé en trop, ni clé manquante)', () => {
  for (const family of DYNAMIC_FAMILIES) {
    const inDict = Object.keys(dict.fr)
      .filter((k) => k.startsWith(family.prefix))
      .map((k) => k.slice(family.prefix.length))
      .sort()
    const inData = [...family.values()].sort()
    assert.deepEqual(
      inDict,
      inData,
      `famille ${family.prefix} désalignée de ${family.where} — ` +
        `en trop : ${inDict.filter((k) => !inData.includes(k)).join(', ') || '—'} ; ` +
        `manquants : ${inData.filter((k) => !inDict.includes(k)).join(', ') || '—'}`
    )
  }
})

test('A9 — les fonctionnalités retirées ne laissent plus de clés derrière elles', () => {
  // Garde-fou explicite sur les groupes supprimés au lot 8.9 : si l'une de ces
  // clés réapparaît sans que la fonctionnalité existe, c'est une régression.
  const groupesRetirés = {
    'authentification SMS (jamais implémentée)': ['authSms', 'authSendCode', 'authVerify', 'authCode', 'authCodeShown', 'authErrorCode'],
    'comparateur de produits (hors-scope volontaire, ROADMAP-10)': ['inCompare', 'compareUpTo', 'addToCompare', 'compareTitle', 'clearAll', 'compareNeed', 'compareN'],
    'paiement 3× / CCP / BaridiMob (cash uniquement)': ['pay3xBadge', 'or3x', 'pay3xDesk', 'payCcp', 'payBaridi'],
    'thème clair/sombre (code supprimé au lot 6.3)': ['themeLight', 'themeDark', 'themeSystem'],
    'avatars et couleurs d’accent profil (retirés)': ['profileAvatar', 'profileAccent']
  }
  for (const [groupe, clés] of Object.entries(groupesRetirés)) {
    for (const key of clés) {
      for (const { id } of LANGS) {
        assert.equal(dict[id][key], undefined, `${groupe} : la clé ${id}.${key} est revenue`)
      }
    }
  }
})
