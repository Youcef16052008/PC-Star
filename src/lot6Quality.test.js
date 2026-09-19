import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

// ---------------------------------------------------------------------------
// LOT 6 — qualité du code : une seule source de vérité par règle, plus de code
// mort, plus d'incohérences entre deux écritures de la même chose.
//
//  6.1 (Q1)  `stockLabel` dupliqué 4× avec 2 conventions de classes → un seul
//            module, la classe Bootstrap complète, aucun appelant ne traduit.
//  6.2 (Q2)  la règle de téléphone dupliquée (client + serveur) → `phoneLogic.js`
//            canonique, ré-exporté (et UTILISABLE localement : `export … from`
//            ne crée pas de liaison).
//  6.3 (Q3)  `loadTheme`/`saveTheme`/`resolveTheme` : code mort (thème sombre
//            retiré sur demande client) → supprimé.
//  6.4 (Q4)  `theme-color` écrit `#f2f5f8` côté React et `#f4f6fb` côté
//            index.html/theme-boot → une constante partagée.
//  6.5 (Q5)  `count` passé au toast sans jamais être lu → retiré.
//  6.6 (Q6)  les listes d'options du Builder filtraient autrement que
//            `socketsMatch` (P17) → un seul prédicat.
//  6.7 (Q7)  `s-${Date.now()}` comme id de recherche sauvée → collisions dans la
//            même milliseconde.
//  6.8 (Q8)  trois écritures des en-têtes CORS, dont une posant un
//            `Allow-Origin` vide → `corsHeaders()` unique.
//  6.9 (Q9)  le smoke e2e n'assertait que « pas de texte d'erreur » → il vérifie
//            l'état connecté.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..')
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

/**
 * Source SANS ses commentaires : les explications de correctif citent souvent le
 * nom de ce qu'elles suppriment (« `loadTheme` a disparu »), et un scan naïf se
 * mordrait la queue en le retrouvant.
 */
function codeOnly(rel) {
  return src(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

const dom = new JSDOM(
  '<!doctype html><html><head><meta name="theme-color" content="#f4f6fb" /></head><body><div id="root"></div></body></html>',
  { url: 'http://127.0.0.1:5173/', pretendToBeVisual: true }
)
const { window } = dom

// Globaux posés AVANT les imports (les modules capturent `window`/`localStorage`).
window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'getComputedStyle'
]) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: BuilderPage } = await import('./BuilderPage.jsx')
const { default: SearchPage } = await import('./SearchPage.jsx')
const { PRODUCTS, PART_LINES, BUILDER_SLOTS, socketsMatch } = await import('./data.js')
const { stockLabel, STOCK_LOW_THRESHOLD } = await import('./stockLabel.js')
const { applyDocumentChrome, THEME_COLOR_LIGHT, saveLang } = await import('./prefs.js')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')

const settle = (ms) => act(async () => new Promise((r) => setTimeout(r, ms)))
/** Traducteur lisible : `clé|var=valeur` (comme BuilderPage.test.js). */
const t = (key, vars) => [String(key), ...Object.entries(vars || {}).map(([k, v]) => `${k}=${v}`)].join('|')
const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

before(() => {
  resetSafeStorage(window)
  window.localStorage.clear()
})

after(async () => {
  await settle(40)
})

async function mount(el) {
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(el)
  })
  await settle(80)
  return {
    host,
    text: () => clean(host),
    byText: (selector, text_) => [...host.querySelectorAll(selector)].find((n) => clean(n) === text_) || null,
    unmount: async () => {
      root.unmount()
      host.remove()
      await settle(20)
    }
  }
}

/* ------------------------------------------------------------- 6.1 (Q1) */

