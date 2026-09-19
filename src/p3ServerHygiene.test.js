/**
 * LOT P3 (B4, B15, B16, B23, B27, B30) — hygiène du serveur et du comptoir.
 *
 * Six points qui ne se voient pas dans les données mais dans la facon dont
 * l'application REPOND : un statut HTTP qui ment (B16), deux champs décoratifs
 * sans borne (B27), un chemin d'URL non encodé (B23), un bouton qui promet une
 * opération impossible (B15), une attente qui ne finit jamais (B4), et un
 * diagnostic qui sort 0 alors qu'il vient d'écrire ✗ (B30).
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { JSDOM } from 'jsdom'
import { dict } from './i18n.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const window = dom.window
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: MasterPage } = await import('./MasterPage.jsx')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p3-hygiene-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.DEMO_PASSWORD

const t = (key, vars) => {
  let out = String(dict.fr[key] ?? key)
  for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, String(v))
  return out
}
const sansCommentaires = (fichier) =>
  fs
    .readFileSync(path.join(process.cwd(), fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

let serveur = null
let base = ''
let jeton = ''

async function appel(methode, chemin, { corps, token = jeton } = {}) {
  const res = await fetch(base + chemin, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: corps == null ? undefined : JSON.stringify(corps)
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  return { status: res.status, data }
}

before(async () => {
  serveur = http.createServer((await import('../server/index.js')).handler)
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${serveur.address().port}`
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.MASTER_EMAIL, password: process.env.MASTER_PASSWORD })
  })
  const donnees = await login.json()
  assert.ok(login.ok && donnees.token, `connexion maître impossible : ${JSON.stringify(donnees)}`)
  jeton = donnees.token
})

after(() => {
  if (serveur) serveur.close()
})

describe('P3/B16 — masquer une fiche inconnue répond 404, pas 400', () => {
  it('le /hide et le PUT de la fiche donnent la même grille de statuts', async () => {
    const inconnu = 'n-existe-pas.ici'
    const hide = await appel('POST', `/api/master/products/${encodeURIComponent(inconnu)}/hide`, { corps: { hidden: true } })
    const put = await appel('PUT', `/api/master/products/${encodeURIComponent(inconnu)}`, { corps: { name: 'X' } })
    assert.equal(hide.status, 404, `hide : ${hide.status} ${JSON.stringify(hide.data)}`)
    assert.equal(hide.data.error, 'not_found')
    assert.equal(put.status, hide.status, `le PUT répond ${put.status} pour la même id : les deux routes divergent`)
    assert.equal(put.data.error, hide.data.error)
  })

  it('une fiche connue se masque et se réaffiche (le 404 ne masque pas le reste)', async () => {
    const catalogue = await fetch(`${base}/api/catalog`).then((r) => r.json())
    const id = (catalogue.products || [])[0]?.id
    assert.ok(id, 'catalogue public vide : le test ne prouverait rien')
    const cache = await appel('POST', `/api/master/products/${id}/hide`, { corps: { hidden: true } })
    assert.equal(cache.status, 200, JSON.stringify(cache.data))
    const apres = await fetch(`${base}/api/catalog`).then((r) => r.json())
    assert.equal((apres.products || []).some((p) => p.id === id), false, 'la fiche masquée est encore servie')
    const montre = await appel('POST', `/api/master/products/${id}/hide`, { corps: { hidden: false } })
    assert.equal(montre.status, 200)
    const reviens = await fetch(`${base}/api/catalog`).then((r) => r.json())
    assert.ok((reviens.products || []).some((p) => p.id === id), 'réaffichée, la fiche ne revient pas')
  })
})

describe('P3/B27 — avatar et accent sont un vocabulaire, pas du texte libre', () => {
  it('une valeur hors vocabulaire est refusée, nommée', async () => {
    const avatar = await appel('PUT', '/api/me', { corps: { avatar: '<img src=x onerror=alert(1)>' } })
    assert.equal(avatar.status, 400, JSON.stringify(avatar.data))
    assert.equal(avatar.data.error, 'avatar', 'le refus ne nomme pas le champ fautif')
    const accent = await appel('PUT', '/api/me', { corps: { accent: 'rouge-à-nez' } })
    assert.equal(accent.status, 400)
    assert.equal(accent.data.error, 'accent')
    const poids = await appel('PUT', '/api/me', { corps: { avatar: `data:image/png;base64,${'A'.repeat(400_000)}` } })
    assert.equal(poids.status, 400, 'une chaîne de 400 Ko comme avatar est acceptée')
  })

  it('une valeur du vocabulaire passe, normalisée, et ne réinitialise pas les autres champs', async () => {
    const ok1 = await appel('PUT', '/api/me', { corps: { avatar: ' PAD ', accent: 'Gold' } })
    assert.equal(ok1.status, 200, JSON.stringify(ok1.data))
    assert.equal(ok1.data.user.avatar, 'pad', 'la valeur stockée est la saisie brute')
    assert.equal(ok1.data.user.accent, 'gold')
    const suite = await appel('PUT', '/api/me', { corps: { name: 'Maître PC Star' } })
    assert.equal(suite.status, 200)
    assert.equal(suite.data.user.avatar, 'pad', 'un PUT sans avatar efface l’avatar')
    assert.equal(suite.data.user.accent, 'gold', 'un PUT sans accent efface l’accent')
    assert.equal(suite.data.user.name, 'Maître PC Star')
  })

  it('le vocabulaire est bien celui des graines', async () => {
    const db = await fs.promises.readFile(path.join(process.cwd(), 'server/db.js'), 'utf8')
    const posées = [...db.matchAll(/\b(?:avatar|accent): '([a-z]+)'/g)].map((m) => m[1])
    const autorisees = [...sansCommentaires('server/index.js').matchAll(/const USER_(?:AVATARS|ACCENTS) = \[([^\]]*)\]/g)]
      .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean))
    for (const v of posées) assert.ok(autorisees.includes(v), `graine « ${v} » refusée par la liste : ${autorisees.join(', ')}`)
  })
})

describe('P3/B4 — l’attente du catalogue maître a une fin', () => {
  const realFetch = globalThis.fetch
  const settle = (n) => act(async () => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) })
  const clean = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
  const propsMaitre = {
    t,
    lang: 'fr',
    user: { id: 'm', role: 'master', name: 'Maître' },
    users: [],
    onUsers() {},
    products: [],
    masterCatalog: [],
    meta: { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], productOverrides: {}, stock: {} },
    onMeta() {},
    basePanels: [],
    setToast() {},
    onBack() {},
    apiOnline: true,
    onStockRefresh() {}
  }

  after(() => {
    globalThis.fetch = realFetch
    for (let i = 0; i < 20; i++) {
      /* draine les tâches restantes avant de fermer la fenetre */
    }
    window.close()
  })

  function demarrer(reponse) {
    const appels = []
    globalThis.fetch = async (url, opts = {}) => {
      const chemin = String(url).split('?')[0]
      const methode = String(opts.method || 'GET').toUpperCase()
      appels.push({ methode, chemin })
      const spec = chemin === '/api/master/products' ? reponse : { status: 200, body: { ok: true, customers: [] } }
      return {
        ok: spec.status >= 200 && spec.status < 300,
        status: spec.status,
        json: async () => spec.body,
        text: async () => JSON.stringify(spec.body),
        headers: { get: () => null }
      }
    }
    return appels
  }

  it('un échec de chargement se dit et se rattrape au lieu de rester « … »', async () => {
    const host = window.document.createElement('div')
    window.document.body.appendChild(host)
    const root = createRoot(host)
    const appels = demarrer({ status: 500, body: { ok: false, error: 'server' } })
    try {
      await act(async () => {
        root.render(
          React.createElement(MasterPage, propsMaitre)
        )
      })
      await settle(12)
      const texte = clean(host)
      assert.equal(texte.includes('…'), false, "le chargement échoué affiche toujours les trois points : « … » n'a pas de fin")
      assert.match(texte, /n’a pas pu être chargé|pas pu être chargé/, `l'échec n'est pas dit : « ${texte.slice(0, 160)} »`)
      const bouton = [...host.querySelectorAll('button')].find((b) => clean(b) === t('retry'))
      assert.ok(bouton, "aucun moyen de réessayer à l'écran")
      const avant = appels.length
      await act(async () => {
        bouton.click()
      })
      await settle(12)
      assert.ok(appels.length > avant, '« Réessayer » ne relance pas la requête')
      root.unmount()
    } finally {
      window.document.body.removeChild(host)
    }
  })

  it('une réponse vide n’est pas un échec : pas d’alerte', async () => {
    const host = window.document.createElement('div')
    window.document.body.appendChild(host)
    const root = createRoot(host)
    demarrer({ status: 200, body: { ok: true, products: [] } })
    try {
      await act(async () => {
        root.render(
          React.createElement(MasterPage, propsMaitre)
        )
      })
      await settle(12)
      assert.equal(clean(host).includes(t('masterProductsLoadFail')), false, 'une base vide est présentée comme une panne')
      assert.equal(clean(host).includes('…'), false, 'une réponse vide laisse les trois points')
      root.unmount()
    } finally {
      window.document.body.removeChild(host)
    }
  })
})

