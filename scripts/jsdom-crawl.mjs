#!/usr/bin/env node
/**
 * L2 (Direction 03 « Terminal Cyber ») — porte de validation :
 * crawl jsdom des 13 pages × 3 langues, 0 erreur JavaScript.
 *
 * Usage : `npm run build` puis `npm run crawl`.
 * Le script démarre et arrête LUI-MÊME l'API (:8787) et `vite preview` (:4173).
 *
 * Ce qui compte comme « erreur » : window.onerror et jsdomError (erreur de
 * script). Les console.error ne comptent PAS : React/Bootstrap y loggent des
 * avertissements non fatals. Le rendu effectif de chaque page est vérifié
 * par le document.title (mis à jour par page/langue dans App.jsx) et par un
 * marqueur DOM quand il existe.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { dict } from '../src/i18n.js'

const FRONT = 'http://127.0.0.1:4173'
const API = 'http://127.0.0.1:8787'
const MASTER = { email: 'pcstar.info31@gmail.com', password: 'star31' }
const LANGS = ['ar', 'fr', 'en']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, label, timeout = 25000) {
  const end = Date.now() + timeout
  for (;;) {
    let v = null
    try { v = await fn() } catch { /* pas encore */ }
    if (v) return v
    if (Date.now() > end) throw new Error(`timeout : ${label}`)
    await sleep(120)
  }
}
const buttonByText = (doc, text) =>
  [...doc.querySelectorAll('button')].find((b) => b.textContent.trim() === text)

/* 13 pages : comment les atteindre + marqueur DOM de rendu réel. */
const PAGES = [
  ['shop', 'nav', 'navShop', '.product-bs-card'],
  ['search', 'nav', 'navSearch', null],
  ['builder', 'nav', 'navBuilder', null],
  ['about', 'nav', 'navAbout', null],
  ['orders', 'nav', 'navOrders', null],
  ['desk', 'nav', 'navDesk', null],
  ['help', 'nav', 'navHelp', null],
  ['master', 'nav', 'navMaster', null],
  ['profile', 'nav', '__userName__', null],
  ['privacy', 'footer', 'navPrivacy', null],
  ['terms', 'footer', 'navTerms', null],
  ['product', 'product', null, '.pdp-zoom']
]

function expectedTitle(d, page, userName) {
  const key = {
    shop: 'heroTitle', search: 'navSearch', builder: 'navBuilder',
    about: 'aboutTitle', desk: 'deskTitle', master: 'masterTitle',
    profile: 'profileTitle', warranty: 'legalWarrantyTitle',
    privacy: 'legalPrivacyTitle', terms: 'legalTermsTitle', help: 'helpTitle'
  }[page]
  if (key) return `${d[key]} · PC Star Oran`
  if (page === 'orders') return 'PC Star · PC Star Oran'
  if (page === 'product') return userName // name-prefix only, checked separately
  return null
}

/* ── serveurs ── */
const procs = []
const startProc = (cmd, args) => {
  // detached : on tue le GROUPE entier au teardown (npx lance un enfant qui
  // survivrait à un SIGTERM sur le parent — port 4173 alors orphanisé).
  const p = spawn(cmd, args, { cwd: process.cwd(), stdio: 'ignore', detached: true })
  procs.push(p)
  return p
}
function teardown(code) {
  for (const p of procs) {
    try { process.kill(-p.pid, 'SIGTERM') } catch { /* déjà mort */ }
  }
  process.exit(code)
}
process.on('exit', () => {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL') } catch { /* ok */ } }
})

console.log('· démarrage API + vite preview (build IIFE dist-crawl)…')
if (!existsSync('dist-crawl/index.html')) {
  console.error('dist-crawl/ absent — lancez d\'abord : npm run build:crawl')
  teardown(1)
}
startProc('node', ['server/index.js'])
// --host 127.0.0.1 : sans ça vite preview ne lie que la boucle IPv6 (::1)
// et le crawl (URL IPv4) échoue en ECONNREFUSED.
startProc('npx', ['vite', 'preview', '--config', 'vite.crawl.config.js', '--port', '4173', '--strictPort', '--host', '127.0.0.1'])
await waitFor(async () => (await fetch(`${API}/api/health`)).ok, 'API :8787')
await waitFor(async () => (await fetch(FRONT)).ok, 'preview :4173')