describe('6.1 (Q1) — stockLabel : une définition, une convention de classes', () => {
  const composants = ['src/App.jsx', 'src/BuilderPage.jsx', 'src/SearchPage.jsx', 'src/ProductPage.jsx']

  it('aucun composant ne redéfinit stockLabel', () => {
    for (const f of composants) {
      const code = src(f)
      assert.doesNotMatch(code, /function stockLabel\s*\(/, `${f} définit encore stockLabel`)
      assert.doesNotMatch(code, /const stockLabel\s*=/, `${f} définit encore stockLabel`)
      assert.match(code, /import \{[^}]*stockLabel[^}]*\} from '\.\/stockLabel(\.js)?'/, `${f} doit importer le module partagé`)
    }
  })

  it('plus personne ne retraduit la classe (ni ternaire, ni interpolation)', () => {
    for (const f of [...composants, 'src/MasterPage.jsx', 'src/OrdersPage.jsx']) {
      const code = src(f)
      assert.doesNotMatch(code, /text-bg-\$\{/, `${f} interpole encore text-bg-\${cls}`)
      assert.doesNotMatch(code, /st\.cls === '(danger|warning|success)'/, `${f} retraduit encore la classe`)
      assert.doesNotMatch(code, /'(stock-out|stock-low|stock-ok)'/, `${f} utilise encore des classes maison inexistantes`)
    }
  })

  it('la fonction renvoie la classe Bootstrap COMPLÈTE', () => {
    const cases = [
      [0, 'text-bg-danger', 'out'],
      [STOCK_LOW_THRESHOLD, 'text-bg-warning', 'low'],
      [STOCK_LOW_THRESHOLD + 1, 'text-bg-success', 'ok'],
      [99, 'text-bg-success', 'ok']
    ]
    for (const [n, cls, level] of cases) {
      const st = stockLabel(n, t)
      assert.equal(st.cls, cls, `stock=${n}`)
      assert.equal(st.level, level)
      assert.ok(st.text.length > 0)
    }
  })

  it('entrées dégénérées : ni NaN, ni stock négatif affiché', () => {
    for (const n of [undefined, null, NaN, -5, '3', 2.9]) {
      const st = stockLabel(n, t)
      assert.doesNotMatch(st.text, /NaN|undefined|null/)
      assert.match(st.cls, /^text-bg-(danger|warning|success)$/)
    }
    assert.equal(stockLabel(-5, t).level, 'out')
    assert.equal(stockLabel('3', t).level, 'low', 'une chaîne numérique est un stock')
  })

  it('le seuil « 3 dernières pièces » n’existe qu’à un seul endroit', () => {
    for (const f of ['src/App.jsx', 'src/BuilderPage.jsx', 'src/SearchPage.jsx', 'src/ProductPage.jsx']) {
      assert.doesNotMatch(src(f), /<=\s*3\b[^0-9]/, `${f} recâble le seuil de stock faible`)
    }
  })
})

/* ------------------------------------------------------------- 6.2 (Q2) */

