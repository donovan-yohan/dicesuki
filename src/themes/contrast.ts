/**
 * Theme Contrast Model — WCAG 2.1 ratios for the pairings the UI really ships
 *
 * PO 2026-07-27 flagged "dark font over dark background" as a blocker for
 * theme scaling. This module is the machine-checkable answer: it declares, in
 * one place, every foreground/background pairing that components actually
 * render, so `contrast.guard.test.ts` can walk the whole theme registry and
 * fail closed when any theme — including one added next month — ships an
 * illegible combination.
 *
 * Adding a newly consumed pairing is one entry in `CONTRAST_PAIRINGS`.
 *
 * Scope note: this gate covers TEXT contrast (WCAG 1.4.3). Purely decorative
 * pairings are listed in `EXCLUDED_PAIRINGS` with a rationale rather than
 * being silently omitted.
 *
 * KNOWN STRUCTURAL LIMIT — read before trusting a green run.
 * ---------------------------------------------------------
 * This manifest is a *declaration*, not a discovery mechanism. It proves that
 * every pairing listed here is legible in every registered theme; it cannot
 * prove the list is complete. A component that starts consuming a new
 * combination — say, `text.muted` on an `accent` fill — is invisible to this
 * gate until someone adds the entry. That gap is real: the first pass of this
 * work shipped a green suite while eight live accent-filled controls still
 * painted `text.primary` on `accent`, because none of them were declared.
 *
 * `contrast.source.guard.test.ts` closes the highest-value slice of that gap
 * by scanning component source for accent-filled controls whose label is not
 * `onAccent`. It is a source-shape check, not a full render-tree audit — the
 * remaining exposure is other token combinations, which stay a review
 * responsibility until someone extends the scanner.
 */

import type { Theme } from './tokens'

// ============================================================================
// WCAG 2.1 math
// ============================================================================