describe('P3/B23, B15, B30 — encodage, bouton, porte', () => {
  it('deleteCustomer encode son identifiant, comme deleteOrder', () => {
    const api = sansCommentaires('src/api.js')
    const bord = (marqueur) => {
      const i = api.indexOf(marqueur)
      assert.ok(i > 0, `${marqueur} introuvable`)
      return api.slice(i, api.indexOf('\n}', i) + 2)
    }
    assert.match(bord('export async function deleteCustomer('), /encodeURIComponent\(id\)/, 'l’id du compte part brut dans l’URL')
    assert.match(bord('export async function deleteOrder('), /encodeURIComponent\(code\)/, 'deleteOrder a perdu son encodage')
  })

  it('B15 : aucun code de retrait n’est proposé sur une ligne jamais reçue', () => {
    const desk = sansCommentaires('src/DeskPage.jsx')
    const i = desk.indexOf('onClick={() => issueCode(r.code)}')
    assert.ok(i > 0, 'le bouton de code de retrait a changé de forme')
    const condition = desk.slice(Math.max(0, i - 420), i)
    assert.match(condition, /r\.localOnly !== true && \(/, 'le bouton est encore offert sur une commande `localOnly`')
    assert.match(desk, /title=\{t\('ordersLocalOnlyHint'\)\}/, 'le badge ne dit plus pourquoi')
  })

  it('B30 : le diagnostic sort 1 quand il écrit ✗', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/neon-doctor.mjs'), 'utf8')
    const i = script.indexOf('const bad = ')
    assert.ok(i > 0)
    assert.match(script.slice(i, i + 200), /souci = 1/, 'le ✗ ne lève plus de drapeau')
    assert.match(script, /process\.exit\(souci \? 1 : 0\)/, 'le script sort toujours 0')
    assert.equal(/process\.exit\(0\)\s*$/.test(script), false, 'la sortie finale est revenue à 0')
  })

  it('B30 : sans DATABASE_URL, le diagnostic reste un succès de dev (0)', () => {
    const env = { ...process.env }
    delete env.DATABASE_URL
    const r = spawnSync(process.execPath, ['scripts/neon-doctor.mjs'], { env, encoding: 'utf8', timeout: 60_000 })
    assert.equal(r.stdout.includes('DATABASE_URL absente'), true, r.stdout + r.stderr)
    assert.equal(r.status, 0, `un dev sans base ne doit pas être une porte fermée : ${r.stdout}`)
  })
})

