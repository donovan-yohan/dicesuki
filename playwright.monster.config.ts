import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: 'monster-manual.spec.ts',
  workers: 1,
  timeout: 120000,
  use: { ...base.use, channel: 'chrome', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
})
