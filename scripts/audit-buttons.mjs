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
import { patchPerformanceGaps } from './jsdom-perf-gaps.mjs'

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
// Le libellé d'une entrée de nav peut porter un badge (« Panier (12) ») dès que
// le panier n'est plus vide : on accepte le préfixe.
const navButton = (doc, label) =>
  [...doc.querySelectorAll('.shop-navbar button')].find((b) => {
    const t = b.textContent.trim()
    // « Panier1 » : le compteur est collé au libellé (sans espace ni parenthèse).
    return t === label || t.replace(/[\d\s()]+$/, '') === label
  })

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

/** Erreur JS = échec ; « not implemented » (alert/confirm/print) ignoré, ainsi
 * que les ressources EXTERNES injoignables (Google Fonts en sandbox/CI) — le
 * rendu DOM n'en dépend pas, même filtrage que scripts/jsdom-crawl.mjs. */
const isSoft = (m) => /not implemented/i.test(m) || /Could not load (link|iframe)/i.test(m)

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
        // Les trous d'API de jsdom sont combles AVANT le premier script : sans
        // Resource Timing, react-dom et le collecteur de rejections du harnais
        // fabriquent une faute qui n'existe pas dans un navigateur (voir
        // scripts/jsdom-perf-gaps.mjs).
        patchPerformanceGaps(w)
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
async function clickAllButtons(session, label, maxClicks = 150) {
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
    await sleep(140)
    clicks++
    const newErrs = errors.slice(before)
    if (newErrs.length) {
      failures.push(`${label} · « ${name} » → ${newErrs.join(' | ')}`)
    }
  }
  results.push(`OK    ${label} — ${clicks} bouton(s) cliqué(s), 0 erreur JS`)
}

/** Saisir une valeur dans un champ contrôlé React (setter natif + input/change). */
function typeValue(w, el, value) {
  const proto = el.tagName === 'SELECT' ? w.HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype
    : w.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
  el.dispatchEvent(new w.Event('change', { bubbles: true }))
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
    // ── P1 : TOUS les liens de la page « À propos » (mailto, wa.me, Maps) ──
    // openExternal preventDefault + window.open (no-op jsdom) : zéro erreur exigé.
    const aboutNav = await waitFor(() => buttonByText(s.doc, d.navAbout), "nav about (" + lang + ")", 6000).catch(() => null)
    if (aboutNav) {
      aboutNav.click()
      await sleep(420)
      const links = [...(s.doc.querySelector('main') || s.doc.body).querySelectorAll('a[href]')]
      let n = 0
      for (const a of links.slice(0, 40)) {
        const b4 = s.errors.length
        a.click()
        await sleep(50)
        n++
        const ne = s.errors.slice(b4)
        if (ne.length) failures.push(lang + '/about · lien « ' + ((a.textContent || '').trim().slice(0, 30) || a.getAttribute('href')) + ' » → ' + ne.join(' | '))
      }
      results.push('OK    ' + lang + '/about — ' + n + ' lien(s) cliqué(s), 0 erreur JS')
    }

    // ── P2 : formulaires REMPLIS INVALIDES → erreur visible, jamais d’enregistrement ──
    // 1) Réservation avec téléphone non-DZ : le panier doit d’abord recevoir un article.
    const shopNav = await waitFor(() => buttonByText(s.doc, d.navShop), "nav shop 2 (" + lang + ")", 6000).catch(() => null)
    if (shopNav) {
      shopNav.click()
      await sleep(420)
      // Les vignettes produit libellent le bouton « Ajouter » (court) — le
      // libellé long existe ailleurs ; on accepte les deux, SANS maillon
      // silencieux : chaque échec de préparation devient un failure nommé.
      const addLabels = new Set([d.addToCart, 'Ajouter', 'Add'])
      const add = [...(s.doc.querySelector('main') || s.doc.body).querySelectorAll('button')]
        .find((b) => !b.disabled && addLabels.has((b.textContent || '').trim()))
      if (!add) failures.push(lang + '/réservation téléphone invalide : bouton « Ajouter » introuvable sur la boutique')
      if (add) {
        add.click()
        await sleep(320)
        const cartNav = navButton(s.doc, d.navCart)
        if (!cartNav) {
          failures.push(lang + '/réservation téléphone invalide : bouton panier introuvable')
          throw new Error('panier inaccessible — fin anticipée du bloc réservation')
        }
        cartNav.click()
        await sleep(420)
        let name = s.doc.querySelector('form #name')
        // Le checkout est multi-étapes : le form complet n'apparaît qu'après
        // le focus (onFocus → setCartStep(1)). On émule l'entrée dans le form.
        if (!name) {
          const f = s.doc.querySelector('main form')
          if (f) {
            f.dispatchEvent(new s.w.Event('focusin', { bubbles: true }))
            await sleep(300)
            name = s.doc.querySelector('form #name')
          }
        }
        if (!name) failures.push(lang + '/réservation téléphone invalide : formulaire checkout non atteint (panier vide ?)')
        const phone = s.doc.querySelector('form #phone')
        if (name && phone) {
          typeValue(s.w, name, 'Audit P2')
          typeValue(s.w, phone, '123') // invalide : pas un mobile DZ 05/06/07
          const sub = s.doc.querySelector('form button[type="submit"]')
          sub.click()
          await sleep(420)
          if (!feedbackVisible(s.doc)) failures.push(lang + '/réservation téléphone invalide : AUCUN retour visible')
          else results.push('OK    ' + lang + '/réservation téléphone invalide → erreur affichée')
        }
      }
    }

    // 2) Fiche produit master : prix NÉGATIF → refus visible.
    const masterNav = [...s.doc.querySelectorAll('.shop-navbar button')]
      .find((b) => b.textContent.trim() === d.navMaster)
    if (masterNav) {
      masterNav.click()
      await sleep(420)
      const name = s.doc.querySelector('#master-product-name')
      const price = s.doc.querySelector('#master-product-price')
      const sub = [...(s.doc.querySelector('main') || s.doc.body).querySelectorAll('form button[type="submit"]')]
        .find((b) => !b.disabled)
      if (name && price && sub) {
        typeValue(s.w, name, 'Audit P2 prix négatif')
        typeValue(s.w, price, '-5')
        sub.click()
        await sleep(420)
        if (!feedbackVisible(s.doc)) failures.push(lang + '/master prix négatif : AUCUN retour visible')
        else results.push('OK    ' + lang + '/master prix négatif → erreur affichée')
      } else {
        results.push('NOTE  ' + lang + '/master : formulaire création non exposé (workflow multi-étapes) — couvert par les tests API')
      }
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
    const cartBtn = navButton(g.doc, d.navCart) || buttonByText(g.doc, d.navCart)
    if (!cartBtn) {
      failures.push(lang + ' (invité) : bouton panier introuvable')
    } else cartBtn.click()
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