describe('P3 — le harnais jsdom ne prête pas un trou d’API à l’application', () => {
  // CI, run 35446572476 : l’audit boutons échouait sur
  // « rejection non gérée : performance.getEntriesByType is not a function »,
  // et le run d’avant avait tué le crawl à la 16ᵉ seconde pour la même raison.
  // jsdom n’implémente pas la Resource Timing API ; le bundle, lui, la sonde.
  it('le shim comble les méthodes qui manquent, sans écraser celles qui existent', async () => {
    const { patchPerformanceGaps } = await import('../scripts/jsdom-perf-gaps.mjs')
    const dom = new JSDOM('', {})
    const w = dom.window
    assert.equal(typeof w.performance.getEntriesByType, 'undefined', 'jsdom a changé : le shim ne sert plus à rien, le retirer')
    assert.equal(patchPerformanceGaps(w), true, 'le shim n’a rien ajouté')
    assert.deepEqual(w.performance.getEntriesByType('resource'), [])
    assert.deepEqual(w.performance.getEntriesByName('x'), [])
    assert.equal(typeof w.performance.mark('m'), 'object')
    assert.equal(typeof w.performance.measure('mm'), 'object')
    const avant = w.performance.getEntriesByType
    assert.equal(patchPerformanceGaps(w), false, 'deuxième passe : le shim écrase ce qui est déjà posé')
    assert.equal(w.performance.getEntriesByType, avant)
    assert.equal(patchPerformanceGaps(null), false, 'une fenêtre absente ne doit pas faire tomber l’audit')
    dom.window.close()
  })

  it('le shim comble aussi les realms enfants : l’iframe du harnais ne prête plus sa faute à l’app', async () => {
    /*
     * CI, run 35456319900 : `rejection non gerree : performance.getEntriesByType
     * is not a function`, deux fois — une par langue — alors que les deux portes
     * appelaient bien `patchPerformanceGaps(w)` en `beforeParse`. Le trou n'etait
     * pas la fenetre principale, comblee, mais un realm fils : chaque iframe a SON
     * objet `performance`, avec les memes methodes absentes, et le harnais ne la
     * voyait jamais. Reproduit ici en trente secondes (et jamais en local sur la
     * machine de dev, d'ou quatre rouges CI pour un meme message) : une iframe
     * inseree apres le patch, un appel a `getEntriesByType`, et le message est
     * mot pour mot celui de l'annotation.
     */
    const { patchPerformanceGaps } = await import('../scripts/jsdom-perf-gaps.mjs')
    const d = new JSDOM('<body></body>', {
      runScripts: 'dangerously',
      beforeParse(w) {
        patchPerformanceGaps(w)
      }
    })
    const w = d.window
    assert.equal(typeof w.performance.getEntriesByType, 'function', 'le realm principal n’est pas comblé')
    // L'iframe apparait APRES le patch : c'est le cas réel (React monte la carte
    // de la page « à propos » après le premier rendu).
    w.document.body.innerHTML = '<iframe src="about:blank"></iframe>'
    await new Promise((r) => setTimeout(r, 40))
    const cw = w.document.querySelector('iframe').contentWindow
    assert.ok(cw, 'le realm de l’iframe n’est pas joignable dans ce jsdom : le verrou ne prouverait rien')
    assert.equal(typeof cw.performance.getEntriesByType, 'function', 'le realm de l’iframe n’est pas comblé : la faute de CI revient')
    assert.deepEqual(cw.performance.getEntriesByType('resource'), [], 'le shim de l’iframe ne doit rien mesurer')
    assert.equal(cw.performance.mark('apres-insertion').name, 'apres-insertion')
    // Inerte ne veut pas dire silencieux : une vraie faute du realm reste levee.
    assert.equal(typeof cw.Error, 'function')
    d.window.close()
  })

  it('le shim est posé une fois : un second appel ne le redécore pas', async () => {
    const { patchPerformanceGaps } = await import('../scripts/jsdom-perf-gaps.mjs')
    const d = new JSDOM('', {})
    assert.equal(patchPerformanceGaps(d.window), true)
    assert.equal(patchPerformanceGaps(d.window), false, 'deuxième passe : le harnais repose ses propres méthodes')
    assert.equal(patchPerformanceGaps(null), false, 'une fenêtre absente ne doit pas faire tomber l’audit')
    d.window.close()
    // Apres fermeture, le collecteur du processus voit encore les promesses de la
    // page : `performance` doit rester appeable, sinon la fermeture fabrique une
    // faute que le navigateur ne montrerait jamais.
    assert.deepEqual(d.window.performance.getEntriesByType('resource'), [])
  })

  it('les deux portes de rendu l’appliquent avant le premier script', () => {
    for (const f of ['scripts/jsdom-crawl.mjs', 'scripts/audit-buttons.mjs']) {
      const s = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      const i = s.indexOf('beforeParse')
      assert.ok(i > 0, `${f} : plus de beforeParse`)
      assert.ok(s.indexOf('patchPerformanceGaps', i) < s.indexOf('localStorage', i), `${f} : le shim doit être posé avant que le bundle ne tourne`)
      assert.match(s, /import \{ patchPerformanceGaps \} from '\.\/jsdom-perf-gaps\.mjs'/, `${f} : import absent`)
    }
  })

  it('le collecteur de rejections reste strict', () => {
    const s = fs.readFileSync(path.join(process.cwd(), 'scripts/audit-buttons.mjs'), 'utf8')
    const i = s.indexOf("process.on('unhandledRejection'")
    assert.ok(i > 0)
    assert.equal(/isSoft\(/.test(s.slice(i, i + 320)), false, 'la rejection est devenue amollie : un clic muet redeviendrait invisible')
  })
})

describe('P3 — les moteurs du smoke et ceux installés par la CI sont les mêmes', () => {
  // Le job e2e a été rouge une première fois pour un motif de ce genre : la
  // config, la spec et le workflow racontaient trois histoires différentes.
  // Un moteur déclaré sans être installé fait échouer le smoke (pas « le moteur
  // manque ») ; un moteur installé sans être déclaré ne teste rien du tout.
  const config = fs.readFileSync(path.join(process.cwd(), 'playwright.config.js'), 'utf8')
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/e2e-smoke.yml'), 'utf8')

  const declarés = [...config.matchAll(/\{ name: '([a-z]+)', use: \{ \.\.\.devices\['([^']+)'\] \} \}/g)].map((m) => ({
    nom: m[1],
    device: m[2]
  }))
  const installés = (workflow.match(/npx playwright install[^\n]*/g) || [])
    .flatMap((l) => l.replace(/^.*chromium/, 'chromium').split(/\s+/))
    .filter((m) => ['chromium', 'firefox', 'webkit'].includes(m))

  it('trois moteurs, un device Playwright connu chacun', () => {
    assert.deepEqual(
      declarés.map((p) => p.nom),
      ['chromium', 'webkit', 'firefox'],
      'les projets de `playwright.config.js` ont changé de forme : ce verrou doit suivre'
    )
    assert.deepEqual(
      declarés.map((p) => p.device),
      ['Desktop Chrome', 'Desktop Safari', 'Desktop Firefox']
    )
  })

  it('la CI installe exactement ces moteurs', () => {
    for (const p of declarés) assert.ok(installés.includes(p.nom), `« ${p.nom} » déclaré dans la config, jamais installé par la CI`)
    for (const m of installés) assert.ok(declarés.some((p) => p.nom === m), `« ${m} » installé par la CI mais déclaré nulle part`)
    assert.match(workflow, /--with-deps/, 'sans `--with-deps`, WebKit et Firefox meurent sur une bibliothèque système absente')
  })

  it('chaque fichier src/*.test.js est branché dans npm test', () => {
    // Genu : `src/lot1BaseScripts.test.js` et `src/phase5Reliability.test.js`
    // vivaient dans le depot sans figurer dans la liste de `package.json` — treize
    // verrous ecrits, verts, et jamais joues par la CI. La liste est explicite (et
    // pas un glob), donc elle doit etre montree a chaque ajout : ce verrou est la
    // seul moyen de voir le trou.
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    const listés = new Set(pkg.scripts.test.match(/src\/\S+\.test\.js/g))
    const surDisque = fs.readdirSync(path.join(process.cwd(), 'src'))
      .filter((f) => f.endsWith('.test.js'))
      .map((f) => `src/${f}`)
    const oublis = surDisque.filter((f) => !listés.has(f))
    assert.deepEqual(oublis, [], `${oublis.length} fichier(s) de test jamais joues : ${oublis.join(', ')}`)
    const fantômes = [...listés].filter((f) => !fs.existsSync(path.join(process.cwd(), f)))
    assert.deepEqual(fantômes, [], 'la liste de npm test pointe des fichiers supprimés')
  })

  it('le resume du crawl ne reporte plus un nombre de pages a la main', () => {
    const crawl = fs.readFileSync(path.join(process.cwd(), 'scripts/jsdom-crawl.mjs'), 'utf8')
    assert.match(crawl, /LANGS\.length\} langues × \$\{PAGES\.length\} pages/, 'le compteur de pages est revenu à une litterale')
    // Le « 13 pages » reste autorisé dans la prose (il explique la faute), pas dans un message.
    const chaines = crawl.match(/`[^`]*`/gs) || []
    assert.equal(chaines.some((c) => c.includes('13 pages')), false, 'un compteur de pages ecrit a la main est revenu dans une chaine de sortie')
  })
})

describe('P4 — la porte rend la pile de la page, pas celle du moteur', () => {
  /*
   * jsdom emballe l'exception du bundle dans `new Error('Uncaught [...]', { cause })`
   * et n'émet que cet emballage sur le virtualConsole : sa pile commence à
   * `reportException` et ne dit ni où ni quoi. La porte « UI audit » a rouge cinq
   * têtes consécutives sur `fr/orders` avec un message nu — cinq têtes à deviner.
   * `pileDeFaute` choisit la pile utile ; les verrous ci-dessous prouvent que ce
   * n'est pas un filtre : rien n'est écarté, rien n'est amolli.
   */

  it('la pile de la `cause` est gardée, celle de jsdom ne suffit pas', async () => {
    const { pileDeFaute } = await import('../scripts/jsdom-error-pile.mjs')
    const vraie = new Error('boom')
    vraie.stack = [
      "TypeError: Cannot read properties of undefined (reading 'querySelector')",
      '    at PS (http://127.0.0.1:4173/assets/index-2KbYsC.js:1:45872)',
      '    at HTMLScriptElement.processJavaScript (/app/node_modules/jsdom/lib/jsdom/living/nodes/HTMLScriptElement-impl.js:233:7)'
    ].join('\n')
    const emballée = new Error('Uncaught [TypeError: boom]', { cause: vraie })
    emballée.stack = [
      'Error: Uncaught [TypeError: boom]',
      '    at reportException (/app/node_modules/jsdom/lib/jsdom/living/helpers/runtime-script-errors.js:66:24)',
      '    at processTicksAndRejections (node:internal/process/task_queues:103:5)'
    ].join('\n')
    const pile = pileDeFaute(emballée)
    assert.match(pile, /assets\/index-2KbYsC\.js/, 'le frame du bundle a été perdu : la porte est de nouveau muette')
    // La tete de la pile de la page suffit a dire d'ou vient la faute : l'evaluation
    // d'un script (`processJavaScript`), pas un clic ni un effet du harnais.
    assert.match(pile, /processJavaScript/, 'la tete de pile ne dit plus que la faute leve pendant l evaluation du script')
    assert.equal((pile.match(/index-2KbYsC/g) || []).length, 1, 'frames dupliqués : le résumé nest plus lisible')
  })

  it('sans cause exploitable la pile reçue reste rendue, et une entrée bizarre ne casse pas la porte', async () => {
    const { pileDeFaute } = await import('../scripts/jsdom-error-pile.mjs')
    const seule = new Error('Uncaught [TypeError: x]')
    seule.stack = 'Error\n    at triche (/app/src/App.jsx:12:3)'
    assert.match(pileDeFaute(seule), /src\/App\.jsx:12:3/)
    // Une erreur sans AUCUN frame (stack amputee, objet nu, chaine sans pile) doit
    // rendre une chaine vide — le message, lui, est deja pousse par l'appelant.
    const nu = new Error('x')
    nu.stack = 'Error: x'
    assert.equal(pileDeFaute(nu), '', 'une erreur sans frame doit rendre vide, pas lever')
    assert.equal(pileDeFaute('TypeError: texte brut'), '', 'une chaine sans frame : rien a montrer')
    for (const vide of [null, undefined, {}, '']) assert.equal(pileDeFaute(vide), '')
    // Une `cause` sans frame ne doit pas masquer la pile utile du wrapper.
    const nue = new Error('nue')
    nue.stack = 'Error: nue' // cause presente mais muette : on doit redescendre
    const avecCauseVide = new Error('Uncaught [x]', { cause: nue })
    avecCauseVide.stack = 'Error\n    at util (/app/dist-crawl/assets/index.js:1:1)'
    assert.match(pileDeFaute(avecCauseVide), /dist-crawl/)
  })

  it('les deux portes sont branchées sur le module, et ne réimprovisent pas la pile', async () => {
    for (const f of ['scripts/jsdom-crawl.mjs', 'scripts/audit-buttons.mjs']) {
      const s = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      assert.match(s, /import \{ pileDeFaute \} from '\.\/jsdom-error-pile\.mjs'/, `${f} nimporte pas le module de pile`)
      assert.match(s, /pileDeFaute\(e\)/, `${f} n'appelle pas pileDeFaute sur la faute`)
      assert.equal(/const frames = /.test(s), false, `${f} recompose une pile à la main : le tri forke en deux endroits`)
    }
    // Le module ne connaît aucune liste d'excuses : il ne peut pas amollir une porte.
    const mod = fs.readFileSync(path.join(process.cwd(), 'scripts/jsdom-error-pile.mjs'), 'utf8')
    assert.equal(/isSoft|Could not load/.test(mod), false, 'le module de pile sest mis à filtrer des erreurs')
  })
})

