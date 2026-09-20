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
const { default: SearchPage } = await import('./SearchPage.jsx')
const { PART_LINES, PRODUCTS } = await import('./data.js')
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
const boutons = () => [...hote.querySelectorAll('button')]
const cases = () => [...hote.querySelectorAll('input[type=checkbox], input[type=radio]')]
const cartes = () => hote.querySelectorAll('.row.g-3 > div').length

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
    // Le bouton porte la valeur choisie meme quand aucune n'a ete touchée : un
    // filtre actif doit se lire, sinon le client croit la page vide de filtre.
    assert.match(libelles[1], /·\s*\S/, 'le bouton catalogue n’affiche pas le rayon courant')
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
    assert.equal(hote.querySelector('#search-sheet-catalog'), null, 'la feuille est ouverte sans clic')
    await clique(boutonCatalogue)
    const feuille = hote.querySelector('#search-sheet-catalog')
    assert.ok(feuille, 'un clic n’a pas ouvert la feuille catalogue')
    assert.equal(feuille.getAttribute('aria-hidden'), null)
    assert.ok(feuille.querySelectorAll('button').length > 0, 'la feuille ouverte ne contient aucun rayon')
    await clique(hote.querySelector(BARRE).querySelectorAll('button')[1])
    assert.equal(hote.querySelector('#search-sheet-catalog'), null, 'un second clic n’a pas refermé la feuille')
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
    const avant = cartes()
    await clique(gpu)
    await settle(80)
    assert.equal(hote.querySelector('#search-sheet-catalog'), null, 'la feuille est restée ouverte apres le choix')
    const apres = cartes()
    assert.notEqual(apres, avant, 'changer de rayon ne change rien aux résultats (filtre décoratif)')
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
    const avant = cartes()
    await clique(marquent[0])
    await settle(80)
    const choisie = marquent[0].textContent.trim()
    assert.equal(hote.querySelector('#search-sheet-brands'), null, 'la feuille est restée ouverte apres le choix')
    assert.ok(cartes() < avant, `la marque « ${choisie} » ne réduit pas les résultats (${cartes()} vs ${avant})`)
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
    assert.equal(hote.querySelector('#search-sheet-brands'), null, 'les deux feuilles sont ouvertes en meme temps')
    assert.ok(hote.querySelector('#search-sheet-catalog'), 'la deuxieme feuille ne s’est pas ouverte')
  })

  it('le bouton « tout » de la feuille marques efface le choix', async () => {
    rend()
    await settle(120)
    await clique(bouton(t('filterBrands')))
    const marquent = [...hote.querySelectorAll('#search-sheet-brands button')].filter((b) => b.textContent.trim() !== t('cat_all'))
    await clique(marquent[1])
    await clique(bouton(t('filterBrands')))
    const avant = cartes()
    await clique([...hote.querySelectorAll('#search-sheet-brands button')].find((b) => b.textContent.trim() === t('cat_all')))
    await settle(80)
    assert.ok(cartes() > avant, 'revenir a « tout » n’a rien rendu')
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
