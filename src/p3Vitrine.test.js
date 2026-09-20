/**
 * LOT P4 (V1 → V5) — la vitrine du comptoir, les filtres, les pages, la pleine page.
 *
 * Six points relevés par le client le 19/09/2026 sur trois captures d'écran,
 * chacun avec son défaut et sa réparation :
 *
 *  · V1 — le hero affichait « 301 références » et « 0 DA — paiement au retrait ».
 *    Le premier nombre comptait le catalogue (un chiffre de stock interne, pas
 *    une promesse) ; le second était un ZÉRO ÉCRIT EN DUR sous un libellé qui
 *    prétendait dire un prix. La tuile est maintenant une VITRINE à trois
 *    valeurs : le maître écrit le libellé et le nombre de réparations (page
 *    Admin → Vitrine), le SERVEUR tient le compteur de commandes, point par
 *    point, à chaque entrée réelle dans le statut « prêt pour retrait ». Un
 *    client ne peut pas écrire ce troisième champ — il ne l'a jamais pu, même
 *    quand la tuile paraissait libre.
 *  · V2 — le mur de 67 puces de marques, dressé avant le premier produit. Deux
 *    boutons, chacun ouvrant son panneau.
 *  · V3 — le « configurateur » de la page d'accueil était un décor : trois lignes
 *    « [OK] socket AM5 », un total de 177 000 DA et une consommation « est. 410 W »
 *    sortis d'un gabarit, sans rapport avec une vraie configuration. Retiré ; le
 *    catalogue enchaîne en pages 1 → 2 → 3.
 *  · V4 — à la page Recherche, « usage » et « En magasin seulement » ne filtraient
 *    rien : le second ne pouvait rien retirer, le catalogue public ne contenant
 *    que du stock (mesure P17 du rapport n°3). Le rayon du catalogue est entré
 *    dans le panneau des filtres.
 *  · V5 — le menu latéral déroulant et la modale de connexion, trop étroits pour
 *    le parc de téléphones du comptoir : l'un et l'autre prennent la page.
 *
 * Le fichier se lit en trois temps : le bornage partagé (1), le serveur et ses
 * routes (2-3), ce que l'écran doit montrer (4-7).
 *
 * Les commentaires sont en français ; le CODE (chaînes comparées, assertions)
 * reste en ASCII pur quand la valeur vient d'une source, comme dans
 * src/lot1BaseScripts.test.js — le conteneur peut réécrire les accents en double
 * encodage, et un test qui compare une chaîne accentuée tapée à la main devient
 * faux sans que personne ait rien cassé. Les libellés sont donc comparés via
 * `t()` (même dictionnaire, même process) ou sur une sous-chaîne ASCII.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { JSDOM } from 'jsdom'

// ── Dom : les globaux doivent exister AVANT les `await import` (App.jsx capture
//    `localStorage` à l'import du module ; un `before()` serait trop tard). ──
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true
})
const window = dom.window
window.matchMedia =
  window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'FormData', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, { value: window[k], writable: true, configurable: true })
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p4-vitrine-'))
process.env.PCSTAR_DATA_DIR = dir
delete process.env.DEMO_PASSWORD

const { LANGS, dict } = await import('./i18n.js')
const { VITRINE_LIMITS, EMPTY_VITRINE, clampVitrine, clampVitrineLabel, clampVitrineCount } = await import('./vitrine.js')
const { default: App, SHOP_PAGE_SIZE } = await import('./App.jsx')
const { default: SearchPage } = await import('./SearchPage.jsx')
const { default: MasterPage } = await import('./MasterPage.jsx')
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')
const { createMemoryStorage, loadMeta } = await import('./shopStore.js')
const { PART_LINES, PRODUCTS } = await import('./data.js')

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
const settle = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)))
const clique = (el) => act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
// React 18 suit les `value` natifs : une affectation directe ne passe pas par son
// listener `onChange`. Le setter du prototype, si.
function natif(el, valeur) {
  const source = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(source, 'value').set.call(el, valeur)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

// ── 1. le bornage : une seule échelle pour les deux côtés ───────────────────
describe('P4/V1 — la vitrine n\u2019a qu\u2019un seul bornage, partagé entre le client et le serveur', () => {
  it('les plafonds sont publiés (la tuile est lisible par tout le monde)', () => {
    assert.ok(VITRINE_LIMITS.label >= 8 && VITRINE_LIMITS.label <= 64, 'étiquette hors bon ordre de grandeur')
    assert.ok(Number.isInteger(VITRINE_LIMITS.count) && VITRINE_LIMITS.count >= 1000)
    // Le compteur de commandes n'a ni champ ni plafond côté client : il n'est
    // pas éditable, donc il n'a rien à borner ici.
    assert.equal(VITRINE_LIMITS.readyTally, undefined)
  })

  it('étiquette : trim, une ligne, plafond', () => {
    assert.equal(clampVitrineLabel('  reparations  '), 'reparations')
    assert.equal(clampVitrineLabel('a\nb'), 'a b', 'un saut de ligne ne traverse pas la tuile')
    assert.equal(clampVitrineLabel('\ta \n b\t'), 'a b', 'la tabulation ne survit pas non plus')
    assert.equal(clampVitrineLabel('x'.repeat(500)).length, VITRINE_LIMITS.label)
    // Un nombre est du texte recevable (« 42 »), un objet ne l'est jamais : la
    // tuile est publique, `[object Object]` y serait une faute visible.
    assert.equal(clampVitrineLabel(42), '42')
    for (const v of [undefined, null, {}, [], true, NaN, Infinity]) {
      assert.equal(clampVitrineLabel(v), '', `${String(v)} doit rendre une chaîne vide`)
    }
  })

  it('nombre : entier, positif, borné — le champ libre d\u2019hier', () => {
    assert.equal(clampVitrineCount('12'), 12)
    assert.equal(clampVitrineCount(12.7), 12, 'pas de virgule sur une tuile publiée')
    assert.equal(clampVitrineCount(-3), 0, 'un compteur négatif n\u2019a pas de sens')
    assert.equal(clampVitrineCount(1e9), VITRINE_LIMITS.count)
    for (const v of [undefined, null, NaN, Infinity, 'abc', {}, []]) {
      assert.equal(clampVitrineCount(v), 0, `${String(v)} doit rendre 0, pas NaN`)
    }
  })

  it('clampVitrine applique les deux règles et ne rend que trois clés', () => {
    assert.deepEqual(clampVitrine(null), EMPTY_VITRINE)
    assert.deepEqual(clampVitrine(undefined), EMPTY_VITRINE)
    assert.deepEqual(clampVitrine({ repairsLabel: '   ', repairsDone: 8 }), { repairsLabel: '', repairsDone: 8, readyTally: 0 })
    assert.deepEqual(Object.keys(clampVitrine({ repairsLabel: 'x', bidon: 1 })).sort(), ['readyTally', 'repairsDone', 'repairsLabel'])
    // Une chaîne (localStorage blessé, réponse partielle) ne doit pas faire tomber la page.
    assert.deepEqual(clampVitrine('vitrine'), EMPTY_VITRINE)
  })

  it('le meta local porte la vitrine : sans cette clé, la tuile saisie ne survit pas au rechargement', () => {
    const vide = loadMeta(createMemoryStorage({}))
    assert.ok('vitrine' in vide, 'loadMeta() ne cote pas `vitrine` : le maitre saisirait dans le vide en mode local')
    assert.deepEqual(vide.vitrine, EMPTY_VITRINE)
  })
})

// ── 2. le serveur : lire, écrire, compter ──────────────────────────────────
describe('P4/V1 — le compteur de commandes est tenu par le serveur, pas par le navigateur', () => {
  it('server/vitrine.js ré-exporte le clamp partagé (pas de deuxième échelle)', () => {
    const serveur = sansCommentaires('server/vitrine.js')
    const db = sansCommentaires('server/db.js')
    assert.match(serveur, /from '\.\.\/src\/vitrine\.js'/, 'le serveur doit importer le clamp du front, pas le sien')
    assert.equal(/function clampVitrine/.test(serveur), false, 'clamp redéfini dans server/vitrine.js : deux échelles')
    assert.equal(/function clampVitrine/.test(db), false, 'clamp redéfini dans server/db.js : trois échelles')
    assert.match(db, /from '\.\/vitrine\.js'/)
    // `server/catalog.js` compte la transition — il ne doit pas le faire à la main.
    const catalogue = sansCommentaires('server/catalog.js')
    assert.match(catalogue, /bumpReadyTally\(db\)/)
    assert.equal(/readyTally \+ 1/.test(catalogue), false, 'le comptage est recollé à la main dans catalog.js')
  })

  it('applyVitrineEdit : le readyTally du client est ignoré, les refus sont nommés et muets', async () => {
    const { applyVitrineEdit } = await import('../server/vitrine.js')
    const db = { meta: { vitrine: { repairsLabel: 'repare au comptoir', repairsDone: 40, readyTally: 7 } } }
    const r = applyVitrineEdit(db, { repairsLabel: '  reparations faites  ', repairsDone: '12.7', readyTally: 9999 })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(db.meta.vitrine.repairsLabel, 'reparations faites')
    assert.equal(db.meta.vitrine.repairsDone, 12)
    assert.equal(db.meta.vitrine.readyTally, 7, 'le client a écrit le compteur de commandes : il ne peut pas')
    assert.deepEqual(Object.keys(db.meta.vitrine).sort(), ['readyTally', 'repairsDone', 'repairsLabel'])

    assert.deepEqual(applyVitrineEdit(db, { repairsLabel: 42 }), { ok: false, error: 'vitrine_label' })
    assert.deepEqual(applyVitrineEdit(db, { repairsDone: 'beaucoup' }), { ok: false, error: 'vitrine_count' })
    // Un patch vide n'écrase pas la tuile : `PUT {}` ne doit pas remettre 0.
    const vide = applyVitrineEdit(db, {})
    assert.equal(vide.ok, true)
    assert.equal(db.meta.vitrine.repairsDone, 12, 'un corps vide a effacé le nombre de réparations')
    assert.equal(db.meta.vitrine.repairsLabel, 'reparations faites')
    // Et un refus ne laisse pas une moitié écrite.
    assert.equal(JSON.stringify(applyVitrineEdit(db, { repairsLabel: 42 })).includes('42'), false, 'le message recite la valeur refusee')
  })

  it('bumpReadyTally : +1 seulement, jamais de trou, jamais de débordement', async () => {
    const { bumpReadyTally, vitrineView } = await import('../server/vitrine.js')
    const db = { meta: {} }
    assert.deepEqual(vitrineView(db), { repairsLabel: '', repairsDone: 0, readyTally: 0 }, 'une base sans vitrine doit projeter des zéros')
    assert.deepEqual(vitrineView(null), EMPTY_VITRINE)
    assert.equal(bumpReadyTally(db), 1)
    assert.equal(bumpReadyTally(db), 2)
    assert.equal(vitrineView(db).repairsLabel, '', 'le comptage ne doit pas toucher au libellé')
    db.meta.vitrine.readyTally = VITRINE_LIMITS.count
    bumpReadyTally(db)
    assert.equal(db.meta.vitrine.readyTally, VITRINE_LIMITS.count, 'sans saturation, le compteur deviendrait un nombre à 16 chiffres sur une tuile')
  })

  it('setOrderStatus : le point est compté à la transition réelle', async () => {
    const { setOrderStatus } = await import('../server/catalog.js')
    const { vitrineView } = await import('../server/vitrine.js')
    const db = { meta: {}, orders: [{ code: 'PC-A', status: 'preparing' }, { code: 'PC-B', status: 'new' }, { code: 'PC-C', status: 'ready' }] }
    assert.equal(vitrineView(db).readyTally, 0)
    // Entree dans « pret » = un point.
    assert.equal(setOrderStatus(db, 'PC-A', 'ready', null).ok, true)
    assert.equal(vitrineView(db).readyTally, 1)
    // Repasser la meme commande a « pret » est refuse par la table des
    // transitions : une commande ne peut pas compter deux fois.
    const rejoue = setOrderStatus(db, 'PC-A', 'ready', null)
    assert.equal(rejoue.ok, false, 'la transition ready -> ready devrait etre refusee')
    assert.equal(vitrineView(db).readyTally, 1, 'la commande a ete comptee deux fois')
    // Sortie de « pret » (retrait) : le point reste — le compteur dit combien de
    // fois le comptoir a prevenu un client, pas combien de cartons attendent.
    assert.equal(setOrderStatus(db, 'PC-A', 'picked', null).ok, true)
    assert.equal(vitrineView(db).readyTally, 1)
    // Seconde commande pretee = second point.
    assert.equal(setOrderStatus(db, 'PC-B', 'ready', null).ok, true)
    assert.equal(vitrineView(db).readyTally, 2)
    // Annulation d'une commande deja pretee : pas de retrait.
    assert.equal(setOrderStatus(db, 'PC-C', 'cancelled', null).ok, true)
    assert.equal(vitrineView(db).readyTally, 2)
    // Une transition refusee ne compte pas.
    assert.equal(setOrderStatus(db, 'PC-A', 'new', null).ok, false)
    assert.equal(vitrineView(db).readyTally, 2)
  })

  it('normalizeDb recalle une vitrine absente ou menteuse (bases existantes tolérées)', async () => {
    const { normalizeDb, readDbAsync } = await import('../server/db.js')
    // Une vraie base, pas un squelette inventé ici : `normalizeDb` est appelée
    // sur ce que le disque renvoie, et c'est ce chemin-là qui doit survivre à
    // l'absence de la clé (bases créées avant le LOT P4).
    const frais = await readDbAsync()
    assert.ok(frais.meta && 'vitrine' in frais.meta, 'la base fraiche ne cote pas la vitrine')
    const avant = await readDbAsync()
    delete avant.meta.vitrine
    // `normalizeDb` mute sur place et renvoie `changed` : c'est l'objet passe
    // qu'il faut relire, pas la valeur de retour.
    const modifie = normalizeDb(avant)
    assert.equal(typeof modifie, 'boolean')
    assert.deepEqual(avant.meta.vitrine, { repairsLabel: '', repairsDone: 0, readyTally: 0 }, 'une base d\u2019avant le LOT P4 doit se lire sans exception')
    const menteur = await readDbAsync()
    menteur.meta.vitrine = { repairsLabel: '  <b>x</b>  '.repeat(30), repairsDone: -5, readyTally: 99, extraProducts: ['vole'] }
    normalizeDb(menteur)
    assert.equal(menteur.meta.vitrine.repairsLabel.length, VITRINE_LIMITS.label)
    assert.equal(menteur.meta.vitrine.repairsDone, 0)
    assert.equal(menteur.meta.vitrine.readyTally, 99, 'le compteur déjà en base est une donnée serveur : on le garde, on ne le remet pas à zéro')
    assert.equal('extraProducts' in menteur.meta.vitrine, false, 'une clé de stock glissée dans la vitrine fuiterait par la projection')
  })
})

// ── 3. les routes ──────────────────────────────────────────────────────────
let serveur = null
let base = ''
let jeton = ''
let jetonClient = ''

async function appel(methode, chemin, { corps, token = jeton } = {}) {
  const res = await fetch(base + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  const maitre = await appelAnon('POST', '/api/auth/login', { email: process.env.MASTER_EMAIL, password: process.env.MASTER_PASSWORD })
  assert.ok(maitre.data?.token, `connexion maitre impossible : ${JSON.stringify(maitre.data)}`)
  jeton = maitre.data.token
  const inscrit = await appelAnon('POST', '/api/auth/register', {
    email: `vitrine-${Date.now()}@demo.dz`,
    password: 'azerty12345',
    name: 'Client Vitrine'
  })
  assert.ok(inscrit.data?.token, `creation du compte client impossible : ${JSON.stringify(inscrit.data)}`)
  jetonClient = inscrit.data.token
})

async function appelAnon(methode, chemin, corps) {
  const res = await fetch(base + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
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

after(() => {
  if (serveur) serveur.close()
})

describe('P4/V1 — lire la vitrine est public, l\u2019écrire est réservé au maître', () => {
  it('GET /api/meta expose la vitrine et rien d\u2019autre du stock caché', async () => {
    const r = await appelAnon('GET', '/api/meta')
    assert.equal(r.status, 200)
    assert.equal(r.data.ok, true)
    assert.ok(r.data.vitrine, 'GET /api/meta ne renvoie pas `vitrine` : la tuile du client ne peut pas lire le compteur du serveur')
    assert.deepEqual(Object.keys(r.data.vitrine).sort(), ['readyTally', 'repairsDone', 'repairsLabel'])
    for (const fuite of ['extraProducts', 'hiddenProductIds', 'photoOverrides', 'users', 'orders']) {
      assert.equal(fuite in r.data, false, `la reponse publique fuiterait ${fuite}`)
    }
    // Un champ ajoute demain a `db.meta` ne doit pas devenir public par accident :
    // la projection est une liste blanche, pas un spread.
    assert.equal(JSON.stringify(r.data).includes('hiddenProductIds'), false)
  })

  it('PUT /api/master/vitrine : sans jeton 403, client 403, maître 200 borné', async () => {
    const refus = await appel('PUT', '/api/master/vitrine', { token: '', corps: { repairsLabel: 'x', repairsDone: 1 } })
    assert.equal(refus.status, 403, `sans session : ${refus.status}`)
    const client = await appel('PUT', '/api/master/vitrine', { token: jetonClient, corps: { repairsLabel: 'x', repairsDone: 1 } })
    assert.equal(client.status, 403, `client authentifie : ${client.status}`)
    assert.equal(client.data.error, 'forbidden')
    // Un client ne peut pas non plus ecrire par la route des panneaux.
    const panneau = await appel('PUT', '/api/master/panels', { token: jetonClient, corps: { extraPanels: [] } })
    assert.equal(panneau.status, 403)

    const ok = await appel('PUT', '/api/master/vitrine', { corps: { repairsLabel: '  reparations au comptoir  ', repairsDone: '342.9', readyTally: 500 } })
    assert.equal(ok.status, 200, JSON.stringify(ok.data))
    assert.equal(ok.data.vitrine.repairsLabel, 'reparations au comptoir')
    assert.equal(ok.data.vitrine.repairsDone, 342)
    const relu = await appelAnon('GET', '/api/meta')
    assert.equal(relu.data.vitrine.repairsLabel, 'reparations au comptoir', 'ecrit mais pas relu : l\u2019enregistrement est un mirage')
    assert.equal(relu.data.vitrine.repairsDone, 342)
    assert.notEqual(relu.data.vitrine.readyTally, 500, 'le corps envoyait un readyTally : il doit rester ignore au tour suivant aussi')
  })

  it('le texte du maitre est du texte : il ne devient pas de HTML a l\u2019ecran', async () => {
    const r = await appel('PUT', '/api/master/vitrine', { corps: { repairsLabel: '<img src=x onerror=alert(1)>' } })
    assert.equal(r.status, 200)
    assert.ok(r.data.vitrine.repairsLabel.length <= VITRINE_LIMITS.label)
    for (const fichier of ['src/App.jsx', 'src/MasterPage.jsx', 'src/SearchPage.jsx']) {
      assert.equal(sansCommentaires(fichier).includes('dangerouslySetInnerHTML'), false, `${fichier} injecte du HTML : le libelle du maitre deviendrait du code`)
    }
  })

  it('une commande passee a « pret pour retrait » au comptoir fait monter la tuile', async () => {
    const catalogue = await appelAnon('GET', '/api/catalog')
    const produit = (catalogue.data.products || [])[0]
    assert.ok(produit, 'catalogue public vide : le test ne prouverait rien')
    const avant = await appelAnon('GET', '/api/meta')
    const cree = await appelAnon('POST', '/api/orders', {
      name: 'Client Vitrine',
      phone: '0550987654',
      items: [{ id: produit.id, sku: produit.sku, name: produit.name, qty: 1, price: produit.price }]
    })
    assert.equal(cree.status, 201, `creation de commande : ${JSON.stringify(cree.data)}`)
    const code = cree.data.order.code
    const passe = await appel('PATCH', `/api/orders/${encodeURIComponent(code)}`, { corps: { status: 'ready' } })
    assert.equal(passe.status, 200, `transition : ${JSON.stringify(passe.data)}`)
    const apres = await appelAnon('GET', '/api/meta')
    assert.equal(apres.data.vitrine.readyTally, avant.data.vitrine.readyTally + 1, '« pret pour retrait » n\u2019a pas fait monter le compteur annonce au client')
    // Retirer la commande ne rend pas le point (choix du client, consigne du tour).
    const retire = await appel('PATCH', `/api/orders/${encodeURIComponent(code)}`, { corps: { status: 'picked' } })
    assert.equal(retire.status, 200)
    const final = await appelAnon('GET', '/api/meta')
    assert.equal(final.data.vitrine.readyTally, apres.data.vitrine.readyTally, 'le compteur a.decru : il ne compte pas les cartons en attente')
  })
})

// ── 4. ce que l\u2019écran doit dire, dans le code ───────────────────────────
describe('P4/V2-V3 — la page d\u2019accueil : deux boutons, des pages, plus de décor', () => {
  const app = sansCommentaires('src/App.jsx')

  it('la page est paginée à douze, et c\u2019est la constante qui le dit', () => {
    assert.equal(SHOP_PAGE_SIZE, 12, 'la page du catalogue ne fait plus douze fiches')
    assert.match(app, /list\.slice\(\(shopPageSure - 1\) \* SHOP_PAGE_SIZE/)
    assert.match(app, /Math\.max\(1, Math\.ceil\(list\.length \/ SHOP_PAGE_SIZE\)\)/, 'le nombre de pages n\u2019est pas déduit de la meme tranche')
    assert.match(app, /aria-label=\{t\('pagerLabel'\)\}/)
    assert.match(app, /aria-current=\{n === shopPageSure \? 'page' : undefined\}/)
    assert.match(app, /disabled=\{shopPageSure <= 1\}/, '« Précédent » cliquable en page 1')
    assert.match(app, /disabled=\{shopPageSure >= shopPages\}/, '« Suivant » cliquable en derniere page')
  })

  it('le mur de marques a laissé la place à deux boutons qui portent la valeur choisie', () => {
    assert.match(app, /t\('filterBrands'\)/)
    assert.match(app, /t\('filterCatalog'\)/)
    assert.match(app, /\{brandFilter \? ` · \$\{brandFilter\}` : ''\}/, 'le bouton ne reporte pas la marque choisie')
    assert.match(app, /marquesFiltrees/, 'la liste des marques ne suit plus la catégorie choisie')
    assert.match(app, /aria-expanded=/)
    assert.match(app, /aria-controls="sheet-brands"/)
    assert.match(app, /id="catalog"/, 'le saut « Voir la sélection » n\u2019a plus de cible')
    for (const motif of ['brand-wall', 'cats scrollable', 'marquesVendues.slice']) {
      assert.equal(app.includes(motif), false, `l'ancien decor « ${motif} » est encore rendu`)
    }
  })

  it('la tuile se borne côté client avec la fonction du serveur, et l\u2019état parallèle a disparu', () => {
    assert.match(app, /clampVitrine\(meta\.vitrine\)/)
    assert.equal(/useState\(\(\) => clampVitrine/.test(app), false, 'un etat local pour la tuile : la valeur du serveur ne serait jamais appliquee')
    assert.match(app, /vitrine: m\.data\.vitrine \|\| loadMeta\(storage\)\.vitrine/, 'la reponse du serveur ne remplace pas la tuile locale')
    assert.equal(/vitrine, setVitrine/.test(app), false, 'un etat `vitrine` subsiste a cote du meta : deux sources de verite')
  })

  it('le configurateur mensonger est parti, avec ses montants écrits à la main', () => {
    for (const motif of ['est. 410', '177 000', '42 000', '54 000', '45 000', '48 000', 'Ryzen 5 7600', 'RTX 4060', '650 W 80+', 'chkOkSocket', 'chkWarnCase']) {
      assert.equal(app.includes(motif), false, `le decor « ${motif} » est encore dans la page`)
    }
    assert.equal(/className="slots"/.test(app), false, 'le faux tableau de slots est revenu')
    assert.match(app, /t\('openBuilder'\)/, 'le lien vers le vrai configurateur doit rester : c\u2019était le seul élément réel du bloc')
    assert.equal(app.includes("{t('openBuilder')} →"), false, 'la fleche est doublee (la cle la porte deja)')
  })

  it('aucun montant n\u2019est écrit à la main dans les tuiles du hero', () => {
    // Le lot P0 verrouillait « 0 DA » ; le lot P4 verrouille l'absence de tout
    // nombre nu dans ce bloc, sinon la prochaine maquette en remettra un.
    const debut = app.indexOf('className="readout"')
    const fin = app.indexOf('className="filters-bar', debut)
    assert.ok(debut > 0 && fin > debut, 'le bloc readout est introuvable : la page a change de forme')
    const hero = app.slice(debut, fin)
    assert.equal(/\{\s*\d[\d ]*\s*\}/.test(hero), false, 'un compteur ecrit en dur dans le hero')
    assert.equal(/\bDA\b/.test(hero), false, 'une devise ecrite en dur dans le hero')
    assert.equal(hero.includes('catalog.length'), false, 'le comptage du catalogue est revenu sur la vitrine')
    for (const cle of ['roOrders', 'roRepairs', 'roGpu', 'roLaptops']) assert.match(hero, new RegExp(`t\\('${cle}'\\)`))
  })
})

describe('P4/V5 — le menu et la connexion prennent la page', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8')

  it('.nav-sheet porte sa propre fermeture, sinon on est coincé dans le menu', () => {
    const app = sansCommentaires('src/App.jsx')
    assert.match(app, /nav-sheet/)
    assert.match(app, /nav-sheet-head/)
    assert.match(app, /onClick=\{\(\) => setNavOpen\(false\)\}/, 'la feuille doit pouvoir se refermer sans choisir une page')
    assert.match(css, /\.nav-sheet\.show\s*\{[^}]*position:\s*fixed/, 'la feuille n\u2019est pas pleine page')
    assert.match(css, /\.nav-sheet\.show\s*\{[^}]*inset:\s*0/, 'la feuille ne couvre pas toute la page')
    assert.match(css, /\.nav-sheet-head\s*\{\s*display:\s*none/, "l\u2019en-tete de fermeture doit etre masque sur grand ecran")
    // Cibles : le pouce, pas la souris (regle des 44 px du harnais responsive).
    assert.match(css, /\.nav-sheet-head \.btn\s*\{[^}]*min-height:\s*44px/)
    assert.match(css, /\.nav-sheet \.navbar-nav \.nav-link\s*\{[^}]*min-height:\s*4[4-9]px|\.nav-sheet \.navbar-nav \.nav-link\s*\{[^}]*min-height:\s*[5-9]\dpx/)
  })

  it('la modale de connexion est pleine page (classe de Bootstrap, pas un custom)', () => {
    const auth = sansCommentaires('src/AuthPanel.jsx')
    assert.match(auth, /modal-dialog[^"]*modal-fullscreen/)
    assert.match(css, /\.auth-sheet-body\s*\{[^}]*width:\s*min\(100%,\s*520px\)/, 'le formulaire s\u2019etalerait sur 1 400 px : pleine page ne veut pas dire illisible')
  })

  it('les filtres de la vitrine ont un panneau plafonné et scrollable', () => {
    assert.match(css, /\.filter-sheet-grid\s*\{[^}]*max-height:\s*4[0-9]vh/)
    assert.match(css, /\.filter-sheet-grid\s*\{[^}]*overflow-y:\s*auto/)
    assert.match(css, /\.filter-sheet-grid \.btn[^}]*min-height:\s*44px/)
  })
})

// ── 5. la page Recherche, dans le code et a l\u2019écran ─────────────────────
describe('P4/V4 — à la page Recherche : catalogue et marques, pas d\u2019usage ni de stock', () => {
  const search = sansCommentaires('src/SearchPage.jsx')

  it('les deux filtres fantômes sont retirés, sur les deux présentations', () => {
    for (const motif of ['filters.use', 'filters.inStock', 'useAny', 'inStoreOnly', 'PRODUCT_USES', 'usesOf', 'm-stock', 'm-use', 'name="product-use"']) {
      assert.equal(search.includes(motif), false, `« ${motif} » est encore lu a la page Recherche`)
    }
    // LOT P6 (S1) : le rayon et la marque sont entres dans le panneau, puis en
    // sont sortis pour devenir la barre de deux boutons (feuille ouverture sur un
    // clic). Le contrat reste le meme — les deux filtres existent, les deux
    // fantomes sont partis — mais la forme verrouillee change : ce sont des
    // boutons qui portent la valeur choisie, pas des champs de plus dans l'aside.
    assert.match(search, /t\('filterBrands'\)/, 'la marque n\u2019est plus un filtre de la page Recherche')
    assert.match(search, /t\('filterCatalog'\)/, 'le catalogue n\u2019est plus un filtre de la page Recherche')
    assert.match(search, /sheet === 'brands'/, 'le bouton marque n\u2019ouvre pas une feuille : il etale')
    assert.match(search, /sheet === 'catalog'/, 'le bouton catalogue n\u2019ouvre pas une feuille : il etale')
  })

  it('EMPTY ne porte plus les deux clés (une recherche sauvée de l\u2019an dernier ne doit pas les ressusciter)', () => {
    assert.equal(/use: 'all'/.test(search), false, 'EMPTY porte encore une cle `use`')
    assert.equal(/inStock: false/.test(search), false, 'EMPTY porte encore une cle `inStock`')
  })
})

// ── 6. montage : ce que le client voit ─────────────────────────────────────
describe('P4/V1-V3 — l\u2019écran du client lit la vitrine, et la grille est paginée', () => {
  let hote = null
  let racine = null

  before(() => {
    // `loadMeta` (src/shopStore.js) lit la cle `pcstar-catalog` : la tuile est
    // seedee la, pas dans un etat que le composant inventerait.
    safeStorage.setItem(
      'pcstar-catalog',
      JSON.stringify({
        extraProducts: [],
        hiddenProductIds: [],
        extraPanels: [],
        hiddenPanelIds: [],
        vitrine: { repairsLabel: 'reparations au comptoir', repairsDone: 342, readyTally: 7 }
      })
    )
    hote = window.document.createElement('div')
    window.document.body.appendChild(hote)
    racine = createRoot(hote)
  })

  after(() => {
    if (racine) act(() => racine.unmount())
    hote?.remove()
    resetSafeStorage()
  })

  it('tuiles : le compteur du serveur et le nombre saisi par le maître, pas un 0 inventé', async () => {
    await act(async () => {
      racine.render(React.createElement(App))
    })
    await settle(140)
    const tuiles = [...hote.querySelectorAll('.readout .ro')]
    assert.equal(tuiles.length, 4, `${tuiles.length} tuiles dans le readout`)
    const lignes = tuiles.map((d) => d.textContent.replace(/\s+/g, ' ').trim())
    assert.ok(lignes[0].startsWith('7'), `tuile 1 = ${lignes[0]}`)
    assert.match(lignes[0], /commandes/, 'la tuile 1 n\u2019annonce plus des commandes')
    assert.ok(lignes[3].startsWith('342'), `tuile 4 = ${lignes[3]}`)
    assert.match(lignes[3], /reparations au comptoir/, 'le libellé écrit par le maître n\u2019est pas lu')
    assert.equal(hote.querySelector('.readout').textContent.includes('0 DA'), false, 'le 0 DA codé en dur est revenu')
    assert.equal(/references/i.test(hote.querySelector('.readout').textContent), false, 'le comptage du catalogue est revenu sur la vitrine')
    // LOT P6 (V6) : ces quatre tuiles se LISENT. Le maitre ecrit la quatrieme
    // (libelle + nombre) depuis sa page Admin ; cote vitrine publique, il n'y a
    // aucun controle — ni champ, ni bouton, ni clic — sinon le chiffre du
    // comptoir devient ce que le visiteur a decide.
    assert.equal(hote.querySelector('.readout input, .readout button, .readout select, .readout textarea'), null, 'un controle client est rendu dans le readout de la vitrine')
  })

  it('douze cartes, puis « Suivant » : la page 2 est une autre coupe du même catalogue', async () => {
    const cartes = () => hote.querySelectorAll('.product-bs-card')
    assert.equal(cartes().length, SHOP_PAGE_SIZE, `premiere page = ${cartes().length} cartes`)
    const annonce = hote.querySelector('#catalog')?.nextElementSibling
    assert.ok(annonce, 'la ligne d\u2019annonce du compte est ailleurs')
    assert.match(annonce.textContent.replace(/\s+/g, ' '), new RegExp(`${SHOP_PAGE_SIZE * 2}\\+ produits|\\d+ produits`), annonce.textContent.trim())
    const pager = hote.querySelector('.pager')
    assert.ok(pager, 'pas de pagination rendue')
    assert.match(pager.getAttribute('aria-label') || '', new RegExp(t('pagerLabel')))
    const annonce2 = annonce.textContent
    assert.match(annonce2, /page 1 sur \d+/, 'la page courante n\u2019est pas annoncee')
    const titres = () => [...hote.querySelectorAll('.product-bs-card .card-title')].map((x) => x.textContent.trim())
    const avant = titres()
    const suivant = [...pager.querySelectorAll('.btn')].pop()
    assert.match(suivant.textContent, new RegExp(t('nextPage')))
    await clique(suivant)
    await settle(60)
    const apres = titres()
    assert.notEqual(apres[0], avant[0], 'page 2 identique a page 1 : la tranche n\u2019est pas appliquee')
    assert.equal(apres.length, SHOP_PAGE_SIZE, `page 2 = ${apres.length} cartes`)
    assert.match(annonce.textContent.replace(/\s+/g, ' '), /page 2 sur/)
    // Le catalogue se suit sans jamais repasser par la meme fiche : 1 → 2 → 3.
    const aller = (n) => [...hote.querySelectorAll('.pager .btn')].find((b) => b.textContent.trim() === String(n))
    await clique(aller(3))
    await settle(60)
    assert.match(annonce.textContent.replace(/\s+/g, ' '), /page 3 sur/)
    const trois = titres()
    assert.equal(trois.some((x) => avant.includes(x)), false, 'la page 3 recoupe la page 1 : fenetre de tranche fausse')
    // « Précédent » ramène bien page 2 depuis page 3.
    await clique([...hote.querySelectorAll('.pager .btn')][0])
    await settle(60)
    assert.match(annonce.textContent.replace(/\s+/g, ' '), /page 2 sur/)
  })

  it('le mur de marques n\u2019est pas dans le document tant que le panneau est fermé', async () => {
    assert.equal(hote.querySelector('.filter-sheet'), null, 'un panneau de filtres est rendu sans etre ouvert')
    const boutons = [...hote.querySelectorAll('#catalog > div > .btn')]
    assert.equal(boutons.length, 2, `${boutons.length} boutons de filtre : « deux simples boutons » attendus`)
    const ouvreMarques = boutons.find((b) => b.textContent.includes(t('filterBrands')))
    assert.ok(ouvreMarques, 'le bouton des marques est absent')
    assert.equal(ouvreMarques.getAttribute('aria-expanded'), 'false')
    await clique(ouvreMarques)
    await settle(60)
    const panneau = hote.querySelector('#sheet-brands')
    assert.ok(panneau, 'le panneau des marques ne s\u2019ouvre pas')
    const champ = panneau.querySelector('input')
    assert.ok(champ, 'la recherche de marque manque dans le panneau')
    const puces = () => [...panneau.querySelectorAll('.filter-sheet-grid .btn')]
    const total = puces().length
    assert.ok(total > 3, `aucune marque dans le panneau (${total})`)
    await act(async () => natif(champ, 'Corsair'))
    await settle(60)
    // La puce « Tout » ouvre la liste, elle n'est pas une marque : elle reste
    // cliquable quel que soit le texte saisi (sinon on ne pourrait pas sortir
    // du filtre). C'est sur les marques seules que la reduction doit porter.
    const toutes = t('cat_all').trim()
    const filtres = puces().map((b) => b.textContent.replace(/\s+/g, ' ').trim()).filter((x) => x !== toutes)
    assert.ok(filtres.length > 0 && filtres.length + 1 < total, `le filtre de marque ne reduit rien (${filtres.length}/${total - 1})`)
    assert.ok(filtres.every((x) => /Corsair/i.test(x)), `marques affichees apres « Corsair » : ${filtres.join(' | ')}`)
    // Choisir une marque ferme le panneau et reporte la valeur sur le bouton.
    await clique(puces()[puces().length - 1])
    await settle(60)
    assert.equal(hote.querySelector('#sheet-brands'), null, 'le panneau reste ouvert apres le choix')
    assert.match(hote.querySelector('#catalog').textContent.replace(/\s+/g, ' '), / · Corsair/, 'le bouton ne porte pas la valeur choisie')
    // Et le catalogue suit : une seule marque a l'ecran.
    const marques = new Set([...hote.querySelectorAll('.product-bs-card .cbrand')].map((x) => x.textContent.trim()))
    assert.deepEqual([...marques], ['Corsair'], `marques filtrees : ${[...marques].join(', ')}`)
  })
})

// ── 7. montage : ce que le maître écrit ────────────────────────────────────
describe('P4/V1 — l\u2019écran du maître écrit la tuile, et ne touche pas au compteur de commandes', () => {
  let hote = null
  let racine = null
  let saisis = []

  after(() => {
    if (racine) act(() => racine.unmount())
    hote?.remove()
  })

  it('onglet Vitrine : nombre borné au clavier déjà, et aucun champ pour les commandes', async () => {
    resetSafeStorage()
    saisis = []
    const meta = { extraProducts: [], hiddenProductIds: [], extraPanels: [], hiddenPanelIds: [], vitrine: { repairsLabel: '', repairsDone: 0, readyTally: 5 } }
    hote = window.document.createElement('div')
    window.document.body.appendChild(hote)
    racine = createRoot(hote)
    await act(async () => {
      racine.render(
        React.createElement(MasterPage, {
          t,
          lang: 'fr',
          user: { id: 'u-maitre', role: 'master', name: 'Maitre' },
          users: [],
          onUsers: () => {},
          products: [],
          masterCatalog: [],
          meta,
          onMeta: (m) => saisis.push(m),
          basePanels: [],
          setToast: () => {},
          onBack: () => {},
          apiOnline: false,
          onStockRefresh: () => {}
        })
      )
    })
    await settle(120)
    const onglet = [...hote.querySelectorAll('.nav-link')].find((b) => b.textContent.trim() === t('masterVitrine'))
    assert.ok(onglet, 'l\u2019onglet Vitrine n\u2019est pas dans la barre du maitre')
    await clique(onglet)
    await settle(60)
    const etiquette = hote.querySelector('#master-vitrine-label')
    const nombre = hote.querySelector('#master-vitrine-count')
    assert.ok(etiquette && nombre, 'les deux champs de la tuile ne sont pas rendus')
    assert.equal(nombre.type, 'number', 'un champ texte libre pour un compteur : la meme faute qu\u2019hier')
    assert.equal(nombre.min, '0')
    assert.equal(nombre.max, String(VITRINE_LIMITS.count))
    assert.equal(nombre.step, '1', 'sans pas de 1, le navigateur laisse saisir 12,7 et la tuile affiche un nombre a virgule')
    assert.equal(etiquette.maxLength, VITRINE_LIMITS.label)
    // Le compteur de commandes se LIT, ne s'écrit pas : pas de champ pour lui.
    assert.equal(hote.querySelector('#master-vitrine-ready'), null, 'le readyTally est devenu editable')
    const lu = hote.querySelector('[data-testid="vitrine-ready-tally"]')
    assert.ok(lu, 'le compteur lu n\u2019est pas affiche au maitre')
    assert.equal(lu.textContent.trim(), '5')

    // Un decimal est refuse par le champ lui-meme (validation de `step`) :
    // `requestSubmit` ne soumet pas. Le test le verifie, puis saisit une valeur
    // valide — la borne du modele, elle, est verifiee a la section 1 et par
    // l'API (`repairsDone: '342.9'` envoye par curl), pour le client qui
    // contournerait le formulaire.
    await act(async () => {
      natif(etiquette, '  reparations au comptoir  ')
      natif(nombre, '12.7')
    })
    await settle(40)
    await act(async () => {
      nombre.form.requestSubmit()
    })
    await settle(80)
    assert.equal(saisis.length, 0, 'le formulaire a soumis un nombre a virgule : le champ ne borne plus rien')
    await act(async () => {
      natif(nombre, '12')
    })
    await settle(40)
    await act(async () => {
      nombre.form.requestSubmit()
    })
    await settle(120)
    assert.ok(saisis.length > 0, 'aucun onMeta emis : la saisie ne persiste pas')
    const ecrit = saisis[saisis.length - 1].vitrine
    assert.equal(ecrit.repairsLabel, 'reparations au comptoir', 'le libelle doit etre stocke trimme')
    assert.equal(ecrit.repairsDone, 12)
    assert.equal(ecrit.readyTally, 5, 'le mode local ne doit pas inventer de commandes')
    // Et la tuile du client, même source : le maitre a écrit, la page d'accueil lit.
    assert.deepEqual(clampVitrine(saisis[saisis.length - 1].vitrine), ecrit)
  })
})

// ── 8. dictionnaire : rien de mort, rien de manquants ──────────────────────
describe('P4 — le dictionnaire suit la page (aucune clé morte, aucune langue en retard)', () => {
  it('les clés de la vitrine existent dans les deux langues', () => {
    for (const l of LANGS) {
      for (const cle of ['roOrders', 'roRepairs', 'filterBrands', 'filterCatalog', 'brandSearchPh', 'noBrands', 'shopCount', 'shopPageOf', 'pagerLabel', 'prevPage', 'nextPage', 'catalog', 'masterVitrine', 'masterVitrineSave', 'masterVitrineSaved', 'masterVitrineBadCount', 'masterRepairsLabel', 'masterRepairsCount', 'masterVitrineReady', 'masterVitrineReadyBody']) {
        const v = dict[l.id][cle]
        assert.ok(typeof v === 'string' && v.trim().length > 1, `${l.id} : ${cle} absent`)
        assert.notEqual(v, cle, `${l.id} : ${cle} se traduit par son propre nom`)
      }
    }
  })

  it('les clés des filtres retirés et du décor supprimé sont parties partout', () => {
    const lues = ['inStoreOnly', 'inStoreOnlyHint', 'useAny', 'availability', 'roRefs', 'roPay', 'builderCheckTitle', 'builderCheckBody', 'chkOkSocket', 'chkOkRam', 'chkOkPsu', 'chkWarnCase']
    for (const l of LANGS) {
      for (const cle of lues) {
        assert.equal(cle in dict[l.id], false, `${l.id} : la cle ${cle} ne sert plus a rien`)
      }
    }
    for (const fichier of ['src/App.jsx', 'src/SearchPage.jsx', 'src/MasterPage.jsx']) {
      const code = sansCommentaires(fichier)
      for (const cle of lues) {
        assert.equal(code.includes(`'${cle}'`), false, `${fichier} lit encore ${cle}`)
      }
    }
  })

  it('le catalogue de base est bien paginé : douze par douze, trois pages au moins', () => {
    // Le client a demandé « les fiches SKU enchaînées en pages 1 → 2 → 3 » : la
    // mesure (301 fiches) doit rester au-dessus du seuil qui rend le test utile.
    assert.ok(PRODUCTS.length > 3 * SHOP_PAGE_SIZE, `catalogue de base = ${PRODUCTS.length} fiches`)
    assert.ok(PART_LINES.length > 1)
  })
})

describe('P5 — le bornage de la vitrine parle en caractères et ne devine pas les nombres', () => {
  /*
   * Deux defauts mesures le 19/09/2026 sur `PUT /api/master/vitrine`, par la
   * meme porte : le libelle etait compte/coupe en UNITES UTF-16 (un libelle de
   * 49 caracteres dont le 49e etait un emoji ressortait en 25 caracteres dont le
   * dernier etait U+D83E seul — un demi-caractere, affiche ? sur le site public,
   * et stocke ainsi), et le compteur passait par `Number()` (un booleen valait
   * 1, un tableau a un element valait son element, `'1e3'` valait 1000, et une
   * valeur au-dessus du plafond etait ramenee a 9 999 999 sans un mot).
   */
  const EMOJI = '\u{1F9F0}' // 🧰

  it('le libellé est compté en caractères : 48 emoji passent, et jamais une moitié de paire', async () => {
    const { clampVitrineLabel, VITRINE_LIMITS } = await import('./vitrine.js')
    assert.equal(clampVitrineLabel(EMOJI.repeat(48)), EMOJI.repeat(48), `${VITRINE_LIMITS.label} emoji doivent passer entiers`)
    const borne = clampVitrineLabel('a' + EMOJI.repeat(60))
    assert.equal([...borne].length, VITRINE_LIMITS.label, 'le compte doit etre en caracteres')
    const d = borne.charCodeAt(borne.length - 1)
    assert.equal(d >= 0xd800 && d <= 0xdbff, false, 'le libelle se termine par une tete de paire orpheline : le site public affiche ?')
    // La base peut porter n importe quoi (une valeur ecrite avant ce correctif) :
    // la projection publique doit REPARER la coupe, pas planter ni servir un demi
    // caractere. C est le chemin de relire une base ancienne.
    const corrompu = 'repare ' + String.fromCharCode(0xd83e)
    const relu = clampVitrineLabel(corrompu)
    assert.equal(relu.includes('\uD83E'), false, 'une moitie de paire stockee avant le correctif ressort toujours du GET /api/meta')
    assert.match(relu, /^repare/)
  })

  it('un compteur est un nombre ou une chaîne de chiffres : le reste est refusé, pas deviné', async () => {
    const { applyVitrineEdit } = await import('../server/vitrine.js')
    const { VITRINE_LIMITS } = await import('./vitrine.js')
    const db = { meta: { vitrine: { repairsLabel: 'repare au comptoir', repairsDone: 40, readyTally: 7 } } }
    for (const horsContrat of [true, false, [12], {}, { 1: 1 }, '1e3', '12px', '-5', '1 284', NaN, Infinity, 1e9, -0.5]) {
      assert.deepEqual(
        applyVitrineEdit(db, { repairsDone: horsContrat }),
        { ok: false, error: 'vitrine_count' },
        `${String(horsContrat)} ne doit pas etre accepte comme compteur`
      )
    }
    // Ce qui n'est PAS touché ne doit pas etre écrasé par le refus : le `PUT`
    // qui precedait a laisse la tuile intacte.
    assert.equal(db.meta.vitrine.repairsDone, 40, 'un refus a quand meme modifie le compteur')
    for (const admissible of [40, '40', 0, '0', 12.7]) {
      const r = applyVitrineEdit(db, { repairsDone: admissible })
      assert.equal(r.ok, true, `${String(admissible)} devrait passer : ${JSON.stringify(r)}`)
    }
    assert.equal(db.meta.vitrine.repairsDone, 12, 'le decimale admise est arrondie vers le bas, pas refusee')
    const apr = applyVitrineEdit(db, { repairsDone: ' 41 ' })
    assert.equal(apr.ok, true)
    assert.equal(db.meta.vitrine.repairsDone, 41, 'la derniere valeur admise doit etre celle stockee')
    assert.equal(db.meta.vitrine.readyTally, 7, 'le compteur de commandes reste hors de portee')
    // Une valeur deja en base au-dessus de la borne reste BORNEE a l'affichage
    // (le public ne doit jamais voir un nombre a 16 chiffres) : le refus est pour
    // la saisie, la borne pour la lecture.
    const { clampVitrineCount } = await import('./vitrine.js')
    assert.equal(clampVitrineCount(1e9), VITRINE_LIMITS.count)
    assert.equal(clampVitrineCount(true), 0, 'un booleen stocke par une ancienne version ne doit pas valoir 1')
    assert.equal(clampVitrineCount([12]), 0)
  })

  it('la route lit la même règle que le champ : plus de Number() qui accepte tout', () => {
    // Le fichier commente l'ancienne garde pour expliquer le defaut : le grep
    // porte sur le CODE, pas sur le texte qui le raconte.
    const code = fs
      .readFileSync('server/vitrine.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    assert.match(code, /estCompteurVitrine\(done\)/, 'la route a retrouve sa conversion aveugle')
    assert.equal(/Number\.isFinite\(Number\(done\)\)/.test(code), false, 'la garde `Number(done)` est revenue : booleens et tableaux repassent')
    // Et le champ, cote front, ne doit pas avoir sa propre echelle.
    const partage = fs.readFileSync('src/vitrine.js', 'utf8')
    assert.match(partage, /export function estCompteurVitrine/, 'la regle n\'est plus partageable : le formulaire va diverger')
  })
})

