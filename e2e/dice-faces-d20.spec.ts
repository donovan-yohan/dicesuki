import { test } from '@playwright/test'
import { validateDiceFace, screenshotDiceFace } from './dice-faces.helpers'

const TYPE = 'd20'
const FACE_COUNT = 20

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
