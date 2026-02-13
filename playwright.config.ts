import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'https://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npm run dev:vite',
    url: 'https://localhost:3000',
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
  },
})
