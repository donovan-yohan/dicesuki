import { defineConfig } from '@playwright/test'

const port = process.env.PLAYWRIGHT_TEST_PORT || '3000'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: `npm run dev:vite -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
  },
})
