#!/usr/bin/env node
/**
 * Post-build du crawl (L2) : deux corrections sur `dist-crawl/index.html`.
 *
 * 1. Vite émet TOUJOURS `<script type="module">` dans index.html, or jsdom
 *    n'exécute pas les scripts de type module. Le bundle de dist-crawl est déjà
 *    au format IIFE (vite.crawl.config.js) — on retire donc l'attribut pour
 *    qu'il tourne comme script classique.
 *
 * 2. Un script CLASSIQUE placé dans `<head>` est, aux termes de la spec HTML,
 *    un script bloquant : le parseur attend son évaluation avant d'aller plus
 *    loin. `src/main.jsx` appelle `createRoot(document.getElementById('root'))`
 *    et `<div id="root">` est dans le `<body>` : dans cet ordre, le conteneur
 *    n'existe pas encore au moment de l'évaluation. Mesuré ici (jsdom, bundle
 *    réel du crawl) : `Error: Minified React error #299` (conteneur absent) et
 *    `#root` vidé de tout rendu quand le script est dans le `<head>`, 0 erreur
 *    et 373 300 caractères rendus quand il est après. La prod n'est jamais dans
 *    ce cas — son `<script type="module">` est différé par spéculation de
 *    parsing, donc évalué après le parsing. Le `type="module"` retiré au point
 *    1, c'est `defer` qui doit prendre le relais, ET le nœud doit suivre le
 *    conteneur : les deux sont appliqués, parce qu'une porte de validation dont
 *    le succès dépend de la vitesse du cache est une porte qui ment.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = 'dist-crawl/index.html'
const html = readFileSync(file, 'utf8')

const sansModule = html.replace(/<script type="module" crossorigin src=/g, '<script defer src=')
if (sansModule === html) {
  console.error('fix-crawl-html : aucun <script type="module"> trouvé — à vérifier')
  process.exit(1)
}

// Le(s) script(s) du bundle quittent le <head> pour se placer juste après #root.
const scripts = [...sansModule.matchAll(/^[ \t]*<script defer src="\/assets\/[^"]+"><\/script>\n/gm)]
let fixé = sansModule
for (const m of scripts) fixé = fixé.replace(m[0], '')
if (!/<div id="root"><\/div>/.test(fixé)) {
  console.error('fix-crawl-html : `<div id="root"></div>` introuvable — le déplacement du script est à revoir')
  process.exit(1)
}
fixé = fixé.replace('<div id="root"></div>', `<div id="root"></div>\n${scripts.map((m) => m[0].trim()).join('\n')}`)

writeFileSync(file, fixé)
console.log(`fix-crawl-html : ${scripts.length} script(s) du crawl différés et replacés après #root`)