describe('6.2 (Q2) — la règle de téléphone a une seule source', () => {
  it('client et serveur renvoient exactement les mêmes résultats', async () => {
    const logic = await import('./phoneLogic.js')
    const store = await import('./shopStore.js')
    const server = await import('../server/phone.js')

    const samples = ['0550123456', '+213550123456', '00213550123456', '550123456', '0770 65 03 87', 'abc', '']
    for (const s of samples) {
      assert.equal(store.normalizePhone(s), logic.normalizePhone(s), `normalizePhone(${JSON.stringify(s)}) diverge`)
      assert.equal(server.normalizePhone(s), logic.normalizePhone(s), `serveur normalizePhone(${JSON.stringify(s)}) diverge`)
      assert.equal(store.phoneCarrier(s), logic.phoneCarrier(s), `phoneCarrier(${JSON.stringify(s)}) diverge`)
      assert.equal(server.phoneCarrier(s), logic.phoneCarrier(s), `serveur phoneCarrier(${JSON.stringify(s)}) diverge`)
      assert.equal(store.isDzPhone(s), logic.isDzPhone(s), `isDzPhone(${JSON.stringify(s)}) diverge`)
    }
  })

  it('shopStore.js UTILISE la règle (pas seulement la ré-exporte)', async () => {
    // `export { x } from './y'` ne crée aucune liaison locale : `registerEmail`
    // appelait `normalizePhone` et levait `ReferenceError`.
    const store = await import('./shopStore.js')
    const storage = store.createMemoryStorage()
    const avant = store.loadUsers(storage)
    assert.ok(Array.isArray(avant), 'loadUsers renvoie la liste des comptes')
    // `registerEmail(users, …)` prend la LISTE (pas le stockage) : c'est l'appel
    // réel d'`AuthPanel`. Avant le correctif, cette ligne levait
    // `ReferenceError: normalizePhone is not defined` — la ré-exportation
    // `export { x } from './y'` ne crée aucune liaison locale.
    const r = store.registerEmail(avant, {
      email: 'q2.test@example.invalid',
      password: 'motdepasse-test',
      name: 'Q2',
      phone: '0550 12 34 56'
    })
    assert.equal(r.ok, true, 'registerEmail doit réussir : ' + JSON.stringify(r))
    assert.equal(r.user.phone, '0550123456', 'le téléphone doit être normalisé par la règle partagée')
    assert.equal(r.users.length, avant.length + 1, 'le compte est ajouté à la liste')
    // La même règle sert à la mise à jour de profil.
    const upd = store.updateUser(r.users, r.user.id, { phone: '+213 770 65 03 87' })
    assert.equal(upd.ok, true)
    assert.equal(store.loadUsers(storage).length >= 0, true)
  })

  it('le module serveur ne réimplémente pas la règle', () => {
    const code = src('server/phone.js')
    assert.match(code, /from '\.\.\/src\/phoneLogic(\.js)?'/, 'server/phone.js doit ré-exporter phoneLogic')
    // Écrit en morceaux : le motif littéral se détecterait lui-même.
    const normalisation = ['replace(', '/', '[^0-9]', '/', 'g'].join('')
    assert.ok(!code.includes(normalisation), 'server/phone.js recode encore la normalisation')
    assert.ok(!code.includes('function normalizePhone('), 'server/phone.js réimplémente normalizePhone')
  })
})

/* ------------------------------------------------------- 6.3 (Q3) + 6.4 (Q4) */

