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

  await page.reload()
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()
})
