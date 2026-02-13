import { test, expect } from '@playwright/test'

const DICE_TYPES = [
  { type: 'd4', faceCount: 4 },
  { type: 'd6', faceCount: 6 },
  { type: 'd8', faceCount: 8 },
  { type: 'd10', faceCount: 10 },
  { type: 'd12', faceCount: 12 },
  { type: 'd20', faceCount: 20 },
]

for (const { type, faceCount } of DICE_TYPES) {
  test.describe(`${type} face validation`, () => {
    for (let face = 0; face < faceCount; face++) {
      test(`${type} face ${face}: reported value matches expected`, async ({ page }) => {
        await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
        await page.waitForSelector('[data-testid="dice-test-harness"]')

        // Wait for WebGL to render
        await page.waitForTimeout(2500)

        const expectedValue = await page.locator('[data-testid="expected-value"]').textContent()
        const reportedValue = await page.locator('[data-testid="reported-value"]').textContent()

        expect(reportedValue).toBe(expectedValue)
      })
    }
  })
}

// Screenshot grid for manual visual review
test('generate screenshot grid for all dice faces', async ({ page }) => {
  test.setTimeout(300000)
  for (const { type, faceCount } of DICE_TYPES) {
    for (let face = 0; face < faceCount; face++) {
      await page.goto(`/test/dice-faces?type=${type}&face=${face}`)
      await page.waitForSelector('[data-testid="dice-test-harness"]')
      await page.waitForTimeout(2500)

      await page.screenshot({
        path: `e2e/screenshots/${type}-face-${face}.png`,
        fullPage: true,
      })
    }
  }
})
