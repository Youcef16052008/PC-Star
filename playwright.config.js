// Relecture PR #8 — configuration simplifiée et validée en local :
// un seul webServer (scripts/dev-all.mjs démarre API 8787 + front 5173).
// Pas de globalSetup : l'environnement de test est entièrement porté par
// dev-all.mjs (identifiants via .env / MASTER_EMAIL, MASTER_PASSWORD).
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  // LOT P3 (moteurs) — trois moteurs, pas un. Le smoke est le SEUL test du
  // dépôt qui rende l'application dans un vrai moteur : les 60-odd fichiers
  // `node:test` rendent dans jsdom, qui n'a ni mise en page ni polices, et le
  // crawl se refuse les clics destructeurs. Un seul moteur (Chromium) laissait
  // la moitié du parc du magasin hors de la porte : en Algérie le téléphone
  // android porte Chrome et WebView (même moteur, donc couvert), mais iOS ne
  // peut être servi que par WebKit, et Firefox Android (Fennec) est Gecko —
  // précisément les deux navigateurs pour lesquels « ça marche sur ma machine »
  // ne veut rien dire.
  // Coût mesuré et assumé : l'installation des trois moteurs à la CI (un seul
  // job, un `playwright install`), et neuf tests séquentiels de ~5 s.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    // LOT P3 (CI e2e) — le workflow .github/workflows/e2e-smoke.yml téléverse
    // `test-results/` en artefact : sans capture, un échec sur le runner ne
    // laisse que le texte de l'assertion, et un « le bouton n'est pas visible »
    // ne se débriefe pas à l'aveugle. `only-on-failure` : rien de payant quand
    // tout passe.
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/dev-all.mjs',
    url: 'http://localhost:5173',
    timeout: 60000,
    reuseExistingServer: !process.env.CI
  }
})
