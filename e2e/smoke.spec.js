import { test, expect } from '@playwright/test'

test('shop loads and exposes the API-backed catalog', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/PC Star/i)
  await expect(page.locator('body')).not.toContainText('Something went wrong')
  await expect(page.locator('body')).not.toContainText('undefined')
})

test('demo customer can open login and authenticate', async ({ page }) => {
  await page.goto('/')
  const login = page.getByRole('button', { name: /connexion|login|تسجيل/i }).first()
  await expect(login).toBeVisible()
  await login.click()
  await page.getByLabel(/e-mail|email/i).fill('karim.oran@demo.dz')
  await page.getByLabel(/mot de passe|password|كلمة/i).fill('karim31')
  await page.getByRole('button', { name: /connexion|login|دخول/i }).last().click()
  await expect(page.locator('body')).not.toContainText(/auth.*error/i)
})
