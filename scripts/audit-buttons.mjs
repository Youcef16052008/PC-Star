#!/usr/bin/env node
/**
 * Audit boutons — « est-ce que TOUS les boutons font quelque chose de sûr,
 * et est-ce qu'un formulaire vide affiche bien une erreur ? »
 *
 * Complète scripts/jsdom-crawl.mjs (navigation 13 pages × 2 langues) :
 *  1. sur chaque page clé, on clique TOUS les boutons du contenu principal
 *     (désactivés exclus) et on exige ZÉRO erreur JavaScript (window.onerror /
 *     jsdomError hors « not implemented » — alert/confirm/print ne sont pas
 *     implémentés par jsdom et n'existent pas en jeu).
 *  2. scénarios « vide → erreur » : panier vide soumis, réservation sans nom
 *     ni téléphone, connexion sans identifiants — un retour visible DOIT
 *     apparaître (toast, .alert, .invalid-feedback ou champ :invalid).
 *
 * Usage : npm run build:crawl && node scripts/audit-buttons.mjs
 * (démarre et arrête lui-même l'API :8787 et vite preview :4173)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { dict } from '../src/i18n.js'
import { masterCredentials } from './masterEnv.mjs'

const FRONT = 'http://127.0.0.1:4173'
const API = 'http://127.0.0.1:8787'
const MASTER = masterCredentials('audit-buttons')
const LANGS = ['fr', 'en']
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

/* ── serveurs (même teardown que jsdom-crawl) ── */
const procs = []
const startProc = (cmd, args) => {
  const p = spawn(cmd, args, { cwd: process.cwd(), stdio: 'ignore', detached: true })
  procs.push(p)
  return p
}
function teardown(code) {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM') } catch { /* déjà mort */ } }
  process.exit(code)
}
process.on('exit', () => {
  for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL') } catch { /* ok */ }
  }
})

if (!existsSync('dist-crawl/index.html')) {
  console.error('dist-crawl/ absent — lancez d\'abord : npm run build:crawl')
  teardown(1)
}
startProc('node', ['server/index.js'])
startProc('npx', ['vite', 'preview', '--config', 'vite.crawl.config.js', '--port', '4173', '--strictPort', '--host', '127.0.0.1'])
await waitFor(async () => (await fetch(`${API}/api/health`)).ok, 'API :8787')
await waitFor(async () => (await fetch(FRONT)).ok, 'preview :4173')

const login = await (await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MASTER)
})).json()
if (!login?.token) { console.error('FAIL login master', login); teardown(1) }
const me = await (await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } })).json()
if (!me?.user?.name || me.user.role !== 'master') { console.error('FAIL /api/me', me); teardown(1) }
const userName = me.user.name

const results = []
const failures = []
// Une rejection non gérée (onClick async) devient un échec NOMMÉ au lieu
// de tuer le processus d'audit sans résumé.
process.on('unhandledRejection', (e) => {
  const msg = String((e && e.message) || e).slice(0, 200)
  failures.push('rejection non gérée : ' + msg)
})

/** Erreur JS = échec ; « not implemented » (alert/confirm/print) ignoré. */
const isSoft = (m) => /not implemented/i.test(m)

function openSession(lang, token) {
  return (async () => {
    const errors = []
    const vc = new VirtualConsole()
    vc.on('jsdomError', (e) => { if (!isSoft(e.message)) errors.push(`jsdomError: ${e.message}`) })
    const dom = await JSDOM.fromURL(`${FRONT}/`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole: vc,
      beforeParse(w) {
        w.localStorage.setItem('pcstar-lang', lang)
        if (token) w.localStorage.setItem('pcstar-api-token', token)
        w.fetch = (input, init) =>
          fetch(typeof input === 'string' ? new URL(input, `${FRONT}/`).href : input, init)
        w.matchMedia = (media) => ({
          media, matches: false, onchange: null,
          addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          dispatchEvent() { return false }
        })
        w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
        w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
        w.scrollTo = () => {}
        w.HTMLElement.prototype.scrollIntoView = function () {}
      }
    })
    const w = dom.window
    w.addEventListener('error', (ev) => { if (!isSoft(ev.message)) errors.push(`window.onerror: ${ev.message}`) })
    return { dom, w, doc: w.document, errors }
  })()
}

/** Clique TOUS les boutons du contenu principal, en ré-évaluant à chaque tour. */
async function clickAllButtons(session, label, maxClicks = 45) {
  const { doc, errors } = session
  const main = () =>
    doc.querySelector('main') || doc.querySelector('.shop-navbar')?.parentElement || doc.body
  const clicked = new Set()
  let clicks = 0
  for (let round = 0; round < maxClicks; round++) {
    const before = errors.length
    const btns = [...main().querySelectorAll('button')]
      .filter((b) => !b.disabled && !clicked.has(b))
    if (!btns.length) break
    const b = btns[0]
    const name = (b.textContent || '').trim().slice(0, 40) || b.getAttribute('aria-label') || 'bouton'
    clicked.add(b)
    b.click()
    await sleep(260)
    clicks++
    const newErrs = errors.slice(before)
    if (newErrs.length) {
      failures.push(`${label} · « ${name} » → ${newErrs.join(' | ')}`)
    }
  }
  results.push(`OK    ${label} — ${clicks} bouton(s) cliqué(s), 0 erreur JS`)
}

