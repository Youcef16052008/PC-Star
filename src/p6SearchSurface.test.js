/**
 * LOT P6 (S1, V6) — la page Recherche se filtre à deux clics, pas en scrollant.
 *
 * Ce que le client a décrit en voyant la vitrine en production, et qui était vrai
 * sur cet arbre : la page Recherche dressait, AVANT les résultats, un rail de
 * huit panneaux (catalogue, machines, imprimantes, pièces PC, périphériques,
 * réseau, lifestyle, bons plans) avec tous leurs rayons en pastilles, et
 * l'aside du bureau répétait la même liste en radios. Un filtre qui occupe une
 * page n'est pas un filtre, c'est un annuaire — et sur le parc de téléphones du
 * comptoir, il fallait scroller une page avant la première fiche.
 *
 * Le lot P4 (V2) avait déjà corrigé la vitrine (chaque filtre = un bouton qui
 * porte la valeur choisie, le panneau ne s'étale que sur un clic). Ce lot étend
 * le même contrat à la page Recherche, et verrouille au passage trois choses qui
 * n'avaient pas de garde :
 *  · les rayons ne sont plus rendus hors feuille (le markup du mur ne revient pas) ;
 *  · la compatibilité (socket) ne se montre QUE pour les pièces PC — c'est là
 *    qu'elle a un sens, pas pour un laptop ou une imprimante ;
 *  · une seule feuille est ouverte à la fois, et le bouton porte la valeur choisie
 *    une fois la feuille refermée (sinon le filtre choisi devient invisible).
 *
 * Comme dans `src/p3Vitrine.test.js`, les libellés sont comparés via `t()` (même
 * dictionnaire, même process) ou sur une sous-chaîne ASCII : le conteneur peut
 * réécrire les accents en double encodage, et un test qui tape une chaîne
 * accentuée à la main devient faux sans que personne ait rien cassé.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'

// ── Dom : les globaux doivent exister AVANT les `await import` (les composants
//    capturent `localStorage` et `window` à l'import du module). ──
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcstar-p6-search-'))
process.env.PCSTAR_DATA_DIR = dir

const { dict, LANGS } = await import('./i18n.js')
const { PAGE_TAILLE, TAILLES, fenetrePages, pageCourante, pagesPour, POINT_DE_SUSPENSION, tailleSure, tranche } = await import('./pager.js')
const { default: SearchPage } = await import('./SearchPage.jsx')
const { PART_LINES, PRODUCTS } = await import('./data.js')
const { loadSavedSearches } = await import('./shopStore.js')
const { filtresRetires, noteRetrait } = await import('./filterDrop.js')
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const t = (key, vars) => {
  let out = String(dict.fr[key] ?? key)
  for (const [k, v] of Object.entries(vars || {})) out = out.replaceAll(`{${k}}`, String(v))
  return out
}
const settle = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)))
const clique = (el) => act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })))
const sansCommentaires = (fichier) =>
  fs
    .readFileSync(path.join(process.cwd(), fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1')

// Les panneaux réels de la page d'accueil, dans le même ordre (huit groupes) :
// c'est exactement ce qui, rendu à plat, faisait un mur avant les résultats.
const PANNEAUX = [
  { id: 'catalog', titleKey: 'panelCatalog' },
  { id: 'machines', titleKey: 'panelMachines' },
  { id: 'printing', titleKey: 'panelPrinting' },
  { id: 'parts', titleKey: 'panelParts' },
  { id: 'peripherals', titleKey: 'panelPeripherals' },
  { id: 'networking', titleKey: 'panelNetworking' },
  { id: 'lifestyle', titleKey: 'panelLifestyle' },
  { id: 'deals', titleKey: 'panelDeals' }
]

/** Les produits du catalogue réel, avec un stock plat : `liveStock` est une prop. */
const produits = PRODUCTS.map((p) => ({ ...p, stock: 3 }))
const liveStock = (p) => (p.id === 'cpu-7800x3d' ? 0 : p.stock)

let hote = null
let racine = null

/**
 * Montagne propre a chaque etage : l'etat de la page (feuille ouverte, marque
 * choisie) ne doit jamais passer d'un verrou a l'autre — sinon un test echoue
 * parce que son predecesseur a laisse le panneau ouvert, pas parce que la page
 * est fausse.
 */
function rend(props = {}) {
  const vu = { onAdd: 0, onOpen: '' }
  if (hote) {
    if (racine) act(() => racine.unmount())
    hote.remove()
  }
  hote = window.document.createElement('div')
  window.document.body.appendChild(hote)
  racine = createRoot(hote)
  act(() => {
    racine.render(
      React.createElement(SearchPage, {
        t,
        products: produits,
        lines: PART_LINES,
        panels: PANNEAUX,
        lang: 'fr',
        liveStock,
        onAdd: () => {
          vu.onAdd += 1
        },
        onOpen: (id) => {
          vu.onOpen = id
        },
        ...props
      })
    )
  })
  return vu
}

/**
 * Un bouton de la page, repéré par son libellé rendu (pas par une classe). La
 * recherche est au PREFIXE parce que chaque bouton porte ensuite la valeur choisie
 * (« Filtrer par catalogue · GPU ») : c'est la moitie de l'ergonomie verrouillee
 * ici, un `===` l'interdirait.
 */
const bouton = (texte) => [...hote.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texte))
const boutonExact = (texte) => [...hote.querySelectorAll('button')].find((b) => b.textContent.trim() === texte)
/** Un `<select>` contrôlé par React se change par le setter natif : React compare la
 *  valeur qu'il a posée lui-même, une affectation directe ne le réveille pas. */
const choisir = (el, valeur) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, valeur)
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
const echap = () =>
  act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
const boutons = () => [...hote.querySelectorAll('button')]
const cases = () => [...hote.querySelectorAll('input[type=checkbox], input[type=radio]')]
const cartes = () => hote.querySelectorAll('.row.g-3 > div').length
/**
 * Le total que la page ANNONCE (ligne « N résultat(s) · page x sur y »). Depuis le
 * lot P6 (S2), le nombre de cartes affichées ne dit plus rien : la page 1 est pleine
 * qu'il y ait 13 ou 301 fiches. Ce qui se compare, c'est la taille de la liste.
 */
const enteteResultats = () => hote.querySelector('#search-results .fw-semibold')
const totalAnnonce = () => {
  const m = /(\d+)/.exec(enteteResultats()?.textContent || '')
  return m ? Number(m[1]) : NaN
}
const mentionPage = () => (enteteResultats()?.textContent || '').replace(/\s+/g, ' ')

const BARRE = '.filters-bar'

