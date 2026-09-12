import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: process.env.CI ? 'dot' : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry' },
  webServer: [
    { command: 'npm run start:api', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30_000 }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
