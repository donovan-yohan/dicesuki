import { expect, test, type Page } from '@playwright/test'

/**
 * Roll builder behaviour and geometry, measured in a real browser.
 *
 * jsdom has no layout engine and no real focus/paint, so the assertions that
 * depend on either live here: the two-column desktop split with its sticky
 * summary column, the centred desktop sheet, the mobile single-column stack,
 * and that the roll name/description actually render field chrome and a focus
 * ring (they previously referenced undefined CSS variables and rendered no
 * border at all). The notation, capacity and validation checks are repeated
 * against the real DOM because they are the slice's user-visible contract.
 *
 * Manual run: `npm run test:e2e:roll-builder`
 */

const VIEWPORTS = [
  { label: '360x640', width: 360, height: 640, desktop: false },
  { label: '390x844', width: 390, height: 844, desktop: false },
  { label: '1280x800', width: 1280, height: 800, desktop: true },
] as const

/** max-w-5xl, the desktop cap applied to the saved-rolls sheet. */
const DESKTOP_SHEET_MAX_WIDTH = 1024

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

async function openBuilder(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'My Dice Rolls' }).click({ timeout: 60_000 })
  await page.getByRole('button', { name: /Create New Roll/i }).click()
  await expect(page.getByLabel('Roll name')).toBeVisible()
}

/** Scroll the builder's own scroll container to a known offset. */
function scrollBuilder(page: Page, top: number) {
  return page.getByTestId('roll-builder-compose-column').evaluate((el, y) => {
    let parent = el.parentElement
    while (parent && parent.scrollHeight <= parent.clientHeight) parent = parent.parentElement
    if (parent) parent.scrollTop = y
    return parent ? parent.scrollTop : -1
  }, top)
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('builds a roll with real fields, free counts and a hard dice cap', async ({ page }) => {
      test.setTimeout(180_000)
      await openBuilder(page)

      // ── The name/description fields render as fields ────────────────────
      const nameField = page.getByLabel('Roll name')
      const chrome = await nameField.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          borderWidth: parseFloat(style.borderTopWidth),
          borderStyle: style.borderTopStyle,
          background: style.backgroundColor,
        }
      })
      expect(chrome.borderStyle).toBe('solid')
      expect(chrome.borderWidth).toBeGreaterThan(0)
      expect(chrome.background).not.toBe('rgba(0, 0, 0, 0)')

      const descriptionField = page.getByLabel('Description')
      expect(await descriptionField.evaluate((el) => el.tagName)).toBe('TEXTAREA')

      // Focus produces a visible ring
      await nameField.focus()
      const ring = await nameField.evaluate((el) => {
        const style = getComputedStyle(el)
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }
      })
      expect(ring.style).toBe('solid')
      expect(ring.width).toBeGreaterThanOrEqual(2)

      // ── Inline validation replaces alert() ──────────────────────────────
      let alerted = false
      page.on('dialog', async (dialog) => { alerted = true; await dialog.dismiss() })
      await nameField.blur()
      await expect(page.getByText('Roll name is required')).toBeVisible()
      await expect(nameField).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(/Add at least one die/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /Save Roll/i })).toBeDisabled()

      await nameField.fill('Verification roll')

      // ── Free dice count, committed on blur ──────────────────────────────
      await page.getByRole('button', { name: 'Add 1 D4 die' }).click()
      const quantity = page.getByRole('textbox', { name: 'D4 quantity', exact: true })
      await quantity.fill('5')
      await quantity.blur()
      await expect(page.getByText('5d4').first()).toBeVisible()

      // The superseded discrete quantity buttons are gone
      await expect(page.getByRole('button', { name: 'Set D4 quantity to 8' })).toHaveCount(0)

      // ── Notation: count outside, die inside the parens ──────────────────
      await quantity.fill('4')
      await quantity.blur()
      const bonus = page.getByRole('spinbutton', { name: 'D4 bonus per die', exact: true })
      await bonus.fill('1')
      await expect(page.getByText('4(d4+1)').first()).toBeVisible()
      await bonus.fill('-1')
      await expect(page.getByText('4(d4-1)').first()).toBeVisible()
      await bonus.fill('0')
      await expect(page.getByText('4d4').first()).toBeVisible()

      // ── Layout ──────────────────────────────────────────────────────────
      await scrollBuilder(page, 0)
      const compose = (await page.getByTestId('roll-builder-compose-column').boundingBox())!
      const summary = (await page.getByTestId('roll-builder-summary-column').boundingBox())!
      const sheet = (await page.getByRole('dialog').boundingBox())!

      if (viewport.desktop) {
        // Two columns, side by side, tops aligned
        expect(summary.x).toBeGreaterThanOrEqual(compose.x + compose.width - 1)
        expect(Math.abs(summary.y - compose.y)).toBeLessThan(40)

        // Sheet is width-capped and centred
        expect(sheet.width).toBeLessThanOrEqual(DESKTOP_SHEET_MAX_WIDTH + 1)
        expect(Math.abs((sheet.x + sheet.width / 2) - viewport.width / 2)).toBeLessThan(2)

        // The summary column stays pinned while the entries scroll
        expect(await scrollBuilder(page, 400)).toBeGreaterThan(0)
        const composeScrolled = (await page.getByTestId('roll-builder-compose-column').boundingBox())!
        const summaryScrolled = (await page.getByTestId('roll-builder-summary-column').boundingBox())!
        expect(compose.y - composeScrolled.y).toBeGreaterThan(100)
        expect(Math.abs(summaryScrolled.y - summary.y)).toBeLessThan(4)
        await scrollBuilder(page, 0)
      } else {
        // Single column, stacked, full-bleed sheet
        expect(summary.y).toBeGreaterThanOrEqual(compose.y + compose.height - 1)
        expect(sheet.x).toBe(0)
        expect(sheet.width).toBeCloseTo(viewport.width, 0)
      }

      // Never scrolls sideways
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1)

      // ── The room dice cap ───────────────────────────────────────────────
      await quantity.fill('31')
      await quantity.blur()
      const capacityError = page.getByTestId('roll-capacity-error')
      await expect(capacityError).toContainText('Rolls are limited to 30 dice')
      await expect(capacityError).toContainText('This roll uses 31')
      await expect(quantity).toHaveAttribute('aria-invalid', 'true')
      const saveButton = page.getByRole('button', { name: /Save Roll/i })
      await expect(saveButton).toBeDisabled()

      // Back under the cap re-enables saving
      await quantity.fill('30')
      await quantity.blur()
      await expect(capacityError).toHaveCount(0)
      await expect(saveButton).toBeEnabled()

      expect(alerted).toBe(false)

      // Saving returns to the list
      await saveButton.click()
      await expect(page.getByText('Verification roll')).toBeVisible()
    })
  })
}

