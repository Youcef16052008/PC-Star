import { test, expect } from '@playwright/test'

test('shop loads and exposes the API-backed catalog', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/PC Star/i)
  await expect(page.locator('body')).not.toContainText('Something went wrong')
  await expect(page.locator('body')).not.toContainText('undefined')
})

// LOT 6.9 (Q9) : le test s'arrêtait à « pas de texte d'erreur d'auth » —
// assertion négative, qui passe aussi quand la connexion échoue silencieusement
// (formulaire refermé, jeton perdu, session non rechargée). Un smoke test de
// connexion doit vérifier l'ÉTAT CONNECTÉ : le compte démo existe dans la seed
// (`server/db.js` : demo-karim / karim.oran@demo.dz, nom « Karim B. »), donc on
// attend le bouton profil portant ce nom, le bouton de déconnexion, et la
// disparition du bouton « Connexion ».
//
// LOT 1.19 : le mot de passe de ce compte n'est plus publié. Il vient de
// `DEMO_PASSWORD` — la variable de l'instance testée. Absente, le serveur seed le
// compte **verrouillé** (`passwordHash: null`, 401 `demo_locked`) : le test se
// saute en le disant, au lieu d'échouer sur un état voulu.
const DEMO = {
  email: 'karim.oran@demo.dz',
  password: process.env.DEMO_PASSWORD || '',
  name: 'Karim B.'
}

test('demo customer can open login and authenticate', async ({ page }) => {
  test.skip(
    !DEMO.password,
    'DEMO_PASSWORD absent : comptes de démonstration verrouillés (lot 1.19) — état voulu'
  )
  await page.goto('/')
  const login = page.getByRole('button', { name: /connexion|login|تسجيل/i }).first()
  await expect(login).toBeVisible()
  await login.click()
  await page.getByLabel(/e-mail|email/i).fill(DEMO.email)
  await page.getByLabel(/mot de passe|password|كلمة/i).fill(DEMO.password)
  await page.getByRole('button', { name: /connexion|login|دخول/i }).last().click()
  await expect(page.locator('body')).not.toContainText(/auth.*error/i)

  // État connecté : le nom du compte démo apparaît (bouton profil), avec un
  // aria-label qui reprend nom + fonction (P22, bug E).
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()
  // La déconnexion devient disponible, le bouton « Connexion » disparaît.
  await expect(page.getByRole('button', { name: /déconnexion|logout|خروج/i }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^\s*(connexion|login|تسجيل الدخول)\s*$/i })).toHaveCount(0)
})

// LOT 6.9 (Q9) : la session survit au rechargement — sinon « connecté » ne veut
// rien dire au-delà du clic (le jeton doit être relisible et `loadSession` doit
// le rendre). C'est exactement le chemin cassé par F7/F8 (initializer de
// useState qui lève) et par R20 (jeton non persisté).
test('demo session survives a page reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /connexion|login|تسجيل/i }).first().click()
  await page.getByLabel(/e-mail|email/i).fill(DEMO.email)
  await page.getByLabel(/mot de passe|password|كلمة/i).fill(DEMO.password)
  await page.getByRole('button', { name: /connexion|login|دخول/i }).last().click()
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: new RegExp(DEMO.name.replace('.', '\\.'), 'i') })).toBeVisible()
})
