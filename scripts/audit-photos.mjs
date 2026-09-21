#!/usr/bin/env node
/**
 * Combien de références n'ont PAS leur propre photo ?
 *
 * Une fiche `photoMode: 'category'` montre l'illustration de son rayon : la même
 * image pour dix routeurs, la même pour sept imprimantes. Ce relevé liste les
 * références qui attendent encore leur photo (à générer ou à recevoir du
 * comptoir), et le fichier `/catalog/*.jpg` qu'elles partagent aujourd'hui —
 * c'est le travail restant du chantier photos, pas un état stable.
 *
 * CLI : node scripts/audit-photos.mjs
 */
import { PRODUCTS } from '../src/data.js'

const restants = PRODUCTS.filter((p) => String((p.photos || [])[0] || '').startsWith('/catalog/'))
const fichiers = new Set(PRODUCTS.flatMap((p) => (p.photos || []).filter((s) => String(s).startsWith('/catalog/'))))
const parRayon = {}
for (const p of restants) parRayon[p.category] = (parRayon[p.category] || 0) + 1

console.log(`catalogue : ${PRODUCTS.length} références, ${fichiers.size} illustrations de rayon en service`)
console.log(`sans photo propre : ${restants.length}`)
for (const [cat, n] of Object.entries(parRayon).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(2)}  ${cat}`)
for (const p of restants) console.log([p.id, p.category, p.brand, p.name, p.photos[0]].join('\t'))
