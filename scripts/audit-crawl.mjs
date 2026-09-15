/**
 * Harnais d'audit — pilote le VRAI App dans jsdom, visite chaque page et clique
 * chaque bouton, en capturant toute erreur console / exception non gérée.
 *
 * Usage : node --experimental-loader ./scripts/jsx-test-loader.mjs \
 *           --no-warnings scripts/audit-crawl.mjs [ar|fr|en]
 *
 * Le harnais REMONTE l'application avant chaque page : un balayage qui clique
 * des centaines de boutons finit par altérer la session (OAuth, déconnexion),
 * ce qui faisait disparaître les pages réservées au maître.
 */
import { JSDOM } from 'jsdom'
import { masterCredentials } from './masterEnv.mjs'

const LANG = process.argv[2] || 'fr'
const API = 'http://127.0.0.1:8787'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const { window } = dom
for (const k of [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event',
  'CustomEvent', 'getComputedStyle', 'localStorage', 'requestAnimationFrame',
  'cancelAnimationFrame'
]) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
window.confirm = () => false // actions destructives refusées pendant le balayage
window.alert = () => {}

// --- capture des erreurs ---------------------------------------------------
const errors = []
const BENIGN = /not wrapped in act|ReactDOMTestUtils|The above error occurred|Not implemented: navigation|Could not parse CSS|Error: Not implemented/
console.error = (...a) => {
  const s = a.map((x) => (x && x.stack) ? x.stack : String(x)).join(' ')
  if (BENIGN.test(s)) return
  errors.push(s)
}
process.on('unhandledRejection', (e) => {
  const s = 'unhandledRejection: ' + (e?.stack || e)
  if (!BENIGN.test(s)) errors.push(s)
})

// --- fetch : URL relatives → API locale ------------------------------------
const realFetch = globalThis.fetch
globalThis.fetch = (u, init) => {
  const s = String(u)
  return realFetch(s.startsWith('/') ? API + s : s, init)
}

// --- session maître --------------------------------------------------------
const login = await realFetch(API + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(masterCredentials('audit-crawl'))
}).then((r) => r.json())
if (!login.token) {
  console.log('ÉCHEC login master — audit impossible')
  process.exit(1)
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const api = await import('../src/api.js')
const { dict } = await import('../src/i18n.js')

const settle = (ms = 250) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const label = (el) => {
  const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (t) return t.slice(0, 40)
  return el.getAttribute('aria-label') || el.getAttribute('title') || '(sans libellé)'
}
const curLang = () => {
  const v = window.localStorage.getItem('pcstar-lang')
  return (v === 'ar' || v === 'fr' || v === 'en') ? v : LANG
}
const navText = (key) => String(dict[curLang()]?.[key] ?? dict[LANG][key] ?? key)

// Boutons à ignorer : ils changent l'état global (langue, thème) ou ferment la
// session, ce qui fausserait le reste du balayage.
const SKIP = new Set(['FR', 'EN', 'ع', 'AR'])
for (const l of ['ar', 'fr', 'en']) {
  for (const k of ['langAr', 'langFr', 'langEn', 'logout', 'authLogout']) {
    if (dict[l][k]) SKIP.add(String(dict[l][k]))
  }
}
const isSkipped = (el) => {
  const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
  return SKIP.has(t) || /^[◐☀☾]$/.test(t)
}

/** Monte une application fraîche, session maître posée, puis va sur `navKey`. */
async function mountAt(navKey, pageName) {
  const { default: App } = await import('../src/App.jsx')
  window.localStorage.setItem('pcstar-api-token', login.token)
  window.localStorage.setItem('pcstar-lang', LANG)
  api.setToken(login.token)
  const host = window.document.createElement('div')
  window.document.getElementById('root').appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(React.createElement(App)) })
  // Le bootstrap de session fait getMeta() puis me() : deux allers-retours
  // réseau. Une attente fixe était trop courte après un gros balayage — on
  // attend ACTIVEMENT que le lien de navigation apparaisse (max 8 s).
  const wanted = OVERRIDE || navText(navKey)
  let btn = null
  for (let i = 0; i < 40; i++) {
    await settle(200)
    btn = [...host.querySelectorAll('button,a')].find(
      (b) => (b.textContent || '').replace(/\s+/g, ' ').trim() === wanted
    )
    if (btn) break
  }
  if (btn) {
    await act(async () => { btn.click() })
    await settle(600)
  }
  let ready = Boolean(btn)
  if (ready && PRE[pageName]) ready = await PRE[pageName](host)
  return { host, root, found: ready }
}