// UN SEUL montage pour tout le fichier : `createRoot` par describe laisserait une
// racine demontee aux etages suivants (« Cannot update an unmounted root »), et le
// verrou rougirait pour une raison de harnais, pas pour le comportement de la page.
after(() => {
  if (racine) act(() => racine.unmount())
  hote?.remove()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('P6/S1 — la barre de filtres : deux boutons, rien d’étalé avant le premier résultat', () => {

  it('« Filtrer par marque » puis « Filtrer par catalogue », dans cet ordre', async () => {
    rend()
    await settle(120)
    const barre = hote.querySelector(BARRE)
    assert.ok(barre, 'aucune barre de filtres sur la page Recherche')
    const libelles = [...barre.querySelectorAll('button')].map((b) => b.textContent.trim())
    assert.equal(libelles[0], t('filterBrands'), `le premier bouton n'est pas la marque : ${libelles[0]}`)
    assert.ok(libelles[1].startsWith(t('filterCatalog')), `le deuxième bouton n'est pas le catalogue : ${libelles[1]}`)
    // LOT P6 (S3) : le bouton ne reporte QUE ce qui est choisi. Ce verrou exigeait un
    // « · … » meme quand aucun rayon n'avait ete touche — il verrouillait le defaut
    // comme une selection, et « Filtrer par catalogue · Tout le catalogue » se lisait
    // comme un filtre actif sur une liste entiere.
    assert.equal(libelles[1], t('filterCatalog'), `le bouton reporte une valeur par défaut comme un choix : ${libelles[1]}`)
    // Et des qu'un rayon est choisi, il le dit.
    await clique(bouton(t('filterCatalog')))
    const feuille = hote.querySelector('#search-sheet-catalog')
    assert.ok(feuille, 'la feuille catalogue ne s’est pas ouverte')
    // On vise un rayon REEL (le GPU) et on ouvre son groupe, comme le fait le client.
    // Le premier bouton de la premiere rangee, lui, peut n'etre que l'entree
    // « Tout le catalogue » du panneau general : la choisir ne reporte rien, et ce
    // verrou est la pour exiger le contraire.
    const ligne = PART_LINES.find((l) => l.id === 'gpu')
    assert.ok(ligne?.group, 'le rayon « gpu » n’est plus rattaché à un panneau : la fixture a bougé')
    // Le titre vient de la fixture elle-meme (`titleKey`), pas d'une cle inventee au
    // clavier : `panel_parts` n'existe pas dans le dictionnaire, `panelParts` oui.
    const panneau = PANNEAUX.find((x) => x.id === ligne.group)
    assert.ok(panneau?.titleKey, `le panneau « ${ligne.group} » n’a pas de titleKey dans la fixture`)
    const titre = t(panneau.titleKey)
    const entete = [...feuille.querySelectorAll('button')].find((b) => b.textContent.trim() === titre)
    if (entete) {
      await clique(entete)
      await settle(60)
    }
    const rayon = boutonExact(t('line_gpu')) || boutonExact(ligne.label)
    assert.ok(rayon, `le rayon « gpu » n’apparait pas dans la feuille (groupe ${ligne.group})`)
    await clique(rayon)
    await settle(60)
    const apres = [...hote.querySelectorAll(`${BARRE} button`)].map((b) => b.textContent.trim())
    assert.match(apres[1], new RegExp(`^${t('filterCatalog')} · \\S`), 'le rayon choisi n’est pas reporté sur le bouton')
  })

  it('aucun rayon n’est rendu tant que la feuille est fermée', async () => {
    rend()
    await settle(120)
    // Le mur, c'était : tous les rayons de tous les panneaux, en permanance.
    // Feuille fermee, la page ne doit montrer QUE le raccourci du groupe courant (le
    // rayon choisi se lit sur le bouton, pas dans une liste de 40 pastilles).
    const horsBarre = boutons().filter((b) => !b.closest(BARRE))
    const libellesRayons = PART_LINES.filter((l) => l.id !== 'all').map((l) =>
      t(`line_${l.id}`) !== `line_${l.id}` ? t(`line_${l.id}`) : l.label
    )
    const etales = horsBarre.filter((b) => libellesRayons.includes(b.textContent.trim()))
    assert.equal(etales.length, 0, `${etales.length} pastilles de rayon sont rendues hors de la feuille : le mur est revenu`)
  })

  it('un clic ouvre la feuille catalogue, un second la referme', async () => {
    rend()
    await settle(120)
    const boutonCatalogue = bouton(t('filterCatalog'))
    assert.equal(hote.querySelector('#search-sheet-catalog') == null, true, 'la feuille est ouverte sans clic')
    await clique(boutonCatalogue)
    const feuille = hote.querySelector('#search-sheet-catalog')
    assert.ok(feuille, 'un clic n’a pas ouvert la feuille catalogue')
    assert.equal(feuille.getAttribute('aria-hidden'), null)
    assert.ok(feuille.querySelectorAll('button').length > 0, 'la feuille ouverte ne contient aucun rayon')
    await clique(hote.querySelector(BARRE).querySelectorAll('button')[1])
    assert.equal(hote.querySelector('#search-sheet-catalog') == null, true, 'un second clic n’a pas refermé la feuille')
  })

  it('choisir un rayon ferme la feuille, filtre les résultats, et le bouton porte le nom du rayon', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterCatalog')))
    const feuille = hote.querySelector('#search-sheet-catalog')
    // Le groupe courant est celui ouvert par défaut ; on saute a un autre groupe
    // en un clic sur son en-tete, puis sur un rayon.
    const tetePieces = [...feuille.querySelectorAll('button')].find((b) => b.textContent.trim() === t('panelParts'))
    assert.ok(tetePieces, "l'en-tête « pièces PC » n'est pas dans la feuille")
    await clique(tetePieces)
    const gpu = boutonExact(t('line_gpu'))
    assert.ok(gpu, 'le rayon GPU n’apparait pas apres un clic sur son groupe')
    const avant = totalAnnonce()
    await clique(gpu)
    await settle(80)
    assert.equal(hote.querySelector('#search-sheet-catalog') == null, true, 'la feuille est restée ouverte apres le choix')
    assert.notEqual(totalAnnonce(), avant, 'changer de rayon ne change rien aux résultats (filtre décoratif)')
    assert.match(bouton([...boutons()].map((b) => b.textContent.trim()).find((x) => x.startsWith(t('filterCatalog')))).textContent, /GPU|graphics/i, 'le bouton ne porte pas le rayon choisi')
  })

  it('la feuille des marques filtre réellement, et son bouton porte le nombre choisi', async () => {
    rend()
    await settle(120)
    await clique(boutonExact(t('filterBrands')))
    const feuille = hote.querySelector('#search-sheet-brands')
    assert.ok(feuille, 'un clic n’a pas ouvert la feuille des marques')
    const marquent = [...feuille.querySelectorAll('button')].filter((b) => b.textContent.trim() !== t('cat_all'))
    assert.ok(marquent.length > 1, 'la feuille des marques est vide ou unique : rien à verrouiller')
    const avant = totalAnnonce()
    await clique(marquent[0])
    await settle(80)
    const choisie = marquent[0].textContent.trim()
    assert.equal(hote.querySelector('#search-sheet-brands') == null, true, 'la feuille est restée ouverte apres le choix')
    assert.ok(totalAnnonce() < avant, `la marque « ${choisie} » ne réduit pas les résultats (${totalAnnonce()} vs ${avant})`)
    assert.equal(cartes() > 0, true, 'la marque choisie ne rend aucune fiche')
    const boutonMarque = boutons().find((b) => b.textContent.trim().startsWith(t('filterBrands')))
    assert.match(boutonMarque.textContent, /·\s*1/, 'le bouton ne dit pas qu’une marque est active une fois la feuille fermée')
    // Le meme bouton, une seconde fois : la feuille se rouvre et la marque choisie
    // y est marquee active (sinon le client ne peut pas la retirer sans la retrouver).
    await clique(boutonMarque)
    const active = [...hote.querySelectorAll('#search-sheet-brands button')].find((b) => b.textContent.trim() === choisie)
    assert.match(active.className, /btn-success/, 'la marque choisie n’est pas marquee active dans la feuille')
  })

  it('une seule feuille est ouverte à la fois', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterBrands')))
    assert.ok(hote.querySelector('#search-sheet-brands'))
    await clique(bouton(t('filterCatalog')))
    assert.equal(hote.querySelector('#search-sheet-brands') == null, true, 'les deux feuilles sont ouvertes en meme temps')
    assert.ok(hote.querySelector('#search-sheet-catalog'), 'la deuxieme feuille ne s’est pas ouverte')
  })

  it('le bouton « tout » de la feuille marques efface le choix', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterBrands')))
    const marquent = [...hote.querySelectorAll('#search-sheet-brands button')].filter((b) => b.textContent.trim() !== t('cat_all'))
    await clique(marquent[1])
    await clique(bouton(t('filterBrands')))
    const avant = totalAnnonce()
    await clique([...hote.querySelectorAll('#search-sheet-brands button')].find((b) => b.textContent.trim() === t('cat_all')))
    await settle(80)
    assert.ok(totalAnnonce() > avant, 'revenir a « tout » n’a rien rendu')
  })
})

