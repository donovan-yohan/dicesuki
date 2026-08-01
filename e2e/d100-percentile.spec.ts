import { expect, test } from '@playwright/test'

/**
 * d100 percentile end-to-end (slice S5).
 *
 * Builds a percentile roll in the real builder, executes it against the live
 * in-browser wasm room, and proves that the tens+ones PAIR settles and reads as
 * one combined 1-100 result. Also guards the d10 regression: a plain d10 entry
 * must still spawn one die and read 0-9.
 *
 * Manual run: `npm run test:e2e:d100`
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

test('rolls a d100 as a tens+ones pair and reports one 1-100 result', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })

  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: /create new roll/i }).click()
  await page.getByLabel('Roll name').fill('Percentile check')
  await page.getByRole('button', { name: 'Add 1 D100 roll' }).click()

  // The builder reads the pair as a single d100 with a 1-100 range.
  await expect(page.getByText('1d100', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Range: 1 - 100')).toBeVisible()

  await page.getByRole('button', { name: 'Save Roll' }).click()
  await page.getByRole('button', { name: 'Roll Percentile check' }).click()

  // Exactly two physical dice hit the table: the tens die and the ones d10.
  await expect(room).toHaveAttribute('data-room-dice-count', '2')
  await expect(room).toHaveAttribute('data-room-dice-types', 'd10,d10tens')
  await expect(room).toHaveAttribute('data-roll-started-sequence', '1')

  // Both settle, and the HUD collapses them into ONE combined D100 chip.
  // (DiceChip renders the label as `<span title="...">`; matching on the text
  // alone would also match a D10 chip's container, whose text is "D10" + "0".)
  const chip = page.locator('span[title="D100"]')
  await expect(chip).toBeVisible({ timeout: 30_000 })

  // DiceChip renders <span>LABEL</span> then <div>value</div>.
  const combined = await chip.locator('xpath=following-sibling::div[1]').textContent()
  const value = Number(combined)
  expect(Number.isInteger(value)).toBe(true)
  expect(value).toBeGreaterThanOrEqual(1)
  expect(value).toBeLessThanOrEqual(100)

  await page.screenshot({ path: 'e2e/screenshots/d100-percentile-result.png', fullPage: true })

  // History records the same combined value, not two loose halves.
  await page.getByRole('button', { name: 'Roll History' }).click()
  // The history rows collapse the pair into a D100 row whose sub-label spells it
  // out as `<tens padded> + <ones>` (the HUD chip keeps its own D100 label).
  const historyRow = page.getByText(/^\d{2} \+ \d$/).first()
  await expect(historyRow).toBeVisible()
  // Exactly two D100 labels: the HUD chip plus the ONE history row. `roll_complete`
  // is the single history writer for an ordinary roll, so a roll is recorded once.
  await expect(page.getByText('D100', { exact: true })).toHaveCount(2)
  await expect(page.getByText(/^\d{2} \+ \d$/)).toHaveCount(1)
  await expect(page.getByText(String(value), { exact: true }).first()).toBeVisible()

  await page.screenshot({ path: 'e2e/screenshots/d100-percentile-history.png', fullPage: true })
})

test('keeps the pair combined after a table edit clears the saved-roll context', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })

  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: /create new roll/i }).click()
  await page.getByLabel('Roll name').fill('Percentile edit')
  await page.getByRole('button', { name: 'Add 1 D100 roll' }).click()
  await page.getByRole('button', { name: 'Save Roll' }).click()
  await page.getByRole('button', { name: 'Roll Percentile edit' }).click()

  await expect(room).toHaveAttribute('data-room-dice-count', '2')
  const chip = page.locator('span[title="D100"]')
  await expect(chip).toBeVisible({ timeout: 30_000 })
  const before = Number(await chip.locator('xpath=following-sibling::div[1]').textContent())

  // Adding a die from the toolbar deliberately clears `activeSavedRoll`. The
  // pairing lives on the dice's presentation, so the pair must STILL read as one
  // D100 — this is the regression that motivated moving it off roll state. Under
  // the old model the HUD degraded here to two raw halves (and 00+0 read 0).
  await page.getByRole('button', { name: 'Manage Dice' }).click()
  await page.getByTestId('dice-quick-slot-d6').click()
  await expect(room).toHaveAttribute('data-room-dice-count', '3')

  // The saved-roll context is gone (its name no longer labels the result)...
  await expect(page.getByText('PERCENTILE EDIT')).toHaveCount(0)
  // ...but the percentile pair is still one combined chip with the same value.
  await expect(page.locator('span[title="D100"]')).toHaveCount(1)
  await expect(page.locator('span[title="D100"]').locator('xpath=following-sibling::div[1]'))
    .toHaveText(String(before))
  // The engine-only shape must never surface raw.
  await expect(page.getByText('D10TENS')).toHaveCount(0)

  await page.screenshot({ path: 'e2e/screenshots/d100-table-edit.png', fullPage: true })
})

test('leaves an ordinary d10 roll unchanged (0-9, one die, no pairing)', async ({ page }) => {
  test.setTimeout(90_000)

  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 30_000 })

  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: /create new roll/i }).click()
  await page.getByLabel('Roll name').fill('Plain d10')
  await page.getByRole('button', { name: 'Add 1 D10 die' }).click()
  await expect(page.getByText('1d10', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Range: 1 - 10')).toBeVisible()

  await page.getByRole('button', { name: 'Save Roll' }).click()
  await page.getByRole('button', { name: 'Roll Plain d10' }).click()

  await expect(room).toHaveAttribute('data-room-dice-count', '1')
  await expect(room).toHaveAttribute('data-room-dice-types', 'd10')
  await expect(page.locator('span[title="D100"]')).toHaveCount(0)

  // A basic die reads as its bare shape in a result chip, so this stays "D10" —
  // the point of the assertion is that it is ONE ordinary d10 chip, not half of
  // a pair.
  const chip = page.locator('span[title="D10"]')
  await expect(chip).toBeVisible({ timeout: 30_000 })
  const face = await chip.locator('xpath=following-sibling::div[1]').textContent()
  const value = Number(face)
  expect(Number.isInteger(value)).toBe(true)
  expect(value).toBeGreaterThanOrEqual(0)
  expect(value).toBeLessThanOrEqual(9)

  await page.screenshot({ path: 'e2e/screenshots/d100-d10-regression.png', fullPage: true })
})
