#!/usr/bin/env node
/**
 * Post-build du crawl (L2) : Vite émet TOUJOURS <script type="module"> dans
 * index.html, or jsdom n'exécute pas les scripts de type module. Le bundle
 * de dist-crawl est déjà au format IIFE (vite.crawl.config.js) — on retire
 * donc l'attribut pour qu'il tourne comme script classique.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'dist-crawl/index.html'
const html = readFileSync(file, 'utf8')
const fixed = html.replace(/<script type="module" crossorigin src=/g, '<script src=')
if (fixed === html) {
  console.error('fix-crawl-html : aucun <script type="module"> trouvé — à vérifier')
  process.exit(1)
}
writeFileSync(file, fixed)
console.log('fix-crawl-html : script du crawl repassé en script classique')
