/**
 * Direction 03 « Terminal Cyber » — garde-fous automatiques du design.
 *
 * Vérifications (plan § 4.5), calculées sur les fichiers réels :
 *   T1. tokens.css ne contient QUE des variables (+ color-scheme) — « règle d'or ».
 *   T2. Contraste WCAG numérique (luminance relative) de chaque paire
 *       token/fond, dark ET light — seuil AA 4.5:1 (3:1 pour --muted-2).
 *   T3. Échelle de breakpoints : aucune media query de largeur hors l'échelle
 *       Bootstrap dans cyber.css (anti-retour des 8 paliers de la maquette).
 *   T4. Cibles tactiles : toute règle visant un élément cliquable sous
 *       max-width: 575.98px déclare min-height ≥ 44px.
 *   T5. Aucun clip-path sur un sélecteur portant :focus (l'anneau de focus ne
 *       doit jamais être rogné — architecture ::before, plan § 4.3 ③).
 *   T6. Aucune couleur en dur dans cyber.css (var(--…) uniquement).
 *   T7. Aucune largeur fixe (px) sur cartes/colonnes.
 *   T8. Tout clip-path passe par les tokens symétriques --chamf/--chamf-sm
 *       (auto-miroir RTL, plan § 5 R1).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/* ── Mini-parseur CSS : blocs {prélude, déclarations, enfants} emboîtés ── */
