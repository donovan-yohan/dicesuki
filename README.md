# Dicesuki - 3D Dice Simulator

A physics-based 3D dice-rolling PWA with single-player and multiplayer support.

Dice physics run in one shared Rust core, `dicesuki-core`, compiled to two targets from a
single source (see [Shared-ADR-007](docs/adrs/shared)):

- **Solo** runs that core as a **WASM room** inside a Web Worker in the browser — no network,
  no local server. `npm run dev` is all solo needs.
- **Multiplayer** runs the same core as a **native Rust/Axum server** that owns physics and
  streams server-authoritative snapshots (60Hz) over a WebSocket room protocol.

Both modes flow through the identical room protocol; they differ only in player count and where
the room runs, never in code path.

## Quick Start

```bash
npm install       # install dependencies
npm run dev       # start the dev server (solo runs entirely in-browser)
npm test          # run unit tests (Vitest)
npm run build     # production build
npm run preview   # preview the production build
```

To rebuild the committed WASM room artifacts after changing `server/core` or `server/wasm`:

```bash
npm run build:wasm-room
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests (Vitest) |
| `npm run build` | Production build |
| `npm run dev` | Start dev server |
| `~/.cargo/bin/cargo test` | Run server tests (from `server/`) |

> `cargo` is not on `PATH` in this environment — use `~/.cargo/bin/cargo` for server commands.

## Woodland Scene Experiment

Choose **Sunlit Glade** in Settings → Change Theme. The scene quality follows the
existing device tier, with compact/coarse-pointer devices capped below desktop
quality. `?lodTier=low`, `mid`, or `high` makes tier comparisons reproducible;
reduced-motion preferences stop ambient animation.

The wood D6 authoring proof is local-only. Generate the files with the pipeline
under `scripts/environment-assets/`, then run
`node scripts/environment-assets/wood-d6-variants.mjs`, open `/?woodlandDice=1`
and add a basic D6. Vite serves only the raw GLB/metadata and two explicitly
allowlisted tier variants from the ignored
`.artifacts/theme-workshop/experiments/woodland/` directory. The endpoint does not
exist in production builds; it cannot load arbitrary paths or replace owned or
network dice. No new environment variables are required by this route.

Run `node scripts/environment-performance.mjs` for repeated idle/rolling frame
cadence and draw-work samples. `PERF_URL`, `PERF_OUT`, `PERF_THEME`, `PERF_CHROME`,
and optional `PERF_CDP` select the local origin, output file, theme, Chrome
executable and a physical-device debugging connection. These are benchmark
process settings, not app configuration. See the
[execution plan](docs/exec-plans/active/woodland-environment.md) for measurement
limits and asset provenance.
The [prototype evidence](docs/guides/woodland-prototype-evidence.md) records
rendered checks, rejected measurements and remaining device/art acceptance.

`node scripts/capture-meadow-proof.mjs` checks full-floor blade coverage and
actual center-region grass motion, with particles hidden. Set `MEADOW_VIDEO=1`
to also render a four-second, 30 fps wind study with ffmpeg. Frames use fixed
shader times from the real scene; the encoded clip is visual evidence, not a
real-time frame-rate measurement. Outputs stay in the ignored woodland tree.

`MEADOW_VIDEO=1 node scripts/capture-grass-reaction.mjs` isolates dice-driven
compression and recovery through the live renderer. It pauses incoming worker
messages only in that disposable test page and feeds controlled snapshots;
the resulting clip is not a real physics roll. The normal table uses the live
room snapshots, with grass and dice sharing the interpolation clock.

## Tech Stack

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS
- **3D rendering**: Three.js via `@react-three/fiber` v9 (+ drei)
- **Physics**: Rapier, run inside `dicesuki-core` (never client-side) — one engine for solo and multiplayer
- **State**: Zustand
- **Multiplayer server**: Rust + Axum + Tokio (`server/`)
- **Identity & durable data**: Supabase (Discord OAuth, Postgres with RLS)
- **PWA**: `vite-plugin-pwa`
- **Payments** (planned): Xsolla

## Project Structure

```
src/           → React frontend (components, hooks, stores, lib, config, themes)
server/        → Rust/Axum multiplayer server (native binary in server/src)
server/core/   → dicesuki-core: shared physics/room engine (native + WASM targets)
server/wasm/   → wasm-bindgen host for the in-browser room worker
supabase/      → database migrations
docs/          → guides and ADRs
```

## Documentation

- **Guides**: [docs/guides/](docs/guides/) — [testing](docs/guides/testing.md),
  [server](docs/guides/server.md), [debugging](docs/guides/debugging.md),
  [patterns](docs/guides/patterns.md), [tech stack](docs/guides/tech-stack.md),
  [deployment](docs/guides/deployment.md), and more (see [index](docs/guides/index.md)).
- **Architecture Decision Records**: [docs/adrs/](docs/adrs/) — the authoritative source for
  architecture rules ([.claude/rules/architecture.md](.claude/rules/architecture.md)).
- **Contributor map**: [CLAUDE.md](CLAUDE.md).

## License

Application code: MIT. Monster Manual data has separate licenses: the 5e SRD 5.1 (2014) mechanics are CC BY 4.0; the adapted PF2e Remaster mechanics are ORC Licensed Material. Attribution, unchanged upstream notice, publication supplement and ORC license copy are bundled under [public/licenses/monster-manual](public/licenses/monster-manual/).

## Monster Manual

Open **My Dice Rolls → Monster Manual**. Search nine supported imported creatures: the original two NPCs and two monsters each from 5e SRD 5.1 (2014) and PF2e Remaster, plus Kobold Cavern Mage. **Refresh** retrieves the four 5e creature records and ten Priest spells, or the five PF2e actor records, and verifies their reviewed SHA-256 revisions. This is a bounded imported catalog with online verification, not whole-database federated search. Failure, changed-source and offline states retain the reviewed import.

Actions immediately roll physical room dice and replace only your dice. Attacks, typed damage components and own saves roll separately; target DCs are information. 5e supports advantage/disadvantage; PF2e strikes support explicit first/second/third attack MAP. Critical damage, multiattack sequences, reactions, conditions and resource-dependent spell automation must be resolved manually. Pure constant damage has no dice control. Solo uses the same Rust room engine through the wasm worker.

Reproduce the reviewed import with `node scripts/monster-manual/import.mjs --online`. It fails closed if upstream bytes changed; review a new revision before updating the registry. Provider retrieval and rules math live in separate modules under `src/lib/monsterManual`. Do not execute upstream formulas/macros or import artwork/lore.

Use Node 22 for checks: `npm run test -- --run --maxWorkers=2`, `npm run lint`, `npm run build`. Real Chrome/wasm smoke: `PLAYWRIGHT_TEST_PORT=18191 npx playwright test --config playwright.monster.config.ts`. Chrome must be installed; this configuration uses the installed browser, not mocked dice.

### Roll library

My Dice Rolls has Personal rolls and Monster Manual tabs. Add creature saves a complete, independent snapshot of supported attack/damage/own-save recipes; Roll executes through the native room backend and replaces your table dice. Saved kit variants retain 5e advantage/disadvantage and PF2e attack-ordinal MAP. Source refresh never rewrites saved kits. Unsupported rules remain manual.

Groups and creature roster are device-local, partitioned between guest and each account (`dicesuki-roll-library:v1:*`). They do not sync or migrate from guest on sign-in; existing personal roll sync/merge/tombstones remain unchanged. Removing a group moves its rolls to Ungrouped. Limits: 50 groups, 50 creature instances, 128 cards per kit, 80-character names, 1000 memberships and 2MiB per scope. Invalid entries are isolated; failed storage writes preserve prior library state and report failure. Auth loading hides/locks library; scope-generation tokens reject stale callbacks, including returning to the same account.

`npm run test:e2e:monster-manual` now exercises the integrated roster and personal organization, native signed totals/MAP/keep rules, reload, source refresh and responsive keyboard flows. Physical hardware and actual browser-toolbar 200% zoom remain distinct from automated viewport/CSS zoom checks.

### Saved spellbooks and abilities

New creature kits include source-backed spells, healing, checks and recharge rolls. The original eight creatures remain, with Kobold Cavern Mage as a ninth PF2e Remaster caster. The Priest uses its own level/slots, spell attack +5, Wisdom modifier +3 and DC 13; the PF caster uses rank 1, spell attack +10 and DC 18. Selectors describe source choices without tracking resource use. Information-only spells have mechanics and no Roll button.

Existing v1 kits continue to load and execute stored recipes without fetching creature or spell sources. Choose **Update spells & abilities** in a saved creature’s options to replace only that kit with the reviewed current definition, retaining its alias, position and other library data. Source Refresh does not update saved kits. New v2 snapshots retain compiled bounded recipes and source/license provenance; target save DCs remain separate from caster rolls.

Reproduce the reviewed import using `node scripts/monster-manual/import.mjs --evidence <creature-source-directory> --feature-evidence <spell-source-directory>`, or `--online` to retrieve the pinned registry URLs. Hash or pointer mismatches reject import. The normalized catalog contains mechanics only; full attribution remains bundled under `public/licenses/monster-manual/`.
