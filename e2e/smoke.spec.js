import { test, expect } from '@playwright/test'
import { dict } from '../src/i18n.js'

/**
 * Smoke e2e — les trois choses qu'aucun autre test du dépôt ne peut dire :
 * un VRAI navigateur affiche la boutique, un client se connecte pour de vrai,
 * et la session survit au rechargement.
 *
 * LOT P3 (relecture du job CI `e2e-smoke.yml`) — la version précédente
 * cherchait le bouton de soumission avec `getByRole('button', { name:
 * /connexion|login|دخول/i }).last()` : en ANGLAIS les deux libellés sont
 * « Log in » (le CTA d'en-tête et l'envoi du formulaire), donc `.last()`
 * tombait sur le bon ; en FRANÇAIS l'en-tête dit « Connexion » et le bouton du
 * formulaire « Se connecter » — le motif ne trouvait que l'en-tête, le clic
 * ouvrait la boîte de dialogue au lieu d'envoyer le formulaire, et la session
 * n'apparaissait jamais. Le job CI (Chromium en `en-US`, application en `fr`
 * par défaut) était donc ROUGE, et ce depuis toujours : sans `DEMO_PASSWORD` la
 * spec se sautait, et la troisième, elle, n'avait même pas de garde.
 *
 * Deux règles en sortent, appliquées ici :
 *  1. la spec FIXE la langue (elle ne la subit pas) : `pcstar-lang` est posé
 *     avant la navigation, donc les libellés sont prévisibles quel que soit le
 *     locale du navigateur ;
 *  2. les libellés viennent du DICTIONNAIRE, pas d'un regex maison, et chaque
 *     localisateur est scopé à la boîte de dialogue — un bouton trouvé dans
 *     tout le document est un bouton qui peut être le mauvais.
 */
const LANG = 'fr'
const L = (key) => String(dict[LANG][key] ?? key)

// Le compte de démonstration : seedé par `server/db.js` (`demo-karim`,
// « Karim B. »). Son mot de passe n'est PAS publié — il vient de
// `DEMO_PASSWORD`, la variable de l'instance testée. Absente, le serveur seed le
// compte verrouillé (`passwordHash: null`, 401 `demo_locked`, lot 1.19) : les
// deux specs de connexion se sautent EN LE DISANT, au lieu d'échouer sur un état
// voulu. Les deux, pas une seule : l'asymétrie précédente faisait du job CI un
// half-green sans signification.
const DEMO = {
  email: 'karim.oran@demo.dz',
  password: process.env.DEMO_PASSWORD || '',
  name: 'Karim B.'
}
const besoinDemo = () =>
  test.skip(!DEMO.password, 'DEMO_PASSWORD absent : comptes de démonstration verrouillés (lot 1.19) — état voulu')

/** La boîte de dialogue d'authentification, repérée par le champ qu'elle porte. */
const modale = (page) => page.locator('.modal-content', { has: page.locator('#auth-email') })

/** Saisit et envoie le formulaire de connexion, sans dépendre d'un libellé ambigu. */
async function brancher(page) {
  await page.getByRole('button', { name: L('navLogin'), exact: true }).first().click()
  const bo = modale(page)
  await expect(bo).toBeVisible()
  await bo.getByLabel(L('authEmail')).fill(DEMO.email)
  await bo.getByLabel(L('authPassword')).fill(DEMO.password)
  await bo.getByRole('button', { name: L('authSubmitLogin'), exact: true }).click()
}

test('shop loads and exposes the API-backed catalog', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('pcstar-lang', 'fr')
    } catch {
      /* stockage bloqué : la langue suit alors le navigateur, rien ne casse */
    }
  })
  await page.goto('/')
  await expect(page).toHaveTitle(/PC Star/i)
  await expect(page.locator('body')).not.toContainText('Something went wrong')
  await expect(page.locator('body')).not.toContainText('undefined')
})

test('demo customer can open login and authenticate', async ({ page }) => {
  besoinDemo()
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('pcstar-lang', 'fr')
    } catch {
      /* idem */
    }
  })
  await page.goto('/')
  await brancher(page)

  // La garde d'origine (6.9/Q9) reste : aucun texte d'erreur d'auth ne doit
  // trainer dans la page après une connexion qui a réussi.
  await expect(page.locator('body')).not.toContainText(/auth.*error/i)

  // Et surtout, l'état CONNECTÉ — pas seulement l'absence d'erreur. Le bouton de
  // profil porte `aria-label="Profil — Karim B."` (P22, bug E), donc le nom du
  // compte seedé est l'assertion, et le CTA de connexion a disparu de l'en-tête.
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()
  await expect(modale(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: L('navLogin'), exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: L('navLogout'), exact: true })).toBeVisible()
})

