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
const { default: App, SHOP_PAGE_SIZE, MENU_DESTINATIONS, HORS_MENU, PAGES_ROUTABLES } = await import('./App.jsx')
const { default: SearchPage } = await import('./SearchPage.jsx')
const { default: MasterPage } = await import('./MasterPage.jsx')
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { safeStorage, resetSafeStorage } = await import('./safeStorage.js')
const { createMemoryStorage, loadMeta } = await import('./shopStore.js')
const { PART_LINES, PRODUCTS, CATEGORIES } = await import('./data.js')

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
/**
 * Un `<select>` controle par React ne se change pas en touchant `.value` : React
 * compare la valeur qu'il a posee lui-meme et ne s'eveille que si le setter natif a
 * ete appele (meme logique que `natif` pour les champs texte).
 */
function choisir(el, valeur) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, valeur)
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
}
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
    // LOT P6 (S2) : la tranche et le compte de pages ne se calculent plus dans le
    // composant, ils viennent de `src/pager.js` — la regle de la page Recherche.
    // Le verrou suit la forme et verifie ce qu'il visait : une seule source de
    // verite, et la meme taille de page des deux cotes.
    assert.match(app, /tranche\(list, shopPageSure, pas\)/, 'la vitrine ne tranche plus avec la regle partagee')
    assert.match(app, /pagesPour\(list\.length, pas\)/, 'le nombre de pages n\u2019est plus déduit ailleurs que de la liste affichee')
    // LOT P6 (S3) : la taille de page se choisit (12 / 24 / 48). Le verrou exige que
    // le tranchage et le compte de pages recoivent la TAILLE — un pager calcule a
    // douze annoncerait « page 1 sur 26 » a une liste qui en fait sept.
    assert.match(app, /const pas = tailleSure\(shopTaille\)/, 'la taille choisie n\u2019entre pas dans la regle de tranchage')
    assert.match(app, /export const SHOP_PAGE_SIZE = PAGE_TAILLE/, 'la taille de page n\u2019est plus l\u2019alias de la regle partagee')
    const recherche = sansCommentaires('src/SearchPage.jsx')
    assert.match(recherche, /from '\.\/pager\.js'/, 'la page Recherche a sa propre pagination : deux regles distinctes')
    assert.equal(/Math\.ceil\([^)]*length/.test(recherche), false, 'la page Recherche recalcule encore ses pages pour son compte')
    // Le markup du pager ne vit plus dans le composant : c'est `Pager`
    // (`src/pagerControls.jsx`) qui le rend, pour la vitrine ET la recherche. Le
    // verrou descend donc dans le fichier partagé, et vérifie au passage que la
    // vitrine n'a pas gardé une copie locale à son nom.
    assert.match(app, /<Pager t=\{t\} page=\{shopPageSure\} pages=\{shopPages\} onPage=\{gotoPage\} \/>/, 'la vitrine ne rend pas le pager partagé')
    const commandes = sansCommentaires('src/pagerControls.jsx')
    assert.match(commandes, /aria-label=\{t\('pagerLabel'\)\}/)
    assert.match(commandes, /aria-current=\{n === courant \? 'page' : undefined\}/)
    assert.match(commandes, /disabled=\{courant <= 1\}/, '« Précédent » cliquable en page 1')
    assert.match(commandes, /disabled=\{courant >= pages\}/, '« Suivant » cliquable en derniere page')
    // Un bouton par page, c'etait le mur de pastilles numéroté : la fenetre vient du
    // module partage, et le composant n'a pas le droit de s'en passer.
    assert.match(commandes, /fenetrePages\(courant, pages\)/, 'le pager dresse un bouton par page')
    assert.equal(/Array\.from\(\{ length: pages \}/.test(commandes), false, 'la fenetre est court-circuitée par une liste complete de numeros')
  })

  it('le mur de marques a laissé la place à deux boutons qui portent la valeur choisie', () => {
    assert.match(app, /t\('filterBrands'\)/)
    assert.match(app, /t\('filterCatalog'\)/)
    assert.match(app, /\{brandFilter \? ` · \$\{brandFilter\}` : ''\}/, 'le bouton ne reporte pas la marque choisie')
    // LOT P6 (S3) : la feuille des marques est un composant partage (vitrine +
    // recherche). Ce que le verrou visait reste : la liste proposee suit la
    // categorie choisie, et le champ de recherche est dans la feuille.
    assert.match(app, /<BrandSheet[\s\S]{0,240}?marques=\{marquesVendues\}/, 'la liste des marques ne suit plus la catégorie choisie')
    const feuille = sansCommentaires('src/brandSheet.jsx')
    assert.match(feuille, /t\('brandSearchPh'\)/, 'la feuille partagée a perdu son champ de recherche')
    assert.match(feuille, /className="filter-sheet-grid"/, 'les cibles tactiles de 44 px sont court-circuitées par la feuille')
    assert.match(app, /aria-expanded=/)
    // `aria-controls` ne doit pointer qu'une feuille montee : ferme, l'id n'existe
    // pas dans le document, et l'attribut promet une relation qui ment.
    assert.match(app, /aria-controls=\{shopSheet === 'brands' \? 'sheet-brands' : undefined\}/, 'un aria-controls pointe dans le vide quand la feuille est fermée')
    assert.match(app, /aria-controls=\{shopSheet === 'catalog' \? 'sheet-catalog' : undefined\}/, 'un aria-controls pointe dans le vide quand la feuille est fermée')
    // Echap, c'est le hook partagé — et la vitrine l'appelle vraiment.
    assert.match(app, /useFeuilleFiltre\(shopSheet !== null, \(\) => setShopSheet\(null\)\)/, 'la vitrine n’a pas hérité du geste clavier de la feuille')
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

  // ── LOT P6 (S6) : le menu doit dire ou l'on peut aller ────────────────────
  it('toute page routable est dans le menu, ou exemptee avec sa raison', () => {
    // Mesure : la page « Garantie & RMA » etait routee (`page === 'warranty'`),
    // traduite, titree — et sans un seul lien vers elle, ni dans le menu ni dans le
    // pied de page. Une page que personne n'atteint est du code mort qui se prend
    // pour du contenu. La regle est lisible dans les declarations, pas dans un regex.
    const dansMenu = new Set(MENU_DESTINATIONS.map((d) => d.id))
    const exemptees = new Set(Object.keys(HORS_MENU))
    for (const id of PAGES_ROUTABLES) {
      assert.equal(dansMenu.has(id) || exemptees.has(id), true, `« ${id} » : page routable sans entree de menu ni exemption ecrite`)
    }
    for (const d of MENU_DESTINATIONS) {
      assert.ok(PAGES_ROUTABLES.includes(d.id), `le menu mene a « ${d.id} » : page inconnue du routeur, le clic retombait sur la vitrine`)
    }
    for (const [id, raison] of Object.entries(HORS_MENU)) {
      assert.ok(typeof raison === 'string' && raison.length > 12, `« ${id} » est exempte sans raison ecrite`)
      assert.equal(MENU_DESTINATIONS.some((d) => d.id === id), false, `« ${id} » est a la fois exemptee et listee`)
    }
    // Deux listes qui se recouvrent mal = un trou ou un doublon : on verifie le compte.
    assert.equal(dansMenu.size + exemptees.size, PAGES_ROUTABLES.length, 'le compte des destinations ne tombe pas juste')
  })

  it('les libelles du menu sont traduits, et le role du maitre est une seule liste', () => {
    // `dict` est celui de l'application : meme dictionnaire, meme process — pas une
    // copie des chaines dans le test (un libelle renomme ne doit pas rougir ici).
    for (const d of MENU_DESTINATIONS) {
      for (const langue of ['fr', 'en']) {
        const chaine = dict[langue][d.labelKey]
        assert.ok(typeof chaine === 'string' && chaine.length > 0, `${d.labelKey} : pas de libelle en ${langue}`)
        assert.notEqual(chaine, d.labelKey, `${d.labelKey} : la cle fuiterait a l'ecran en ${langue}`)
      }
    }
    // Ce que le menu reserve au maitre doit etre exactement ce que `go()` refuse aux
    // autres : deux listes differentes = un lien qui ouvre une page interdite, ou une
    // page autorisee que personne ne voit.
    const app = sansCommentaires('src/App.jsx')
    const gardee = app.match(/if \(\(next === '(\w+)' \|\| next === '(\w+)' \|\| next === '(\w+)'\) && !isMaster\)/)
    assert.ok(gardee, 'la garde du menu maitre a change de forme : relire ce verrou au lieu de le retirer')
    const refusees = gardee.slice(1, 4).sort()
    const reservees = MENU_DESTINATIONS.filter((d) => d.masterOnly).map((d) => d.id).sort()
    assert.deepEqual(reservees, refusees, 'le menu promet ce que le routeur refuse (ou cache ce qui est permis)')
  })

  it("le declencheur du menu dit ce qu'il ouvre, la feuille a un nom", () => {
    const app = sansCommentaires('src/App.jsx')
    assert.match(app, /aria-controls=\{navOpen \? 'nav-sheet' : undefined\}/, 'le bouton du menu ne nomme pas sa cible (ou la nomme quand elle est fermee)')
    assert.match(app, /id="nav-sheet"/, "la feuille du menu n'a pas d'identifiant")
    // Le groupe « informations » doit rester a la taille du pouce : separer ne veut
    // pas dire retrecir la cible (la regle des 44 px du harnais responsive).
    assert.match(css, /\.nav-sheet \.nav-lien-info \.nav-link[\s\S]{0,160}?min-height:\s*4[4-9]px/, 'les liens « informations » descendent sous 44 px')
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
    assert.equal(hote.querySelector('.readout input, .readout button, .readout select, .readout textarea') == null, true, 'un controle client est rendu dans le readout de la vitrine')
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

  // LOT P6 (S3) — un mot, pas un anglicisme : le bouton efface les filtres, et le
  // reste de l'interface le dit deja en francais (« Tout », « Aucune marque ne
  // correspond »). L'anglais garde « Reset », la parite des cles n'est pas la parite
  // des mots.
  it('le bouton d’effacement se nomme en français sur la vitrine française', () => {
    assert.equal(dict.fr.reset, 'Tout effacer', `libellé français du bouton de remise à zéro : ${dict.fr.reset}`)
    assert.equal(/reset/i.test(dict.fr.reset), false, 'un mot anglais est entré dans la chaîne française')
    assert.equal(typeof dict.en.reset, 'string', 'la clé a disparu du dictionnaire anglais')
  })

  it('le pager tient dans une fenêtre, et la dernière page reste à un clic', async () => {
    // L'etage precedent a deja tourne dans les pages : on ne part PAS de « page 1 »,
    // on lit ou on est, et on verifie la fenetre autour de la page courante.
    const numeros = () => [...hote.querySelectorAll('.pager .btn')].filter((b) => /^\d+$/.test(b.textContent.trim()))
    const annonce = hote.querySelector('#catalog')?.nextElementSibling
    const mention = () => annonce.textContent.replace(/\s+/g, ' ')
    const m = /page (\d+) sur (\d+)/.exec(mention())
    assert.ok(m, `aucune mention de page lisible : ${mention()}`)
    const total = Number(m[2])
    assert.ok(total > 6, `la vitrine ne fait que ${total} pages : ce verrou ne prouverait rien sur un catalogue court`)
    assert.ok(numeros().length <= 8, `${numeros().length} numéros dressés pour ${total} pages : le pager est un mur`)
    assert.ok(hote.querySelectorAll('.pager .pager-trou').length >= 1, 'aucun trou marqué alors que la fenêtre est fermée')
    const plusGrand = Math.max(...numeros().map((b) => Number(b.textContent.trim())))
    assert.equal(plusGrand, total, 'la dernière page a disparu de la fenêtre : on ne peut plus l’atteindre')
    assert.ok(numeros().some((b) => b.getAttribute('aria-current') === 'page'), 'la page courante n’est pas marquée dans la fenêtre')
    await clique(numeros().find((b) => b.textContent.trim() === String(total)))
    await settle(60)
    assert.match(mention(), new RegExp(`page ${total} sur ${total}`), 'la dernière page n’a pas été atteinte')
    const cartes = () => hote.querySelectorAll('.product-bs-card')
    assert.ok(cartes().length > 0, 'la dernière page est vide : la tranche est fausse en fin de liste')
    assert.ok(cartes().length <= 12, `la dernière page déborne la taille choisie (${cartes().length})`)
  })

  it('la taille de page se choisit, et le compte de pages suit', async () => {
    const select = hote.querySelector('.pager-taille select')
    assert.ok(select, 'aucun choix de taille de page sur la vitrine')
    assert.equal([...select.options].map((o) => o.value).join(','), '12,24,48', 'les tailles proposées ne viennent pas de `TAILLES`')
    const cartes = () => hote.querySelectorAll('.product-bs-card')
    const annonce = hote.querySelector('#catalog')?.nextElementSibling
    const mention = () => annonce.textContent.replace(/\s+/g, ' ')
    const douze = Number(/page (\d+) sur (\d+)/.exec(mention())[2])
    assert.ok(cartes().length > 0 && cartes().length <= 12, `a douze par page, la vitrine en rend ${cartes().length}`)
    await act(async () => choisir(select, '48'))
    await settle(80)
    const m2 = /page (\d+) sur (\d+)/.exec(mention())
    const pages48 = Number(m2[2])
    // Le compte de pages doit suivre la taille choisie — c'est LA faute que ce verrou
    // cherchait : un pager calcule a douze annoncerait « page 1 sur 25 » a une liste
    // qui en fait sept.
    assert.ok(pages48 < douze, `le compte de pages n’a pas suivi la taille (${pages48} pour ${douze})`)
    assert.equal(pages48, Math.ceil(300 / 48), `pages annoncees ${pages48} pour 300 fiches a quarante-huit`)
    // On ne part pas de la page 1 : l'etage precedent a tourne jusqu'a la page 3, et
    // le bornage a rendu la derniere page (12 fiches sur 300 a quarante-huit par page).
    // C'est le bon comportement — verrouille par les cas de `pageCourante` — donc le
    // verrou lit la page ou il est, puis y ramene le client.
    assert.ok(cartes().length > 0 && cartes().length <= 48, `tranche de ${cartes().length} cartes pour une page de 48`)
    const un = [...hote.querySelectorAll('.pager .btn')].find((b) => b.textContent.trim() === '1')
    assert.ok(un, 'la page 1 n’est pas atteignable depuis la fenêtre après le changement de taille')
    await clique(un)
    await settle(60)
    assert.equal(cartes().length, 48, 'passer à quarante-huit n’a rien changé aux cartes rendues')
    assert.match(mention(), /page 1 sur 7/, 'la page courante n’a pas été annoncée après le retour en tête')
    // Le select reste a la valeur choisie : un controle qui revient a 12 a chaque
    // rendu est un controle qui ne dit pas ou on en est.
    assert.equal(select.value, '48', 'le choix de taille n’a pas été retenu par le contrôle')
    // LOT P6 (S5) : la taille est une preference, pas un etat de la page. Elle part
    // donc dans le stockage, sous la cle du pager, et remonte telle quelle au remontage
    // (rechargement, ou aller voir la page Recherche puis revenir).
    const cle = JSON.parse(window.localStorage.getItem('pcstar-pager') || 'null')
    assert.deepEqual(cle, { taille: 48 }, 'le choix de la vitrine na pas ete ecrit : la page Recherche ne le verra jamais')
    // Et on rend l'appartement propre : le stockage est partage par tout le fichier.
    await choisir(select, '12')
    await settle(60)
    assert.deepEqual(JSON.parse(window.localStorage.getItem('pcstar-pager')), { taille: 12 }, 'revenir a douze doit aussi etre ecrit')
  })

  it('le mur de marques n\u2019est pas dans le document tant que le panneau est fermé', async () => {
    assert.equal(hote.querySelector('.filter-sheet') == null, true, 'un panneau de filtres est rendu sans etre ouvert')
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
    assert.equal(hote.querySelector('#sheet-brands') == null, true, 'le panneau reste ouvert apres le choix')
    assert.match(hote.querySelector('#catalog').textContent.replace(/\s+/g, ' '), / · Corsair/, 'le bouton ne porte pas la valeur choisie')
    // Et le catalogue suit : une seule marque a l'ecran.
    const marques = new Set([...hote.querySelectorAll('.product-bs-card .cbrand')].map((x) => x.textContent.trim()))
    assert.deepEqual([...marques], ['Corsair'], `marques filtrees : ${[...marques].join(', ')}`)
  })

  // ── LOT P6 (S4) : la marque que la categorie rend inutile ────────────────
  it('la categorie qui ne vend pas la marque choisie la retire, et le dit', () => {
    const app = sansCommentaires('src/App.jsx')
    // Le clic categorie ne doit plus decider pour son compte : c'est la regle
    // partagee (`src/filterDrop.js`) qui tranche, la meme que page Recherche.
    assert.match(app, /choisirCategorie\(c\.id\)/, 'le clic categorie ne passe plus par la regle partagee')
    assert.equal(/onClick=\{\(\) => \{ setCategory\(c\.id\)/.test(app), false, 'un clic categorie garde encore la main sur setCategory : deux regles pour un geste')
    assert.match(app, /filtresRetires\(/, 'la vitrine redecide seule quoi garder de la marque')
    assert.match(app, /from '\.\/filterDrop\.js'/, 'la vitrine n\u2019importe plus le module partag\u00e9')
  })

  it('marque + categorie incompatible : la grille rend des fiches, pas zero', async () => {
    const barRE = () => hote.querySelector('#catalog').textContent.replace(/\s+/g, ' ')
    const cartes = () => hote.querySelectorAll('.product-bs-card').length
    const effacer = [...hote.querySelector('#catalog').querySelectorAll('button')].find((b) => b.textContent.trim() === t('reset'))
    if (effacer) { await clique(effacer); await settle(60) }
    // Une marque vendue dans une categorie et absente d'une autre, choisie sur les
    // donnees (pas sur un nom tape a la main : la donnee de demo bouge).
    const vendue = (b, c) => PRODUCTS.some((p) => p.brand === b && (c === 'all' || p.category === c))
    const marque = [...new Set(PRODUCTS.map((p) => p.brand))].find((b) =>
      CATEGORIES.some((c) => c.id !== 'all' && vendue(b, c.id)) &&
      CATEGORIES.some((c) => c.id !== 'all' && !vendue(b, c.id)))
    assert.ok(marque, 'aucune marque ne se trouve dans un rayon et pas dans un autre : le verrou n\u2019a rien a mesurer')
    const etrangere = CATEGORIES.find((c) => c.id !== 'all' && !vendue(marque, c.id))
    assert.ok(etrangere, 'tout rayon vend cette marque : rien a retirer ici')
    const libelle = t(`cat_${etrangere.id}`) !== `cat_${etrangere.id}` ? t(`cat_${etrangere.id}`) : etrangere.label

    const declencheurs = () => [...hote.querySelectorAll('#catalog > div > .btn')]
    await clique(declencheurs().find((b) => b.textContent.includes(t('filterBrands'))))
    await settle(60)
    const puce = [...hote.querySelectorAll('#sheet-brands .filter-sheet-grid .btn')].find((b) => b.textContent.trim() === marque)
    assert.ok(puce, `la marque « ${marque} » n'est pas proposee au catalogue complet`)
    await clique(puce)
    await settle(60)
    assert.ok(barRE().includes(` · ${marque}`), 'le bouton ne porte pas la marque choisie avant le changement de categorie')
    assert.ok(cartes() > 0, 'la marque seule ne rend aucune fiche : l etage ne mesure rien')

    await clique(declencheurs().find((b) => b.textContent.includes(t('filterCatalog'))))
    await settle(60)
    const categorie = hote.querySelector(`#sheet-catalog .cat-${etrangere.id}`)
    assert.ok(categorie, `le rayon « ${etrangere.id} » n'est pas cliquable dans la feuille`)
    await clique(categorie)
    await settle(60)

    // 1) la marque n'est plus armee : ni sur le bouton, ni dans la grille vide.
    assert.equal(barRE().includes(` · ${marque}`), false, 'le bouton porte encore la marque retiree')
    // 2) et surtout : la grille n'est plus a zero (c'etait le defaut).
    assert.ok(cartes() > 0, `la categorie « ${etrangere.id} » rend une grille vide apres le retrait de la marque`)
    // 3) le retrait est annonce, avec la meme phrase que la page Recherche.
    const note = hote.querySelector('p[role="status"].text-warning')
    assert.ok(note, 'le filtre est retire sans un mot : le client voit la marque disparaitre du bouton')
    assert.equal(note.textContent.replace(/\s+/g, ' ').trim(), t('filterDrop', { brands: marque, line: libelle }), 'les deux ecrans n\u2019annoncent plus le meme retrait')
    // 4) « Tout effacer » efface egalement la mention.
    const efface = [...hote.querySelector('#catalog').querySelectorAll('button')].find((b) => b.textContent.trim() === t('reset'))
    assert.ok(efface, '« Tout effacer » a disparu alors qu une categorie est retenue')
    await clique(efface)
    await settle(60)
    assert.equal(hote.querySelector('p[role="status"].text-warning') == null, true, 'la mention du filtre retire survit a « Tout effacer »')
    assert.ok(cartes() > 0, 'apres effacement, plus aucune fiche a l ecran')
  })

  // ── LOT P6 (S6) : le menu mene bien aux pages, et les deux portes du compte ──
  it('le menu liste les pages du site — « Garanties » y compris, et le clic y mene', async () => {
    const liens = () => [...hote.querySelectorAll('.nav-sheet .nav-item button')]
    const attendus = MENU_DESTINATIONS.filter((d) => !d.masterOnly).map((d) => t(d.labelKey))
    const rendus = liens().map((b) => b.textContent.trim())
    for (const libelle of attendus) {
      assert.ok(rendus.includes(libelle), `le menu ne propose pas « ${libelle} » (rendu : ${rendus.join(' | ')})`)
    }
    // Le maitre seul, refuse a un visiteur : le menu ne doit pas le promettre.
    for (const d of MENU_DESTINATIONS.filter((x) => x.masterOnly)) {
      assert.equal(rendus.includes(t(d.labelKey)), false, `le menu offre « ${d.labelKey} » a un visiteur que le routeur refuserait`)
    }
    // La page qui n'avait AUCUN entree : garantie. Le menu la liste, le clic l'ouvre.
    const garantie = liens().find((b) => b.textContent.trim() === t('legalWarrantyTitle'))
    assert.ok(garantie, "le menu ne mene pas a la page « Garantie & RMA »")
    await clique(garantie)
    await settle(80)
    const titre = hote.querySelector('#main-content h1, #main-content h2')
    assert.ok(titre, 'la page garantie ne rend pas de titre')
    assert.equal(titre.textContent.trim(), t('legalWarrantyTitle'), 'le titre de la page garantie n est pas celui du menu')
  })

  it('le declencheur du menu nomme la feuille qu il ouvre, seulement quand elle est ouverte', async () => {
    const declencheur = hote.querySelector('.navbar-toggler')
    assert.ok(declencheur, 'le bouton du menu est absent')
    assert.equal(declencheur.getAttribute('aria-controls'), null, 'aria-controls pointe une feuille fermee')
    await clique(declencheur)
    await settle(60)
    assert.equal(declencheur.getAttribute('aria-expanded'), 'true', 'le bouton ne dit pas qu il est ouvert')
    assert.equal(declencheur.getAttribute('aria-controls'), 'nav-sheet', 'le bouton ne nomme pas sa cible une fois ouvert')
    assert.ok(hote.querySelector('#nav-sheet'), "l'identifiant annoncé n'existe pas dans la page")
    await clique(declencheur)
    await settle(60)
    assert.equal(declencheur.getAttribute('aria-controls'), null, 'aria-controls survit a la fermeture')
  })

  it('hors connexion : le menu propose les deux portes, et elles ouvrent le bon onglet', async () => {
    const boutons = () => [...hote.querySelectorAll('.nav-sheet button')]
    const connexion = boutons().find((b) => b.textContent.trim() === t('navLogin'))
    const inscription = boutons().find((b) => b.textContent.trim() === t('navSignup'))
    assert.ok(connexion, 'le menu ne propose pas de se connecter')
    assert.ok(inscription, 'le menu ne propose pas de creer un compte (un seul bouton envoyait le nouveau client sur un mot de passe)')
    await clique(inscription)
    await settle(120)
    assert.ok(hote.querySelector('#reg-name'), "l'onglet « Inscription » n est pas ouvert : le champ nom manque")
    const ongletActif = [...hote.querySelectorAll('.modal .nav-pills .nav-link.active')].map((x) => x.textContent.trim())
    assert.deepEqual(ongletActif, [t('authRegister')], 'le panneau ne dit pas sur quel onglet il est')
    // Et l'autre porte mene a l'onglet connexion, pas au meme endroit.
    const ongletConnexion = [...hote.querySelectorAll('.modal .nav-pills .nav-link')].find((x) => x.textContent.trim() === t('authLogin'))
    await clique(ongletConnexion)
    await settle(80)
    assert.equal(hote.querySelector('#reg-name') == null, true, "le formulaire d'inscription reste monte sous l'onglet connexion")
    // On rend l'appartement propre : la modale est montee sur tout le describe.
    const fermer = [...hote.querySelectorAll('.modal .btn-close')][0]
    if (fermer) { await clique(fermer); await settle(80) }
  })

  it('un lien ?inscription=1 debarque sur le formulaire, et le parametre repart', async () => {
    // Montage neuf : l'effet qui lit l'URL ne se joue qu une fois par instance.
    window.history.replaceState({}, '', '/?inscription=1&langue=fr')
    const hote2 = window.document.createElement('div')
    window.document.body.appendChild(hote2)
    const racine2 = createRoot(hote2)
    try {
      await act(async () => {
        racine2.render(React.createElement(App))
      })
      await settle(160)
      assert.ok(hote2.querySelector('#reg-name'), '?inscription=1 n ouvre pas le formulaire de creation de compte')
      assert.equal(window.location.search.includes('inscription'), false, 'le parametre reste dans l URL (partagee, recopiee, historisee)')
      assert.equal(window.location.search.includes('langue'), true, 'un parametre qui ne nous regarde pas a ete efface')
    } finally {
      await act(async () => {
        racine2.unmount()
      })
      hote2.remove()
      window.history.replaceState({}, '', '/')
    }
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
    assert.equal(hote.querySelector('#master-vitrine-ready') == null, true, 'le readyTally est devenu editable')
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
      for (const cle of ['roOrders', 'roRepairs', 'filterBrands', 'filterCatalog', 'brandSearchPh', 'noBrands', 'shopCount', 'pageSize', 'pagerLabel', 'shopPageOf', 'pagerLabel', 'prevPage', 'nextPage', 'catalog', 'masterVitrine', 'masterVitrineSave', 'masterVitrineSaved', 'masterVitrineBadCount', 'masterRepairsLabel', 'masterRepairsCount', 'masterVitrineReady', 'masterVitrineReadyBody']) {
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
