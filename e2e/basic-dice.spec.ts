import { expect, test, type Page } from '@playwright/test'

/**
 * Infinite basic dice, measured in a real browser against the live wasm room.
 *
 * Basic dice are the floor of every collection: a plain white body with black
 * numerals, unlimited, never in the inventory, and the automatic fill whenever a
 * roll wants more dice of a type than the player owns.
 *
 * What is unit-tested elsewhere and deliberately NOT re-proved here: the
 * presentation block (`src/lib/basicDice.test.ts`), the glyph ink
 * (`src/lib/faceRenderers/basicFaceRenderers.test.ts`), the spawn fallback
 * (`src/hooks/useMultiplayerDiceBackend.test.tsx`) and the substitution notice
 * (`src/lib/savedRollExecution.test.ts`).
 *
 * What only a browser can show, and so lives here: that a default (empty)
 * inventory still reaches a playable table through the REAL wasm room, that the
 * rail never disables a type, that a mixed owned/basic roll actually lands both
 * kinds of die, and that the basic die's texture really is black-on-white
 * pixels rather than the default white-on-colour.
 *
 * Manual run: `npm run test:e2e:basic-dice`
 */

const MOBILE = { width: 390, height: 844 }

/** A minimal owned d4, shaped like a persisted `InventoryDie`. */
function ownedD4(index: number) {
  return {
    id: `die_owned_d4_${index}`,
    type: 'd4',
    setId: 'adventurer-starter',
    rarity: 'common',
    appearance: { baseColor: '#2563eb', accentColor: '#ffffff', material: 'plastic' },
    vfx: {},
    name: `Blue d4 #${index}`,
    isFavorite: false,
    isLocked: false,
    source: 'gacha_standard',
    assignedToRolls: [],
    acquiredAt: 1_700_000_000_000 + index,
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
  }
}

/**
 * Seed persisted state BEFORE the app boots. Written at the CURRENT persist
 * versions so the stores hydrate it as-is instead of running a migration.
 */
async function seedStorage(
  page: Page,
  options: { ownedD4Count?: number; savedRoll?: unknown } = {},
) {
  const dice = Array.from({ length: options.ownedD4Count ?? 0 }, (_, i) => ownedD4(i + 1))
  await page.addInitScript(({ dice, savedRoll }) => {
    window.localStorage.clear()
    window.localStorage.setItem('dicesuki-player-inventory', JSON.stringify({
      state: {
        dice,
        localDice: dice,
        assignments: {},
        localAssignments: {},
        serverCopiesActive: false,
        currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
      },
      version: 5,
    }))
    if (savedRoll) {
      window.localStorage.setItem('dicesuki-saved-rolls', JSON.stringify({
        state: { savedRolls: [savedRoll], currentlyEditing: null },
        version: 1,
      }))
    }
  }, { dice, savedRoll: options.savedRoll ?? null })
}

async function openSoloRoom(page: Page) {
  await page.goto('/')
  const room = page.getByTestId('solo-room')
  await expect(room).toHaveAttribute('data-connection-status', 'connected', { timeout: 60_000 })
  // The branded splash covers the table until the first frame is rendered;
  // screenshots taken before it leaves would show the splash, not the dice.
  //
  // Wait on the gate's own handover edge rather than polling for the splash to
  // disappear (issue #222). Connecting is milliseconds; cold-starting the
  // renderer behind it is seconds of main-thread work, and an absence poll can
  // only guess at how many. The assertion below is unchanged and still the
  // load-bearing one — it just runs after a signal that says the work is done.
  await expect(room).toHaveAttribute('data-table-revealed', 'true', { timeout: 60_000 })
  await expect(page.getByTestId('startup-splash')).toHaveCount(0)
  return room
}

