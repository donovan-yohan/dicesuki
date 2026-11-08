import { expect, test } from '@playwright/test'

const STORAGE_KEY = 'dicesuki-solo-table:v1:guest'

/** Reload runs the native worker spawn path. No room state or face values are injected. */
test('restores mixed-theme solo dice and remembers a deliberately empty table', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('solo-loadout-fixture')) return
    localStorage.clear()
    localStorage.setItem('dicesuki-settings', JSON.stringify({ version: 1, state: { themeId: 'monster-dungeon' } }))
    sessionStorage.setItem('solo-loadout-fixture', 'initialized')
  })
  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-room-dice-count', '1')
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByTestId('dice-quick-slot-d6').click()
  await expect(room).toHaveAttribute('data-room-dice-count', '2')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: /Change Theme/ }).click()
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: /Cyberpunk/ }) }).click()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Close panel', exact: true })).toHaveCount(0)
  await page.getByTestId('dice-quick-slot-d8').click()
  await expect(room).toHaveAttribute('data-room-dice-count', '3')
  const saved = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
  expect(JSON.parse(saved!).dice.map((die: { shape: string; presentation: { customAssetId: string } }) => [die.shape, die.presentation.customAssetId])).toEqual([
    ['d20', 'monster-dungeon-set/d20'], ['d6', 'monster-dungeon-set/d6'], ['d8', 'cyberpunk-cutline-set/d8'],
  ])
  await page.reload()
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-room-dice-count', '3')
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(saved)
  // Restoring a loadout does not invent settled results or replay a saved recipe.
  await expect(page.getByTestId('roll-grand-total')).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage Dice', exact: true }).click()
  await page.getByRole('button', { name: 'Clear all dice', exact: true }).click()
  await expect(room).toHaveAttribute('data-room-dice-count', '0')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dice, STORAGE_KEY)).toEqual([])
  await page.reload()
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 30_000 })
  await expect(room).toHaveAttribute('data-room-dice-count', '0')
})
