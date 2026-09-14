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
/**
 * P20 — `bootstrap` n'a pas d'export ESM nommé utilisable sous Node
 * (`import { Modal } from 'bootstrap'` → SyntaxError), ce qui empêchait de
 * rendre le vrai `App` en test. L'app n'utilise que `Modal` et `Offcanvas`,
 * uniquement pour ouvrir/fermer des panneaux : on substitue des classes inertes
 * qui enregistrent les appels. Le JSX et le DOM restent réels — seul le
 * comportement d'ouverture Bootstrap est simulé.
 */
const BOOTSTRAP_STUB = 'pcstar-test:bootstrap'

export async function resolve(specifier, context, next) {
  if (specifier === 'bootstrap') return { url: BOOTSTRAP_STUB, shortCircuit: true, format: 'module' }
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
  if (url === BOOTSTRAP_STUB) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        class Stub {
          constructor(el) { this._el = el; Stub.instances.push(this) }
          show() { this.shown = true }
          hide() { this.shown = false }
          dispose() { this.disposed = true }
          static getOrCreateInstance(el) { return new Stub(el) }
          static getInstance(el) { return null }
        }
        Stub.instances = []
        export const Modal = Stub
        export const Offcanvas = Stub
        export const Tooltip = Stub
        export const Popover = Stub
        export const Dropdown = Stub
        export const Collapse = Stub
        export const Tab = Stub
        export const Toast = Stub
        export default { Modal: Stub, Offcanvas: Stub, Tooltip: Stub, Popover: Stub, Dropdown: Stub, Collapse: Stub, Tab: Stub, Toast: Stub }
      `
    }
  }
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
