#!/usr/bin/env node
/**
 * L0 (Direction 03 « Terminal Cyber ») — vérification WCAG 2.x des tokens.
 * Usage ponctuel : `node scripts/contrast-check.mjs` (n'entre pas dans `npm test`
 * au lot L0 ; sera formalisé dans src/cyberDesign.test.js au lot L1).
 * Calcule la luminance relative réelle (pas une estimation) et le ratio de
 * contraste pour chaque paire token/fond des thèmes dark et light.
 */
const chan = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const fmt = (n) => n.toFixed(2).padStart(6)

// ── Thème sombre (défaut) ──
const dark = {
  bg: '#07090c', card: '#0d1116', soft: '#111720',
  ink: '#dfe7ef', muted: '#7d8fa1', muted2: '#5d6f80',
  line: '#1c2733', lineHi: '#2a3a4a',
  blue: '#22d3ee', blue2: '#0ea5c4', blueOn: '#04212a',
  warn: '#fbbf24', danger: '#f87171',
}
// ── Thème clair « papier technique » (option B du plan § 3.3) ──
const light = {
  bg: '#f2f5f8', card: '#ffffff', soft: '#e7edf4',
  ink: '#0b1220', muted: '#5b6b7c', muted2: '#7b8a9c',
  line: '#d5dee8', lineHi: '#b7c5d3',
  blue: '#0e7490', blue2: '#155e75', blueOn: '#f8fafc',
  warn: '#92400e', danger: '#c62828',
}

let fails = 0
const check = (theme, name, pairs) => {
  console.log(`\n── ${name} ──`)
  for (const [fg, bg, min, note] of pairs) {
    const r = ratio(theme[fg], theme[bg])
    const pass = r >= min
    if (!pass) fails++
    console.log(
      `${pass ? 'OK  ' : 'FAIL'} ${fg.padEnd(8)} / ${bg.padEnd(6)} ${fmt(r)}:1  (seuil ${min}:1) ${note}`,
    )
  }
}

for (const [name, t] of [['DARK', dark], ['LIGHT', light]]) {
  check(t, name, [
    ['ink', 'bg', 4.5, 'texte courant'],
    ['ink', 'card', 4.5, 'texte courant'],
    ['ink', 'soft', 4.5, 'texte courant'],
    ['muted', 'bg', 4.5, 'métadonnées'],
    ['muted', 'card', 4.5, 'métadonnées'],
    ['muted', 'soft', 4.5, 'métadonnées'],
    ['muted2', 'bg', 3.0, 'décoratif ≥18px / non-texte'],
    ['muted2', 'card', 3.0, 'décoratif ≥18px / non-texte'],
    ['blue', 'bg', 4.5, 'accent / liens'],
    ['blue', 'card', 4.5, 'accent / liens'],
    ['blueOn', 'blue', 4.5, 'texte sur accent'],
    ['blueOn', 'blue2', 4.5, 'texte sur accent (hover)'],
    ['warn', 'bg', 4.5, 'avertissement'],
    ['danger', 'bg', 4.5, 'erreur'],
  ])
}

// Filets décoratifs (information seulement — WCAG 1.4.11 ne s'applique pas :
// les panneaux restent identifiables par leur fond, cf. plan § 6.1)
console.log('\n── filets (info) ──')
console.log(`dark  line/bg      ${fmt(ratio(dark.line, dark.bg))}:1   line-hi/bg ${fmt(ratio(dark.lineHi, dark.bg))}:1`)
console.log(`light line/card    ${fmt(ratio(light.line, light.card))}:1   line-hi/card ${fmt(ratio(light.lineHi, light.card))}:1`)

if (fails) {
  console.error(`\n${fails} PAIRE(S) SOUS LE SEUIL`)
  process.exit(1)
}
console.log('\nTOUTES LES PAIRES PASSENT')
