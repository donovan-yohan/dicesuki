import { expect, test, type Page } from '@playwright/test'

/**
 * Advanced roll mechanics, measured in a real browser against the live wasm room.
 *
 * The mechanics themselves are unit-tested deterministically in
 * `src/lib/savedRollPlan.test.ts` (scoring) and
 * `src/lib/savedRollExecution.test.ts` (wave orchestration, against a fake room
 * with scripted faces). What cannot be faked there — and so lives here — is
 * that the *real* engine actually spawns the extra dice, that the HUD shows
 * which of them were kept, and that the panel lays out at 360px.
 *
 * Face values from the wasm room are genuinely random, so assertions are on
 * relationships that hold for every outcome (the kept d20 is the higher of the
 * two; the total equals the kept face) rather than on fixed numbers. Exploding
 * cannot be forced to trigger, so its browser coverage is the builder contract
 * plus a completed roll — the chain arithmetic is unit-tested.
 *
 * Manual run: `npm run test:e2e:roll-advanced`
 */

const VIEWPORTS = [
  { label: '360x640', width: 360, height: 640, desktop: false },
  { label: '1280x800', width: 1280, height: 800, desktop: true },
] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

async function openBuilder(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'My Dice Rolls' }).click({ timeout: 60_000 })
  await page.getByRole('button', { name: /Create New Roll/i }).click()
  await expect(page.getByLabel('Roll name')).toBeVisible()
}

/** Add one die of `type` and open its Advanced Options panel. */
async function addEntryWithAdvancedOpen(page: Page, type: 'D4' | 'D6' | 'D20') {
  await page.getByRole('button', { name: `Add 1 ${type} die` }).click()
  await page.getByRole('button', { name: /Advanced Options/ }).click()
  await expect(page.getByRole('button', { name: `Apply Advantage to ${type}` })).toBeVisible()
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1)
}

