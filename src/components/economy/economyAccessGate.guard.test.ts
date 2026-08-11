/**
 * Source guard: every economy surface stays behind `useEconomyAccess()`.
 *
 * Dicesuki ships utility-first — a clean tabletop dice roller with ZERO economy
 * chrome — and reveals shop/wallet/banner/pass surfaces only for accounts an
 * operator has explicitly flagged on (`supabase/migrations/0034_economy_access_flag.sql`,
 * `src/hooks/useEconomyAccess.ts`).
 *
 * The failure this suite is built to catch is NOT today's gating being wrong;
 * it is the change six weeks from now where someone adds a new economy surface
 * — a "scrap duplicate" button, a passport claim prompt, a second storefront
 * entry — mounts it from a component tree that has nothing to do with
 * `ShopPanel`, and ships a shop to every un-flagged player. A behavioural test
 * can only assert about surfaces that already exist; this one fails on the
 * arrival of an unregistered new one.
 *
 * Detection uses three signals:
 *
 * 1. PATH — anything under `src/components/economy/` is economy by location.
 * 2. IMPORT EDGE — a real economy surface usually gets its data or its children
 *    from somewhere: the wallet store, the pull RPCs, the payments client, the
 *    currency glyphs, the shop catalog, an existing economy component.
 * 3. USAGE TOKEN — for economy state that arrives through a general-purpose
 *    provider, where the import edge is indistinguishable from a non-economy
 *    one. `ThemeSelector` is the motivating case: it renders dollar prices and
 *    a purchase affordance, but it only imports `useTheme` from `ThemeContext`,
 *    exactly like ~20 components that have nothing to do with money. Matching
 *    the context would drown the registry in false positives, so we match the
 *    two members that are unambiguously about buying and owning instead.
 *
 * Known limit, stated so nobody mistakes this for proof: a surface that trips
 * none of the three (a hardcoded "Buy Stars" button wired to nothing) is
 * invisible here. Widen the marker lists when that becomes real; they
 * deliberately over-match, because an unnecessary registry row costs one line
 * and a miss costs a leaked storefront.
 *
 * If this fails: register the file in `REGISTRY` with the gate that actually
 * protects it, and make sure that gate is real.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Vitest runs from the project root (vite.config.ts lives there).
const SRC_DIR = join(process.cwd(), 'src')
const COMPONENTS_DIR = join(SRC_DIR, 'components')

/**
 * How a registered economy surface is prevented from reaching an un-flagged
 * player. Every value here is a claim this suite either checks directly or
 * anchors to a checked ancestor.
 */
type Gate =
  /** The file itself calls `useEconomyAccess()` and gates its own children. */
  | 'economy-access'
  /** Reachable only as a descendant of a surface gated by `economy-access`. */
  | 'gated-subtree'
  /**
   * Checkout tree. Behind the `isPaymentsEnabled()` env flag AND unreachable
   * without a checkout that only a flagged player can start. Its one piece of
   * global chrome (`PendingPurchaseBanner`) is additionally `economy-access`
   * gated at its mount site in `src/App.tsx`.
   */
  | 'payments-env'
  /** Presentational primitive with no mount site of its own. */
  | 'primitive'

/**
 * Every file that touches the economy, and what keeps it away from un-flagged
 * players. Adding a row is the intended cost of adding an economy surface.
 *
 * Paths are relative to `src/`.
 */
