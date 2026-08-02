import { expect, test, type Page } from '@playwright/test'

/**
 * The roll dice picker, measured in a real browser.
 *
 * The builder assembles the roll; this dialog decides which physical dice fill
 * it, replacing the standing "Owned Dice" grid (PO decision (g), 2026-07-28).
 *
 * What is unit-tested elsewhere and deliberately NOT re-proved here: the slot
 * arithmetic (`src/lib/rollSources.test.ts`), the tile states and the
 * percentile copy (`src/components/panels/saved-rolls/RollBuilder.test.tsx`).
 *
 * What only a browser can show, and so lives here: that the SELECTED state is
 * really painted (jsdom computes no outline, so the "clear selected state" the
 * PO asked for is unfalsifiable there), that the dialog composes with the
 * saved-rolls sheet's own Escape/z-band without either dismissing the other,
 * that it is usable at 360x640, and that a pinned die actually reaches the
 * table through the live wasm room instead of being substituted by a basic.
 *
 * Manual run: `npm run test:e2e:roll-picker`
 */

const VIEWPORTS = [
  { label: '360x640', width: 360, height: 640 },
  { label: '1280x800', width: 1280, height: 800 },
] as const

/** A minimal owned d20, shaped like a persisted `InventoryDie`. */
function ownedD20(index: number) {
  return {
    id: `die_owned_d20_${index}`,
    type: 'd20',
    setId: 'adventurer-starter',
    rarity: 'rare',
    appearance: { baseColor: '#2563eb', accentColor: '#ffffff', material: 'plastic' },
    vfx: {},
    name: `Owned d20 #${index}`,
    isFavorite: false,
    isLocked: false,
    source: 'gacha_standard',
    assignedToRolls: [],
    acquiredAt: 1_700_000_000_000 + index,
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
  }
}

/**
 * Seed the inventory BEFORE the app boots. The default inventory is EMPTY —
 * basic dice are the floor — so a test about OWNED dice brings its own. Written
 * at the current persist version so the store hydrates it as-is.
 */
async function seedOwnedDice(page: Page, count: number) {
  const dice = Array.from({ length: count }, (_, i) => ownedD20(i + 1))
  await page.addInitScript((seeded) => {
    window.localStorage.clear()
    window.localStorage.setItem('dicesuki-player-inventory', JSON.stringify({
      state: {
        dice: seeded,
        localDice: seeded,
        assignments: {},
        localAssignments: {},
        serverCopiesActive: false,
        currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
      },
      version: 5,
    }))
  }, dice)
}

async function openBuilder(page: Page) {
  await page.goto('/')
  // Wait for the table's own reveal edge instead of hiding a cold 3D boot inside
  // a click timeout (issue #222). A generous timeout on an action is a guess at
  // how long booting takes; this is the boot reporting that it finished.
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-table-revealed',
    'true',
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: /Create New Roll/i }).click()
  await expect(page.getByLabel('Roll name')).toBeVisible()
}

/** Add a d20 entry of `count` dice and open its picker. */
async function openPickerForD20(page: Page, count: 1 | 4 = 1) {
  await page.getByRole('button', {
    name: count === 1 ? 'Add 1 D20 die' : `Add ${count} D20 dice`,
  }).click()
  await page.getByTestId('dice-entry-picker-trigger').click()
  const picker = page.getByTestId('roll-dice-picker')
  await expect(picker).toBeVisible()
  return picker
}

