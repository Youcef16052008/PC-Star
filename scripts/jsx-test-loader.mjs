/**
 * Chargeur de test : permet à `node --test` d'importer les composants `.jsx`.
 *
 * Node ne sait pas parser le JSX ; le dépôt n'a pas de runner dédié (Jest/Vitest)
 * et les tests tournent en `node:test`. Plutôt que de renoncer à tester les
 * composants (P14 #4 Builder, P15 #6 PartThumb), on transforme le JSX à la
 * volée avec esbuild — déjà présent via Vite.
 *
 * Usage (déjà câblé dans `npm test`) :
 *   node --import ./scripts/jsx-test-register.mjs --test …
 */
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

/**
 * Le code applicatif est écrit pour Vite : les imports relatifs sont souvent
 * sans extension (`from './data'`). Node ESM exige l'extension → on complète.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') && err?.code === 'ERR_MODULE_NOT_FOUND') {
      for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
        try {
          return await next(specifier + ext, context)
        } catch {
          /* on essaie le suivant */
        }
      }
    }
    throw err
  }
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.jsx')) {
    const source = readFileSync(new URL(url), 'utf8')
    const { code } = transformSync(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      target: 'node20',
      sourcefile: new URL(url).pathname
    })
    return { format: 'module', shortCircuit: true, source: code }
  }
  return next(url, context)
}
