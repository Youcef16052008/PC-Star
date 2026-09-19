// Relecture PR #8 — configuration simplifiée et validée en local :
// un seul webServer (scripts/dev-all.mjs démarre API 8787 + front 5173).
// Pas de globalSetup : l'environnement de test est entièrement porté par
// dev-all.mjs (identifiants via .env / MASTER_EMAIL, MASTER_PASSWORD).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
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
