import { expect, test, type Page } from '@playwright/test'
import {
  DICE_TOOLBAR_NATURAL_HEIGHT,
  getDiceToolbarLane,
} from '../src/components/layout/hudLayout'

/**
 * HUD Layout A geometry, measured in a real browser.
 *
 * jsdom has no layout engine, so the assertions that actually depend on
 * geometry live here: the roll button's centre-x between its neighbours, the
 * dice toolbar rail staying on-screen and clear of the Settings gear, and the
 * bottom-left control cluster never covering or stealing taps from an overlay.
 */

const VIEWPORTS = [
  { label: '360x640', width: 360, height: 640 },
  { label: '375x667', width: 375, height: 667 },
  { label: '360x780', width: 360, height: 780 },
  { label: '390x844', width: 390, height: 844 },
  { label: '1280x800', width: 1280, height: 800 },
] as const

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear())
})

async function openTable(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-connection-status',
    'connected',
    { timeout: 45_000 },
  )
  // Wait for the gate's handover, not for a HUD button to appear (issue #222).
  // `Manage Dice` is rendered *underneath* the startup splash, so its visibility
  // was never evidence that the table was up: this suite measures bounding boxes,
  // and it could take them while the splash still covered the screen. The reveal
  // edge is the state the measurements actually depend on.
  await expect(page.getByTestId('solo-room')).toHaveAttribute(
    'data-table-revealed',
    'true',
    { timeout: 30_000 },
  )
  await expect(page.getByRole('button', { name: 'Manage Dice' })).toBeVisible()
}

async function centerX(page: Page, name: string) {
  const box = await page.getByRole('button', { name }).boundingBox()
  if (!box) throw new Error(`No bounding box for ${name}`)
  return box.x + box.width / 2
}

/**
 * The empty-favorites hint puts a full-screen tap catcher over the HUD so that
 * any tap dismisses it. jsdom cannot see stacking or hit tests, so the thing
 * that would actually hurt — a catcher that outlives its hint and silently eats
 * every tap — is only visible in a browser.
 */
test.describe('empty-favorites hint at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('dismisses on a tap anywhere and hands the HUD back', async ({ page }) => {
    test.setTimeout(120_000)
    await openTable(page)

    await page.getByRole('button', { name: 'Manage Dice' }).click()
    const star = page.getByTestId('quick-slot-star-d20')
    // Visible with a stock (favorite-free) inventory — that is the whole point.
    await expect(star).toBeVisible({ timeout: 30_000 })

    await star.click()
    await expect(page.getByTestId('favorite-dice-empty-hint')).toBeVisible()

    // A tap on unrelated screen furniture, not on a close button.
    await page.mouse.click(195, 300)
    await expect(page.getByTestId('favorite-dice-empty-hint')).toHaveCount(0)
    await expect(page.getByTestId('favorite-dice-hint-backdrop')).toHaveCount(0)

    // The catcher is gone from the hit test too: the rail takes taps again.
    const slot = page.getByTestId('dice-quick-slot-d20')
    const box = (await slot.boundingBox())!
    // Reported as a testid rather than a boolean so a `null` hit (slot scrolled
    // out, layout shifted) fails loudly instead of passing as "not the catcher".
    const hitTestId = await page.evaluate(([x, y]) => {
      const element = document.elementFromPoint(x, y)
      return element?.closest('[data-testid]')?.getAttribute('data-testid') ?? null
    }, [box.x + box.width / 2, box.y + box.height / 2])
    expect(hitTestId).toBe('dice-quick-slot-d20')
  })
})