for (const viewport of VIEWPORTS) {
  test.describe(`advanced options at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('exposes every mechanic and keeps the formula honest', async ({ page }) => {
      test.setTimeout(180_000)
      await openBuilder(page)
      await page.getByLabel('Roll name').fill('Advanced mechanics')
      await addEntryWithAdvancedOpen(page, 'D6')

      // ── The "coming soon" placeholder is gone ───────────────────────────
      await expect(page.getByText(/Advanced mechanics coming soon/i)).toHaveCount(0)

      // ── Keep / drop ─────────────────────────────────────────────────────
      const rolled = page.getByRole('textbox', { name: 'D6 quantity', exact: true })
      await rolled.fill('4')
      await rolled.blur()
      await page.getByLabel('Keep only some D6 dice').check()
      await page.getByLabel('D6 dice to keep').fill('2')
      await expect(page.getByText('Roll 4, keep best 2')).toBeVisible()
      await expect(page.getByText('4d6 kh2').first()).toBeVisible()
      await expect(page.getByText('⬆️ ADV').first()).toBeVisible()

      await page.getByLabel('D6 keep mode').selectOption('lowest')
      await expect(page.getByText('4d6 kl2').first()).toBeVisible()
      await expect(page.getByText('⬇️ DIS').first()).toBeVisible()

      // ── Exploding, with its caps stated in the UI ───────────────────────
      await page.getByLabel('Exploding D6 dice').check()
      await expect(page.getByText('4d6! kl2').first()).toBeVisible()
      await expect(page.getByText(/up to 3 extra waves/i)).toBeVisible()
      await expect(page.getByText(/only while the table has room/i)).toBeVisible()
      // An open-ended top end is marked, not promised as a ceiling
      await expect(page.getByText(/^Range: .*\+$/)).toBeVisible()

      await page.getByLabel('D6 explodes on').fill('5')
      await expect(page.getByText('4d6!5 kl2').first()).toBeVisible()
      await page.getByLabel('D6 explodes on').fill('6')

      // ── Reroll ──────────────────────────────────────────────────────────
      await page.getByLabel('Reroll low D6 dice').check()
      await page.getByLabel('D6 reroll at or below').fill('2')
      await expect(page.getByText('4d6! kl2 r≤2').first()).toBeVisible()
      await expect(page.getByText('⚔️ GWF').first()).toBeVisible()

      // ── Success counting ────────────────────────────────────────────────
      await page.getByLabel('Count D6 successes').check()
      await page.getByLabel('D6 success on or above').fill('5')
      await expect(page.getByText('4d6! kl2 r≤2 ≥5').first()).toBeVisible()
      await expect(page.getByText('✓5+').first()).toBeVisible()
      await page.getByLabel('Count D6 successes').uncheck()

      // ── Min / max clamps ────────────────────────────────────────────────
      await page.getByLabel('D6 minimum value').fill('2')
      await expect(page.getByText('🎯 Limits').first()).toBeVisible()
      // Clamps are a badge, not notation
      await expect(page.getByText('4d6! kl2 r≤2').first()).toBeVisible()

      // ── Layout holds at this width ──────────────────────────────────────
      await expectNoSidewaysScroll(page)
      const panelWidth = await page
        .getByLabel('Keep only some D6 dice')
        .evaluate((el) => el.closest('div')!.getBoundingClientRect().width)
      expect(panelWidth).toBeGreaterThan(0)
      expect(panelWidth).toBeLessThanOrEqual(viewport.width)

      await expect(page.getByRole('button', { name: /Save Roll/i })).toBeEnabled()
    })

    test('applies the quick presets', async ({ page }) => {
      test.setTimeout(180_000)
      await openBuilder(page)
      await page.getByLabel('Roll name').fill('Presets')
      await addEntryWithAdvancedOpen(page, 'D20')

      // Advantage — roll 2, keep best 1
      await page.getByRole('button', { name: 'Apply Advantage to D20' }).click()
      await expect(page.getByText('2d20 kh1').first()).toBeVisible()
      await expect(page.getByText('Roll 2, keep best 1')).toBeVisible()

      // Disadvantage — same shape, other end
      await page.getByRole('button', { name: 'Apply Disadvantage to D20' }).click()
      await expect(page.getByText('2d20 kl1').first()).toBeVisible()

      // Elven Accuracy — roll 3, keep best 1
      await page.getByRole('button', { name: 'Apply Elven Accuracy to D20' }).click()
      await expect(page.getByText('3d20 kh1').first()).toBeVisible()

      // Halfling Luck rerolls 1s without touching the rolled count
      await page.getByRole('button', { name: 'Apply Halfling Luck to D20' }).click()
      await expect(page.getByText('3d20 kh1 r=1').first()).toBeVisible()
      await expect(page.getByText('🍀 LUCK').first()).toBeVisible()

      await expectNoSidewaysScroll(page)
    })
  })
}

test.describe('physical execution at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('rolls advantage as two real dice and scores only the kept one', async ({ page }) => {
    test.setTimeout(240_000)
    await openBuilder(page)
    await page.getByLabel('Roll name').fill('Advantage attack')
    await addEntryWithAdvancedOpen(page, 'D20')

    // Arrange — 2d20 keep highest 1
    await page.getByRole('button', { name: 'Apply Advantage to D20' }).click()
    await expect(page.getByText('2d20 kh1').first()).toBeVisible()
    await page.getByRole('button', { name: /Save Roll/i }).click()

    // Act — execute it in the live wasm room
    await page.getByRole('button', { name: 'Roll Advantage attack' }).click()

    // Assert — the panel closes and both dice physically land
    await expect(page.getByRole('button', { name: 'Roll Advantage attack' })).toHaveCount(0)
    const chips = page.getByTestId('result-die-chip')
    await expect(chips).toHaveCount(2, { timeout: 60_000 })
    await expect(page.getByTestId('roll-grand-total')).not.toHaveText('?', { timeout: 60_000 })

    // Exactly one die is kept and one is dropped
    const kept = page.getByTestId('result-die-chip').and(page.locator('[data-dropped="false"]'))
    const dropped = page.getByTestId('result-die-chip').and(page.locator('[data-dropped="true"]'))
    await expect(kept).toHaveCount(1)
    await expect(dropped).toHaveCount(1)
    await expect(page.getByTestId('roll-dropped-hint')).toHaveText('1 dropped')

    // The kept die is the higher roll, and it alone is the total
    const keptValue = Number(await kept.locator('span').last().innerText())
    const droppedValue = Number(await dropped.locator('span').last().innerText())
    const total = Number(await page.getByTestId('roll-grand-total').innerText())

    expect(Number.isFinite(keptValue)).toBe(true)
    expect(Number.isFinite(droppedValue)).toBe(true)
    expect(keptValue).toBeGreaterThanOrEqual(droppedValue)
    expect(total).toBe(keptValue)

    // A dropped die is visibly struck out, not silently missing
    await expect(dropped.locator('.line-through')).toHaveCount(1)
  })

  test('completes an exploding roll without stranding the table', async ({ page }) => {
    test.setTimeout(240_000)
    await openBuilder(page)
    await page.getByLabel('Roll name').fill('Exploding burst')
    await addEntryWithAdvancedOpen(page, 'D4')

    // Arrange — 3d4!, which triggers often enough to exercise the wave path
    const rolled = page.getByRole('textbox', { name: 'D4 quantity', exact: true })
    await rolled.fill('3')
    await rolled.blur()
    await page.getByLabel('Exploding D4 dice').check()
    await expect(page.getByText('3d4!').first()).toBeVisible()
    await page.getByRole('button', { name: /Save Roll/i }).click()

    // Act
    await page.getByRole('button', { name: 'Roll Exploding burst' }).click()

    // Assert — the roll resolves; explosions may or may not have fired, but the
    // table always comes to rest with at least the three base dice and a total.
    await expect(page.getByRole('button', { name: 'Roll Exploding burst' })).toHaveCount(0)
    const chips = page.getByTestId('result-die-chip')
    await expect(async () => {
      expect(await chips.count()).toBeGreaterThanOrEqual(3)
    }).toPass({ timeout: 60_000 })
    await expect(page.getByTestId('roll-grand-total')).not.toHaveText('?', { timeout: 60_000 })

    // Every die that landed is counted — exploding never drops dice
    await expect(page.locator('[data-dropped="true"]')).toHaveCount(0)

    const total = Number(await page.getByTestId('roll-grand-total').innerText())
    const faces = await chips.evaluateAll((nodes) => nodes.map((node) => (
      Number(node.querySelectorAll('span')[1]?.textContent ?? '0')
    )))
    expect(total).toBe(faces.reduce((sum, face) => sum + face, 0))
  })
})