test.describe('basic dice at 390x844', () => {
  test.use({ viewport: MOBILE })

  test('a brand-new player with no dice still gets a playable table', async ({ page }) => {
    test.setTimeout(120_000)
    await seedStorage(page)

    const room = await openSoloRoom(page)

    // The default table die is now a basic one: the inventory is empty by
    // design, and the seed spawn falls through to the infinite floor.
    await expect(room).toHaveAttribute('data-room-dice-count', '1')
    await expect(room).toHaveAttribute('data-room-dice-types', 'd20')
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '1')

    await page.screenshot({
      path: 'e2e/screenshots/basic-dice-empty-inventory-table.png',
      fullPage: false,
    })
  })

  test('the rail offers every type, never disabled, and spawns basics past what you own', async ({ page }) => {
    test.setTimeout(120_000)
    await seedStorage(page, { ownedD4Count: 1 })

    const room = await openSoloRoom(page)
    await page.getByRole('button', { name: 'Manage Dice' }).click()
    await expect(page.getByTestId('dice-quick-slot-d20')).toBeVisible({ timeout: 30_000 })

    // Every type is present and enabled even though the player owns one d4.
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
      const slot = page.getByTestId(`dice-quick-slot-${type}`)
      await expect(slot).toBeVisible()
      await expect(slot).toBeEnabled()
    }
    // The rail reports no supply at all — not a tally, and not the ∞ that used
    // to stand in for one. What you own is the Inventory panel's business.
    await expect(page.getByTestId('dice-quick-slot-d4')).toHaveText('D4')
    await expect(page.getByTestId('dice-quick-slot-d6')).toHaveText('D6')

    await page.screenshot({
      path: 'e2e/screenshots/basic-dice-toolbar-no-disabled-states.png',
      fullPage: false,
    })

    // Owned first…
    await page.getByTestId('dice-quick-slot-d4').click()
    await expect(room).toHaveAttribute('data-room-dice-count', '2')
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '1')

    // …then basics, without the rail ever refusing. The player's one owned d4
    // is on the table now, so this second tap can only be a basic one.
    await page.getByTestId('dice-quick-slot-d4').click()
    await expect(room).toHaveAttribute('data-room-dice-count', '3')
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '2')
  })

  test('a plain 6d4 roll with 4 owned dice lands 4 owned and 2 basic', async ({ page }) => {
    test.setTimeout(180_000)
    await seedStorage(page, {
      ownedD4Count: 4,
      // A PLAIN entry — no die is named. Owned-first fill is what turns this
      // into 4 styled + 2 basic (PO decision (d)).
      savedRoll: {
        id: 'roll-mixed',
        name: 'Mixed d4s',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-1',
          type: 'd4',
          quantity: 6,
          perDieBonus: 0,
          sources: [{ kind: 'anonymous', quantity: 6 }],
        }],
      },
    })

    const room = await openSoloRoom(page)

    await page.getByRole('button', { name: 'My Dice Rolls' }).click()
    await page.getByRole('button', { name: 'Roll Mixed d4s' }).click()

    // Six physical d4s: the four the player owns, plus two basics to make up
    // the count. The roll is never short and never refuses.
    await expect(room).toHaveAttribute('data-room-dice-count', '6', { timeout: 60_000 })
    await expect(room).toHaveAttribute('data-room-dice-types', 'd4,d4,d4,d4,d4,d4')
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '2')

    // The shortfall is stated — not as an error, the roll is complete.
    await expect(page.getByText('You ran out of owned dice, so 2 basic dice filled in.'))
      .toBeVisible()
    await expect(page.getByTestId('roll-grand-total'))
      .not.toHaveText('?', { timeout: 60_000 })

    await page.screenshot({
      path: 'e2e/screenshots/basic-dice-mixed-owned-and-basic-roll.png',
      fullPage: false,
    })
  })

  test('a plain roll covered by owned dice uses them all and says nothing', async ({ page }) => {
    test.setTimeout(180_000)
    await seedStorage(page, {
      ownedD4Count: 4,
      savedRoll: {
        id: 'roll-covered',
        name: 'All mine',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-1',
          type: 'd4',
          quantity: 4,
          perDieBonus: 0,
          sources: [{ kind: 'anonymous', quantity: 4 }],
        }],
      },
    })

    const room = await openSoloRoom(page)

    await page.getByRole('button', { name: 'My Dice Rolls' }).click()
    await page.getByRole('button', { name: 'Roll All mine' }).click()

    await expect(room).toHaveAttribute('data-room-dice-count', '4', { timeout: 60_000 })
    // Not one basic: the owned pool covered the whole roll.
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '0')
    await expect(page.getByTestId('roll-notice')).toHaveCount(0)
  })

  test('a roll naming a die you no longer own degrades to a basic with a notice', async ({ page }) => {
    test.setTimeout(180_000)
    await seedStorage(page, {
      ownedD4Count: 1,
      savedRoll: {
        id: 'roll-dangling',
        name: 'Lost die',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-1',
          type: 'd4',
          quantity: 2,
          perDieBonus: 0,
          sources: [
            { kind: 'specific', dieId: 'die_owned_d4_1' },
            { kind: 'specific', dieId: 'die_sold_last_week' },
          ],
        }],
      },
    })

    const room = await openSoloRoom(page)

    await page.getByRole('button', { name: 'My Dice Rolls' }).click()
    await page.getByRole('button', { name: 'Roll Lost die' }).click()

    // The whole roll still runs — the missing die becomes a basic one…
    await expect(room).toHaveAttribute('data-room-dice-count', '2', { timeout: 60_000 })
    await expect(room).toHaveAttribute('data-room-basic-dice-count', '1')
    // …and the player is told why, instead of the roll failing.
    await expect(page.getByText(/no longer in your collection/i)).toBeVisible()
  })
})

