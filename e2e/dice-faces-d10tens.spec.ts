import { test } from '@playwright/test'
import { validateDiceFace, screenshotDiceFace } from './dice-faces.helpers'

/**
 * Percentile TENS die: the d10 solid labelled 00-90. Each face index must report
 * exactly ten times the matching d10 digit, and the two-digit labels must stay
 * legible inside the kite (see the screenshot grid).
 */
const TYPE = 'd10tens'
const FACE_COUNT = 10

test.describe(`${TYPE} face validation`, () => {
  for (let face = 0; face < FACE_COUNT; face++) {
    test(`${TYPE} face ${face}: reported value matches expected`, async ({ page }) => {
      await validateDiceFace(page, TYPE, face)
    })
  }
})

test(`generate ${TYPE} screenshot grid`, async ({ page }) => {
  test.setTimeout(60000)
  for (let face = 0; face < FACE_COUNT; face++) {
    await screenshotDiceFace(page, TYPE, face)
  }
})