// A controlled result publication exercises the production ResultDisplay and
// Tailwind animation in the actual table. It is not a scripted physics result.
for (const viewport of [VIEWPORTS[3], VIEWPORTS[4]]) {
  test.describe(`animated result at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('contains every bounce phase without moving the resting HUD or losing horizontal scrolling', async ({ page }, testInfo) => {
      await openTable(page)
      // The starter die can still be falling at reveal. Wait for its real
      // settled publication so it cannot overwrite the controlled HUD result.
      await expect.poll(() => page.evaluate(async () => {
        const url = '/src/store/useDiceStore.ts'
        const { useDiceStore } = await import(/* @vite-ignore */ url)
        const state = useDiceStore.getState()
        return state.settledDice.size > 0 && state.rollingDice.size === 0
      })).toBe(true)
      await expect(page.getByTestId('roll-grand-total').locator('xpath=..')).not.toHaveClass(/animate-bounce/)
      await page.evaluate(async () => {
        const url = '/src/store/useDiceStore.ts'
        const { useDiceStore } = await import(/* @vite-ignore */ url)
        useDiceStore.setState({ settledDice: new Map(), rollingDice: new Set() })
      })
      await expect(page.getByTestId('roll-grand-total')).toHaveCount(0)
      // Hold the existing 500ms React cleanup while sampling the real CSS
      // animation. No replacement keyframes, layout styles or renderer.
      await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
      await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'))
      await page.evaluate(async () => {
        const url = '/src/store/useDiceStore.ts'
        const { useDiceStore } = await import(/* @vite-ignore */ url)
        useDiceStore.setState({
          activeSavedRoll: null,
          rollingDice: new Set(),
          settledDice: new Map([['hud-boundary', {
            diceId: 'hud-boundary', value: 1, type: 'd20', settledAt: Date.now(),
          }]]),
        })
      })
      await page.clock.runFor(16)
      const total = page.getByTestId('roll-grand-total')
      await expect(total).toHaveText('1')
      const samples = await total.evaluate(element => {
        const animated = element.parentElement!
        const animation = animated.getAnimations().find(item => (item as CSSAnimation).animationName === 'bounce')!
        if (!animation) throw new Error('The actual result change did not start the production bounce')
        animation.pause()
        const result = []
        for (const time of [0, 125, 250, 375, 500]) {
          animation.currentTime = time
          const range = document.createRange()
          range.selectNodeContents(element)
          const glyph = range.getBoundingClientRect()
          const box = element.getBoundingClientRect()
          const clips = []
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor)
            if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
              const bounds = ancestor.getBoundingClientRect()
              clips.push({ top: bounds.top + ancestor.clientTop, bottom: bounds.top + ancestor.clientTop + ancestor.clientHeight, overflowX: style.overflowX, overflowY: style.overflowY })
            }
          }
          result.push({ time, top: box.top, bottom: box.bottom, glyphTop: glyph.top, glyphBottom: glyph.bottom, clips })
        }
        return result
      })
      await testInfo.attach('actual-animation-bounds', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
      // Capture the apex even on RED; the geometric assertion below must not
      // prevent retaining the visible original failure.
      await total.evaluate(element => { element.parentElement!.getAnimations()[0].currentTime = 0 })
      await page.screenshot({ path: testInfo.outputPath('bounce-apex.png') })
      expect(Math.max(...samples.map(sample => sample.top)) - Math.min(...samples.map(sample => sample.top))).toBe(12)
      for (const sample of samples) {
        expect(sample.glyphTop).toBeGreaterThanOrEqual(0)
        expect(sample.glyphBottom).toBeLessThanOrEqual(viewport.height)
        for (const clip of sample.clips) {
          expect(sample.top, `line box at ${sample.time}ms versus ${clip.overflowY} clip`).toBeGreaterThanOrEqual(clip.top)
          expect(sample.glyphTop, `glyph at ${sample.time}ms versus ${clip.overflowY} clip`).toBeGreaterThanOrEqual(clip.top)
          expect(sample.glyphBottom).toBeLessThanOrEqual(clip.bottom)
        }
      }
      await total.evaluate(element => { element.parentElement!.getAnimations()[0].currentTime = 500 })
      expect((await total.boundingBox())!.y).toBe(32)
      const chip = page.getByTestId('result-die-chip')
      expect((await chip.boundingBox())!.y).toBe(88)
      await expect(chip).toHaveText('D201')
      const scroll = total.locator('xpath=../../..')
      const geometry = await scroll.evaluate(element => {
        const style = getComputedStyle(element)
        const before = element.getBoundingClientRect()
        // A wide content control tests the existing scroll owner, not a switch
        // to page overflow. Restore it before native HUD interactions.
        const content = element.firstElementChild as HTMLElement
        const oldWidth = content.style.minWidth
        content.style.minWidth = `${window.innerWidth + 200}px`
        element.scrollLeft = 50
        const result = {
          overflowX: style.overflowX, pointerEvents: style.pointerEvents,
          scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
          contentTop: content.getBoundingClientRect().top, bottomCap: before.top + Number.parseFloat(style.maxHeight),
        }
        content.style.minWidth = oldWidth
        element.scrollLeft = 0
        return result
      })
      expect(geometry.overflowX).toBe('auto')
      expect(geometry.pointerEvents).toBe('none')
      expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth)
      expect(geometry.scrollLeft).toBeGreaterThan(0)
      expect(geometry.pageWidth).toBe(geometry.viewportWidth)
      expect(geometry.contentTop).toBe(32)
      expect(geometry.bottomCap).toBeCloseTo(32 + viewport.height * 0.4, 0)
      await page.clock.resume()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    })
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.label}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('keeps the Layout A HUD on-screen, under overlays, and out of their hit tests', async ({ page }) => {
      test.setTimeout(120_000)
      await openTable(page)

      // ── The real roll button is the centre nav slot ──────────────────────
      const savedRolls = await centerX(page, 'My Dice Rolls')
      const roll = await centerX(page, 'Roll dice')
      const history = await centerX(page, 'Roll History')
      expect(roll).toBeGreaterThan(savedRolls)
      expect(roll).toBeLessThan(history)

      const rollBox = (await page.getByRole('button', { name: 'Roll dice' }).boundingBox())!
      const navBox = (await page.getByRole('navigation').boundingBox())!
      expect(rollBox.width).toBeCloseTo(70, 0)
      expect(rollBox.y + rollBox.height / 2).toBeCloseTo(navBox.y + navBox.height / 2, 0)

      // ── The dice toolbar rail fits on-screen, clear of the gear ──────────
      await page.getByRole('button', { name: 'Manage Dice' }).click()
      const rail = page.getByTestId('dice-toolbar-rail')
      await expect(rail).toBeVisible()

      const railBox = (await rail.boundingBox())!
      const gearBox = (await page.getByRole('button', { name: 'Settings' }).boundingBox())!
      expect(railBox.y).toBeGreaterThanOrEqual(0)
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(viewport.height)
      expect(railBox.y).toBeGreaterThanOrEqual(gearBox.y + gearBox.height)

      // The rendered rail matches the lane model that hudLayout.test.ts asserts.
      // The cluster below the rail collapses on desktop, so the lane depends on
      // the form factor the app itself derives from the viewport width.
      const lane = getDiceToolbarLane(viewport.height, viewport.width < 768)
      const scroll = await page.getByTestId('dice-toolbar-scroll').evaluate(element => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }))
      expect(scroll.scrollHeight).toBeLessThanOrEqual(DICE_TOOLBAR_NATURAL_HEIGHT)
      expect(scroll.clientHeight).toBeLessThanOrEqual(lane.maxHeight)
      expect(railBox.height).toBeLessThanOrEqual(lane.maxHeight + 1)

      const slots = page.locator('[data-testid^="dice-quick-slot-"]')
      const slotCount = await slots.count()
      expect(slotCount).toBeGreaterThan(0)
      for (let index = 0; index < slotCount; index += 1) {
        const slot = slots.nth(index)
        await slot.scrollIntoViewIfNeeded()
        const slotBox = (await slot.boundingBox())!
        expect(slotBox.y).toBeGreaterThanOrEqual(-1)
        expect(slotBox.y + slotBox.height).toBeLessThanOrEqual(viewport.height + 1)
      }

      // ── An overlay suppresses the cluster and the rail, then restores ────
      const eye = page.getByRole('button', { name: 'Hide UI' })
      const rotate = page.getByTestId('rotate-view-button')

      await page.getByRole('button', { name: 'Roll History' }).click()
      await expect(page.getByRole('heading', { name: 'Roll History' })).toBeVisible()
      await expect(eye).toHaveCount(0)
      await expect(rotate).toHaveCount(0)
      await expect(rail).toHaveCount(0)

      await page.getByRole('button', { name: 'Close panel' }).click()
      await expect(page.getByRole('heading', { name: 'Roll History' })).toHaveCount(0)
      await expect(eye).toBeVisible()
      await expect(rotate).toBeVisible()
      // The rail state survived the overlay round trip.
      await expect(rail).toBeVisible()

      // Guests have no economy chrome. Exercise shop geometry only after a
      // local presentation fixture enables the existing account gate. No
      // credentials, entitlement, backend grant or purchase is involved.
      await expect(page.getByRole('button', { name: 'Shop', exact: true })).toHaveCount(0)
      await page.evaluate(async () => {
        const storeUrl = '/src/store/useAuthStore.ts'
        const { useAuthStore } = await import(/* @vite-ignore */ storeUrl)
        useAuthStore.setState({
          status: 'authenticated',
          economyAccess: true,
          user: {
            id: 'hud-layout-fixture-user',
            aud: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z',
          },
        })
      })
      // ── The full-screen shop owns the screen outright ────────────────────
      await page.getByRole('button', { name: 'Shop' }).click()
      const shop = page.getByRole('dialog', { name: 'Shop' })
      await expect(shop).toBeVisible()
      // Visibility precedes the native slide-in finishing. Measure the settled
      // dialog, not a still-translated descendant below the viewport.
      await expect.poll(() => shop.evaluate(element => ({
        top: element.getBoundingClientRect().top,
        opacity: Number(getComputedStyle(element).opacity),
      }))).toEqual({ top: 0, opacity: 1 })

      await expect(eye).toHaveCount(0)
      await expect(rotate).toHaveCount(0)
      await expect(rail).toHaveCount(0)

      // The odds/pity entry point is on screen without scrolling…
      const details = page.getByRole('button', { name: /banner details/i })
      await expect(details).toHaveCount(1)
      await expect(details).toBeVisible()
      const detailsBox = (await details.boundingBox())!
      expect(detailsBox.y).toBeGreaterThanOrEqual(0)
      expect(detailsBox.y + detailsBox.height).toBeLessThanOrEqual(viewport.height)

      // …and the topmost element over every pull CTA is that CTA.
      const ctas = page.locator('[data-testid="pull-cta-footer"] button')
      const ctaCount = await ctas.count()
      expect(ctaCount).toBeGreaterThan(0)
      for (let index = 0; index < ctaCount; index += 1) {
        const box = (await ctas.nth(index).boundingBox())!
        const hit = await page.evaluate(([x, y]) => {
          const element = document.elementFromPoint(x, y)
          return {
            inFooter: Boolean(element?.closest('[data-testid="pull-cta-footer"]')),
            tag: element?.tagName ?? null,
          }
        }, [box.x + box.width / 2, box.y + box.height / 2])
        expect(hit).toMatchObject({ inFooter: true })
      }

      // ── The shell has one close affordance plus Escape ──────────────────
      await expect(page.getByRole('button', { name: 'Close Banners' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Close Shop' })).toBeVisible()
      await expect(page.getByRole('tab', { name: /wallet & bundles/i })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(shop).toHaveCount(0)
      await expect(eye).toBeVisible()
    })
  })
}
