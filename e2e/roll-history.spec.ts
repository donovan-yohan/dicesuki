import { expect, test, type Page } from '@playwright/test'

/**
 * Roll history has exactly ONE row per roll.
 *
 * The regression this exists for (issue #211): a plain roll used to be written
 * to history TWICE — once, unattributed, when `useDiceStore`'s settle cycle
 * drained, and once, attributed, from the room's `roll_complete`. The player saw
 * the same roll listed as both "You / 12" and "Roll #1 / 12". `roll_complete` is
 * now the single writer for an ordinary roll; the cycle drain only closes the
 * cycle. A saved roll with follow-up waves is the one deliberate exception —
 * it CLAIMS its `roll_complete` by dice id and `finishSavedRollWaves` writes the
 * row instead.
 *
 * Three shapes, because each ends the roll differently:
 *  - a plain roll, where `roll_complete` writes;
 *  - a wave roll whose reroll never triggers, where the sequence is over before
 *    `roll_complete` arrives — the case a timing-based latch check gets wrong;
 *  - an exploding roll, where the waves really do run.
 *
 * Only a browser proves this end to end: it takes the real wasm room emitting
 * real `roll_started` / `die_settled` / `roll_complete` traffic, on real task
 * boundaries, to show that the two writers do not both fire.
 *
 * Manual run: `npm run test:e2e:roll-history`
 */

const MOBILE = { width: 390, height: 844 }

/**
 * Assert the history row count and that it STAYS there.
 *
 * The duplicate row arrived on a later WebSocket message than the first, so a
 * bare count assertion could pass on the gap between the two writes. Re-reading
 * after a settle delay closes that window.
 */
async function expectStableHistoryRows(page: Page, count: number) {
  const rows = page.getByTestId('history-roll')
  await expect(rows).toHaveCount(count, { timeout: 30_000 })
  await page.waitForTimeout(1_500)
  await expect(rows).toHaveCount(count)
}

/**
 * Seed a saved roll before boot. Written at the store's current persist version
 * so it hydrates as-is.
 */
async function seedSavedRoll(page: Page, entry: Record<string, unknown>) {
  await page.addInitScript((diceEntry) => {
    window.localStorage.clear()
    window.localStorage.setItem('dicesuki-saved-rolls', JSON.stringify({
      state: {
        savedRolls: [{
          id: 'roll-wave',
          name: 'Wave roll',
          flatBonus: 0,
          createdAt: 1,
          dice: [{ id: 'entry-1', perDieBonus: 0, ...diceEntry }],
        }],
        currentlyEditing: null,
      },
      version: 1,
    }))
  }, entry)
}

async function openSoloRoom(page: Page) {
  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 60_000 })
  await expect(page.getByTestId('startup-splash')).toHaveCount(0, { timeout: 60_000 })
  return room
}

test.use({ viewport: MOBILE })

test('a plain roll lands exactly one attributed history row', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => window.localStorage.clear())

  const room = await openSoloRoom(page)

  // A multi-die table (the default d20 plus a d6 from the rail), so the roll
  // only completes once BOTH dice settle. No saved roll is involved, so nothing
  // suppresses `roll_complete` and both writers would have fired.
  await expect(room).toHaveAttribute('data-room-dice-count', '1', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Manage Dice' }).click()
  await page.getByTestId('dice-quick-slot-d6').click()
  await expect(room).toHaveAttribute('data-room-dice-types', 'd20,d6', { timeout: 30_000 })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Roll dice' }).click()
  await expect(room).toHaveAttribute('data-roll-started-sequence', '1', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Roll History' }).click()

  // The whole point: ONE row, not two.
  await expectStableHistoryRows(page, 1)
  // And the surviving row is the attributed one. This is the timing-independent
  // half of the check: the duplicate was written by the cycle drain, which had
  // no player, so it rendered the "Roll #N" fallback header. Any such header
  // means the second writer is back.
  await expect(page.getByText(/^Roll #\d+$/)).toHaveCount(0)

  await page.screenshot({ path: 'e2e/screenshots/roll-history-single-row.png', fullPage: true })

  // A second roll adds exactly one more row, so nothing is being swallowed.
  await page.getByRole('button', { name: 'Close panel' }).click()
  await page.getByRole('button', { name: 'Roll dice' }).click()
  await expect(room).toHaveAttribute('data-roll-started-sequence', '2', { timeout: 30_000 })

  await page.getByRole('button', { name: 'Roll History' }).click()
  await expectStableHistoryRows(page, 2)
  await expect(page.getByText(/^Roll #\d+$/)).toHaveCount(0)
})

/**
 * A saved roll that CONFIGURES a follow-up wave still records one row — whether
 * or not the wave actually fires.
 *
 * The non-triggering shape is the dangerous one and the reason suppression is
 * keyed on the roll's dice rather than on "are waves running right now": with
 * nothing to reroll, the wave sequence is over in the same task the base dice
 * settle in, which is BEFORE the room's `roll_complete` crosses the socket. A
 * latch check finds it already cleared and writes the duplicate row.
 */
test('a wave roll whose reroll never triggers lands exactly one row', async ({ page }) => {
  test.setTimeout(120_000)
  // `equals 0` can never match a d20 face (1-20), so the reroll is configured
  // but provably never fires. Seeded rather than built in the UI, whose
  // threshold field clamps to >= 1 and would only non-trigger 95% of the time.
  await seedSavedRoll(page, {
    type: 'd20',
    quantity: 1,
    sources: [{ kind: 'anonymous', quantity: 1 }],
    reroll: { condition: 'equals', value: 0, maxRerolls: 1 },
  })

  const room = await openSoloRoom(page)
  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: 'Roll Wave roll' }).click()

  await expect(room).toHaveAttribute('data-roll-started-sequence', '1', { timeout: 60_000 })
  await expect(page.getByTestId('roll-grand-total')).not.toHaveText('?', { timeout: 60_000 })

  await page.getByRole('button', { name: 'Roll History' }).click()
  await expectStableHistoryRows(page, 1)
  await expect(page.getByText(/^Roll #\d+$/)).toHaveCount(0)
})

test('an exploding wave roll lands exactly one row', async ({ page }) => {
  test.setTimeout(120_000)
  // 3d4! explodes often enough to actually run the wave path; the row count
  // must be 1 whether it fired or not.
  await seedSavedRoll(page, {
    type: 'd4',
    quantity: 3,
    sources: [{ kind: 'anonymous', quantity: 3 }],
    exploding: { on: 'max' },
  })

  const room = await openSoloRoom(page)
  await page.getByRole('button', { name: 'My Dice Rolls' }).click()
  await page.getByRole('button', { name: 'Roll Wave roll' }).click()

  await expect(room).toHaveAttribute('data-roll-started-sequence', '1', { timeout: 60_000 })
  await expect(page.getByTestId('roll-grand-total')).not.toHaveText('?', { timeout: 60_000 })

  await page.getByRole('button', { name: 'Roll History' }).click()
  await expectStableHistoryRows(page, 1)
  await expect(page.getByText(/^Roll #\d+$/)).toHaveCount(0)
})