/** Un retour visible après soumission vide ? (toast / alert / invalid) */
function feedbackVisible(doc) {
  return Boolean(
    doc.querySelector('.pc-toast') ||
    doc.querySelector('[role="status"].toast') ||
    doc.querySelector('.alert-danger, .alert-warning') ||
    doc.querySelector('.invalid-feedback:not([hidden])') ||
    doc.querySelector('input:invalid, select:invalid, textarea:invalid')
  )
}

for (const lang of LANGS) {
  const d = dict[lang]
  /* ── session MAÎTRE : toutes les pages + boutons ── */
  const s = await openSession(lang, login.token)
  try {
    await waitFor(() => s.doc.querySelector('.shop-navbar'), `boot master (${lang})`)
    await waitFor(() => buttonByText(s.doc, d.navDesk), `session maître (${lang})`)
    const pages = [
      ['shop', d.navShop], ['cart', d.navCart], ['search', d.navSearch],
      ['builder', d.navBuilder], ['about', d.navAbout], ['orders', d.navOrders],
      ['desk', d.navDesk], ['help', d.navHelp], ['master', d.navMaster],
      ['profile', userName]
    ]
    for (const [page, label] of pages) {
      const btn = await waitFor(() => buttonByText(s.doc, label) ||
        [...s.doc.querySelectorAll('.shop-navbar button')].find((b) => b.textContent.trim() === String(label)), `nav ${page} (${lang})`, 6000).catch(() => null)
      if (!btn) { failures.push(`${lang}/${page} : bouton de navigation introuvable`); continue }
      btn.click()
      await sleep(420)
      await clickAllButtons(s, `${lang}/${page}`)
    }
    // Soumission VIDE du premier formulaire master encore vierge : une erreur
    // visible doit apparaître (jamais d'enregistrement silencieux).
    const mSubmit = [...s.doc.querySelectorAll('main form button[type="submit"], form button[type="submit"]')]
      .find((b) => !b.disabled)
    if (mSubmit) {
      mSubmit.click()
      await sleep(400)
      if (!feedbackVisible(s.doc)) failures.push(`${lang}/master formulaire vide : AUCUN retour visible`)
      else results.push(`OK    ${lang}/master formulaire vide → erreur affichée`)
    } else {
      results.push(`NOTE  ${lang}/master : aucun formulaire soumis directement (workflow multi-étapes)`)
    }
  } catch (e) {
    failures.push(`${lang} (maître) : ${e.message}`)
  } finally {
    s.dom.window.close()
  }

  /* ── session INVITÉ : connexion vide + réservation vide ── */
  const g = await openSession(lang, null)
  try {
    await waitFor(() => g.doc.querySelector('.shop-navbar'), `boot invité (${lang})`)
    // 1) connexion sans rien saisir
    const profileBtn = [...g.doc.querySelectorAll('.shop-navbar button')]
      .find((b) => /profil|profile|compte|account|connexion|log in|se connecter/i.test(b.textContent))
    ;(profileBtn || buttonByText(g.doc, d.navCart)).click()
    await sleep(450)
    const loginBtn =
      buttonByText(g.doc, d.authLogin) ||
      [...g.doc.querySelectorAll('button[type="submit"]')].find((b) => /connexion|log in/i.test(b.textContent))
    if (!loginBtn) {
      // Le profil invité affiche peut-être le formulaire plus bas : on cherche un submit.
      const anySubmit = g.doc.querySelector('form button[type="submit"]')
      if (!anySubmit) failures.push(`${lang} : formulaire de connexion introuvable`)
      else anySubmit.click()
    } else loginBtn.click()
    await sleep(400)
    if (!feedbackVisible(g.doc)) failures.push(`${lang}/connexion vide : AUCUN retour visible`)
    else results.push(`OK    ${lang}/connexion vide → erreur affichée`)

    // 2) panier vide → soumission réservation
    const cartBtn = [...g.doc.querySelectorAll('.shop-navbar button')]
      .find((b) => b.textContent.trim() === d.navCart) || buttonByText(g.doc, d.navCart)
    cartBtn.click()
    await sleep(420)
    const submit = g.doc.querySelector('form button[type="submit"]')
    if (!submit) {
      // Panier vide : la boutique doit le dire plutôt que proposer un formulaire.
      const saysEmpty = /vide|empty/i.test(g.doc.body.textContent)
      if (!saysEmpty) failures.push(`${lang}/panier vide : ni formulaire ni mention « panier vide »`)
      else results.push(`OK    ${lang}/panier vide → message « panier vide » affiché`)
    } else {
      submit.click()
      await sleep(400)
      if (!feedbackVisible(g.doc)) failures.push(`${lang}/réservation vide : AUCUN retour visible`)
      else results.push(`OK    ${lang}/réservation vide → erreur affichée`)
    }
  } catch (e) {
    failures.push(`${lang} (invité) : ${e.message}`)
  } finally {
    g.dom.window.close()
  }
}

console.log(results.join('\n'))
if (failures.length) {
  console.error(`\nAUDIT FAILED (${failures.length}) :\n${failures.map((f) => '  ✗ ' + f).join('\n')}`)
  teardown(1)
}
console.log(`\nAUDIT OK — ${results.length} vérifications, tous les boutons sûrs, vides → erreurs affichées`)
teardown(0)
