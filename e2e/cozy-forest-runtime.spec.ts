import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

interface CatalogAsset {
  id: string
  catalogItemId: string
  modelPath: string
  metadata: {
    name: string
    description?: string
    appearance: Record<string, unknown>
    vfx: Record<string, unknown>
    diceMetadata: Record<string, unknown> & { diceType: string; rarity?: string; tags?: string[] }
    delivery: { thumbnailPath: string }
  }
}

const catalog = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), 'src/generated/collectibleCatalog.json'),
  'utf8',
)) as { assetVersions: CatalogAsset[] }
const cozyAssets = catalog.assetVersions.filter(asset => (
  asset.catalogItemId.startsWith('cozy-forest-imagegen-set/')
))

test('inventory stays thumbnail-only and each Cozy Forest GLB loads on table demand', async ({
  page,
}) => {
  test.setTimeout(90_000)
  expect(cozyAssets).toHaveLength(6)
  await seedCozyInventory(page)

  const modelRequests: string[] = []
  const thumbnailRequests: string[] = []
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (!pathname.startsWith('/dice/cozy-forest-imagegen-set/')) return
    if (pathname.endsWith('/model.glb')) modelRequests.push(pathname)
    if (pathname.endsWith('/thumbnail.png')) thumbnailRequests.push(pathname)
  })

  await page.goto('/?lodTier=high')
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-connection-status',
    'connected',
    { timeout: 30_000 },
  )

  // Solo may place one inventory D20 on startup. That is table demand, never a
  // catalog-wide preload.
  await page.waitForTimeout(1_500)
  await expect.poll(() => new Set(modelRequests).size).toBeLessThanOrEqual(1)
  const modelsBeforeInventory = new Set(modelRequests).size

  await page.getByRole('button', { name: 'Manage Dice' }).click()
  await page.getByRole('button', { name: 'Open full dice inventory' }).click()
  await expect(page.getByRole('heading', { name: 'Dice Collection' }).first()).toBeVisible()
  await page.getByLabel('Filter by set').selectOption('cozy-forest-imagegen-set')
  await expect(page.getByTestId('dice-thumbnail')).toHaveCount(6)
  await expect.poll(() => new Set(thumbnailRequests).size).toBe(6)
  await expect.poll(() => new Set(modelRequests).size).toBe(modelsBeforeInventory)

  fs.mkdirSync(path.resolve(process.cwd(), '.artifacts/cozy-forest-runtime'), { recursive: true })
  await page.screenshot({
    path: path.resolve(process.cwd(), '.artifacts/cozy-forest-runtime/inventory-desktop.png'),
    fullPage: true,
  })

  for (const asset of cozyAssets) {
    const addButton = page.getByRole('button', { name: `Add ${asset.metadata.name} to table` })
    if (await addButton.count()) await addButton.click()
  }
  await expect.poll(() => new Set(modelRequests).size, { timeout: 30_000 }).toBe(6)

  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('heading', { name: 'Dice Collection' })).toHaveCount(0)
  await page.waitForTimeout(1_500)
  await page.screenshot({
    path: path.resolve(process.cwd(), '.artifacts/cozy-forest-runtime/table-desktop.png'),
    fullPage: true,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?lodTier=mid')
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-connection-status',
    'connected',
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: 'Manage Dice' }).click()
  await page.getByRole('button', { name: 'Open full dice inventory' }).click()
  await page.getByLabel('Filter by set').selectOption('cozy-forest-imagegen-set')
  await expect(page.getByTestId('dice-thumbnail')).toHaveCount(6)
  await page.getByTestId('dice-thumbnail').first().scrollIntoViewIfNeeded()
  await page.screenshot({
    path: path.resolve(process.cwd(), '.artifacts/cozy-forest-runtime/inventory-mobile-mid.png'),
    fullPage: true,
  })
})

async function seedCozyInventory(page: Page) {
  const dice = cozyAssets.map((asset, index) => ({
    id: `cozy-runtime-${index}`,
    type: asset.metadata.diceMetadata.diceType,
    setId: 'cozy-forest-imagegen-set',
    rarity: asset.metadata.diceMetadata.rarity ?? 'common',
    appearance: asset.metadata.appearance,
    vfx: asset.metadata.vfx,
    name: asset.metadata.name,
    description: asset.metadata.description,
    tags: asset.metadata.diceMetadata.tags ?? [],
    isFavorite: false,
    isLocked: false,
    acquiredAt: 1_750_000_000_000 + index,
    source: 'starter',
    catalogRef: {
      itemId: asset.catalogItemId,
      assetVersionId: asset.id,
    },
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    assignedToRolls: [],
    customAsset: {
      modelUrl: asset.modelPath,
      thumbnailUrl: asset.metadata.delivery.thumbnailPath,
      assetId: asset.catalogItemId.replace(/@1$/, ''),
      storage: 'bundled',
      metadata: asset.metadata.diceMetadata,
    },
  }))
  await page.addInitScript(inventoryDice => {
    window.localStorage.clear()
    window.localStorage.setItem('dicesuki-player-inventory', JSON.stringify({
      state: {
        dice: inventoryDice,
        currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
        assignments: {},
      },
      version: 3,
    }))
  }, dice)
}
