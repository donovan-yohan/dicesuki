import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npm run dev:vite',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
  },
})
