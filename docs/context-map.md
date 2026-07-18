# Dicesuki Context Map

Use this map to find the authoritative source and its executable backpressure.
Detailed operating notes live in the linked guides and ADRs.

| Domain | Authoritative source | Derived/runtime surface | Harness and delivery path |
|--------|----------------------|-------------------------|---------------------------|
| Collectible identity and assets | `src/config/collectibleCatalogSource.json`, production sidecars, `supabase/catalog/editions/` | `src/generated/collectibleCatalog.json`, Supabase catalog tables | `scripts/generate-collectible-catalog.js`, `scripts/check-immutable-catalog-history.js`, `docs/guides/collectible-catalog.md` |
| Runtime GLB delivery | Release source lock, production sidecars, `runtime-assets.json` | Bounded `/public/dice/` GLBs and thumbnails; lazy local/remote table rendering | `scripts/runtime-dice-assets/`, `npm run check:runtime-dice-assets`, `docs/guides/runtime-dice-assets.md` |
| Economy hypotheses and studies | `economy/contracts/editions/`, `economy/simulations/scenarios/` | Immutable disclosures and fixed-seed reports under `economy/disclosures/` and `economy/simulations/reports/`; no production consumer | `scripts/generate-economy-disclosures.js`, `scripts/economy-simulator.js`, `scripts/check-immutable-economy-history.js`, `docs/guides/economy-contracts.md` |
| Production earned economy and wallet | `economy/production/editions/`, `supabase/migrations/0009_earned_economy_ledger.sql` | Public immutable edition reads; authenticated own-wallet reads; service-role-only ledger appends | `scripts/validate-production-economy.js`, `scripts/test-supabase-postgres.mjs`, `supabase/tests/0009_earned_economy_ledger.test.*`, `docs/adrs/shared/014-earned-economy-ledger-foundation.md` |
| Authoritative earned rewards | `supabase/migrations/0010_earned_reward_claims.sql`, normalized from `earned-collection@1` | Service-only authoritative-roll ingest; authenticated non-anonymous status/passport/community RPCs; immutable enrollment and exact claim outcomes | `supabase/migrations/0010_earned_reward_claims.test.ts`, `supabase/tests/0010_earned_reward_claims.test.*`, `src/lib/earnedEconomy.ts`, ADR 014 |
| Entitlement authority | `supabase/migrations/0004_collectible_catalog.sql` | `src/lib/dataSync.ts`, local inventory projection | Migration/static tests and hosted role/RLS proof in `docs/guides/collectible-catalog.md` |
| Local inventory and gameplay | `src/store/useInventoryStore.ts`, `src/lib/diceSpawner.ts` | React/R3F solo experience | Co-located Vitest tests, `npm test`, `npm run build` |
| Multiplayer physics and protocol | `server/core/`, `server/src/` | Native Axum server and WASM room worker | Rust tests, WASM build, Playwright solo smoke; see multiplayer ADRs |
| CI and release gates | `package.json`, `.github/workflows/ci.yml` | Pull-request and `main` checks | Global immutable/contiguous migration history runs before sorted real-Postgres suites; domain history, generated-artifact, lint, Vitest, build, and Rust gates follow |

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

Migration `0010` is the earned-only collectible-grant boundary. It expands the
already-immutable reward pools from `earned-collection@1` into normalized
version/item rows, never another JSON snapshot. An account-first lock
serializes every roll credit and claim. Only trusted room-server completion
events can mint promotional Stars; local WASM solo has no callable path.
Claim outcomes link to exactly one immutable wallet-ledger row or one
`user_entitlements` row, while caller-controlled item, amount, user, and claim
index inputs do not exist.
