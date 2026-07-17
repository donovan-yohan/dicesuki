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
const runtimeSets = [
  {
    setId: 'cozy-forest-imagegen-set',
    label: 'Cozy Forest',
    artifactDirectory: 'cozy-forest-runtime',
  },
  {
    setId: 'cyberpunk-imagegen-set',
    label: 'Cyberpunk',
    artifactDirectory: 'cyberpunk-runtime',
  },
] as const

for (const runtimeSet of runtimeSets) {
  test(`inventory stays thumbnail-only and each ${runtimeSet.label} GLB loads on table demand`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const assets = catalog.assetVersions.filter(asset => (
      asset.catalogItemId.startsWith(`${runtimeSet.setId}/`)
    ))
    expect(assets).toHaveLength(6)
    await runRuntimeSetProof(page, runtimeSet, assets)
  })
}

async function runRuntimeSetProof(
  page: Page,
  runtimeSet: typeof runtimeSets[number],
  assets: CatalogAsset[],
) {
  await seedRuntimeInventory(page, runtimeSet.setId, assets)

  const modelRequests: string[] = []
  const thumbnailRequests: string[] = []
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (
      pathname.endsWith('/model.glb') &&
      runtimeSets.some(candidate => pathname.startsWith(`/dice/${candidate.setId}/`))
    ) {
      modelRequests.push(pathname)
    }
    if (
      pathname.startsWith(`/dice/${runtimeSet.setId}/`) &&
      pathname.endsWith('/thumbnail.png')
    ) {
      thumbnailRequests.push(pathname)
    }
  })

  const requestedModelPaths = () => [...new Set(modelRequests)].sort()
  const expectedSetModelPaths = assets.map(asset => asset.modelPath).sort()

  await page.goto('/?lodTier=high')
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-connection-status',
    'connected',
    { timeout: 30_000 },
  )

  await page.getByRole('button', { name: 'Manage Dice' }).click()
  await page.getByRole('button', { name: 'Open full dice inventory' }).click()
  await expect(page.getByRole('heading', { name: 'Dice Collection' }).first()).toBeVisible()
  await page.getByLabel('Filter by set').selectOption(runtimeSet.setId)
  await expect(page.getByTestId('dice-thumbnail')).toHaveCount(6)
  await expect.poll(() => new Set(thumbnailRequests).size).toBe(6)
  await page.waitForTimeout(1_500)
  expect(requestedModelPaths()).toEqual([])

  const artifactRoot = path.resolve(
    process.cwd(),
    '.artifacts',
    runtimeSet.artifactDirectory,
  )
  fs.mkdirSync(artifactRoot, { recursive: true })
  await page.screenshot({
    path: path.join(artifactRoot, 'inventory-desktop.png'),
    fullPage: true,
  })

  await addRuntimeSetToTable(page, assets)
  await expect.poll(requestedModelPaths, { timeout: 30_000 }).toEqual(expectedSetModelPaths)

  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('heading', { name: 'Dice Collection' })).toHaveCount(0)
  await page.waitForTimeout(1_500)
  await page.screenshot({
    path: path.join(artifactRoot, 'table-desktop.png'),
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
  await page.getByLabel('Filter by set').selectOption(runtimeSet.setId)
  await expect(page.getByTestId('dice-thumbnail')).toHaveCount(6)
  await page.getByTestId('dice-thumbnail').first().scrollIntoViewIfNeeded()
  await page.screenshot({
    path: path.join(artifactRoot, 'inventory-mobile-mid.png'),
    fullPage: true,
  })
  expect(requestedModelPaths()).toEqual(expectedSetModelPaths)

  await addRuntimeSetToTable(page, assets)
  await expect.poll(requestedModelPaths, { timeout: 30_000 }).toEqual(expectedSetModelPaths)
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('heading', { name: 'Dice Collection' })).toHaveCount(0)
  await page.waitForTimeout(1_500)
  await page.screenshot({
    path: path.join(artifactRoot, 'table-mobile-mid.png'),
    fullPage: true,
  })
}

async function addRuntimeSetToTable(page: Page, assets: CatalogAsset[]) {
  const placedButtons = page.getByRole('button', { name: / is on the table$/ })
  const preplacedAssets: CatalogAsset[] = []

  for (const asset of assets) {
    const addCount = await page.getByRole('button', {
      name: `Add ${asset.metadata.name} to table`,
      exact: true,
    }).count()
    const placedCount = await page.getByRole('button', {
      name: `${asset.metadata.name} is on the table`,
      exact: true,
    }).count()
    expect(addCount + placedCount).toBe(1)
    if (placedCount === 1) preplacedAssets.push(asset)
  }

  expect(preplacedAssets.length).toBeLessThanOrEqual(1)
  expect(preplacedAssets.every(asset => asset.metadata.diceMetadata.diceType === 'd20')).toBe(true)
  await expect(placedButtons).toHaveCount(preplacedAssets.length)

  let placedCount = preplacedAssets.length
  for (const asset of assets.filter(candidate => !preplacedAssets.includes(candidate))) {
    const addButton = page.getByRole('button', {
      name: `Add ${asset.metadata.name} to table`,
      exact: true,
    })
    const placedButton = page.getByRole('button', {
      name: `${asset.metadata.name} is on the table`,
      exact: true,
    })
    await expect(addButton).toHaveCount(1)
    await expect(placedButton).toHaveCount(0)
    await addButton.click()
    placedCount += 1
    await expect(placedButton).toHaveCount(1)
    await expect(placedButtons).toHaveCount(placedCount)
  }
  await expect(placedButtons).toHaveCount(6)
}

async function seedRuntimeInventory(page: Page, setId: string, assets: CatalogAsset[]) {
  const dice = assets.map((asset, index) => ({
    id: `${setId}-runtime-${index}`,
    type: asset.metadata.diceMetadata.diceType,
    setId,
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