test.describe('owned dice safety at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  /**
   * The default inventory is EMPTY — basic dice are the playable floor and
   * nothing is seeded any more — so a test about OWNED dice has to bring its
   * own. Written at the current persist version so the store hydrates it as-is.
   */
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const die = {
        id: 'die_owned_d20_1',
        type: 'd20',
        setId: 'adventurer-starter',
        rarity: 'common',
        appearance: { baseColor: '#2563eb', accentColor: '#ffffff', material: 'plastic' },
        vfx: {},
        name: 'Owned d20',
        isFavorite: false,
        isLocked: false,
        source: 'gacha_standard',
        assignedToRolls: [],
        acquiredAt: 1_700_000_000_000,
        stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
      }
      window.localStorage.setItem('dicesuki-player-inventory', JSON.stringify({
        state: {
          dice: [die],
          localDice: [die],
          assignments: {},
          localAssignments: {},
          serverCopiesActive: false,
          currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
        },
        version: 5,
      }))
    })
  })

  test('keeps an owned die while a multi-digit count is typed', async ({ page }) => {
    test.setTimeout(180_000)
    await openBuilder(page)
    await page.getByLabel('Roll name').fill('Owned die growth')

    // Arrange — an entry backed by a real owned die. Owned dice are chosen in
    // the per-entry picker now; the builder no longer carries a standing grid.
    await page.getByRole('button', { name: 'Add 1 D20 die' }).click()
    await page.getByTestId('dice-entry-picker-trigger').click()
    const picker = page.getByTestId('roll-dice-picker')
    const ownedTile = picker.getByRole('button', { name: /^Pin / }).first()
    await expect(ownedTile).toBeVisible()
    const dieName = (await ownedTile.getAttribute('aria-label'))!.replace(/^Pin /, '')
    await ownedTile.click()
    await picker.getByRole('button', { name: 'Done' }).click()

    const entryCard = page.getByText('[1 specific]').first()
    await expect(entryCard).toBeVisible()

    // Act — type "12"; the intermediate "1" must not truncate the sources
    const quantity = page.getByRole('textbox', { name: /quantity$/ }).first()
    await quantity.click()
    await quantity.press('Control+a')
    await quantity.pressSequentially('12', { delay: 40 })
    await quantity.blur()

    // Assert — still one specific owned die, now padded with generic dice
    await expect(page.getByText(/^12d\d+ \[1 specific\]$/).first()).toBeVisible()
    await expect(page.getByText(dieName).first()).toBeVisible()
    await expect(page.getByText(/Removed from this roll/)).toHaveCount(0)
  })
})