/**
 * The die's actual PIXELS. The default renderers paint white numerals with a
 * black outline, so a white body with the wrong renderer would be an unreadable
 * white-on-white die. This samples the rendered canvas to prove the basic die is
 * genuinely dark ink on a light face.
 */
test.describe('basic die texture', () => {
  test.use({ viewport: MOBILE })

  for (const shape of ['d4', 'd6', 'd20'] as const) {
    test(`renders a basic ${shape} as black numerals on a white body`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.goto(`/test/dice-faces?type=${shape}&face=0&style=basic`)
      const harness = page.getByTestId('dice-test-harness')
      await expect(page.getByTestId('face-style')).toHaveText('basic')
      // Sample the frame the renderer has actually drawn, not whatever is on
      // screen after a guessed delay (issue #222). The harness has no splash to
      // watch, so it publishes its own first-frame edge; because its face
      // textures are built synchronously, that edge also means the numerals are
      // already painted into the frame this test is about to read back.
      await expect(harness).toHaveAttribute('data-frame-drawn', 'true', { timeout: 60_000 })

      // A WebGL drawing buffer is cleared once composited, so it cannot be read
      // back in-page. The COMPOSITED frame Playwright captures can be — fed back
      // in as an image and sampled through a 2D canvas.
      const frame = await page.screenshot({
        path: `e2e/screenshots/basic-die-${shape}.png`,
        fullPage: false,
      })

      const sample = await page.evaluate(async (dataUrl) => {
        const image = new Image()
        image.src = dataUrl
        await image.decode()

        const snapshot = document.createElement('canvas')
        snapshot.width = image.naturalWidth
        snapshot.height = image.naturalHeight
        const context = snapshot.getContext('2d')
        if (!context) throw new Error('no 2d context')
        context.drawImage(image, 0, 0)

        const { data, width, height } = context.getImageData(0, 0, snapshot.width, snapshot.height)
        const lumaAt = (index: number) =>
          0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]

        /** True when the four points `radius` away are all part of a bright face. */
        const enclosedByBrightFace = (x: number, y: number, radius: number) => {
          for (const [dx, dy] of [[-radius, 0], [radius, 0], [0, -radius], [0, radius]]) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false
            if (lumaAt((ny * width + nx) * 4) < 150) return false
          }
          return true
        }

        let bodyPixels = 0
        let inkPixels = 0
        let maxBodySaturation = 0

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            const luma = lumaAt(i)
            if (luma > 200) {
              bodyPixels += 1
              const max = Math.max(data[i], data[i + 1], data[i + 2])
              const min = Math.min(data[i], data[i + 1], data[i + 2])
              maxBodySaturation = Math.max(maxBodySaturation, max - min)
            } else if (luma < 80 && enclosedByBrightFace(x, y, 14)) {
              // Dark, but with bright die face on every side: a numeral, not the
              // dark page behind the die.
              inkPixels += 1
            }
          }
        }

        return { bodyPixels, inkPixels, maxBodySaturation, total: width * height }
      }, `data:image/png;base64,${frame.toString('base64')}`)

      // A substantial near-white body…
      expect(sample.bodyPixels / sample.total).toBeGreaterThan(0.1)
      // …carrying dark numerals painted on it…
      expect(sample.inkPixels).toBeGreaterThan(200)
      // …and no colour: a regression to the collectible renderer would show the
      // harness's orange body (and white numerals, which would leave no ink).
      expect(sample.maxBodySaturation).toBeLessThan(12)
    })
  }
})