/** Parse `#rgb` / `#rrggbb` into 0-255 channels. */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: "${hex}"`)
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** WCAG 2.1 relative luminance (sRGB). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio between two opaque colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Composite `fg` at `alpha` over opaque `bg` (source-over), returning hex. */
export function compositeOver(fg: string, alpha: number, bg: string): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  const mixed = f.map((channel, i) => Math.round(channel * alpha + b[i] * (1 - alpha)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// ============================================================================
// Token addressing
// ============================================================================

/**
 * Every colour token that can act as a foreground or an opaque backdrop.
 * Kept as an explicit union so a typo in the manifest is a type error.
 */
export type ColorTokenPath =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'onAccent'
  | 'background'
  | 'surface'
  | 'error'
  | 'text.primary'
  | 'text.secondary'
  | 'text.muted'

export function resolveToken(theme: Theme, path: ColorTokenPath): string {
  const c = theme.tokens.colors
  switch (path) {
    case 'primary':
      return c.primary
    case 'secondary':
      return c.secondary
    case 'accent':
      return c.accent
    case 'onAccent':
      return c.onAccent
    case 'background':
      return c.background
    case 'surface':
      return c.surface
    case 'error':
      return c.error
    case 'text.primary':
      return c.text.primary
    case 'text.secondary':
      return c.text.secondary
    case 'text.muted':
      return c.text.muted
  }
}

/**
 * A backdrop is a theme token, optionally with a translucent overlay painted
 * on top of it by shared component chrome (chips, tinted row cards).
 *
 * The overlay colours are LITERALS on purpose: components today hardcode
 * `rgba(255,255,255,α)` and `rgba(249,135,151,α)` rather than deriving them
 * from the active theme, so this is what actually renders. If those overlays
 * are ever made theme-aware, update the literals here in the same change.
 */
export interface Backdrop {
  /** Human name used in failure messages. */
  readonly id: string
  readonly base: ColorTokenPath
  readonly overlay?: { readonly color: string; readonly alpha: number }
  /** Where this backdrop is painted, so a reviewer can verify the claim. */
  readonly source: string
}

export const BACKDROPS = {
  background: {
    id: 'background',
    base: 'background',
    source: 'full-screen overlays + inputs (PullBannerScreen, PullRevealOverlay, DiceEntryCard)',
  },
  surface: {
    id: 'surface',
    base: 'surface',
    source: 'FlyoutPanel / BottomSheet panel body',
  },
  primaryFill: {
    id: 'primary-fill',
    base: 'primary',
    source: 'bg-theme-primary controls in artist-tools',
  },
  // 0.10 is the largest white alpha any component paints as a container.
  // Sites painting exactly 0.10: BottomSheet.tsx:211 and FlyoutPanel.tsx:115
  // (close buttons), SavedRollsPanel.tsx:303,320 (tag filter chips).
  // Sites painting less, covered conservatively by modelling 0.10:
  // DicePool.tsx:42 and InventoryPanel.tsx:654 (0.08), HistoryPanel.tsx:155 (0.05).
  chipOnSurface: {
    id: 'chip-on-surface',
    base: 'surface',
    overlay: { color: '#ffffff', alpha: 0.1 },
    source:
      'white chips over a panel body — BottomSheet.tsx:211, FlyoutPanel.tsx:115, ' +
      'SavedRollsPanel.tsx:303 (all rgba(255,255,255,0.1))',
  },
  // DEFENSIVE: no component currently paints a white chip directly on the page
  // background — every chip today sits inside a `surface`-backed panel or card.
  // It is kept anyway because `surface` is NOT reliably the lighter of the two
  // (critter-forest's bark surface is darker than its forest background), so
  // "chip-on-surface is always the binding case" is not a safe premise, and
  // full-screen overlays (PullBannerScreen, InventoryPanel) do paint
  // `--color-background` directly. Costs nothing: every theme already clears it.
  chipOnBackground: {
    id: 'chip-on-background',
    base: 'background',
    overlay: { color: '#ffffff', alpha: 0.1 },
    source:
      'defensive — no current site; covers the chip idiom landing on a ' +
      'background-backed full-screen overlay, where surface-based bounds do not apply',
  },
  tintedRow: {
    id: 'tinted-row',
    base: 'surface',
    overlay: { color: '#f98797', alpha: 0.12 },
    source:
      'tinted row cards — ThemeSelector.tsx:84, DiceEntryCard.tsx:221 (rgba(249,135,151,0.12)); ' +
      'lighter than the lavender/indigo 0.12 variants in SettingsPanel/AccountSection, so it is the binding case',
  },
  accentWash: {
    id: 'accent-wash',
    base: 'surface',
    overlay: { color: '#f98797', alpha: 0.16 },
    source: 'accent-on-accent-wash badges — RollBuilder.tsx:257 source chip (rgba(249,135,151,0.16))',
  },
  errorTint: {
    id: 'error-tint',
    base: 'surface',
    overlay: { color: '#ef4444', alpha: 0.2 },
    source:
      'destructive affordances — HistoryPanel.tsx:60 (0.1) and SavedRollsPanel.tsx:272 (0.14); ' +
      'the 0.2 model remains a conservative bound',
  },
  accentFill: {
    id: 'accent-fill',
    base: 'accent',
    source: 'accent-filled buttons — CenterRollButton, Pull CTAs, selected chips',
  },
  // A fixed dark slate at 0.92, NOT a token — the flyout floats over the live 3D
  // table, where no theme token describes what is behind it. Modelled over
  // `background` because that is the only backdrop a theme controls here; at
  // 0.92 the base contributes ~8%, so the result is near theme-independent.
  // Gated so a future light theme cannot silently paint pale copy on it.
  flyoutGlass: {
    id: 'flyout-glass',
    base: 'background',
    overlay: { color: '#1f2937', alpha: 0.92 },
    source: 'DiceToolbar.tsx quick-slot ★ flyout — rgba(31,41,55,0.92) over the table',
  },
} as const satisfies Record<string, Backdrop>

export function resolveBackdrop(theme: Theme, backdrop: Backdrop): string {
  const base = resolveToken(theme, backdrop.base)
  return backdrop.overlay
    ? compositeOver(backdrop.overlay.color, backdrop.overlay.alpha, base)
    : base
}

// ============================================================================
// Threshold classes (WCAG 2.1 SC 1.4.3)
// ============================================================================

/**
 * `normal` — body text below 18.66px bold / 24px regular. 4.5:1.
 * `large`  — 18.66px bold or 24px+. 3:1.
 *
 * Classify honestly: a pairing is only `large` if EVERY site that renders it
 * is genuinely large.
 */
export type ThresholdClass = 'normal' | 'large'

export const THRESHOLDS: Record<ThresholdClass, number> = {
  normal: 4.5,
  large: 3,
}

// ============================================================================
// The manifest
// ============================================================================

export interface ContrastPairing {
  /** Stable name, quoted verbatim in failure messages. */
  readonly name: string
  readonly fg: ColorTokenPath
  readonly bg: Backdrop
  readonly threshold: ThresholdClass
  /** A real render site, so the manifest can be audited against the code. */
  readonly usedBy: string
}

/**
 * Every text pairing the UI renders through the theme tokens.
 *
 * Derived from a full sweep of `var(--color-*)` and `text-theme-*` /
 * `bg-theme-*` usage (2026-08-01), not from guesswork.
 */
export const CONTRAST_PAIRINGS: readonly ContrastPairing[] = [
  // ── text.primary ─────────────────────────────────────────────────────────
  { name: 'text.primary on background', fg: 'text.primary', bg: BACKDROPS.background, threshold: 'normal', usedBy: 'PullBannerScreen body copy, DiceEntryCard number inputs' },
  { name: 'text.primary on surface', fg: 'text.primary', bg: BACKDROPS.surface, threshold: 'normal', usedBy: 'ThemeSelector title, RollBuilder section headings, CornerIcon glyphs' },
  { name: 'text.primary on primary fill', fg: 'text.primary', bg: BACKDROPS.primaryFill, threshold: 'normal', usedBy: 'artist-tools file input label (file:bg-theme-primary file:text-theme-text)' },
  { name: 'text.primary on chip over surface', fg: 'text.primary', bg: BACKDROPS.chipOnSurface, threshold: 'normal', usedBy: 'DicePool.tsx:42 +4/+8 quantity chips (paints 0.08; modelled at 0.10)' },
  { name: 'text.primary on chip over background', fg: 'text.primary', bg: BACKDROPS.chipOnBackground, threshold: 'normal', usedBy: 'defensive backdrop — see BACKDROPS.chipOnBackground; no current render site' },
  { name: 'text.primary on tinted row', fg: 'text.primary', bg: BACKDROPS.tintedRow, threshold: 'normal', usedBy: 'SettingsPanel "Change Theme" row, ThemeSelector current theme name' },
  { name: 'text.primary on flyout glass', fg: 'text.primary', bg: BACKDROPS.flyoutGlass, threshold: 'normal', usedBy: 'DiceToolbar.tsx empty-favorites hint copy on the ★ flyout glass' },

  // ── text.secondary ───────────────────────────────────────────────────────
  { name: 'text.secondary on background', fg: 'text.secondary', bg: BACKDROPS.background, threshold: 'normal', usedBy: 'PullRevealOverlay result copy, DiceEntryCard advanced options' },
  { name: 'text.secondary on surface', fg: 'text.secondary', bg: BACKDROPS.surface, threshold: 'normal', usedBy: 'SettingsPanel section headings, PullBannerScreen details modal' },
  { name: 'text.secondary on primary fill', fg: 'text.secondary', bg: BACKDROPS.primaryFill, threshold: 'normal', usedBy: 'artist-tools inactive tab buttons (bg-theme-primary text-theme-text-secondary)' },
  { name: 'text.secondary on chip over surface', fg: 'text.secondary', bg: BACKDROPS.chipOnSurface, threshold: 'normal', usedBy: 'BottomSheet.tsx:211 / FlyoutPanel.tsx:115 close buttons, SavedRollsPanel.tsx:303 tag chips' },
  { name: 'text.secondary on tinted row', fg: 'text.secondary', bg: BACKDROPS.tintedRow, threshold: 'normal', usedBy: 'DiceEntryCard "Removed from this roll" pill' },

  // ── text.muted ───────────────────────────────────────────────────────────
  { name: 'text.muted on background', fg: 'text.muted', bg: BACKDROPS.background, threshold: 'normal', usedBy: 'ThemeSelector purchase hint, RollBuilder owned-die rarity line' },
  { name: 'text.muted on surface', fg: 'text.muted', bg: BACKDROPS.surface, threshold: 'normal', usedBy: 'SettingsPanel legal footer, SavedRollsPanel empty state, DiceToolbar.tsx ★ glyph on a type with no favorites' },
  { name: 'text.muted on primary fill', fg: 'text.muted', bg: BACKDROPS.primaryFill, threshold: 'normal', usedBy: 'artist-tools secondary labels on bg-theme-primary rows' },
  { name: 'text.muted on tinted row', fg: 'text.muted', bg: BACKDROPS.tintedRow, threshold: 'normal', usedBy: 'SettingsPanel row subtitles, AccountSection "Signed in with Discord"' },

  // ── accent as text ───────────────────────────────────────────────────────
  { name: 'accent text on background', fg: 'accent', bg: BACKDROPS.background, threshold: 'normal', usedBy: 'PullRevealOverlay "Outcome revealed" / "NEW", ThemeSelector price' },
  { name: 'accent text on surface', fg: 'accent', bg: BACKDROPS.surface, threshold: 'normal', usedBy: 'DiceEntryCard "Advanced Options" disclosure' },
  { name: 'accent text on accent wash', fg: 'accent', bg: BACKDROPS.accentWash, threshold: 'normal', usedBy: 'SettingsPanel row chevrons, DiceEntryCard source chip' },

  // ── the label on an accent-filled control ────────────────────────────────
  { name: 'onAccent on accent fill', fg: 'onAccent', bg: BACKDROPS.accentFill, threshold: 'normal', usedBy: '16 accent-filled controls — CenterRollButton.tsx:50, TableHud.tsx:136, PullBannerScreen.tsx:632 x10 CTA, PullRevealOverlay.tsx:221, PullProgressOverlay.tsx:124, InventoryPanel.tsx:389/518/675/730, ShopPanel.tsx:337/451, LunarPassCard.tsx:327, HeroDieInspector.tsx:200, RoomBrowser.tsx:212, RoomThemePicker.tsx:128, SoloRoom.tsx:117' },
  // A deliberate inversion, not an oversight: the toolbar quick slots are
  // accent chips with a surface-coloured glyph, which reads as a punched-out
  // hole in the chip. It clears AA on every theme (6.07-15.34:1), so it is
  // declared and gated rather than normalised to onAccent.
  { name: 'surface on accent fill', fg: 'surface', bg: BACKDROPS.accentFill, threshold: 'normal', usedBy: 'DiceToolbar.tsx:246 quick-slot add buttons (accentColor fill, surfaceColor glyph)' },

  // ── destructive / validation ─────────────────────────────────────────────
  { name: 'error text on background', fg: 'error', bg: BACKDROPS.background, threshold: 'normal', usedBy: 'PullProgressOverlay.tsx:114 and PullRevealOverlay.tsx:233 role="alert" copy on the full-screen overlay' },
  { name: 'error text on surface', fg: 'error', bg: BACKDROPS.surface, threshold: 'normal', usedBy: 'RollBuilder.tsx:198 name-field error, RollBuilder.tsx:370 dice-required hint' },
  { name: 'error text on error tint', fg: 'error', bg: BACKDROPS.errorTint, threshold: 'normal', usedBy: 'HistoryPanel.tsx:60 "Clear All History"' },
] as const

/**
 * Pairings deliberately NOT gated, each with why. Kept in code so the omission
 * is a reviewed decision rather than an oversight.
 */
export const EXCLUDED_PAIRINGS = [
  {
    pairing: 'secondary as a text colour',
    reason:
      '`secondary` is a surface/border token: 12 `bg-theme-secondary` fills and 6 `border-theme-secondary` ' +
      'borders vs. 5 text uses, of which 4 are hover states inside the internal artist-tools panel and 1 ' +
      'tints an SVG die icon. Gating it as text would force every theme to give up its mid-tone secondary. ' +
      'The artist-tools hover states are tracked as a follow-up component fix.',
  },
  {
    pairing: '--color-border (rgba(255,255,255,0.14)) against its own backdrop',
    reason:
      'Non-text UI boundary (WCAG 1.4.11, 3:1), not covered by this text gate. It currently measures ' +
      '1.30-1.55:1 on every theme; raising it is a visual-design decision, tracked as a follow-up.',
  },
  {
    pairing: 'dice.* and environment.* colours',
    reason: 'Decorative 3D materials and lighting; no text is rendered on them.',
  },
  {
    pairing: 'effects.gradients.*',
    reason: 'Decorative fills. No component renders theme text directly on a gradient.',
  },
  {
    pairing: 'text over the live 3D canvas (Scene totals, PlayerPanel)',
    reason:
      'The backdrop is a per-frame render of the dice tray, not a token. These sites use their own opaque ' +
      'scrims (rgba(0,0,0,0.55-0.75)); auditing them needs pixel sampling, not token math.',
  },
] as const

// ============================================================================
// Audit
// ============================================================================

export interface PairingResult {
  readonly pairing: ContrastPairing
  readonly foreground: string
  readonly background: string
  readonly ratio: number
  readonly threshold: number
  readonly passes: boolean
}

/** Evaluate every manifest pairing for one theme. */
export function auditTheme(
  theme: Theme,
  pairings: readonly ContrastPairing[] = CONTRAST_PAIRINGS,
): PairingResult[] {
  return pairings.map((pairing) => {
    const foreground = resolveToken(theme, pairing.fg)
    const background = resolveBackdrop(theme, pairing.bg)
    const ratio = contrastRatio(foreground, background)
    const threshold = THRESHOLDS[pairing.threshold]
    return { pairing, foreground, background, ratio, threshold, passes: ratio >= threshold }
  })
}

/** Format one result for a test failure message. */
export function describeFailure(themeId: string, result: PairingResult): string {
  return (
    `[${themeId}] "${result.pairing.name}" is ${result.ratio.toFixed(2)}:1 ` +
    `(needs ${result.threshold}:1 for ${result.pairing.threshold} text) — ` +
    `${result.pairing.fg} ${result.foreground} on ${result.pairing.bg.id} ${result.background}. ` +
    `Rendered by: ${result.pairing.usedBy}.`
  )
}
