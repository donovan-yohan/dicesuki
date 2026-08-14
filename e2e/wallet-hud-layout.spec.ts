import { expect, test, type Page } from '@playwright/test'

async function renderWallet(page: Page, premiumTickets: number) {
  await page.goto('/')
  await page.evaluate(async ticketCount => {
    const [react, reactDom, theme, walletHud, tokens] = await Promise.all([
      import('/@id/react'),
      import('/@id/react-dom/client'),
      import('/src/contexts/ThemeContext.tsx'),
      import('/src/components/economy/WalletHud.tsx'),
      import('/src/themes/tokens.ts'),
    ])
    const fixture = document.createElement('div')
    fixture.id = 'wallet-hud-fixture'
    fixture.style.cssText = 'position: fixed; top: 0; left: 16px; width: calc(100vw - 32px); z-index: 2000;'
    document.body.append(fixture)

    reactDom.default.createRoot(fixture).render(
      react.default.createElement(
        theme.ThemeContext.Provider,
        {
          value: {
            currentTheme: tokens.defaultTheme,
            setTheme: () => {},
            availableThemes: [tokens.defaultTheme],
            ownedThemes: [tokens.defaultTheme.id],
            purchaseTheme: async () => true,
          },
        },
        react.default.createElement(walletHud.WalletBalanceSummary, {
          stars: 19_840,
          dust: 0,
          standardTickets: 0,
          premiumTickets: ticketCount,
        }),
      ),
    )
  }, premiumTickets)

  await expect(page.getByRole('region', { name: 'Wallet balances' })).toBeVisible()
}

async function balanceLayout(page: Page) {
  return page.getByRole('list', { name: 'Available balances' }).locator('[data-testid^="wallet-"]').evaluateAll(items =>
    items.map(item => {
      const box = item.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }),
  )
}

for (const viewport of [320, 360]) {
  test.describe(`at ${viewport}px wide`, () => {
    test.use({ viewport: { width: viewport, height: 640 } })

    test('keeps base balances on one row and premium balances in a compact 2×2 grid', async ({ page }) => {
      await renderWallet(page, 0)
      const fixture = page.locator('#wallet-hud-fixture')
      await expect(fixture).toHaveCSS('width', `${viewport - 32}px`)
      const baseBalances = await balanceLayout(page)
      expect(baseBalances).toHaveLength(3)
      expect(new Set(baseBalances.map(({ y }) => Math.round(y))).size).toBe(1)

      const baseList = page.getByRole('list', { name: 'Available balances' })
      expect(await baseList.evaluate(list => list.scrollWidth <= list.clientWidth)).toBe(true)

      await renderWallet(page, 2)
      const premiumBalances = await balanceLayout(page)
      expect(premiumBalances).toHaveLength(4)
      const rows = new Map<number, number>()
      for (const { y } of premiumBalances) {
        const row = Math.round(y)
        rows.set(row, (rows.get(row) ?? 0) + 1)
      }
      expect([...rows.values()]).toEqual([2, 2])

      const premiumList = page.getByRole('list', { name: 'Available balances' })
      expect(await premiumList.evaluate(list => list.scrollWidth <= list.clientWidth)).toBe(true)
    })
  })
}