function parseBlocks(css) {
  const blocks = []
  let i = 0
  const n = css.length
  while (i < n) {
    while (i < n && /[\s;]/.test(css[i])) i++
    if (i >= n) break
    let prelude = ''
    while (i < n && css[i] !== '{') prelude += css[i++]
    if (i >= n) break
    i++ // saute '{'
    let depth = 1
    let body = ''
    let quote = null
    while (i < n && depth > 0) {
      const c = css[i]
      if (quote) {
        body += c
        if (c === quote && css[i - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'") {
        quote = c
        body += c
      } else if (c === '{') {
        depth++
        body += c
      } else if (c === '}') {
        depth--
        if (depth > 0) body += c
      } else body += c
      i++
    }
    prelude = prelude.trim()
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      blocks.push({ prelude, declarations: [], children: parseBlocks(body) })
    } else {
      const declarations = []
      let current = ''
      let q = null
      for (let j = 0; j < body.length; j++) {
        const c = body[j]
        if (q) {
          current += c
          if (c === q && body[j - 1] !== '\\') q = null
        } else if (c === '"' || c === "'") {
          q = c
          current += c
        } else if (c === ';') {
          if (current.trim()) declarations.push(current.trim())
          current = ''
        } else current += c
      }
      if (current.trim()) declarations.push(current.trim())
      blocks.push({
        prelude,
        declarations: declarations
          .map((d) => {
            const idx = d.indexOf(':')
            return idx < 0 ? null : { prop: d.slice(0, idx).trim(), value: d.slice(idx + 1).trim() }
          })
          .filter(Boolean),
        children: []
      })
    }
  }
  return blocks
}

const flatRules = (blocks, media = []) =>
  blocks.flatMap((b) => [
    ...(b.prelude && !b.prelude.startsWith('@') ? [{ selector: b.prelude, declarations: b.declarations, media }] : []),
    ...flatRules(b.children, b.prelude ? [...media, b.prelude] : media)
  ])

/* ── WCAG : luminance relative réelle ── */
const chan = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function lum(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((o) => parseInt(full.slice(o, o + 2), 16) / 255)
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/* ── Extraction des tokens par thème ── */
function themeTokens(css, themeRe) {
  const m = css.match(themeRe)
  assert.ok(m, `bloc de thème introuvable (${themeRe})`)
  const out = {}
  for (const line of stripComments(m[1]).split(';')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const prop = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (prop.startsWith('--')) out[prop] = value
  }
  return out
}

const tokensCss = read('src/tokens.css')
const cyberCss = read('src/cyber.css')
const dark = themeTokens(tokensCss, /:root,[\s\S]*?\{([\s\S]*?)\n\}/)
const light = themeTokens(tokensCss, /html\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/)

/* ── T1 : règle d'or de tokens.css ── */
test('T1 tokens.css : uniquement des variables (+ color-scheme)', () => {
  for (const rule of flatRules(parseBlocks(stripComments(tokensCss)))) {
    assert.ok(
      /^(:root|html\[data-theme=)/.test(rule.selector),
      `sélecteur inattendu dans tokens.css : ${rule.selector}`
    )
    for (const d of rule.declarations) {
      assert.ok(
        d.prop.startsWith('--') || d.prop === 'color-scheme',
        `tokens.css doit rester un fichier de variables — trouvé « ${d.prop} »`
      )
    }
  }
})

/* ── T2 : contraste AA des deux thèmes ── */
const PAIRS = [
  ['ink', 'bg', 4.5], ['ink', 'card', 4.5], ['ink', 'soft', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'card', 4.5], ['muted', 'soft', 4.5],
  ['muted-2', 'bg', 3], ['muted-2', 'card', 3],
  ['blue', 'bg', 4.5], ['blue', 'card', 4.5],
  ['blue-on', 'blue', 4.5], ['blue-on', 'blue-2', 4.5],
  ['warn', 'bg', 4.5], ['danger', 'bg', 4.5]
]
for (const [name, theme] of [['dark', dark], ['light', light]]) {
  test(`T2 contraste WCAG AA — thème ${name}`, () => {
    const hex = (tok) => {
      const v = theme[`--${tok}`]
      assert.ok(v, `token manquant : --${tok} (${name})`)
      assert.match(v, /^#[0-9a-fA-F]{6}$/, `--${tok} doit être un hex (#rrggbb) : ${v}`)
      return v
    }
    for (const [fg, bg, min] of PAIRS) {
      const r = ratio(hex(fg), hex(bg))
      assert.ok(
        r >= min,
        `${name} : --${fg} sur --${bg} = ${r.toFixed(2)}:1 < ${min}:1`
      )
    }
  })
}

const cyberRules = flatRules(parseBlocks(stripComments(cyberCss)))

/* ── T3 : breakpoints Bootstrap uniquement ── */
const ALLOWED_WIDTHS = new Set([575.98, 576, 767.98, 768, 991.98, 992, 1199.98, 1200, 1399.98, 1400])
test('T3 breakpoints : échelle Bootstrap uniquement dans cyber.css', () => {
  for (const { media } of cyberRules) {
    for (const mq of media) {
      for (const m of mq.matchAll(/(min|max)-width:\s*([\d.]+)px/g)) {
        const w = Number(m[2])
        assert.ok(ALLOWED_WIDTHS.has(w), `media query hors échelle Bootstrap : ${mq}`)
      }
    }
  }
})

/* ── T4 : cibles tactiles ≥ 44px sous 576px ── */
const CLICKABLE = /(\.btn|\.nav-link|\.add\b|\[role=["']?button|\bbutton\b|\ba\b)/
const inMobile = ({ media }) => media.some((mq) => /max-width:\s*575\.98px/.test(mq))
test('T4 tactile : règles cliquables sous 575.98px → min-height ≥ 44px', () => {
  let found = 0
  for (const rule of cyberRules.filter(inMobile)) {
    if (!CLICKABLE.test(rule.selector)) continue
    found++
    const mh = rule.declarations.find((d) => d.prop === 'min-height')
    assert.ok(mh, `règle cliquable sans min-height sous 576px : ${rule.selector}`)
    const px = parseFloat(mh.value)
    assert.ok(px >= 44, `min-height ${mh.value} < 44px : ${rule.selector}`)
  }
  // Garde anti-suppression silencieuse : la règle globale § 4.3 ① doit exister.
  assert.ok(found > 0, 'aucune règle tactile cliquable sous 575.98px (§ 4.3 ① supprimée ?)')
})

/* ── T5 : jamais de clip-path sur un sélecteur portant :focus ── */
test('T5 focus : aucun clip-path sur un sélecteur :focus', () => {
  for (const rule of cyberRules) {
    if (!/:focus/.test(rule.selector)) continue
    assert.ok(
      !rule.declarations.some((d) => d.prop === 'clip-path'),
      `clip-path sur sélecteur :focus (anneau rogné) : ${rule.selector}`
    )
  }
})

/* ── T6 : aucune couleur en dur dans cyber.css ── */
/* Exception assumée (L5) : le bloc @media print est volontairement
   A-thématique (papier blanc / encre noire, économie d'encre) — les couleurs
   en dur y sont autorisées, et seulement là. */
const inPrint = ({ media }) => media.some((mq) => /print/.test(mq))
const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
  'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray',
  'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen',
  'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
  'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue',
  'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue',
  'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace',
  'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red',
  'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
  'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle',
  'tomato', 'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow',
  'yellowgreen'
])
test('T6 cyber.css : aucune couleur en dur (var(--…) uniquement, hors @media print)', () => {
  for (const rule of cyberRules.filter((r) => !inPrint(r))) {
    for (const d of rule.declarations) {
      const value = d.value.replace(/url\([\s\S]*?\)/g, '')
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(value), `couleur hex en dur (${d.prop}: ${d.value}) dans ${rule.selector}`)
      assert.ok(!/\b(rgb|rgba|hsl|hsla|lab|lch|oklch|oklab)\(/.test(value), `fonction couleur en dur (${d.prop}: ${d.value}) dans ${rule.selector}`)
      for (const word of value.split(/[^a-zA-Z-]+/)) {
        assert.ok(!NAMED_COLORS.has(word.toLowerCase()), `couleur nommée « ${word} » (${d.prop}) dans ${rule.selector}`)
      }
    }
  }
})

/* ── T7 : pas de largeur fixe sur cartes/colonnes ── */
test('T7 responsive : aucune largeur px fixe sur cartes/colonnes', () => {
  for (const rule of cyberRules) {
    if (!/(\.card|\.col)\b/.test(rule.selector)) continue
    for (const d of rule.declarations) {
      if (d.prop !== 'width') continue
      assert.ok(
        !/^\d+(\.\d+)?px$/.test(d.value),
        `largeur fixe ${d.value} sur ${rule.selector}`
      )
    }
  }
})

/* ── T10 : anti-zoom iOS (§ 4.3 ②) — champs ≥ 16px sous 576px ── */
const FORM_FIELD = /\b(input|select|textarea)\b/
test('T10 iOS : champs de formulaire ≥ 16px sous 575.98px', () => {
  let found = 0
  for (const rule of cyberRules.filter(inMobile)) {
    if (!FORM_FIELD.test(rule.selector)) continue
    found++
    const fs = rule.declarations.find((d) => d.prop === 'font-size')
    assert.ok(fs, `règle de champ sans font-size sous 576px : ${rule.selector}`)
    const px = parseFloat(fs.value)
    assert.ok(px >= 16, `font-size ${fs.value} < 16px → zoom iOS au focus : ${rule.selector}`)
  }
  assert.ok(found > 0, 'aucune règle input/select/textarea sous 575.98px (§ 4.3 ② supprimé ?)')
})

/* ── T11 : impression (§ 4.4, lot L5) ──
   Les tickets de commande partent en imprimante thermique/guichet : le
   biseautage et les fonds sombres sont interdits à l'impression. Vérifié
   mécaniquement plutôt qu'à l'œil (pas de navigateur ici). */
test('T11 impression : clip-path neutralisé + couches biseautées retirées + fond blanc', () => {
  const printRules = cyberRules.filter(inPrint)
  assert.ok(printRules.length > 0, 'aucun bloc @media print dans cyber.css')

  // 1) clip-path: none !important global
  const clipNone = printRules.some(
    (r) =>
      /\*/.test(r.selector) &&
      r.declarations.some((d) => d.prop === 'clip-path' && /^none\s*!important$/.test(d.value))
  )
  assert.ok(clipNone, '@media print doit déclarer clip-path: none !important sur *')

  // 2) les pseudo-couches biseautées sont retirées à l'impression
  const pseudoOff = printRules.some(
    (r) =>
      /::(before|after)/.test(r.selector) &&
      /\.app \.card/.test(r.selector) &&
      r.declarations.some((d) => d.prop === 'display' && /^none\s*!important$/.test(d.value))
  )
  assert.ok(pseudoOff, 'les couches ::before/::after des cartes doivent passer en display: none à l\'impression')

  // 3) fond blanc forcé
  const whiteBg = printRules.some((r) =>
    r.declarations.some((d) => d.prop === 'background' && /#fff(\s*!important)?$/.test(d.value))
  )
  assert.ok(whiteBg, 'l\'impression doit forcer un fond blanc (économie d\'encre)')
})

/* ── T8 : clip-path = tokens symétriques seulement (RTL-safe) ── */
test('T8 RTL : clip-path uniquement via var(--chamf) / var(--chamf-sm) / var(--chamf-top)', () => {
  // Hors impression : en @media print, `clip-path: none !important` est
  // l'objectif même du garde-fou (T11).
  const clipRules = cyberRules.filter((r) => !inPrint(r) && r.declarations.some((d) => d.prop === 'clip-path'))
  assert.ok(clipRules.length > 0, 'cyber.css devrait appliquer le biseautage (var(--chamf…))')
  for (const rule of clipRules) {
    for (const d of rule.declarations.filter((x) => x.prop === 'clip-path')) {
      assert.match(
        d.value,
        /^var\(--chamf(-sm|-top)?\)$/,
        `clip-path hors tokens (risque RTL § 5 R1) : ${rule.selector} → ${d.value}`
      )
    }
  }
})
