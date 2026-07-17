import { expect, test } from '@playwright/test'

const PREVIEW_CASES = [
  {
    set: 'fantasy-set',
    dice: 'aurelian-imagegen-d20',
    faceValue: 20,
  },
  {
    set: 'fantasy-set',
    dice: 'emerald-d20',
    faceValue: 20,
  },
  {
    set: 'dungeon-set',
    dice: 'iron-d6',
    faceValue: 6,
  },
  {
    set: 'cozy-forest-imagegen-set',
    dice: 'acorn-compass-d10',
    faceValue: 9,
  },
  {
    set: 'cozy-forest-imagegen-set',
    dice: 'elder-canopy-d20',
    faceValue: 20,
  },
  {
    set: 'dark-dungeon-imagegen-set',
    dice: 'gaoler-key-d10',
    faceValue: 9,
  },
  {
    set: 'dark-dungeon-imagegen-set',
    dice: 'dread-gate-d20',
    faceValue: 20,
  },
  ...[2, 6, 12, 17].map((faceValue) => ({
    set: 'dark-dungeon-imagegen-set',
    dice: 'dread-gate-d20',
    faceValue,
  })),
  {
    set: 'cyberpunk-imagegen-set',
    dice: 'cipher-core-d10',
    faceValue: 9,
  },
  {
    set: 'cyberpunk-imagegen-set',
    dice: 'overdrive-d20',
    faceValue: 20,
  },
]

test.describe('production dice preview fixtures', () => {
  for (const previewCase of PREVIEW_CASES) {
    test(`${previewCase.set}/${previewCase.dice} face ${previewCase.faceValue} matches face reader`, async ({ page }) => {
      await page.goto(`/test/production-dice-preview?set=${previewCase.set}&dice=${previewCase.dice}&faceValue=${previewCase.faceValue}`)
      await page.waitForSelector('[data-testid="production-dice-preview"]')
      await page.waitForSelector('canvas')

      await expect(page.locator('[data-testid="expected-value"]')).toHaveText(String(previewCase.faceValue))
      await expect(page.locator('[data-testid="reported-value"]')).toHaveText(String(previewCase.faceValue))
    })
  }
})
