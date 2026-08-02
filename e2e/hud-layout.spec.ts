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
      const lane = getDiceToolbarLane(viewport.height)
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

      // ── The full-screen shop owns the screen outright ────────────────────
      await page.getByRole('button', { name: 'Shop' }).click()
      const shop = page.getByRole('dialog', { name: 'Shop' })
      await expect(shop).toBeVisible()

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

      // ── Guests get the unified shell: one close affordance plus Escape ───
      await expect(page.getByRole('button', { name: 'Close Banners' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Close Shop' })).toBeVisible()
      await expect(page.getByRole('tab', { name: /wallet & bundles/i })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(shop).toHaveCount(0)
      await expect(eye).toBeVisible()
    })
  })
}