// LOT 6.9 (Q9) : la session survit au rechargement — sinon « connecté » ne veut
// rien dire au-delà du clic (le jeton doit être relisible et `loadSession` doit
// le rendre). C'est exactement le chemin cassé par F7/F8 (initializer de
// useState qui lève) et par R20 (jeton non persisté).
test('demo session survives a page reload', async ({ page }) => {
  besoinDemo()
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('pcstar-lang', 'fr')
    } catch {
      /* idem */
    }
  })
  await page.goto('/')
  await brancher(page)
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()

  // La course attendait le nom de l'utilisateur pendant 5 s APRÈS le
  // rechargement. Sur un runner chargé, ce n'est pas le rendu qui traîne :
  // c'est la reprise de session qui part du jeton relu puis rappelle l'API — et
  // le premier `await` du navigateur peut dépasser le délai par temps d'attente
  // CPU. Le verrou est le même (le nom doit être là, sinon la session n'a pas
  // survécu), mais il est posé sur un événement : la réponse de session. Le
  // délai de 30 s n'amollit rien — une session qui ne revient pas en 30 s est
  // une session qui ne revient pas ; une session qui revient en 6 s n'est pas
  // un bug.
  const [reponse] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/me'), { timeout: 30_000 }),
    page.reload()
  ])
  await expect(reponse.ok()).toBe(true)
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()
})

/*
 * LOT P6 (S6) — le menu, dans un vrai moteur, sur un vrai téléphone.
 *
 * Le client a décrit ceci : « le bouton du menu n'a pas les autres pages à cliquer, et
 * il n'y a pas sign in and sign up ». Deux faits vérifiés sur l'arbre d'avant : la page
 * « Garantie & RMA » n'avait AUCUN lien dans l'application (0 occurrence de `go('warranty')`),
 * et la seule porte du compte était « Connexion ». Ce que jsdom ne peut pas dire, lui,
 * c'est si le bas de la feuille est ATTEIGNABLE — un panneau qui déborde sans défiler
 * rend des liens présents dans le DOM et impossibles à cliquer. D'où `toBeInViewport`
 * après défilement : la cible doit être sous le pouce, pas seulement dans l'arbre.
 *
 * 21/09/2026 — le client a demandé le retrait des trois textes légaux du menu
 * (« supprime le bouton Informations ; Conditions ; Confidentialité ; Garantie &
 * RMA »). Ce test garde ses deux objets — les pages sont atteignables, les deux
 * portes du compte sont dans la feuille — et suit le déménagement : le lien vers
 * « Garantie & RMA » est désormais dans le pied de page.
 */
test('phone menu: every routed page is reachable, and the sign-up door opens the register form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  await page.getByRole('button', { name: L('navMenu'), exact: true }).click()
  const feuille = page.locator('#nav-sheet')
  await expect(feuille).toBeVisible()

  // Ce que la feuille doit offrir, et qui doit etre SOUS LE POUCE : les cinq
  // destinations publiques, puis les deux portes du compte en bas. Un lien
  // present dans le DOM mais hors du viewport, c'est « le menu n'a pas les
  // autres pages » au sens propre.
  for (const cle of ['navShop', 'navSearch', 'navBuilder', 'navAbout', 'navOrders', 'navLogin', 'navSignup']) {
    const lien = feuille.getByRole('button', { name: L(cle), exact: true })
    await expect(lien).toBeVisible()
    await lien.scrollIntoViewIfNeeded()
    await expect(lien).toBeInViewport()
  }

  // La feuille se referme par son propre en-tête : tant qu'elle est ouverte,
  // elle couvre le pied de page (et c'est bien ce qu'on veut d'elle).
  await feuille.locator('.nav-sheet-head .btn').click()
  await expect(feuille).toBeHidden()

  // 21/09/2026 — les textes legaux ont quitte le menu (demande du client) :
  // « Garantie & RMA » se rejoint depuis le pied de page, et la page s'ouvre.
  const garantie = page.locator('.site-footer').getByRole('button', { name: L('navWarranty'), exact: true })
  await expect(garantie).toBeVisible()
  await garantie.click()
  await expect(page.locator('#main-content h1')).toHaveText(L('legalWarrantyTitle'))

  // Les deux portes du compte, dans la même feuille.
  await page.getByRole('button', { name: L('navMenu'), exact: true }).click()
  await expect(feuille).toBeVisible()
  await expect(feuille.getByRole('button', { name: L('navLogin'), exact: true })).toBeVisible()
  await expect(feuille.getByRole('button', { name: L('navSignup'), exact: true })).toBeVisible()
  await feuille.getByRole('button', { name: L('navSignup'), exact: true }).click()
  const boite = page.locator('.modal-content', { has: page.locator('#reg-name') })
  await expect(boite).toBeVisible()
  // L'onglet actif, lu dans les pilules : pas de role/button ambigu (le libelle de
  // l'onglet et celui de l'envoi se ressemblent, un getByRole exact choisirait le mauvais).
  await expect(boite.locator('.nav-pills .nav-link.active')).toHaveText(L('authRegister'))
})

test('deep link ?inscription=1 opens the form and leaves no trace in the URL', async ({ page }) => {
  await page.goto('/?inscription=1&langue=fr')
  const boite = page.locator('.modal-content', { has: page.locator('#reg-name') })
  await expect(boite).toBeVisible()
  expect(page.url()).not.toContain('inscription')
  // Un paramètre qui ne nous regarde pas reste où le client l'a laissé.
  expect(page.url()).toContain('langue=fr')
})