describe('P6/S1 — ce qui ne doit pas revenir', () => {
  const page = sansCommentaires('src/SearchPage.jsx')

  it('le mur de panneaux, rendu a plat hors feuille', () => {
    // `{allPanels.map(` sans garde de feuille, c'etait le mur. Les `allPanels`
    // restants servent a la feuille (en-tetes de groupe + grille du groupe ouvert).
    assert.equal(/allPanels\.map\(/.test(page), false, 'un rail de panneaux est rendu sans etre dans une feuille')
    assert.equal(/d-lg-none">\s*\n?\s*\{allPanels/.test(page), false, 'le bloc mobile `d-lg-none` des panneaux est revenu')
    assert.ok((page.match(/allPanels/g) || []).length <= 4, `allPanels est lu ${'\b'}${(page.match(/allPanels/g) || []).length} fois : la page recompose le mur ailleurs`)
  })

  it('les filtres retirés sur demande (usage, en magasin) et leur markup', () => {
    for (const motif of ['filters.use', 'filters.inStock', 'useAny', 'inStoreOnly', 'PRODUCT_USES', 'usesOf', 'name="product-use"']) {
      assert.equal(page.includes(motif), false, `« ${motif} » est encore lu a la page Recherche`)
    }
    assert.equal(/En magasin|only in store/i.test(page), false, 'un filtre « en magasin seulement » est revenu')
  })

  it('deux surfaces pour la meme regle : ni les rayons ni les marques en double dans l’aside', () => {
    // L'aside du bureau garde ce qui n'existe pas ailleurs (condition, prix,
    // compatibilite, recherches sauvegardees). Les rayons et les marques ont UNE
    // surface : la feuille du bouton. Deux listes a maintenir, c'est deux listes
    // qui finissent par se contredire (c'est exactement comment `usage` a vecu).
    const aside = page.slice(page.indexOf('<aside'), page.indexOf('</aside>'))
    assert.equal(aside.includes('lineBrands'), false, 'l’aside listing les marques est revenu a cote de la feuille')
    assert.equal(aside.includes("name=\"search-line\""), false, 'les radios de rayon de l’aside contredisent la feuille')
    assert.match(aside, /t\('condition'\)/, "l'aside n'a plus la condition : il n'a plus rien a porter")
  })
})

describe('P6/S2 — les résultats de la recherche tiennent une page', () => {
  /*
   * Avant ce lot, la page Recherche rendait LES 301 FICHES d'un coup : 301 cartes,
   * 301 vignettes, 301 `PartThumb` — sur le parc de téléphones du comptoir, la page
   * ne s'affichait pas. Elle prend la règle de la vitrine, et donc la MÊME source de
   * vérité : `src/pager.js`.
   */
  it('douze fiches affichées, total annoncé intact, et le pager est là', async () => {
    rend()
    await settle(120)
    assert.equal(totalAnnonce(), produits.length, 'la page n’annonce plus la taille réelle de la liste')
    assert.equal(cartes(), PAGE_TAILLE, `la première page ne rend pas ${PAGE_TAILLE} cartes` + ` mais ${cartes()}`)
    assert.match(mentionPage(), new RegExp(`1\\s+sur\\s+${pagesPour(produits.length)}`), 'la page courante n’est pas annoncée')
    const pager = hote.querySelector('nav.pager')
    assert.ok(pager, 'aucun pager rendu alors que la liste fait plusieurs pages')
    assert.match(pager.getAttribute('aria-label') || '', new RegExp(t('pagerLabel')))
    const courant = [...pager.querySelectorAll('button')].find((b) => b.getAttribute('aria-current') === 'page')
    assert.ok(courant, 'la page active n’est pas marquée (aria-current)')
    assert.equal(courant.textContent.trim(), '1')
    assert.match(pager.querySelectorAll('button')[0].textContent, new RegExp(t('prevPage')), 'le bouton « précédent » est ailleurs')
    // Le separateur est deja dans la cle `shopPageOf` ; le composant qui en rajoute un
    // affiche « 301 résultat(s) · · page 1 sur 26 ». Ce defaut-la ne se voit que dans le
    // texte rendu : le source, lui, est propre.
    assert.equal(/·\s*·/.test(mentionPage()), false, `point-median doublé dans l’en-tête : ${mentionPage()}`)
  })

  it('page 2 : une autre coupe de la même liste, pas une liste amputée', async () => {
    rend()
    await settle(120)
    const premiere = [...hote.querySelectorAll('.product-bs-card .card-title')].map((x) => x.textContent.trim())
    const deuxiemeBouton = [...hote.querySelectorAll('nav.pager button')].find((b) => b.textContent.trim() === '2')
    assert.ok(deuxiemeBouton, 'le bouton « 2 » du pager est introuvable')
    await clique(deuxiemeBouton)
    await settle(80)
    const seconde = [...hote.querySelectorAll('.product-bs-card .card-title')].map((x) => x.textContent.trim())
    assert.equal(seconde.length, PAGE_TAILLE, 'la page 2 n’est pas pleine')
    assert.equal(new Set([...premiere, ...seconde]).size, PAGE_TAILLE * 2, 'la page 2 répète la page 1 : la tranche est fausse')
    assert.equal(totalAnnonce(), produits.length, 'changer de page a changé le total annoncé')
    assert.match(mentionPage(), /2\s+sur/, 'la page courante n’est pas annoncée après le changement')
  })

  it('un changement de filtre ramène page 1 (on ne cherche pas page 7 d’une liste qui vient de raccourcir)', async () => {
    rend()
    await settle(120)
    //LOT P6 (S3) : le pager est une FENETRE — depuis la page 1, « 3 » n'est plus a
    // portee de clic (et c'est voulu). On tourne d'une page, c'est assez pour la
    // demonstration : le filtre doit ramener le client en tete de la nouvelle liste.
    const bouton2 = [...hote.querySelectorAll('nav.pager button')].find((b) => b.textContent.trim() === '2')
    await clique(bouton2)
    await settle(60)
    assert.match(mentionPage(), /2\s+sur/, 'la page 2 n’a pas été atteinte')
    await clique(bouton(t('filterBrands')))
    const marque = [...hote.querySelectorAll('#search-sheet-brands button')].find((b) => b.textContent.trim() !== t('cat_all'))
    await clique(marque)
    await settle(80)
    // Liste courte apres filtre : le pager peut disparaitre (une seule page), c'est
    // pareil qu'« page 1 sur N ». Ce qui n'a pas le droit d'arriver, c'est d'y rester.
    const ou = /\d+\s+sur/.exec(mentionPage())
    assert.equal(ou ? Number(ou[0]) : 1, 1, 'le filtre laissé page 2 : le client voit une page qui n’existe plus')
    assert.equal(cartes() > 0, true, 'aucune fiche après le changement de filtre')
  })

  it('et la règle de tranchage est écrite UNE fois pour les deux listes', () => {
    const app = sansCommentaires('src/App.jsx')
    const page = sansCommentaires('src/SearchPage.jsx')
    for (const [nom, source] of [['src/App.jsx', app], ['src/SearchPage.jsx', page]]) {
      assert.match(source, /from '\.\/pager\.js'/, `${nom} ne passe pas par le module partagé`)
      // Le calcul du nombre de pages ne se refait pas dans les composants : deux
      // formules, deux arrondis différents, deux « page x sur y » qui se contredisent.
      assert.equal(/Math\.ceil\([^)]*length\s*\//.test(source), false, `${nom} recalcule encore un nombre de pages pour son compte`)
    }
    assert.match(app, /export const SHOP_PAGE_SIZE = PAGE_TAILLE/, 'la vitrine a sa propre taille de page')
    assert.match(page, /tranche\(results, pageSure, pas\)/, 'la recherche ne tranche pas avec la règle partagée')
    assert.match(page, /pagesPour\(results\.length, pas\)/, 'la recherche compte ses pages à douze quoi qu’il arrive')
    assert.match(page, /<Pager t=\{t\} page=\{pageSure\} pages=\{pages\} onPage=\{vaEnPage\} \/>/, 'la recherche dresse encore son pager à la main')
    assert.match(page, /<BrandSheet/, 'la recherche dresse encore son mur de marques à la main')
    assert.match(page, /useFeuilleFiltre\(sheet !== null/, 'la recherche n’a pas hérité du geste clavier de la feuille')
    // Les deux pages portent la meme mention, donc le meme mot dans le dictionnaire.
    assert.match(page, /t\('shopPageOf'/, 'la recherche n’annonce pas la page comme la vitrine')
    // Le repère du pager (`pagerLabel`) n'est plus dans la page : il est dans le
    // composant partage, ou les deux ecrans le lisent. Un libelle par ecran, c'est un
    // lecteur d'ecran qui dit « Pages du catalogue » sur la recherche et autre part.
    const commandes = sansCommentaires('src/pagerControls.jsx')
    assert.match(commandes, /t\('pagerLabel'\)/, 'le pager partagé n’a plus de libellé de repère')
    assert.match(commandes, /t\('prevPage'\)/, 'le pager partagé n’a plus de bouton « précédent »')
    assert.match(commandes, /t\('nextPage'\)/, 'le pager partagé n’a plus de bouton « suivant »')
    assert.match(commandes, /t\('pageSize'\)/, 'le choix de taille n’a pas de mot dans le dictionnaire')
  })
})

describe('P6/S1 — la compatibilité n’est demandée qu’aux pièces qui en ont une', () => {
  /** Ouvre la feuille catalogue, deplie le groupe demande, choisit le rayon. */
  async function choisisRayon(idRayon) {
    await clique(bouton(t('filterCatalog')))
    const feuille = hote.querySelector('#search-sheet-catalog')
    assert.ok(feuille, 'la feuille catalogue ne s’est pas ouverte')
    const ligne = PART_LINES.find((l) => l.id === idRayon)
    const tete = [...feuille.querySelectorAll('button')].find((b) => b.textContent.trim() === t(`panel_${ligne.group}`) || b.textContent.trim() === (dict.fr[`panel_${ligne.group}`] ?? dict.fr[`panel${ligne.group[0].toUpperCase()}${ligne.group.slice(1)}`]))
    if (tete) await clique(tete)
    const boutonRayon = boutonExact(t(`line_${idRayon}`)) || boutonExact(ligne.label)
    assert.ok(boutonRayon, `le rayon « ${idRayon} » n’apparait pas dans la feuille (groupe ${ligne.group})`)
    await clique(boutonRayon)
    await settle(80)
  }

  it('le champ socket apparait pour un CPU, jamais pour un laptop', async () => {
    rend()
    await settle(120)
    assert.equal(hote.textContent.includes(t('socket')), false, 'la page demande un socket avant meme qu’un composant soit choisi')
    await choisisRayon('cpu')
    assert.ok(hote.textContent.includes(t('socket')), 'un CPU choisi ne propose toujours pas de compatibilite')
    await choisisRayon('laptop')
    assert.equal(hote.textContent.includes(t('socket')), false, 'le socket est demande a un laptop : la cle de compatibilite n’a pas de sens ici')
    await choisisRayon('motherboard')
    assert.ok(hote.textContent.includes(t('socket')), 'une carte mère choisie ne propose pas de compatibilite')
  })
})

describe('P6/V6 — les mots du readout, et le fait que le client ne touche a rien', () => {
  it('la tuile du compteur de commandes dit « commande », pas « référence »', () => {
    assert.equal(dict.fr.roOrders.includes('commande'), true, `roOrders FR = ${dict.fr.roOrders}`)
    assert.equal(dict.en.roOrders.includes('order'), true, `roOrders EN = ${dict.en.roOrders}`)
    for (const langue of LANGS.map((l) => l.id)) {
      assert.equal(/r[eé]f[eé]rence|reference/i.test(dict[langue].roOrders), false, `${langue} : la tuile annonce encore des references`)
      assert.equal(/retrir|pickup/i.test(dict[langue].roOrders), false, `${langue} : le mot retire n'a plus sa place, le compteur ne decroft pas`)
      assert.equal(/pay|paiement|retrait/i.test(dict[langue].roRepairs), false, `${langue} : la quatrieme tuile parle encore de paiement au retrait`)
      assert.equal(dict[langue].roRepairs.length > 0, true)
    }
  })

  it('et le navigateur n’a aucune prise sur ce compteur', () => {
    // `readyTally` se lit, il ne se decrete : la seule ecriture du maitre porte le
    // libelle et le nombre des reparations. Un client qui ouvrirait la console ne
    // doit trouver aucun bout d'API qui ecrit dans la vitrine.
    const api = sansCommentaires('src/api.js')
    assert.equal(/readyTally/.test(api), false, 'src/api.js expose une ecriture de readyTally')
    assert.match(api, /putVitrine/, 'la seule ecriture de la vitrine a disparu : rien ne verrouille plus son bornage')
    const page = sansCommentaires('src/App.jsx')
    assert.equal(/readout[\s\S]{0,400}<input/.test(page), false, 'un champ de saisie est rendu dans le readout de la vitrine')
  })
})

describe('P6/S3 — la feuille des marques, la fenêtre de pages et le clavier', () => {
  /*
   * Mesuré sur la page rendue avant ce lot : la feuille des marques de la recherche
   * alignait 84 boutons sans champ de recherche (celle de la vitrine, elle, avait le
   * sien), le pager dressait 28 boutons pour 301 fiches, Échap ne fermait rien, et
   * `aria-controls` promettait une feuille qui n'était pas dans le document. Le mur
   * de pastilles signalé par le client n'était pas abattu, il était plié.
   */
  it('la feuille des marques a son champ de recherche, et la grille tactile de la vitrine', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterBrands')))
    const feuille = hote.querySelector('#search-sheet-brands')
    assert.ok(feuille, 'la feuille des marques ne s’ouvre pas')
    const champ = feuille.querySelector('input')
    assert.ok(champ, 'le champ « chercher une marque » est absent de la feuille de la recherche')
    assert.match(champ.getAttribute('aria-label') || '', new RegExp(t('brandSearchPh')))
    assert.ok(feuille.querySelector('.filter-sheet-grid'), 'les marques ne sont pas posées dans la grille à cibles de 44 px')
    const puces = () => [...feuille.querySelectorAll('.filter-sheet-grid .btn')].map((b) => b.textContent.trim())
    const total = puces().length
    assert.ok(total > 20, `${total} marques proposées : le catalogue s’est vidé depuis la mesure`)
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(champ, 'corsair')
      champ.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await settle(60)
    const filtres = puces().filter((x) => x !== t('cat_all'))
    assert.ok(filtres.length > 0 && filtres.length < total, `le champ ne réduit rien (${filtres.length} sur ${total})`)
    assert.ok(filtres.every((x) => /corsair/i.test(x)), `marques après « corsair » : ${filtres.join(' | ')}`)
    // Un texte qui ne matche rien le dit : une liste vide silencieuse se lit « le
    // magasin n’a plus de marques », pas « j’ai mal tapé ».
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(champ, 'zzzz')
      champ.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await settle(60)
    assert.match(feuille.textContent, new RegExp(t('noBrands')), 'aucune mention quand aucun nom ne correspond')
  })

  it('Échap ferme la feuille et rend le focus au bouton qui l’a ouverte', async () => {
    rend()
    await settle(120)
    const declencheur = bouton(t('filterBrands'))
    // Un vrai clavier a donne le focus au bouton avant de le declencher ; jsdom ne
    // le fait pas tout seul sur un `click` synthetique.
    await act(async () => declencheur.focus())
    await clique(declencheur)
    assert.ok(hote.querySelector('#search-sheet-brands'), 'la feuille ne s’est pas ouverte')
    await echap()
    await settle(60)
    assert.equal(hote.querySelector('#search-sheet-brands') == null, true, 'Échap n’a pas fermé la feuille')
    // JAMAIS `assert.equal(nodeA, nodeB)` sur des noeuds : le diff de Node traverse
    // l'arbre DOM puis les `__reactFiber` accroches aux elements, et la suite meurt
    // d'un tas epuise une vingtaine de secondes plus tard, sans message. On compare
    // une trace lisible.
    assert.equal(document.activeElement?.textContent?.trim(), t('filterBrands'), 'la feuille fermée, le focus du clavier est perdu')
  })

  it('et `aria-controls` ne promet que ce qui est monté', async () => {
    rend()
    await settle(120)
    const marques = bouton(t('filterBrands'))
    const catalogue = bouton(t('filterCatalog'))
    assert.equal(marques.hasAttribute('aria-controls'), false, 'un aria-controls pointe une feuille fermée, donc inexistante')
    assert.equal(marques.getAttribute('aria-expanded'), 'false')
    await clique(marques)
    await settle(60)
    assert.equal(marques.getAttribute('aria-controls'), 'search-sheet-brands', 'la feuille ouverte n’est pas reliée à son bouton')
    assert.ok(hote.querySelector('#search-sheet-brands'), 'l’id visé par aria-controls n’est pas dans le document')
    assert.equal(catalogue.hasAttribute('aria-controls'), false, 'la deuxième feuille ment aussi')
  })

  it('le pager tient dans une fenêtre, et la dernière page reste à un clic', async () => {
    rend()
    await settle(120)
    const pager = hote.querySelector('nav.pager')
    assert.ok(pager, 'pas de pager rendu')
    const numeros = () => [...pager.querySelectorAll('button')].filter((b) => /^\d+$/.test(b.textContent.trim()))
    const total = pagesPour(produits.length)
    assert.ok(total > 6, `la liste ne fait que ${total} pages : ce verrou ne prouverait rien`)
    assert.ok(numeros().length <= 8, `${numeros().length} numéros dressés pour ${total} pages : le pager est un mur`)
    assert.equal(pager.querySelectorAll('.pager-trou').length >= 1, true, 'aucun trou marqué alors que la liste fait plusieurs pages')
    assert.equal(Math.max(...numeros().map((b) => Number(b.textContent.trim()))), total, 'la dernière page a disparu de la fenêtre')
    assert.ok(numeros().some((b) => b.getAttribute('aria-current') === 'page'), 'la page courante n’est pas marquée dans la fenêtre')
    await clique(numeros().find((b) => b.textContent.trim() === String(total)))
    await settle(60)
    assert.match(mentionPage(), new RegExp(`${total}\\s+sur\\s+${total}`), 'la dernière page n’a pas été atteinte')
    assert.equal(cartes() > 0, true, 'la dernière page est vide : la tranche est fausse en fin de liste')
    assert.equal(cartes() <= PAGE_TAILLE, true, `la dernière page déborne (${cartes()} cartes)`)
  })

  it('le client choisit sa taille de page, et tout le reste suit', async () => {
    rend()
    await settle(120)
    const select = hote.querySelector('.pager-taille select')
    assert.ok(select, 'aucun choix de taille de page sur la recherche')
    assert.equal([...select.options].map((o) => o.value).join(','), TAILLES.join(','), 'les tailles proposées ne viennent pas de `TAILLES`')
    assert.equal(cartes(), PAGE_TAILLE, 'la recherche ne commence pas à douze fiches')
    await choisir(select, '48')
    await settle(80)
    assert.equal(cartes(), 48, 'passer à quarante-huit n’a rien changé aux fiches rendues')
    assert.match(mentionPage(), new RegExp(`1\\s+sur\\s+${pagesPour(produits.length, 48)}`), 'le compte de pages n’a pas suivi la taille')
    assert.ok(hote.querySelectorAll('nav.pager button').length <= 8, 'le pager n’a pas rétréci avec moins de pages')
    assert.equal(select.value, '48', 'le contrôle n’a pas retenu le choix du client')
    // Revenir a douze doit rendre la fenetre d'avant, pas rester coince a quarante-huit.
    await choisir(select, '12')
    await settle(80)
    assert.equal(cartes(), 12, 'revenir à douze n’a rien rendu')
  })

  it('et la règle reste unique : les deux écrans passent par les mêmes composants', () => {
    const app = sansCommentaires('src/App.jsx')
    const page = sansCommentaires('src/SearchPage.jsx')
    for (const [nom, source] of [['src/App.jsx', app], ['src/SearchPage.jsx', page]]) {
      assert.match(source, /from '\.\/pagerControls\.jsx'/, `${nom} dresse encore son pager à la main`)
      assert.match(source, /from '\.\/brandSheet\.jsx'/, `${nom} dresse encore son mur de marques à la main`)
      assert.match(source, /from '\.\/filterSheet\.js'/, `${nom} n’a pas le geste clavier partagé`)
      // Un markup recopié à côté du composant partagé est la divergence de demain.
      assert.equal(/nav className="pager/.test(source), false, `${nom} garde une copie locale du markup du pager`)
      assert.equal(/brandSearchPh/.test(source), false, `${nom} garde une copie locale du champ de recherche des marques`)
    }
  })
})

  it('un rayon choisi suffit à faire apparaître « Tout effacer » dans la barre', async () => {
    rend()
    await settle(120)
    // La barre, et pas la page entiere : l'aside de bureau porte lui aussi un bouton
    // du meme nom — « un seul exemplaire par regle » vaut aussi pour les verrous.
    const effacerBarre = () => [...hote.querySelectorAll(`${BARRE} button`)].find((b) => b.textContent.trim() === t('reset'))
    assert.equal(effacerBarre() == null, true, '« Tout effacer » se propose alors que rien n’est filtré')
    await clique(bouton(t('filterCatalog')))
    const feuille = hote.querySelector('#search-sheet-catalog')
    const ligne = PART_LINES.find((l) => l.id === 'gpu')
    const entete = [...feuille.querySelectorAll('button')].find((b) => b.textContent.trim() === t(PANNEAUX.find((x) => x.id === ligne.group).titleKey))
    if (entete) await clique(entete)
    await settle(60)
    const rayon = boutonExact(t('line_gpu')) || boutonExact(ligne.label)
    assert.ok(rayon, 'le rayon « gpu » n’apparait pas dans la feuille')
    await clique(rayon)
    await settle(80)
    // La vitrine comptait deja sa categorie dans ce bouton ; la recherche comptait
    // tout SAUF le rayon — le client reste donc sans issue visible quand il veut
    // revenir a toute la liste.
    const effacer = effacerBarre()
    assert.ok(effacer, 'aucun « Tout effacer » dans la barre alors qu’un rayon est choisi')
    const avant = totalAnnonce()
    await clique(effacer)
    await settle(80)
    assert.equal(totalAnnonce(), produits.length, '« Tout effacer » n’a pas rendu toute la liste')
    assert.ok(avant < produits.length, `le rayon n’avait rien filtré (${avant})`)
    assert.equal(effacerBarre() == null, true, 'le bouton reste après l’effacement')
  })

  it('Échap ferme le tiroir mobile — une surface à la fois', async () => {
    rend()
    await settle(120)
    const tiroir = bouton(t('filters'))
    assert.ok(tiroir, 'le bouton du tiroir de filtres est introuvable')
    await clique(tiroir)
    await settle(60)
    assert.ok(hote.querySelector('.offcanvas-body'), 'le tiroir ne s’est pas ouvert')
    await echap()
    await settle(60)
    assert.equal(hote.querySelector('.offcanvas-body') == null, true, 'Échap n’a pas fermé le tiroir mobile')
    // Les deux ouvertes : Echap ferme la feuille, laisse le tiroir — vider les deux
    // d'un coup ferait perdre le choix que le client etait en train de faire.
    await clique(tiroir)
    await settle(60)
    await clique(bouton(t('filterBrands')))
    await settle(60)
    assert.ok(hote.querySelector('#search-sheet-brands') && hote.querySelector('.offcanvas-body'), 'les deux surfaces ne sont pas ouvertes')
    await echap()
    await settle(60)
    assert.equal(hote.querySelector('#search-sheet-brands') == null, true, 'la feuille n’a pas fermé la première')
    assert.ok(hote.querySelector('.offcanvas-body'), 'Échap a fermé le tiroir en même temps : deux surfaces vidées d’un coup')
  })

  it('une feuille ouverte est un groupe nommé, et ses trous sont reliés', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterCatalog')))
    const feuille = hote.querySelector('#search-sheet-catalog')
    assert.ok(feuille, 'la feuille catalogue ne s’est pas ouverte')
    assert.equal(feuille.getAttribute('role'), 'group', 'la feuille est une boite de boutons sans nom pour un lecteur d’écran')
    assert.match(feuille.getAttribute('aria-label') || '', new RegExp(t('filterCatalog')))
    // Un `aria-expanded` sans `aria-controls` dit « ca se déplie » sans dire ou.
    const entete = [...feuille.querySelectorAll('button')].find((b) => b.hasAttribute('aria-expanded'))
    assert.ok(entete, 'aucun entete de groupe dans la feuille')
    const cible = entete.getAttribute('aria-controls')
    assert.ok(cible, 'un aria-expanded sans aria-controls : le groupe déplié n’a pas de nom de region')
    assert.ok(hote.querySelector(`#${cible}`), `aria-controls vise #${cible}, qui n’est pas dans le document`)
    // Et la regle vaut pour TOUTES les tetes de la feuille : un groupe replie qui
    // promet une grille absente est le meme mensonge, juste moins visible.
    for (const b of [...feuille.querySelectorAll('button')]) {
      const vise = b.getAttribute('aria-controls')
      if (!vise) continue
      assert.ok(hote.querySelector(`#${vise}`), `« ${b.textContent.trim()} » promet #${vise}, qui n’est pas monté`)
    }
    await clique(bouton(t('filterBrands')))
    await settle(60)
    assert.equal(hote.querySelector('#search-sheet-brands')?.getAttribute('role'), 'group', 'la feuille des marques n’est pas nommée')
  })

  it('le choix de taille a un seul nom, pas deux', () => {
    rend()
    const select = hote.querySelector('.pager-taille select')
    assert.ok(select, 'aucun choix de taille de page')
    // Le `<label>` porte le texte visible ; un `aria-label` par-dessus fait dire la
    // meme phrase deux fois au lecteur d'ecran.
    assert.equal(select.hasAttribute('aria-label'), false, 'le select est nommé deux fois')
    assert.match(select.closest('label').textContent, new RegExp(t('pageSize')), 'le texte visible ne nomme plus le contrôle')
  })

  it('une recherche enregistrée se nomme, et ne porte pas le défaut du catalogue', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('saveSearch')))
    await settle(60)
    // La source de verite, c'est ce qui est persiste (et `saved.map` rend une puce
    // par entree) — pas une classe Bootstrap qui habille aussi la bascule Grille/
    // Liste et les numeros du pager.
    const dernier = loadSavedSearches()[0]
    assert.ok(dernier, 'la recherche nenregistrée na rien laisse en magasin')
    // Sans aucun filtre, la puce a quand meme un nom : « Recherche libre ». Une puce
    // vide ne se relit pas deux jours plus tard.
    assert.equal(dernier.title, t('searchFree'), `nom de la recherche sans filtre : ${JSON.stringify(dernier.title)}`)
    assert.equal(loadSavedSearches().some((x) => String(x.title).includes(t('line_all'))), false, 'le défaut du catalogue est devenu un choix dans le nom')
    const puces = [...hote.querySelectorAll('.filter-sheet button, .d-flex.flex-wrap.gap-1.mb-3 button')].map((b) => b.textContent.trim())
    assert.ok(puces.includes(t('searchFree')), `la puce narrive pas a lecran : ${puces.join(' | ')}`)
  })

describe('P6/S3 — la forme des verrous (le pige est arrivé deux fois dans ce lot)', () => {
  it('aucun verrou ne compare deux nœuds DOM', () => {
    // `assert.equal(hote.querySelector('#x'), null)` passe quand tout va bien et
    // TRUIRE le runner quand ça rate : le diff de Node remonte l'arbre DOM, puis les
    // `__reactFiber` accrochés aux éléments, et le process meurt d'un tas épuisé une
    // vingtaine de secondes plus tard sans jamais afficher le message. Un verrou qui
    // ne peut pas dire pourquoi il a rougi n'est pas un verrou.
    const sources = ['src/p6SearchSurface.test.js', 'src/p3Vitrine.test.js', 'src/reportP17.test.js']
    const motif = /assert\.equal\(\s*(?:hote\.querySelector\(|bouton(?:Exact)?\(|document\.querySelector\()[^;]*,\s*(?:null|undefined)\s*,/
    for (const f of sources) {
      const source = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      const fautives = source.split('\n').filter((l) => motif.test(l))
      assert.deepEqual(fautives, [], `${f} compare des nœuds à ${'null'}`)
    }
  })
})

describe('P6/S2 — la règle de tranchage, testée pour elle-même', () => {
  it('pagesPour : au moins une page, jamais de page pour une liste vide', () => {
    assert.equal(PAGE_TAILLE, 12, 'la vitrine annonce douze fiches par page')
    assert.equal(pagesPour(0), 1)
    assert.equal(pagesPour(1), 1)
    assert.equal(pagesPour(12), 1)
    assert.equal(pagesPour(13), 2)
    assert.equal(pagesPour(301), 26)
    assert.equal(pagesPour(-5), 1, 'une liste de taille négative n’invente pas de page')
    assert.equal(pagesPour('abc'), 1, 'une taille qui n’est pas un nombre ne doit pas faire NaN de pagination')
  })

  it('pageCourante : bornée dans les deux sens, et sourde aux valeurs absurdes', () => {
    assert.equal(pageCourante(1, 3), 1)
    assert.equal(pageCourante(3, 3), 3)
    assert.equal(pageCourante(4, 3), 3, 'une page au-delà de la liste doit retomber sur la dernière')
    assert.equal(pageCourante(0, 3), 1)
    assert.equal(pageCourante(-7, 3), 1)
    assert.equal(pageCourante(NaN, 3), 1, 'un numéro invalide ne doit pas sortir du domaine')
    assert.equal(pageCourante(2.9, 3), 2, 'un numéro à virgule se lit par défaut bas, comme la tranche')
    assert.equal(pageCourante(7, 0), 1, 'aucune page possible : on reste à 1, pas à 0')
  })

  it('tailleSure : ce que l’interface propose, rien d’autre', () => {
    assert.deepEqual(TAILLES, [12, 24, 48], 'les tailles proposées ont changé sans prévenir les verrous')
    for (const n of TAILLES) assert.equal(tailleSure(n), n)
    assert.equal(tailleSure('24'), 24, 'une valeur venue d’une URL en chaîne doit être lisible')
    for (const v of [0, -3, 99, 13, 'beaucoup', NaN, null, undefined, {}]) {
      assert.equal(tailleSure(v), PAGE_TAILLE, `${String(v)} doit retomber sur le défaut, pas vider la liste`)
    }
    // Le select est borne, le tranchage ne l'est pas : un autre appelant a le droit
    // de demander cinq fiches par page, et lui repondre « douze » en silence serait un
    // `slice` faux et muet.
    assert.equal(tranche([1, 2, 3, 4, 5, 6, 7], 2, 5).length, 2)
    assert.equal(pagesPour(301, 48), 7)
    assert.equal(pagesPour(301), 26)
    assert.equal(pagesPour(301, 'beaucoup'), 26, 'un compte de pages ne se laisse pas mettre à zéro par une ordure')
  })

  it('fenetrePages : première et dernière toujours là, le trou marqué mais pas cliquable', () => {
    assert.deepEqual(fenetrePages(1, 3), [1, 2, 3], 'une liste courte ne doit pas inventer de trou')
    assert.deepEqual(fenetrePages(1, 6), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(fenetrePages(1, 7), [1, 2, POINT_DE_SUSPENSION, 7], 'un seul numéro sauté se marque en clair, pas en « … »')
    assert.deepEqual(fenetrePages(13, 26), [1, POINT_DE_SUSPENSION, 12, 13, 14, POINT_DE_SUSPENSION, 26])
    assert.ok(fenetrePages(13, 26).length <= 8, `la fenêtre fait ${fenetrePages(13, 26).length} cases`)
    assert.ok(fenetrePages(1, 26).includes(26), 'page 1 : la dernière page doit rester cliquable')
    assert.ok(fenetrePages(26, 26).includes(1), 'dernière page : la première doit rester cliquable')
    assert.deepEqual(fenetrePages(999, 4), [1, 2, 3, 4], 'une page hors liste doit rendre une fenêtre lisible, pas un trou')
    assert.deepEqual(fenetrePages(NaN, 0), [1])
    assert.ok(fenetrePages(13, 26, 0).includes(13), 'rayon nul : la page courante reste dans sa propre fenêtre')
    assert.equal(fenetrePages(13, 26, 0).filter((x) => typeof x === 'number').length, 3)
  })

  it('tranche : la bonne coupe, et jamais de trou ni de doublon entre deux pages', () => {
    const liste = Array.from({ length: 30 }, (_, i) => i)
    assert.deepEqual(tranche(liste, 1), liste.slice(0, 12))
    assert.deepEqual(tranche(liste, 2), liste.slice(12, 24))
    assert.deepEqual(tranche(liste, 3), liste.slice(24, 30), 'la dernière page est partielle, pas vide')
    const couvre = [1, 2, 3].flatMap((n) => tranche(liste, n))
    assert.equal(new Set(couvre).size, 30, 'des fiches disparaissent entre les pages')
    assert.equal(couvre.length, 30, 'des fiches sont comptées deux fois entre les pages')
    assert.deepEqual(tranche(null, 1), [], 'une liste absente se lit vide, elle ne casse pas la page')
    assert.deepEqual(tranche(liste, 99), liste.slice(24, 30), 'une page hors liste ramène la dernière')
    assert.deepEqual(tranche(liste, 1, 5), [0, 1, 2, 3, 4], 'la taille reste réglable (une taille par écran ne veut rien dire partout)')
  })
})
// ── LOT P6 (S4) : la marque que le rayon rend inutile ────────────────────────
describe('P6/S4 — une marque que le rayon ne vend plus est retiree, et le client le lit', () => {
  // Deux ecrans, deux regles pour le meme geste : la page Recherche vidait
  // `brands` sans un mot, la vitrine gardait la marque et affichait zero fiche.
  // La regle est unique (`src/filterDrop.js`) et a deux moities : on retire,
  // et on le dit. Les verrous ci-dessous mesurent les deux moities.

  /** Ouvre la feuille catalogue, au besoin en ouvrant le groupe du rayon, et
   *  clique le rayon. Rend le libelle choisi (celui que la note doit citer). */
  async function ouvrirRayon(ligne) {
    await clique(bouton(t('filterCatalog')))
    await settle(60)
    const libelle = t(`line_${ligne.id}`) !== `line_${ligne.id}` ? t(`line_${ligne.id}`) : ligne.label
    const trouvee = () => {
      const f = hote.querySelector('#search-sheet-catalog')
      return f && [...f.querySelectorAll('.filter-sheet-grid button')].find((b) => b.textContent.trim() === libelle)
    }
    if (!trouvee()) {
      const panneau = PANNEAUX.find((x) => x.id === ligne.group)
      assert.ok(panneau, `le rayon « ${libelle} » n'a aucun panneau : la feuille ne peut pas le proposer`)
      await clique([...hote.querySelector('#search-sheet-catalog').querySelectorAll('button')].find((b) => b.textContent.trim() === t(panneau.titleKey)))
      await settle(60)
    }
    const cible = trouvee()
    assert.ok(cible, `le rayon « ${libelle} » n'est pas cliquable dans la feuille`)
    await clique(cible)
    await settle(80)
    return libelle
  }

  /** Retient la premiere marque proposee par la feuille. */
  async function choisirMarque() {
    await clique(boutonExact(t('filterBrands')))
    await settle(60)
    const feuille = hote.querySelector('#search-sheet-brands')
    assert.ok(feuille, 'la feuille des marques ne souvre pas')
    const marquent = [...feuille.querySelectorAll('button')].filter((b) => b.textContent.trim() !== t('cat_all'))
    assert.ok(marquent.length > 1, "aucune marque a choisir dans la feuille")
    await clique(marquent[0])
    await settle(80)
    return marquent[0].textContent.trim()
  }

  const note = () => hote.querySelector('p[role="status"].text-warning')

  it('filtresRetires : ce qui filtre encore reste, ce qui ne filtre plus est nomme', () => {
    const vendues = (m) => m === 'Corsair' || m === 'Gigabyte'
    assert.deepEqual(filtresRetires(['Corsair', 'Asus'], vendues), { gardees: ['Corsair'], retirees: ['Asus'] })
    assert.deepEqual(filtresRetires([], vendues), { gardees: [], retirees: [] }, 'rien de choisi : rien a annoncer')
    assert.deepEqual(filtresRetires(null, vendues), { gardees: [], retirees: [] }, 'une liste absente ne doit pas casser le changement de rayon')
    assert.deepEqual(filtresRetires(['Asus', '', null], vendues), { gardees: [], retirees: ['Asus'] }, 'une entree vide deviendrait une puce vide')
    assert.deepEqual(filtresRetires(['Asus'], () => false).retirees, ['Asus'], 'un rayon qui ne vend rien doit tout retirer')
    assert.deepEqual(filtresRetires(['Asus'], () => true).retirees, [], 'un rayon qui vend tout ne doit rien retirer')
    // Les deux listes se recouvrent exactement : une marque choisie ne disparait
    // ni deux fois ni pas du tout.
    const r = filtresRetires(['A', 'B', 'C'], (m) => m === 'B')
    assert.deepEqual([...r.gardees, ...r.retirees].sort(), ['A', 'B', 'C'], 'des marques ont ete perdues en route')
  })

  it('noteRetrait : pas de phrase quand rien n\'est retire, une phrase nominative quand ca arrive', () => {
    assert.equal(noteRetrait(t, [], 'CPU'), '', 'on annone un retrait quil ny a pas')
    assert.equal(noteRetrait(t, null, 'CPU'), '')
    assert.equal(noteRetrait(t, ['Asus'], 'CPU'), t('filterDrop', { brands: 'Asus', line: 'CPU' }), 'la phrase nomme la marque et le rayon')
  })

  it('rayon incompatible : la marque tombe, la liste reste pleine, et la note la nomme', async () => {
    rend()
    await settle(120)
    const marque = await choisirMarque()
    assert.match(bouton(t('filterBrands')).textContent.replace(/\s+/g, ' '), /· 1$/, 'la marque choisie n apparait pas sur le bouton avant le rayon')
    const avant = totalAnnonce()
    assert.ok(avant > 0, 'la recherche de depart ne rend rien : le verrou n aurait rien a mesurer')
    const etranger = PART_LINES.find((l) => l.id !== 'all' && l.match && !produits.some((p) => l.match(p) && p.brand === marque))
    assert.ok(etranger, `tout rayon vend « ${marque} » : choisis une autre donnee, le verrou ne peut rien mesurer`)
    const libelle = await ouvrirRayon(etranger)

    // 1) le filtre est retire a la vue : plus de puce, plus de marque active.
    assert.equal(bouton(t('filterBrands')).textContent.replace(/\s+/g, ' ').trim(), t('filterBrands'), 'le bouton porte encore le filtre retire')
    await clique(bouton(t('filterBrands')))
    await settle(60)
    const feuille = hote.querySelector('#search-sheet-brands')
    assert.ok(feuille, 'la feuille des marques ne se rouvre pas')
    const actives = [...feuille.querySelectorAll('button')].filter((b) => /btn-success/.test(b.className)).map((b) => b.textContent.trim())
    assert.deepEqual(actives.filter((x) => x !== t('cat_all')), [], `une marque est encore marquee active : ${actives.join(', ')}`)
    await clique(bouton(t('filterBrands')))
    await settle(60)

    // 2) le rayon est bien applique, et la liste n est pas vide (c etait la promesse).
    assert.ok(totalAnnonce() > 0, 'le rayon choisit rend une liste vide')
    assert.notEqual(totalAnnonce(), avant, 'le rayon n a rien change aux resultats')
    assert.match(bouton(t('filterCatalog')).textContent, new RegExp(libelle.slice(0, 4), 'i'), 'le bouton du catalogue ne porte pas le rayon choisi')

    // 3) et le retrait est DIT : la phrase est celle de la regle partagee, mot pour mot.
    const m = note()
    assert.ok(m, 'le filtre est retire sans un mot : le client voit sa marque disparaitre')
    assert.equal(m.textContent.replace(/\s+/g, ' ').trim(), t('filterDrop', { brands: marque, line: libelle }), 'la note ne dit pas quoi on a retire et ou')
    assert.ok(m.textContent.includes(marque), 'la note oublie le nom de la marque retiree')
  })

  it('rayon compatible : la marque reste, et personne n\'a rien a expliquer', async () => {
    rend()
    await settle(120)
    const marque = await choisirMarque()
    const ami = PART_LINES.find((l) => l.id !== 'all' && l.match && produits.some((p) => l.match(p) && p.brand === marque))
    assert.ok(ami, `aucun rayon ne vend « ${marque} » : le verrou n a rien a mesurer`)
    await ouvrirRayon(ami)
    assert.ok(totalAnnonce() > 0, 'un rayon compatible rend une liste vide')
    assert.equal(note() == null, true, 'une note de retrait est rendue alors que rien n a ete retire')
    assert.match(bouton(t('filterBrands')).textContent.replace(/\s+/g, ' '), /· 1$/, 'la marque a ete retiree alors qu elle filtre encore dans ce rayon')
  })

  it('« Tout effacer » efface aussi la mention du filtre retire', async () => {
    rend()
    await settle(120)
    const marque = await choisirMarque()
    const etranger = PART_LINES.find((l) => l.id !== 'all' && l.match && !produits.some((p) => l.match(p) && p.brand === marque))
    await ouvrirRayon(etranger)
    assert.ok(note(), 'la note n est pas la : l etage suivant ne mesure rien')
    await clique(boutonExact(t('reset')))
    await settle(80)
    assert.equal(note() == null, true, '« Tout effacer » laisse a l ecran une explication qui ne veut plus rien dire')
    assert.equal(totalAnnonce() > 0, true, 'apres effacement, plus aucune fiche')
  })

  it('et la regle reste unique : les deux ecrans passent par le meme module', () => {
    const recherche = sansCommentaires('src/SearchPage.jsx')
    const vitrine = sansCommentaires('src/App.jsx')
    for (const [nom, source] of [['SearchPage', recherche], ['App (vitrine)', vitrine]]) {
      assert.match(source, /from '\.\/filterDrop\.js'/, `${nom} ne passe plus par la regle partagee`)
      assert.match(source, /filterDrop/, `${nom} n annone plus le retrait du filtre`)
    }
    // Les deux moities de la regle viennent du meme module : si un ecran
    // reimplementait « que garder ? », on aurait de nouveau deux comportements.
    assert.match(recherche, /filtresRetires\(/, 'la page Recherche redecide seule quoi garder des marques')
    assert.match(vitrine, /filtresRetires\(/, 'la vitrine redecide seule quoi garder de la marque')
    // Le vidage silencieux est mort : c'est la forme exacte du defaut d'avant.
    assert.equal(/line:\s*value,\s*brands:\s*\[\]/.test(recherche), false, 'la page Recherche vide encore les marques en silence quand un rayon est choisi')
  })
})
