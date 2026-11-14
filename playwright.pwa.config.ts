/// <reference types="node" />
import { defineConfig } from '@playwright/test'

// Never use Vite dev here. Both inputs must be immutable production builds.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'pwa-hardening.spec.ts',
  workers: 1,
  timeout: 60_000,
  outputDir: process.env.PWA_EVIDENCE_DIR || 'test-results/pwa',
  use: { channel: 'chromium', headless: process.env.PWA_HEADED !== '1', viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', video: 'on', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