describe('P4 — la porte ne charge pas le code des tiers', () => {
  /*
   * Le rouge `fr/orders` de la CI venait du CHARGEUR DE GOOGLE MAPS lui-même :
   * `useJsApiLoader` injecte `<script src="https://maps.googleapis.com/maps/api/js…">`
   * dès que la clé publique est dans le build, et `resources: 'usable'` faisait
   * aller le crawl le chercher et l'évaluer. Dans jsdom l'API lève chez elle un
   * `TypeError: … reading 'querySelector'` — faute authentique, mais du tiers, et
   * pilotée par le réseau du runner (d'où une tête sur deux, et jamais en local).
   * `scripts/jsdom-subresources.mjs` refuse la sous-ressource distante AVANT la
   * requête ; les verrous ci-dessous sont ce qui prouve que le refus est la norme
   * sur tout runner, bundle local inclus.
   */

  it('la politique est une origine, pas une liste de messages', async () => {
    const { estSousRessourceDistante } = await import('../scripts/jsdom-subresources.mjs')
    const cas = [
      ['https://maps.googleapis.com/maps/api/js?key=AIzaSyFAKE&callback=onApiLoad', true],
      ['https://fonts.googleapis.com/css2?family=Inter:wght@400..900', true],
      ['http://example.org/assets/index-abc.js', true],
      ['/assets/index-abc.js', false],
      ['../photos/1234.jpg', false],
      ['http://127.0.0.1:4173/assets/index-abc.js', false],
      ['http://localhost:8787/api/health', false],
      ['http://127.0.0.1:4173', false],
      ['data:text/css,a{}', false],
      ['about:blank', false]
    ]
    for (const [url, attendu] of cas) {
      assert.equal(estSousRessourceDistante(url), attendu, `estSousRessourceDistante(${url})`)
    }
    assert.equal(estSousRessourceDistante(undefined), false, 'une URL absente ne doit pas inventer un blocage')
    // Un module de politique ne doit rien savoir des fautes qu'il fait taire :
    // on grep le code, pas le récit du bloc d'en-tête (qui doit pouvoir citer le
    // message de la CI pour expliquer la panne).
    const modBrut = fs.readFileSync(path.join(process.cwd(), 'scripts/jsdom-subresources.mjs'), 'utf8')
    const code = modBrut.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(code, /export function/, 'le retrait des blocs de commentaire a mangé le module')
    assert.equal(/Could not load|isSoft|querySelector|Uncaught/.test(code), false, 'le module sest mis à raisonner sur les messages derreur')
  })

  it('le bundle same-origin est évalué, le script tiers est neutralé sans faute', async () => {
    const { ressourcesDeLaPorte } = await import('../scripts/jsdom-subresources.mjs')
    const { VirtualConsole } = await import('jsdom')
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/javascript' })
      res.end('window.__bundle = (window.__bundle||0) + 1')
    })
    await new Promise((r) => srv.listen(0, '127.0.0.1', r))
    const origine = `http://127.0.0.1:${srv.address().port}`
    const erreurs = []
    const vc = new VirtualConsole()
    vc.on('jsdomError', (e) => erreurs.push(`jsdomError: ${e.message}`))
    // Le script « Google » pointe vers un domaine VRAIMENT résolvable : si la
    // porte dépendait encore du réseau, ce test rouge/vert dépendrait du réseau
    // du runner — et ce n'est jamais le cas ici, même hors ligne.
    const dom = new JSDOM(`<!doctype html><title>porte</title>
      <link rel="stylesheet" href="https://rsms.me/inter/inter.css" onerror="window.__cssErr=1">
      <script src="https://maps.googleapis.com/maps/api/js?key=FAKE&callback=onApiLoad"
              onload="window.__charge=1" onerror="window.__err=1"></script>
      <script src="${origine}/assets/index-abc.js"></script>`, {
      url: `${origine}/fr/orders`, runScripts: 'dangerously', resources: ressourcesDeLaPorte(),
      pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) { w.__onApiLoad = () => { w.__mapsVivant = 1 } }
    })
    try {
      await new Promise((r) => setTimeout(r, 800))
      const w = dom.window
      assert.equal(w.__bundle, 1, 'le bundle same-origin nest plus évalué : la porte est devenue muette')
      assert.equal(w.__err, undefined, 'la sous-ressource distante lève une erreur délément : le chemin de refus dépend du réseau du runner')
      assert.equal(w.__cssErr, undefined, 'idem pour la feuille de style distante')
      assert.equal(w.__mapsVivant, undefined, 'le tiers est neutralisé mais son callback est quand même appelé : réponse synthétique mal formée')
      assert.deepEqual(erreurs, [], 'la porte reporte encore le code des tiers')
    } finally {
      dom.window.close()
      srv.close()
    }
  })

  it('les deux portes partagent la politique (plus de `resources: "usable"` nu)', () => {
    for (const f of ['scripts/jsdom-crawl.mjs', 'scripts/audit-buttons.mjs']) {
      const s = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      assert.match(s, /import \{ ressourcesDeLaPorte \} from '\.\/jsdom-subresources\.mjs'/, `${f} nimporte pas la politique de sous-ressources`)
      assert.match(s, /resources: ressourcesDeLaPorte\(\)/, `${f} ne passe pas resourcesDeLaPorte() au JSDOM`)
      assert.equal(/resources: 'usable'/.test(s), false, `${f} a retrouvé un resources: 'usable' nu : le flake du tiers revient`)
    }
  })
})
