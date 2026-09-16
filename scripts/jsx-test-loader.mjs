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

/**
 * LOT 2 — le stub Bootstrap reproduit ce que l'API réelle fait AU DOM :
 * classe `show`, attributs ARIA, et événements `show/shown` + `hide/hidden`.
 *
 * Le stub précédent se contentait d'un drapeau interne (`this.shown`) sans
 * toucher l'élément. Or c'est précisément la classe `show` posée par
 * `Offcanvas.show()` qui rend le panier visible — impossible alors de tester
 * F1 (« Ajouter la config » ouvrait la boutique, panier fermé) ni F6 (la
 * confirmation du client précédent restait affichée) sur le DOM réel.
 *
 * Restent simulés : l'animation, le backdrop, le focus-trap et le blocage de
 * scroll — sans effet sur ce que l'app décide.
 */
const BOOTSTRAP_STUB_SOURCE = `
  const REGISTRY = new WeakMap()
  function fire(el, name) {
    if (!el || typeof el.dispatchEvent !== 'function') return
    el.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }))
  }
  function makeStub(kind) {
    const ns = kind === 'modal' ? 'bs.modal' : 'bs.offcanvas'
    class Stub {
      constructor(el) {
        this._el = el
        this.shown = false
        this.disposed = false
        Stub.instances.push(this)
      }
      show() {
        if (this.disposed || !this._el || this.shown) return
        this.shown = true
        this._el.classList.add('show')
        this._el.removeAttribute('aria-hidden')
        this._el.setAttribute('aria-modal', 'true')
        this._el.setAttribute('role', 'dialog')
        this._el.style.visibility = 'visible'
        this._el.style.display = 'block'
        fire(this._el, 'show.' + ns)
        fire(this._el, 'shown.' + ns)
      }
      hide() {
        if (this.disposed || !this._el || !this.shown) return
        this.shown = false
        this._el.classList.remove('show')
        this._el.setAttribute('aria-hidden', 'true')
        this._el.removeAttribute('aria-modal')
        this._el.removeAttribute('role')
        this._el.style.removeProperty('visibility')
        this._el.style.removeProperty('display')
        fire(this._el, 'hide.' + ns)
        fire(this._el, 'hidden.' + ns)
      }
      toggle() {
        if (this.shown) this.hide()
        else this.show()
      }
      dispose() {
        if (this._el && REGISTRY.get(this._el) === this) REGISTRY.delete(this._el)
        this.disposed = true
      }
      static getOrCreateInstance(el) {
        const found = Stub.getInstance(el)
        if (found) return found
        const inst = new Stub(el)
        if (el) REGISTRY.set(el, inst)
        return inst
      }
      static getInstance(el) {
        return (el && REGISTRY.get(el)) || null
      }
    }
    Stub.instances = []
    return Stub
  }
  export const Modal = makeStub('modal')
  export const Offcanvas = makeStub('offcanvas')
  export const Tooltip = makeStub('tooltip')
  export const Popover = makeStub('popover')
  export const Dropdown = makeStub('dropdown')
  export const Collapse = makeStub('collapse')
  export const Tab = makeStub('tab')
  export const Toast = makeStub('toast')
  export default { Modal, Offcanvas, Tooltip, Popover, Dropdown, Collapse, Tab, Toast }
`

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
      source: BOOTSTRAP_STUB_SOURCE
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