describe('6.3 (Q3) — plus de code mort autour du thème', () => {
  it('loadTheme / saveTheme / resolveTheme ont disparu', async () => {
    const prefs = await import('./prefs.js')
    for (const nom of ['loadTheme', 'saveTheme', 'resolveTheme']) {
      assert.equal(prefs[nom], undefined, `${nom} est encore exporté`)
    }
    const code = codeOnly('src/prefs.js')
    assert.doesNotMatch(code, /KEY_THEME/, 'la clé de stockage du thème reste')
    assert.doesNotMatch(code, /pcstar-theme/, 'la clé `pcstar-theme` reste')
  })

  it('rien d’autre ne les appelait (le dépôt entier)', () => {
    for (const f of ['src/App.jsx', 'src/prefs.js', 'src/shopStore.js', 'src/MasterPage.jsx', 'src/ProfilePage.jsx']) {
      const code = codeOnly(f)
      for (const nom of ['loadTheme', 'saveTheme', 'resolveTheme']) {
        assert.ok(!code.includes(nom), `${f} référence encore ${nom}`)
      }
    }
  })

  it('applyDocumentChrome reste (il EST utilisé par App.jsx)', () => {
    assert.match(src('src/App.jsx'), /applyDocumentChrome\(/, 'App.jsx applique toujours la chrome du document')
  })
})

describe('6.4 (Q4) — theme-color : une seule teinte', () => {
  it('index.html, theme-boot.js et prefs.js disent la même chose', () => {
    const html = src('index.html')
    const boot = src('public/theme-boot.js')
    const m = html.match(/name="theme-color"\s+content="(#[0-9a-fA-F]{6})"/)
    assert.ok(m, 'meta theme-color introuvable dans index.html')
    assert.equal(m[1].toLowerCase(), THEME_COLOR_LIGHT.toLowerCase(), 'index.html ≠ constante partagée')
    assert.ok(boot.includes(THEME_COLOR_LIGHT), `theme-boot.js n’annonce pas ${THEME_COLOR_LIGHT}`)
  })

  it('le montage de React ne change plus la teinte (comportement)', () => {
    const meta = window.document.querySelector('meta[name="theme-color"]')
    const avant = meta.getAttribute('content')
    applyDocumentChrome({ lang: 'fr', dir: 'ltr', theme: 'light' })
    assert.equal(meta.getAttribute('content'), avant, 'la barre du navigateur ne doit pas changer de teinte au montage')
    assert.equal(meta.getAttribute('content'), THEME_COLOR_LIGHT)
    assert.equal(window.document.documentElement.lang, 'fr')
    assert.equal(window.document.documentElement.dir, 'ltr')
  })

  it('la langue et le sens de lecture sont toujours appliqués (LTR fr/en)', () => {
    applyDocumentChrome({ lang: 'en', dir: 'ltr', theme: 'light' })
    assert.equal(window.document.documentElement.dir, 'ltr')
    assert.equal(window.document.documentElement.lang, 'en')
    assert.equal(window.document.documentElement.style.colorScheme, 'light')
    applyDocumentChrome({ lang: 'fr', dir: 'ltr', theme: 'light' })
    assert.equal(window.document.documentElement.lang, 'fr')
  })
})

/* ------------------------------------------------------------- 6.5 (Q5) */

describe('6.5 (Q5) — plus de donnée morte dans le toast panier', () => {
  it('le toast « ajouté au panier » ne porte plus de `count` non lu', () => {
    const code = src('src/App.jsx')
    assert.doesNotMatch(code, /kind:\s*'cart'[\s\S]{0,200}?count,/, 'le toast passe encore un `count` jamais affiché')
    // Le compteur du panier, lui, est bien rendu quelque part (badge).
    assert.match(code, /\{count\}/, 'le badge panier doit toujours afficher le nombre d’articles')
  })

  it('le texte du toast reste nom + « ajouté au panier »', () => {
    const code = src('src/App.jsx')
    assert.match(code, /toast\?\.kind === 'cart' \? `\$\{toast\.name\} · \$\{t\('addedToCart'\)\}`/)
  })
})

/* ------------------------------------------------------------- 6.6 (Q6) */

describe('6.6 (Q6) — le Builder filtre avec le même prédicat qu’il affiche', () => {
  const emptyBuild = () => Object.fromEntries(BUILDER_SLOTS.map((s) => [s.key, null]))
  const P = (id) => {
    const p = PRODUCTS.find((x) => x.id === id)
    assert.ok(p, `fixture absente du catalogue : ${id}`)
    return p
  }

  const mountBuilder = (build, products = PRODUCTS) =>
    mount(
      React.createElement(BuilderPage, {
        t,
        products,
        build,
        setBuild: () => {},
        liveStock: () => 5,
        onAdd: () => {},
        onOpen: () => {},
        onGoCart: () => {},
        setToast: () => {}
      })
    )

  it('carte mère multi-socket : les CPU de chaque socket sont proposés', async () => {
    const board = { ...P('mb-b650'), compat: { ...P('mb-b650').compat, socket: ['AM5', 'AM4'] } }
    const am5 = PRODUCTS.find((p) => p.category === 'cpu' && String(p.compat?.socket).includes('AM5'))
    const am4 = { ...am5, id: 'cpu-fixture-am4', name: 'CPU fixture AM4', compat: { ...am5.compat, socket: 'AM4' } }
    assert.ok(am5, 'fixture : aucun CPU AM5')

    const m = await mountBuilder({ ...emptyBuild(), motherboard: board }, [...PRODUCTS, am4])
    const cpuSlot = BUILDER_SLOTS.find((s) => s.key === 'cpu')
    const btn = [...m.host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(cpuSlot.label))
    assert.ok(btn, 'onglet CPU introuvable')
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await settle(60)

    const text = m.text()
    assert.ok(text.includes(am5.name), 'le CPU AM5 doit être proposé pour une carte AM5/AM4')
    assert.ok(text.includes(am4.name), 'le CPU AM4 doit être proposé pour une carte AM5/AM4 (P17)')
    await m.unmount()
  })

  it('carte mère mono-socket : un CPU d’un AUTRE socket n’est pas proposé', async () => {
    const board = P('mb-b650') // AM5
    const am5 = PRODUCTS.find((p) => p.category === 'cpu' && String(p.compat?.socket).includes('AM5'))
    const other = { ...am5, id: 'cpu-fixture-lga', name: 'CPU fixture LGA1700', compat: { ...am5.compat, socket: 'LGA1700' } }

    const m = await mountBuilder({ ...emptyBuild(), motherboard: board }, [...PRODUCTS, other])
    const cpuSlot = BUILDER_SLOTS.find((s) => s.key === 'cpu')
    const btn = [...m.host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(cpuSlot.label))
    await act(async () => {
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    await settle(60)
    const text = m.text()
    assert.ok(text.includes(am5.name), 'le CPU compatible doit rester proposé')
    assert.ok(!text.includes(other.name), 'un CPU LGA1700 ne doit pas être proposé sur une carte AM5')
    await m.unmount()
  })

  it('ventirad multi-socket : accepté quelle que soit la forme des données', () => {
    // Le filtre d'options et l'indicateur de compatibilité utilisent désormais
    // le même prédicat : chaîne vs tableau, dans les deux sens.
    assert.equal(socketsMatch(['AM5', 'AM4'], 'AM4'), true)
    assert.equal(socketsMatch('AM4', ['AM5', 'AM4']), true)
    assert.equal(socketsMatch('AM5', 'LGA1700'), false)
    const code = src('src/BuilderPage.jsx')
    assert.doesNotMatch(code, /p\.compat\?\.socket === board\.compat\?\.socket/, 'filtre CPU encore en `===`')
    assert.doesNotMatch(code, /p\.compat\.socket\.includes\(/, 'filtre ventirad encore en `.includes()`')
    const hits = code.match(/socketsMatch\(/g) || []
    assert.ok(hits.length >= 3, 'les filtres d’options doivent passer par socketsMatch')
  })
})

/* ------------------------------------------------------------- 6.7 (Q7) */

describe('6.7 (Q7) — les recherches sauvées ont des ids uniques', () => {
  const KEY = 'pcstar-saved-searches'

  it('deux sauvegardes dans la même milliseconde → deux ids distincts', async () => {
    window.localStorage.removeItem(KEY)
    const m = await mount(
      React.createElement(SearchPage, {
        t,
        products: PRODUCTS,
        lines: PART_LINES,
        panels: [],
        lang: 'fr',
        liveStock: () => 5,
        onAdd: () => {},
        onOpen: () => {}
      })
    )

    const saveBtn = m.byText('button', t('saveSearch'))
    assert.ok(saveBtn, 'bouton « Enregistrer la recherche » introuvable')

    // Date.now figé : les deux clics tombent dans la MÊME milliseconde, ce qui
    // est exactement le cas réel d'un double-clic (et ce que `s-${Date.now()}`
    // ne savait pas gérer).
    const realNow = Date.now
    Date.now = () => 1760000000000
    try {
      await act(async () => {
        saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      })
    } finally {
      Date.now = realNow
    }
    await settle(60)

    const stored = JSON.parse(window.localStorage.getItem(KEY) || '[]')
    assert.equal(stored.length, 2, 'deux recherches doivent être enregistrées')
    assert.notEqual(stored[0].id, stored[1].id, 'les ids doivent différer même dans la même milliseconde')
    assert.equal(new Set(stored.map((s) => s.id)).size, 2)

    // Les deux sont rendues (des `key` React dupliqués en auraient fusionné une).
    const rendered = [...m.host.querySelectorAll('button')].filter((b) => clean(b) === stored[0].title)
    assert.equal(rendered.length, 2, 'les deux recherches doivent apparaître dans la liste')
    await m.unmount()
  })

  it('la borne à 10 tient toujours (P10 conservé)', async () => {
    window.localStorage.removeItem(KEY)
    const m = await mount(
      React.createElement(SearchPage, {
        t,
        products: PRODUCTS,
        lines: PART_LINES,
        panels: [],
        lang: 'fr',
        liveStock: () => 5,
        onAdd: () => {},
        onOpen: () => {}
      })
    )
    const saveBtn = m.byText('button', t('saveSearch'))
    const realNow = Date.now
    let n = 0
    Date.now = () => 1760000000000 + n++ // ids distincts garantis
    try {
      for (let i = 0; i < 13; i += 1) {
        await act(async () => {
          saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        })
      }
    } finally {
      Date.now = realNow
    }
    await settle(60)
    const stored = JSON.parse(window.localStorage.getItem(KEY) || '[]')
    assert.equal(stored.length, 10, 'la liste reste bornée à 10')
    assert.equal(new Set(stored.map((s) => s.id)).size, 10, '10 ids distincts')
    await m.unmount()
  })
})

/* ------------------------------------------------------------- 6.8 (Q8) */

describe('6.8 (Q8) — un seul jeu d’en-têtes CORS', () => {
  it('aucune écriture de CORS hors corsHeaders() dans server/index.js', () => {
    const code = src('server/index.js')
    const lignes = code.split('\n')
    lignes.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return // commentaires
      if (!/Access-Control-Allow-(Origin|Headers|Methods)/.test(l)) return
      // Seule la définition de corsHeaders() peut écrire ces en-têtes.
      const dansCorsHeaders = i > 0 && /export function corsHeaders/.test(lignes.slice(Math.max(0, i - 25), i + 1).join('\n'))
      assert.ok(dansCorsHeaders, `ligne ${i + 1} : en-tête CORS écrit hors corsHeaders() → ${l.trim()}`)
    })
  })

  it('avec origine déclarée : les 4 en-têtes sortent ensemble (sonde isolée)', () => {
    // `scripts/test-env.mjs` ÉPINGLE `FRONT_ORIGIN` à '' (volontairement : les
    // tests d'absence d'en-tête CORS en dépendent). La sonde pose donc l'origine
    // elle-même, avant l'import — `server/index.js` la lit au chargement.
    const probe = `
      process.env.FRONT_ORIGIN = 'https://shop.example'
      const { corsHeaders } = await import(${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'server', 'index.js'))))})
      console.log(JSON.stringify(corsHeaders()))
    `
    const res = spawnSync(process.execPath, ['--import', String(pathToFileURL(path.join(ROOT, 'scripts', 'test-env.mjs'))), '--input-type=module', '-e', probe], {
      env: { ...process.env, PCSTAR_DATA_DIR: path.join(ROOT, '.tmp-q8') },
      encoding: 'utf8',
      timeout: 60000
    })
    assert.equal(res.status, 0, 'sonde : ' + String(res.stderr).slice(0, 500))
    const h = JSON.parse(res.stdout.trim().split('\n').pop())
    assert.equal(h['Access-Control-Allow-Origin'], 'https://shop.example')
    assert.equal(h.Vary, 'Origin')
    assert.match(h['Access-Control-Allow-Headers'], /Authorization/)
    assert.match(h['Access-Control-Allow-Methods'], /OPTIONS/)
  })

  it('sans origine déclarée : aucun en-tête CORS, et surtout pas un Allow-Origin vide', () => {
    const probe = `
      const { corsHeaders } = await import(${JSON.stringify(String(pathToFileURL(path.join(ROOT, 'server', 'index.js'))))})
      console.log(JSON.stringify(corsHeaders()))
    `
    const res = spawnSync(process.execPath, ['--import', String(pathToFileURL(path.join(ROOT, 'scripts', 'test-env.mjs'))), '--input-type=module', '-e', probe], {
      env: { ...process.env, FRONT_ORIGIN: '', FRONT_URL: '', VERCEL_URL: '', PCSTAR_DATA_DIR: path.join(ROOT, '.tmp-q8b') },
      encoding: 'utf8',
      timeout: 60000
    })
    assert.equal(res.status, 0, 'sonde : ' + String(res.stderr).slice(0, 500))
    const h = JSON.parse(res.stdout.trim().split('\n').pop())
    assert.deepEqual(h, {}, 'sans origine, l’API est same-origin : zéro en-tête CORS')
    assert.equal(h['Access-Control-Allow-Origin'], undefined, 'un Allow-Origin vide est un en-tête invalide')
  })

  it('les routes qui n’utilisent pas send() propagent quand même corsHeaders()', () => {
    const code = src('server/index.js')
    // Redirection OAuth, photo locale, redirection Blob, export CSV.
    // Découpage manuel : chaque `res.writeHead(` jusqu'à sa fermeture `})`.
    const sites = []
    let from = 0
    for (;;) {
      const i = code.indexOf('res.writeHead(', from)
      if (i < 0) break
      const j = code.indexOf('})', i)
      sites.push(code.slice(i, j > 0 ? j + 2 : i + 400))
      from = i + 14
    }
    assert.ok(sites.length >= 5, `routes hors send() attendues, ${sites.length} trouvées`)
    for (const site of sites) {
      if (/'Content-Type': isJson/.test(site)) continue // c'est send() lui-même
      assert.match(site, /corsHeaders\(\)/, 'une réponse écrite à la main doit propager les mêmes en-têtes :\n' + site.slice(0, 220))
    }
  })
})

/* ------------------------------------------------------------- 6.9 (Q9) */

describe('6.9 (Q9) — le smoke e2e vérifie l’état connecté', () => {
  const code = src('e2e/smoke.spec.js')

  /** Découpe le fichier en blocs `test('…', async …)` nommés. */
  const blocs = () => {
    const out = {}
    const re = /test\(\s*'([^']+)'[\s\S]*?(?=\ntest\(|\n\/\/|\nconst DEMO|$)/g
    let m
    while ((m = re.exec(code))) out[m[1]] = m[0]
    return out
  }

  it('il ne se contente plus d’une assertion négative', () => {
    const b = blocs()
    const login = b['demo customer can open login and authenticate']
    assert.ok(login, 'le test de connexion doit exister')
    assert.match(login, /not\.toContainText\(\/auth\.\*error\/i\)/, 'la garde d’origine reste')
    // L'état connecté doit être ASSERTÉ dans CE bloc : attendre le bouton profil
    // au nom du compte démo, la déconnexion visible, et la disparition du
    // bouton « Connexion ».
    assert.match(login, /expect\(page\.getByRole\('button', \{ name: new RegExp\(DEMO\.name/, 'le nom du compte connecté doit être attendu après le clic')
    assert.match(login, /déconnexion|logout|خروج/i, 'la déconnexion doit apparaître une fois connecté')
    assert.match(login, /toHaveCount\(0\)/, 'le bouton « Connexion » doit disparaître')
    assert.match(code, /name: 'Karim B\.'/, 'les identifiants attendus sont ceux du compte démo seedé')
  })

  it('la session est vérifiée après rechargement (le jeton doit survivre)', () => {
    const b = blocs()
    const reload = b['demo session survives a page reload']
    assert.ok(reload, 'un test de survie de session au rechargement doit exister')
    assert.match(reload, /page\.reload\(\)/, 'le test doit recharger la page')
    // Découpe sur le code, pas sur la prose : la verrouillait sur la PREMIERE
    // occurrence du texte, donc une phrase de commentaire qui nommait l'appel
    // déplaçait la découpe et faisait échouer le verrou pour la mauvaise raison.
    // Les commentaires sont retirés, puis on découpe sur la dernière occurrence
    // du rechargement — seule la vraie assertion compte, dans un sens comme dans
    // l'autre (un commentaire ne peut plus ni satisfaire ni saboter ce verrou).
    const corps = reload.replace(/^\s*\/\/.*$/gm, '')
    const i = corps.lastIndexOf('page.reload()')
    const apres = i >= 0 ? corps.slice(i + 'page.reload()'.length) : ''
    assert.match(
      apres,
      /expect\(page\.getByRole\('button', \{ name: new RegExp\(DEMO\.name/,
      'après rechargement, l’état connecté doit être revérifié (et pas seulement avant)'
    )
    assert.match(apres, /toBeVisible\(\)/)
  })

  it('les identifiants utilisés sont ceux du compte de DÉMONSTRATION (non privilégié)', () => {
    assert.match(code, /karim\.oran@demo\.dz/)
    const db = src('server/db.js')
    const i = db.indexOf("id: 'demo-karim'")
    assert.ok(i > 0, 'le compte démo doit exister dans la seed')
    const bloc = db.slice(i, i + 400)
    assert.match(bloc, /role: 'customer'/, 'le smoke ne doit jamais se connecter avec un compte maître')
    assert.doesNotMatch(code, /master/i, 'aucun compte maître dans le smoke e2e')
  })
})
