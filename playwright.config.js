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
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'node scripts/dev-all.mjs',
    url: 'http://localhost:5173',
    timeout: 60000,
    reuseExistingServer: !process.env.CI
  }
})