const REGISTRY: ReadonlyArray<{ file: string; gate: Gate; note: string }> = [
  {
    file: 'App.tsx',
    gate: 'economy-access',
    note: 'Gates the only economy chrome outside Scene (PendingPurchaseBanner). The /checkout/return route is intentionally not gated — see the comment there.',
  },
  {
    file: 'components/Scene.tsx',
    gate: 'economy-access',
    note: 'THE table gate: computes `showShop` and mounts the whole ShopPanel subtree behind `economyAccess`.',
  },
  {
    file: 'components/panels/ShopPanel.tsx',
    gate: 'gated-subtree',
    note: 'Storefront root: wallet HUD, banners tab, Stars→rolls conversion, Lunar Pass, bundle previews. Mounted only by Scene, behind the gate.',
  },
  {
    file: 'components/panels/PullBannerScreen.tsx',
    gate: 'gated-subtree',
    note: 'Banner/pull screen, pull CTAs, odds & fairness modal, convert/insufficient sheets. Rendered only by ShopPanel.',
  },
  {
    file: 'components/panels/PullRevealOverlay.tsx',
    gate: 'gated-subtree',
    note: 'Pull reveal + duplicate Dust payout lines. Rendered only by PullBannerScreen.',
  },
  {
    file: 'components/panels/LunarPassCard.tsx',
    gate: 'gated-subtree',
    note: 'Lunar Pass offer, subscription status, daily Stars claim. Rendered only by ShopPanel.',
  },
  {
    file: 'components/economy/WalletHud.tsx',
    gate: 'gated-subtree',
    note: 'Wallet/currency balances. Rendered only by ShopPanel.',
  },
  {
    file: 'components/ThemeSelector.tsx',
    gate: 'economy-access',
    note: 'Priced themes are a storefront. Hides dollar prices, the purchase affordance, and unowned priced themes, and refuses to call purchaseTheme, unless flagged on. Inert today only because ThemeProvider dev-grants every theme id.',
  },
  {
    file: 'components/panels/lunarPassOffer.ts',
    gate: 'primitive',
    note: 'Lunar Pass offer constants. Data module consumed only by LunarPassCard.',
  },
  {
    file: 'components/economy/CurrencyGlyph.tsx',
    gate: 'primitive',
    note: 'Stars/Dust/roll glyph + label primitive. No mount site of its own.',
  },
  {
    file: 'components/economy/shopCatalog.ts',
    gate: 'primitive',
    note: 'Star bundle SKU previews and conversion constants. Data module.',
  },
  {
    file: 'components/checkout/BuyButton.tsx',
    gate: 'payments-env',
    note: 'Sole Pay Station SDK entry. Self-gates on isPaymentsEnabled().',
  },
  {
    file: 'components/checkout/CheckoutReturn.tsx',
    gate: 'payments-env',
    note: 'Payment return status screen at /checkout/return.',
  },
  {
    file: 'components/checkout/CheckoutReturnRoute.tsx',
    gate: 'payments-env',
    note: 'Route wrapper; self-gates on isPaymentsEnabled().',
  },
  {
    file: 'components/checkout/PendingPurchaseBanner.tsx',
    gate: 'payments-env',
    note: 'Global "confirming your purchase" banner; its mount in App.tsx is economy-access gated.',
  },
  {
    file: 'components/checkout/useCheckoutStatus.ts',
    gate: 'payments-env',
    note: 'Order polling hook for the checkout tree. No surface of its own.',
  },
]

/**
 * Import-edge markers. Deliberately over-matching: a false positive costs one
 * registry row, a false negative costs a storefront shown to every player.
 */
const ECONOMY_IMPORT_MARKERS = [
  'economy/',
  'useWalletStore',
  'usePaymentsStore',
  'walletBalances',
  'pullRpc',
  'pullFlow',
  'pullPity',
  'pullInventoryRefresh',
  'lunarPass',
  'earnedEconomy',
  'paymentsClient',
  'paymentsCheckout',
  'paymentsOrders',
  'paymentsConfig',
  'ShopPanel',
  'PullBannerScreen',
  'PullRevealOverlay',
  'PullProgressOverlay',
  'LunarPassCard',
  'BuyButton',
  'CheckoutReturn',
  'PendingPurchaseBanner',
] as const

/**
 * Tokens whose mere USE marks a file as an economy surface, regardless of where
 * they came from. Reserved for economy state delivered through a general-purpose
 * provider, where the import specifier carries no signal (see #3 above). Keep
 * this list tiny and unambiguous — a token that also appears in non-economy code
 * turns the guard into noise.
 */
const ECONOMY_USAGE_MARKERS = ['purchaseTheme', 'ownedThemes'] as const

/** `import … from '<specifier>'` / `import('<specifier>')` specifiers only. */
function importSpecifiers(source: string): string[] {
  const out: string[] = []
  const staticImport = /\bimport\b[^;]*?\bfrom\s*'([^']+)'/g
  const dynamicImport = /\bimport\s*\(\s*'([^']+)'\s*\)/g
  for (const match of source.matchAll(staticImport)) out.push(match[1])
  for (const match of source.matchAll(dynamicImport)) out.push(match[1])
  return out
}

function isEconomySurface(rel: string, source: string): boolean {
  // 1. Path rule: everything under src/components/economy/ is economy by location.
  if (rel.startsWith('components/economy/')) return true
  // Both remaining signals read the comment-stripped source. Prose must not be
  // able to register a file (a comment explaining why something is NOT imported
  // was enough to trip the import scan) and must not be able to exempt one.
  const code = executable(source)
  // 2. Import edge.
  const byImport = importSpecifiers(code).some(specifier =>
    ECONOMY_IMPORT_MARKERS.some(marker => specifier.includes(marker)),
  )
  if (byImport) return true
  // 3. Usage token.
  return ECONOMY_USAGE_MARKERS.some(marker => code.includes(marker))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry) && !/\.(test|guard\.test)\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = [...walk(COMPONENTS_DIR), join(SRC_DIR, 'App.tsx')].map(full => ({
  full,
  rel: full.slice(SRC_DIR.length + 1),
  source: readFileSync(full, 'utf8'),
}))