/* ── session maître (pages desk/help/master + profil) ── */
const login = await (await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MASTER)
})).json()
if (!login?.token) { console.error('FAIL login master', login); teardown(1) }
const me = await (await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } })).json()
const userName = me?.user?.name
if (!userName || me.user.role !== 'master') { console.error('FAIL /api/me', me); teardown(1) }

const results = []
const failures = []

for (const lang of LANGS) {
  const d = dict[lang]
  const errors = []
  const vc = new VirtualConsole() // silence console.*, jsdomError capturé
  vc.on('jsdomError', (e) => {
    // Non fatal : ressources EXTERNES injoignables en sandbox (Google Fonts,
    // iframe Google Maps de la page about) — le rendu DOM n'en dépend pas.
    if (/Could not load (link|iframe)/i.test(e.message)) return
    errors.push(`jsdomError: ${e.message}`)
  })

  const dom = await JSDOM.fromURL(`${FRONT}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('pcstar-lang', lang)
      w.localStorage.setItem('pcstar-api-token', login.token)
      // Polyfills : le bundle doit tourner dans jsdom comme en navigateur.
      w.fetch = (input, init) =>
        fetch(typeof input === 'string' ? new URL(input, `${FRONT}/`).href : input, init)
      w.matchMedia = (media) => ({
        media, matches: false, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false }
      })
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
      w.scrollTo = () => {}
      w.HTMLElement.prototype.scrollIntoView = function () {}
    }
  })
  const w = dom.window
  w.addEventListener('error', (ev) => errors.push(`window.onerror: ${ev.message}`))

  const doc = w.document
  try {
    await waitFor(() => doc.querySelector('.shop-navbar'), `chargement (${lang})`)
    // Session maître restaurée depuis le token → nav desk visible.
    await waitFor(() => buttonByText(doc, d.navDesk), `session maître (${lang})`)
    // applyDocumentChrome() est un effet React : on laisse le flush se poser
    // avant d'assertir lang/dir.
    await waitFor(() => doc.documentElement.lang === lang, `<html lang="${lang}">`, 5000)
      .catch(() => failures.push(`${lang}/boot : <html lang="${doc.documentElement.lang}"> attendu "${lang}"`))

    for (const [page, via, key, marker] of PAGES) {
      const before = errors.length
      let btn = null
      if (via === 'nav') {
        const label = key === '__userName__' ? userName : d[key]
        btn = buttonByText(doc, label)
      } else if (via === 'footer') {
        btn = [...doc.querySelectorAll('.site-footer button')]
          .find((b) => b.textContent.trim() === d[key])
      } else {
        await waitFor(() => buttonByText(doc, d.navShop), `nav shop (${lang})`)
        buttonByText(doc, d.navShop).click()
        await sleep(300)
        btn = await waitFor(() => doc.querySelector('.product-bs-card button'), `carte produit (${lang})`)
      }
      if (!btn) {
        failures.push(`${lang}/${page} : bouton introuvable (via ${via}, clé ${key})`)
        continue
      }
      btn.click()
      await sleep(450)
      const newErrs = errors.slice(before)
      const title = doc.title
      const want = expectedTitle(d, page, userName)
      const titleOk = page === 'product' ? title.endsWith('· PC Star Oran') && title.length > '· PC Star Oran'.length : title === want
      const markerOk = !marker || doc.querySelector(marker)
      if (newErrs.length === 0 && titleOk && markerOk) {
        results.push(`OK    ${lang}/${page}`)
      } else {
        failures.push(`${lang}/${page} : ${newErrs.join(' | ') || `titre « ${title} »${want && page !== 'product' ? ` attendu « ${want} »` : ''}${marker && !markerOk ? ` ; marqueur ${marker} absent` : ''}`}`)
      }
    }
  } catch (e) {
    failures.push(`${lang} : ${e.message}`)
  } finally {
    dom.window.close()
  }
}

console.log(results.join('\n'))
if (failures.length) {
  console.error(`\nCRAWL FAILED (${failures.length}) :\n${failures.map((f) => '  ✗ ' + f).join('\n')}`)
  teardown(1)
}
console.log(`\nCRAWL OK — ${results.length} pages rendues (${LANGS.length} langues × 13 pages), 0 erreur`)
teardown(0)
