import { expect, test } from '@playwright/test'

const PREVIEW_CASES = [
  {
    set: 'fantasy-set',
    dice: 'aurelian-imagegen-d20',
    faceValue: 20,
  },
  { set: 'cozy-forest-imagegen-set', dice: 'mossheart-d4', faceValue: 4 },
  { set: 'cozy-forest-imagegen-set', dice: 'hearthwood-d6', faceValue: 6 },
  { set: 'cozy-forest-imagegen-set', dice: 'fernlight-d8', faceValue: 8 },
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
  { set: 'cozy-forest-imagegen-set', dice: 'grovekeeper-d12', faceValue: 12 },
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
    test(`${previewCase.set}/${previewCase.dice} face ${previewCase.faceValue} matches GLB geometry and UVs`, async ({ page }) => {
      await page.goto(`/test/production-dice-preview?set=${previewCase.set}&dice=${previewCase.dice}&faceValue=${previewCase.faceValue}`)
      await page.waitForSelector('[data-testid="production-dice-preview"]')
      await page.waitForSelector('canvas')

      await expect(page.locator('[data-testid="validation-status"]')).toHaveText('validated')
      await expect(page.locator('[data-testid="requested-value"]')).toHaveText(String(previewCase.faceValue))
      await expect(page.locator('[data-testid="model-face-value"]')).toHaveText(String(previewCase.faceValue))
      await expect(page.locator('[data-testid="model-face-uv-triangles"]')).not.toHaveText('0')
      await expect(page.locator('[data-testid="canonical-material-index"]')).not.toHaveText('validating')
      await expect(page.locator('[data-testid="canonical-uv-status"]')).toHaveText('matched')
    })
  }

  test('fails closed when the requested face is absent', async ({ page }) => {
    await page.goto('/test/production-dice-preview?set=cozy-forest-imagegen-set&dice=acorn-compass-d10&faceValue=99')

    await expect(page.locator('[data-testid="production-dice-preview-error"]'))
      .toContainText('Requested face 99 is missing')
    await expect(page.locator('canvas')).toHaveCount(0)
  })
})