const ALL_NAV = [
  ['shop', 'navShop'], ['search', 'navSearch'], ['builder', 'navBuilder'],
  ['about', 'navAbout'], ['orders', 'navOrders'], ['help', 'navHelp'],
  ['desk', 'navDesk'], ['master', 'navMaster'], ['profile', 'navProfile'],
  ['warranty', 'navWarranty'], ['privacy', 'navPrivacy'], ['terms', 'navTerms'],
  ['product', 'navShop']
]
// Pas de lien de nav pour la fiche produit : on part de la boutique et on
// clique la première carte (App.jsx:1055, aria-label = nom du produit).
const PRE = {
  product: async (host) => {
    const card = [...host.querySelectorAll('button.p-0.border-0')].find(
      (b) => (b.getAttribute('aria-label') || '').length > 2
    )
    if (!card) return false
    await act(async () => { card.click() })
    await settle(500)
    return true
  }
}
// Un seul montage par processus évite la contamination entre pages : les
// bootstraps de session des instances précédentes réinitialisaient le token et
// masquaient les pages réservées au maître.
const ONLY = process.argv[3]
// Le bouton « profil » affiche user.name, pas t('navProfile') : la clé i18n
// navProfile existe dans les 3 langues mais n'est jamais rendue par App.jsx.
const OVERRIDE = process.argv[4] || null
const NAV = ONLY ? ALL_NAV.filter(([n]) => n === ONLY) : ALL_NAV

const report = []
for (const [name, navKey] of NAV) {
  const before = errors.length
  const { host, root, found } = await mountAt(navKey, name)
  if (!found) {
    report.push({ page: name, status: `nav « ${OVERRIDE || navText(navKey)} » introuvable` })
    root.unmount()
    continue
  }
  const buttons = [...host.querySelectorAll('button')]
  const clicked = []
  let skipped = 0
  for (const b of buttons) {
    if (b.disabled) continue
    if (isSkipped(b)) { skipped++; continue }
    const lbl = label(b)
    const e0 = errors.length
    try {
      await act(async () => { b.click() })
      await settle(140)
    } catch (e) {
      errors.push(`clic « ${lbl} » (${name}) a levé : ${e?.message || e}`)
    }
    if (errors.length > e0) clicked.push(lbl)
  }
  report.push({
    page: name, status: 'ok', buttons: buttons.length, skipped,
    clicked: buttons.length - skipped, newErrors: errors.length - before,
    errButtons: clicked
  })
  root.unmount()
  await settle(60)
}

console.log(`\n=== AUDIT CRAWL — langue ${LANG} ===`)
for (const r of report) {
  if (r.status !== 'ok') { console.log(`  ${r.page.padEnd(9)} ⚠ ${r.status}`); continue }
  console.log(
    `  ${r.page.padEnd(9)} ${r.newErrors ? '✗' : '✓'} ` +
    `${String(r.buttons).padStart(3)} boutons, ${String(r.clicked).padStart(3)} cliqués, ` +
    `${String(r.skipped).padStart(2)} ignorés, ${r.newErrors} erreur(s)`
  )
  if (r.errButtons.length) console.log(`             en erreur : ${r.errButtons.slice(0, 6).join(' | ')}`)
}
console.log(`\n=== ERREURS CAPTURÉES (${errors.length}) ===`)
const seen = new Map()
for (const e of errors) {
  const key = e.split('\n')[0].slice(0, 150)
  seen.set(key, (seen.get(key) || 0) + 1)
}
for (const [k, n] of seen) console.log(`  • (×${n}) ${k}`)
console.log(`  ${errors.length} erreurs, ${seen.size} distinctes`)
process.exit(0)
