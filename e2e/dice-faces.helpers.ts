import { Page, expect } from '@playwright/test'

/** Time (ms) for the dice to render and settle before reading values. */
const RENDER_SETTLE_MS = 2500

export async function validateDiceFace(page: Page, type: string, face: number) {
  await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
  await page.waitForSelector('[data-testid="dice-test-harness"]')
  await page.waitForTimeout(RENDER_SETTLE_MS)

  const expectedValue = await page.locator('[data-testid="expected-value"]').textContent()
  const reportedValue = await page.locator('[data-testid="reported-value"]').textContent()

  expect(reportedValue).toBe(expectedValue)
}

export async function screenshotDiceFace(page: Page, type: string, face: number) {
  await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
  await page.waitForSelector('[data-testid="dice-test-harness"]')
  await page.waitForTimeout(RENDER_SETTLE_MS)

  await page.screenshot({
    path: `e2e/screenshots/${type}-face-${face}.png`,
    fullPage: true,
  })
}