for (const viewport of VIEWPORTS) {
  test.describe(`roll dice picker at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('paints a pinned die as selected, by outline and by label', async ({ page }) => {
      test.setTimeout(180_000)
      await seedOwnedDice(page, 3)
      await openBuilder(page)

      const picker = await openPickerForD20(page, 4)
      await expect(picker.getByTestId('roll-dice-picker-summary')).toContainText('0 pinned, 4 auto')

      const tile = picker.getByRole('button', { name: 'Pin Owned d20 #3' })
      await expect(tile).toHaveAttribute('aria-pressed', 'false')
      await expect(tile).toHaveAttribute('data-pinned', 'false')

      // Unpinned tiles must not already look selected, or "selected" says nothing.
      const before = await tile.evaluate((el) => getComputedStyle(el).outlineWidth)
      expect(Number.parseFloat(before)).toBeLessThan(3)

      // Act
      await tile.click()

      // Assert — pressed state, a real painted outline, and a text badge, so the
      // selection survives both a screen reader and a greyscale render.
      const pinned = picker.getByRole('button', { name: 'Unpin Owned d20 #3' })
      await expect(pinned).toHaveAttribute('aria-pressed', 'true')
      await expect(pinned).toHaveAttribute('data-pinned', 'true')
      await expect(pinned).toContainText('Pinned')
      const after = await pinned.evaluate((el) => {
        const style = getComputedStyle(el)
        return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle }
      })
      expect(after.width).toBeGreaterThanOrEqual(3)
      expect(after.style).toBe('solid')

      await expect(picker.getByTestId('roll-dice-picker-summary')).toContainText('1 pinned, 3 auto')

      // The dialog must fit the viewport it is measured at — no horizontal scroll.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)

      await page.screenshot({
        path: `e2e/screenshots/roll-picker-selected-${viewport.label}.png`,
        fullPage: false,
      })
    })

    test('Escape closes only the picker, leaving the saved-rolls sheet open', async ({ page }) => {
      test.setTimeout(180_000)
      await seedOwnedDice(page, 2)
      await openBuilder(page)

      const picker = await openPickerForD20(page)
      await page.keyboard.press('Escape')

      // The picker goes; the sheet behind it stays. One Escape, one dialog.
      await expect(picker).toHaveCount(0)
      await expect(page.getByLabel('Roll name')).toBeVisible()
    })

    test('the dice pool shows accurate polyhedron icons, not placeholders', async ({ page }) => {
      test.setTimeout(180_000)
      await seedOwnedDice(page, 1)
      await openBuilder(page)

      // Every quick-dice tile draws an icon, and none of them is the old plain
      // circle (d20) or flat rect (d6) the redraw replaced.
      const pool = page.getByRole('heading', { name: 'Quick Dice' }).locator('..')
      await expect(pool.locator('svg')).toHaveCount(7)
      await expect(pool.locator('svg circle')).toHaveCount(0)
      await expect(pool.locator('svg rect')).toHaveCount(0)

      await page.screenshot({
        path: `e2e/screenshots/roll-picker-dice-icons-${viewport.label}.png`,
        fullPage: false,
      })
    })
  })
}

/**
 * The other consumer of the nested-dialog contract.
 *
 * `BottomSheet` yields Escape and its focus trap to any nested `aria-modal`
 * dialog, so a nested dialog that handles neither leaves Escape dead and lets
 * Tab walk out onto the HUD behind the sheet. jsdom cannot show this — it has
 * no native Tab navigation — so the browser proof lives here.
 */
test.describe('nested dialogs keep focus and Escape', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the hero inspector traps Tab and takes only its own Escape', async ({ page }) => {
    test.setTimeout(180_000)
    await seedOwnedDice(page, 3)

    await page.goto('/')
    // Reveal edge instead of a 90s click timeout standing in for the boot.
    await expect(page.getByTestId('solo-room')).toHaveAttribute(
      'data-table-revealed',
      'true',
      { timeout: 90_000 },
    )
    await page.getByRole('button', { name: 'Manage Dice' }).click()
    await page.getByRole('button', { name: /open full dice inventory/i }).click()
    await page.getByRole('button', { name: /Inspect Owned d20 #3/ }).click()

    const inspector = page.getByTestId('hero-die-inspector')
    await expect(inspector).toBeVisible()

    // Far more presses than the inspector has focusable controls: a trap that
    // leaks reaches the sheet or the HUD well before this finishes.
    for (let press = 0; press < 60; press += 1) {
      await page.keyboard.press('Tab')
      const inside = await inspector.evaluate((el) => el.contains(document.activeElement))
      expect(inside, `focus left the inspector on Tab #${press + 1}`).toBe(true)
    }

    // One Escape, one dialog: the inspector goes and the inventory sheet stays.
    await page.keyboard.press('Escape')
    await expect(inspector).toHaveCount(0)
    await expect(page.getByRole('dialog')).toBeVisible()

    // The second Escape is the sheet's.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('a pinned die reaches the table', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('rolls the pinned owned dice instead of substituting basics', async ({ page }) => {
    test.setTimeout(180_000)
    await seedOwnedDice(page, 2)

    await page.goto('/')
    const room = page.getByTestId('solo-room')
    await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 60_000 })
    // Reveal edge, then the (now instant) absence assertion — see issue #222.
    await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 60_000 })
    await expect(page.getByTestId('startup-splash')).toHaveCount(0)

    await page.getByRole('button', { name: 'My Dice Rolls' }).click()
    await page.getByRole('button', { name: /Create New Roll/i }).click()
    await page.getByLabel('Roll name').fill('Both pinned')

    // Arrange — a 2-die entry with BOTH slots pinned to real owned dice.
    const picker = await openPickerForD20(page, 4)
    const summary = picker.getByTestId('roll-dice-picker-summary')
    await expect(summary).toContainText('0 pinned, 4 auto')
    await picker.getByRole('button', { name: 'Pin Owned d20 #1' }).click()
    await expect(summary).toContainText('1 pinned, 3 auto')
    await picker.getByRole('button', { name: 'Pin Owned d20 #2' }).click()
    await expect(summary).toContainText('2 pinned, 2 auto')
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText('4d20 [2 specific]').first()).toBeVisible()

    // Trim to exactly the two pinned dice, so any basic on the table is a
    // substitution rather than auto fill.
    const quantity = page.getByRole('textbox', { name: /quantity$/ }).first()
    await quantity.click()
    await quantity.press('Control+a')
    await quantity.pressSequentially('2', { delay: 40 })
    await quantity.blur()
    await expect(page.getByText('2d20 [2 specific]').first()).toBeVisible()

    // Act
    await page.getByRole('button', { name: /Save Roll/i }).click()
    await page.getByRole('button', { name: 'Roll Both pinned' }).click()

    // Assert — two d20s land and NEITHER is a basic, so both pinned ids
    // resolved to the player's real dice.
    await expect(room).toHaveAttribute('data-room-dice-count', '2', { timeout: 60_000 })
    await expect(room).toHaveAttribute('data-room-dice-types', 'd20,d20')
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '0')
    await expect(page.getByText(/no longer in your collection/)).toHaveCount(0)

    await page.screenshot({
      path: 'e2e/screenshots/roll-picker-pinned-dice-on-table.png',
      fullPage: false,
    })
  })
})
