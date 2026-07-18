# Brand Default Theme + App-Wide Restyle (dark plum default)

> Status: ACTIVE. Product decision (2026-07-18): **dark-plum is the canonical default** — app background `#1a101d`, not cream. Light pairing is future work, not this wave.
> Base every branch on `origin/main` (local `main` may be stale).
> Goal: kill the visual seam where the branded splash unmounts into a black/gray/orange app. After this wave, splash → app is one continuous brand surface.

## Brand palette (source of truth: `public/brand/*.svg` + splash CSS)

- Pink (primary accent): `#F98797` (tints `#F8A6B1`, `#FDB9B7`, `#F8CECF`)
- Lavender (secondary): `#9C89C4` (tints `#AE9ECD`, `#C4A7DC`)
- Plum ink: `#3F1D3E`
- Plum-black bg (dark): `#1a101d` · Cream (light, splash/light-mode only): `#f3ebe2`
- Signature gradient: `linear-gradient(90deg, #f98797 0%, #9c89c4 100%)`

Keep untouched: WoW-style rarity colors (`#ff8000/#a335ee/#0070dd/#1eff00`), player-color chips, delete-action red (may re-tint to fit, but must stay unmistakably destructive).

## Work packets (one PR each)

### Packet 1 — token rebrand (highest leverage; repaints ~80% of UI)

- Rewrite `defaultTheme` (`src/themes/tokens.ts`, "Classic Dice"): background `#1a101d`, surface = elevated plum (derive, e.g. `#2a1a2e`-family, ensure WCAG AA contrast with text), primary `#3F1D3E`, accent `#F98797`, secondary `#9C89C4`, text cream `#f3ebe2` / muted lavender-grays; `effects.gradients.primary` = brand pink→purple (replace generic indigo `#667eea→#764ba2`).
- Dice defaults: replace rainbow (`#ef4444/#3b82f6/...`) with brand family (pink/lavender/plum/cream range) — distinct enough to tell dice apart.
- Environment tokens: background `#1a101d`, floor/walls in plum tones replacing `#444444`/`#ffffff`; adjust lighting so dice stay readable on dark plum.
- Mirror the same values into the `:root` fallback block in `src/index.css` (currently generic gray/orange) so pre-hydration paint matches.
- Splash: dark-plum becomes the default splash background; `prefers-color-scheme` may keep the cream light variant, but the app it reveals is always dark-plum in this wave — verify no cream→black flash in dark mode and document the light-mode seam as accepted.
- Update ThemeProvider/registry snapshot tests (`registry.test.ts`, `ThemeProvider.test.tsx`) and any multiplayer theme-sync tests (RoomThemePicker / host theme sync) that assert old token values.
- Replace ad-hoc brand pink at `SoloRoom.tsx:119` (`bg-[#f98797]`) with the accent token.

### Packet 2 — brand display font + persistent wordmark

- Wordmark is vectorized lettering; no font file exists in repo. Choose a display face that matches its letterforms (rounded, friendly, geometric — propose 2–3 candidates with a screenshot comparison before committing; final pick is Donovan's call).
- Self-host as `woff2` under `public/fonts/` (subset latin), `@font-face` in `src/index.css` with `font-display: swap`, add preload in `index.html`. No Google Fonts runtime dependency (offline PWA).
- New `--font-family-display` token wired into `ThemeProvider`; apply to headings, roll totals, panel titles, brand moments. Body text stays `system-ui`.
- Fix latent bug: purchaseable themes name fonts never loaded (Cinzel, Comic Neue, Quicksand, Uncial Antiqua, VT323, Press Start 2P) — either self-host those faces or change the theme definitions to faces that exist; no silent fallback.
- Persistent in-app brand presence: wordmark/lockup in one deliberate place (e.g. BottomNav or settings header) — currently logo appears only on splash + 2 error screens.

### Packet 3 — hardcoded-color sweep + asset cleanup

- Convert hardcoded non-token colors to tokens in: `DiceSelector.tsx` (`bg-orange-600/bg-gray-700/bg-black`), `SettingsPanel.tsx`, `HeroDieInspector.tsx` (`bg-black`), `DeviceMotionButton.tsx`, `effects/PerformanceOverlay.tsx`, `ThemeSelector.tsx`, `panels/artist-tools/*`, `icons/DiceIconWithNumber.tsx`, multiplayer `#fecaca` usages. Grep for remaining inline hex + `bg-black|bg-gray-|orange-` Tailwind classes as final pass (audit sampled large files; small components may hide more).
- Cherry-pick/land parked commit `606c1c8` (`fix/brand-icon-halo`): clips icon base fills to outline, +regenerated PNG icons. Verify `BrandAssets.test.ts` (updated on origin/main) still passes.
- Optional: simplified favicon (current `public/icons/favicon.svg` is the full 82K icon).

## Verification gates (per packet)

- `npm test` green (update snapshots deliberately, not blindly); `npm run build` clean.
- Visual evidence: screenshots of splash→solo transition, solo table, inventory panel, settings, multiplayer room — dark plum everywhere, no orange/gray remnants, dice readable on dark tray.
- Contrast: text-on-surface and accent-on-background pass WCAG AA.
- Theme switching still works (purchaseable themes unaffected except font fix); multiplayer host theme sync unaffected.
