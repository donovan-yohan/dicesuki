# Dicesuki Context Map

Use this map to find the authoritative source and its executable backpressure.
Detailed operating notes live in the linked guides and ADRs.

| Domain | Authoritative source | Derived/runtime surface | Harness and delivery path |
|--------|----------------------|-------------------------|---------------------------|
| Collectible identity and assets | `src/config/collectibleCatalogSource.json`, production sidecars, `supabase/catalog/editions/` | `src/generated/collectibleCatalog.json`, Supabase catalog tables | `scripts/generate-collectible-catalog.js`, `scripts/check-immutable-catalog-history.js`, `docs/guides/collectible-catalog.md` |
| Runtime GLB delivery | Release source lock, production sidecars, `runtime-assets.json` | Bounded `/public/dice/` GLBs and thumbnails; lazy local/remote table rendering | `scripts/runtime-dice-assets/`, `npm run check:runtime-dice-assets`, `docs/guides/runtime-dice-assets.md` |
| Economy hypotheses and studies | `economy/contracts/editions/`, `economy/simulations/scenarios/` | Immutable disclosures and fixed-seed reports under `economy/disclosures/` and `economy/simulations/reports/`; no production consumer | `scripts/generate-economy-disclosures.js`, `scripts/economy-simulator.js`, `scripts/check-immutable-economy-history.js`, `docs/guides/economy-contracts.md` |
| Production earned economy and wallet | `economy/production/editions/`, `supabase/migrations/0009_earned_economy_ledger.sql` | Public immutable edition reads; authenticated own-wallet reads; service-role-only ledger appends | `scripts/validate-production-economy.js`, `scripts/test-wallet-ledger-postgres.mjs`, `supabase/tests/0009_earned_economy_ledger.test.sql`, `docs/adrs/shared/014-earned-economy-ledger-foundation.md` |
| Entitlement authority | `supabase/migrations/0004_collectible_catalog.sql` | `src/lib/dataSync.ts`, local inventory projection | Migration/static tests and hosted role/RLS proof in `docs/guides/collectible-catalog.md` |
| Local inventory and gameplay | `src/store/useInventoryStore.ts`, `src/lib/diceSpawner.ts` | React/R3F solo experience | Co-located Vitest tests, `npm test`, `npm run build` |
| Multiplayer physics and protocol | `server/core/`, `server/src/` | Native Axum server and WASM room worker | Rust tests, WASM build, Playwright solo smoke; see multiplayer ADRs |
| CI and release gates | `package.json`, `.github/workflows/ci.yml` | Pull-request and `main` checks | Immutable-history checks, generated-artifact checks, lint, Vitest, build, Rust tests |

## Economy boundary

Economy contracts, scenarios, and reports are frozen analysis inputs, not
launch rules. Production code
under `src/`, `server/src/`, `server/core/src/`, and `server/wasm/src/` may not
import them or the simulator. A future production pull service requires a
separate server-authoritative design, security review, and delivery slice.

The selected launch rules are copied into a separately validated immutable
production edition. Production validation never imports simulator code. Wallet
entries are currency history only; they do not create, revoke, or replace the
source-specific entitlement-grant history required by future commerce work.
