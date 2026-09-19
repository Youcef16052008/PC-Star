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