const registered = new Set(REGISTRY.map(entry => entry.file))
const byRel = new Map(FILES.map(file => [file.rel, file]))

/** Strip line and block comments so a claim cannot be satisfied by prose. */
function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('economy surfaces stay behind useEconomyAccess', () => {
  it('scans a non-trivial number of components', () => {
    // Guards against a broken walk silently passing the whole suite.
    expect(FILES.length).toBeGreaterThan(40)
  })

  it('every economy surface is registered with the gate that protects it', () => {
    const unregistered = FILES.filter(
      file => isEconomySurface(file.rel, file.source) && !registered.has(file.rel),
    ).map(file => file.rel)

    expect(
      unregistered,
      '\nNew economy surface(s) with no declared gate:\n' +
        unregistered.map(rel => `  - ${rel}`).join('\n') +
        '\n\nEvery shop / wallet / banner / pass / checkout surface must be hidden from\n' +
        'players who have not been flagged on. Gate it with `useEconomyAccess()` (or\n' +
        'mount it under a surface that already is), then add it to REGISTRY in\n' +
        'src/components/economy/economyAccessGate.guard.test.ts with its gate.\n',
    ).toEqual([])
  })

  it('every registered file still exists and still touches the economy', () => {
    const stale = REGISTRY.flatMap(({ file: rel }) => {
      const file = byRel.get(rel)
      if (!file) return [`${rel}: registered file no longer exists — drop the REGISTRY row`]
      if (!isEconomySurface(rel, file.source)) {
        return [`${rel}: no longer imports anything economy — drop the REGISTRY row`]
      }
      return []
    })

    expect(
      stale,
      '\nREGISTRY has rotted:\n' + stale.map(entry => `  - ${entry}`).join('\n') + '\n',
    ).toEqual([])
  })

  it('every economy-access gate file actually consults the hook', () => {
    const missing = REGISTRY.filter(entry => entry.gate === 'economy-access').flatMap(entry => {
      const source = executable(byRel.get(entry.file)?.source ?? '')
      return /useEconomyAccess\s*\(\s*\)/.test(source) ? [] : [entry.file]
    })

    expect(
      missing,
      '\nDeclared `economy-access` but never calls useEconomyAccess():\n' +
        missing.map(rel => `  - ${rel}`).join('\n') + '\n',
    ).toEqual([])
  })

  it('Scene gates both the shop entry point and the ShopPanel mount', () => {
    const scene = executable(byRel.get('components/Scene.tsx')?.source ?? '')

    // The HUD button. Gating this alone is not enough, hence the next assertion.
    expect(scene).toMatch(/const\s+showShop\s*=\s*economyAccess\s*&&/)
    // The panel mount — ShopPanel owns the entire economy subtree and would
    // otherwise stay mountable through `isShopOpen`. The bounded window lets a
    // <Suspense> wrapper sit between the gate and the element without letting
    // an unrelated, ungated <ShopPanel> elsewhere in the file satisfy it.
    expect(scene).toMatch(/\{\s*economyAccess\s*&&\s*\([\s\S]{0,200}?<ShopPanel\b/)
    // Structural, not just visual: an un-flagged player must not even download
    // the storefront chunk (banners, pull overlays, Lunar Pass, SKU strings).
    expect(scene).toMatch(/lazy\(\s*\(\)\s*=>\s*import\('\.\/panels\/ShopPanel'\)/)
    expect(scene).not.toMatch(/^import\s*\{[^}]*\bShopPanel\b[^}]*\}\s*from/m)
    // And no import of the `./panels` BARREL from Scene.
    expect(scene).not.toMatch(/from '\.\/panels'/)
    // A stale `isShopOpen` would keep `isOverlayOpen` true with nothing on screen.
    expect(scene).toMatch(/if\s*\(\s*economyAccess\s*\)\s*return\s*\n?\s*setIsShopOpen\(false\)/)
  })

  /**
   * The lazy boundary is only real if NOTHING gives Rollup a static edge to
   * ShopPanel. It had one — the `./panels` barrel re-exported it — and the
   * build silently inlined the dynamic import back into the main chunk: no
   * warning that fails anything, no test failure, just a 79 kB storefront
   * shipped to every un-flagged player. Assert on the barrel itself, because
   * that is the file that can reintroduce it for any importer, not just Scene.
   */
  it('the panels barrel does not re-export ShopPanel', () => {
    const barrel = readFileSync(join(COMPONENTS_DIR, 'panels', 'index.ts'), 'utf8')
    expect(executable(barrel)).not.toMatch(/ShopPanel/)
  })

  it('App gates the pending-purchase banner', () => {
    const app = executable(byRel.get('App.tsx')?.source ?? '')
    expect(app).toMatch(/paymentsEnabled\s*&&\s*economyAccess\s*&&/)
  })
})