describe('P5 — les bornes du formulaire maître viennent des constantes partagées', () => {
  /*
   * Le verrou `p2ProductLimits` interdit déja les limites ecrites en dur COTE
   * SERVEUR. Le champ qui les saisit avait le meme defaut : deux `textarea`
   * portaient `maxLength="2000"` et `maxLength="500"` pendant que
   * `DESCRIPTION_LIMIT` et `CONDITION_NOTE_LIMIT` valaient 2000 et 500 — juste
   * assez le temps qu'un bornage change et que le formulaire laisse saisir dix
   * caracteres que le serveur coupera sans un mot.
   */
  const MASTER = fs.readFileSync('src/MasterPage.jsx', 'utf8')

  it('plus aucun maxLength littéral dans la page Admin', () => {
    const litteraux = [...MASTER.matchAll(/maxLength="\d+"/g)].map((m) => m[0])
    assert.deepEqual(litteraux, [], `${litteraux.length} borne(s) ecrite(s) a la main : ${litteraux.join(', ')}`)
  })

  it('les deux champs de texte libre lisent leur constante', () => {
    for (const [id, constante] of [
      ['master-product-description', 'DESCRIPTION_LIMIT'],
      ['master-product-condition-note', 'CONDITION_NOTE_LIMIT'],
      ['master-product-name', 'NAME_LIMIT'],
      ['master-product-brand', 'BRAND_LIMIT'],
      ['master-product-short', 'SHORT_LIMIT'],
      ['master-vitrine-label', 'VITRINE_LIMITS.label']
    ]) {
      const ligne = MASTER.split('\n').find((l) => l.includes(`id="${id}"`) || (l.includes(`id="${id}"`)) || new RegExp(`id="${id}"[\\s\\S]{0,220}maxLength=\\{${constante}\\}`).test(MASTER))
      assert.ok(ligne, `le champ ${id} n existe plus dans la page Admin`)
      const fenetre = MASTER.slice(Math.max(0, MASTER.indexOf(`id="${id}"`) - 240), MASTER.indexOf(`id="${id}"`) + 480)
      assert.match(fenetre, new RegExp(`maxLength=\\{${constante.replace('.', '\\.')}\\}`), `${id} ne borne plus sa saisie sur ${constante}`)
    }
  })

  it('les constantes existent et se recouvrent', async () => {
    const meta = await import('./productMeta.js')
    const { VITRINE_LIMITS } = await import('./vitrine.js')
    assert.equal(meta.DESCRIPTION_LIMIT, 2000)
    assert.equal(meta.CONDITION_NOTE_LIMIT, 500)
    assert.equal(VITRINE_LIMITS.label, 48)
    // Le serveur tronque a la MEME borne : le champ ne promet rien que l'API coupe.
    const { cleanProductText } = meta
    assert.equal([...cleanProductText('a'.repeat(5000), meta.DESCRIPTION_LIMIT)].length, meta.DESCRIPTION_LIMIT)
  })
})
