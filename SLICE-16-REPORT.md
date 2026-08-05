# Slice 16 Report — Lunar Pass client surface

## Summary and status

**Status: implemented within the Slice 16 boundary. Targeted tests and the
production build pass. The exact full suite is not green because this sandbox
blocks the three pre-existing immutable-history tests from spawning Git.**

The authenticated Shop now contains a dormant-aware Lunar Pass surface:

- the locked $2.99 monthly offer, with 300 Stars on purchase, 90 Stars per UTC
  day, and a derived 3,000-Star monthly total;
- an offer/subscriber state machine derived from the existing server-owned
  subscription snapshot;
- pre-launch auto-renewal and provider-cancellation disclosure copy;
- a guarded, typed daily-claim flow with pending, success, same-day replay,
  error, balance-refresh, UTC countdown, and exact-midnight reset states;
- no subscription purchase path, including when the general payments flag is
  enabled.

Guests remain unchanged because `ShopPanel` still returns before rendering any
shop content unless authentication status is `authenticated`
(`src/components/panels/ShopPanel.tsx:29-30,96`). `WalletHud`, navigation,
backend migrations/functions, and payment checkout wiring were not changed.

The Slice 13 store exposed the raw Lunar subscription snapshot but no
client-side entitlement derivation. The task's conditional store allowance was
therefore used for one additive pure selector; the store shape and actions are
unchanged.

## Changed files and exact line ranges

### Production

- `src/lib/lunarPass.ts:1-223`
  - typed daily receipt and `LunarPassClaimError` contract (`:4-41`);
  - strict receipt/date/amount parsing and SQLSTATE mapping (`:43-133,159-190`);
  - owner-readable receipt preflight for replay advice (`:135-157`);
  - optional injected-client `claimLunarDailyStars` RPC wrapper
    (`:192-223`).
- `src/components/panels/lunarPassOffer.ts:1-18`
  - single client offer contract citing product spec §3.1;
  - derives 3,000 from 300 + (90 × 30), rather than duplicating the total.
- `src/components/panels/LunarPassCard.tsx:1-421`
  - offer/subscriber projection and exact entitlement-boundary scheduling
    (`:17-74,368-408`);
  - claim state, account/subscription scope guard, committed-success handling,
    and best-effort refresh (`:30-44,120-174`);
  - receipt-day UTC reset scheduling and countdown (`:84-118,296-317,410-420`);
  - offer, renewal, cancellation, daily-expiry, dormant-button, and
    provider-management copy (`:176-365`).
- `src/components/panels/ShopPanel.tsx:13,37-38,268-274`
  - mounts the Lunar card with scalar subscription/refresh selectors while
    preserving the existing authenticated panel and conversion flow.
- `src/store/useWalletStore.ts:48-71`
  - minimal exported pure `selectIsLunarPassEntitled(state, at)` selector;
    no store field or action was added or changed.

### Tests

- `src/lib/lunarPass.test.ts:1-169`
  - exact no-argument RPC call, strict receipt projection, fresh/replay advice,
    prior-day distinction, SQLSTATE mapping, missing configuration, transport
    failures, and fail-closed malformed responses/history.
- `src/components/panels/ShopPanel.test.tsx:1-535`
  - guest behavior, locked constants, subscription × payments-flag matrix,
    strict entitlement boundary, renewal/end/provider copy, disclosure copy,
    claim/replay/error flows, one-refresh reconciliation, double-tap guard,
    account-switch isolation, and receipt-day midnight reset;
  - retains the pre-existing conversion and dormant bundle coverage.
- `src/store/useWalletStore.test.ts:1-79`
  - exact active/non-renewing/canceled truth table, including null, invalid,
    equal, and past boundaries plus invalid evaluation times.

This report is the only additional repository-root artifact created for the
required handoff.

## Subscription state machine

The server predicate documents why `active` ignores dates and why bounded
states use their respective Xsolla terminal dates
(`supabase/migrations/0023_subscription_status.sql:515-524`). Its executable
arms are:

- `active`;
- `non_renewing` with non-null `date_next_charge` and
  `p_at < date_next_charge`;
- `canceled` with non-null `date_end` and `p_at < date_end`
  (`supabase/migrations/0023_subscription_status.sql:557-578`).

The client selector mirrors those arms at
`src/store/useWalletStore.ts:55-70`. In particular, equality is expired and a
missing, invalid, or past bounded date fails closed.

| Snapshot at client time | Entitled | Shop projection |
|---|---:|---|
| no subscription | no | locked offer and disabled dormant subscribe button |
| `active` | yes, regardless of dates | `Active · renews <date>` when valid, otherwise `Active`; daily claim |
| `non_renewing`, valid future `dateNextCharge` | yes | `Ends <date>`; daily claim |
| `non_renewing`, null/invalid/equal/past boundary | no | offer |
| `canceled`, valid future `dateEnd` | yes | `Ends <date>`; daily claim |
| `canceled`, null/invalid/equal/past boundary | no | offer |

The card schedules a render at a bounded subscription's exact terminal instant
so it does not depend on an unrelated store event to return to the offer
(`src/components/panels/LunarPassCard.tsx:56-74`). The general payments flag
changes dormant button wording only. The button remains disabled and has no
handler under either flag state (`src/components/panels/LunarPassCard.tsx:234-252`)
because the Lunar SKU and subscription-law launch wiring do not exist yet.

## Offer, disclosure, and claim semantics

### Offer and compliance copy

The product contract locks $2.99 per month, 300 Stars on purchase, and 90 Stars
per day for a 3,000-Star month
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:293-303`).
Those values are single-sourced by
`src/components/panels/lunarPassOffer.ts:3-18`, with the daily amount shared
from `src/lib/lunarPass.ts:4-8`.

Spec §3.4 requires auto-renewal disclosure, clear renewal terms, and
frictionless cancellation as an independent launch gate
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:331-335`).
The dormant offer therefore places this explicit line next to the disabled
subscription control:

> Subscription automatically renews monthly at $2.99 until canceled. Cancel
> anytime through your payment provider.

That placement makes the future purchase layout disclosure-ready rather than
adding terms after activation (`src/components/panels/LunarPassCard.tsx:224-252`).
Entitled users also see provider-managed manage/cancel copy
(`:354-361`). This slice provides copy and placement only; it does not claim
that the subscription-law gate or an actual frictionless cancellation path is
complete. Spec §3.6 still requires both #154 and subscription-law clearance
before launch
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:346-349`).

### Daily claim wrapper and UI

Spec §3.5 deliberately records the paid-pass claim-or-lose tradeoff
(`docs/exec-plans/active/2026-07-22-monetization-economy-spec.md:337-344`).
Migration 0024 implements one current-UTC-day claim with no retroactive bank
and fixes the purchase/daily amounts at 300/90
(`supabase/migrations/0024_lunar_pass_faucet.sql:1-12`).

The database checks for and returns an existing same-day immutable receipt
before rechecking current entitlement
(`supabase/migrations/0024_lunar_pass_faucet.sql:153-160,186-205`). Otherwise it
rechecks the exact 0023 entitlement arms and appends one 90-Star promotional
ledger entry and receipt (`:208-279`). The public RPC derives caller, current
time, amount, product, and subscription server-side
(`:289-308`).

`claimLunarDailyStars(client?)`:

- reads the latest owner-visible receipt id, then calls the no-argument
  self-only RPC (`src/lib/lunarPass.ts:135-157,200-215`);
- treats every valid RPC receipt as claimed-today truth;
- advises `alreadyClaimed: true` when the returned immutable receipt id existed
  before this invocation (`:159-190`);
- validates singleton/object shape, positive ids, calendar-valid UTC day,
  coherent claim timestamp, and the locked 90-Star amount (`:43-117,159-190`);
- maps SQLSTATE `55000` to `not_entitled`, `28000`/`42501`/`PGRST301` to
  `unauthenticated`, missing configuration to `not_configured`, and all other
  backend/transport failures to `rpc_failure` (`:9-41,119-133,200-223`).

The UI never auto-claims. A user tap is guarded by an in-flight ref, a valid
entitled view, and the current user/subscription scope
(`src/components/panels/LunarPassCard.tsx:120-149`). A valid receipt immediately
sets claimed-today truth; wallet refresh runs exactly once and remains
best-effort so a reconciliation failure cannot turn a committed grant into a
claim error (`:150-174`). Claimed state clears at the exact next UTC midnight
derived from the authoritative receipt day (`:84-118`).

## Adversarial review and closure

One adversarial review was run before final gates. It concentrated on the risky
seams rather than reopening unrelated Shop behavior: stale asynchronous claim
completion after an account/subscription change, exact entitlement and UTC
timer boundaries, replay discrimination, malformed server data, and accidental
purchase reachability.

The valid findings were batched into one fix pass:

- claim completion is scoped to the invoking user and subscription and ignored
  after a scope change or unmount;
- Shop keys the card by user/subscription so local claim state does not cross
  identity boundaries;
- bounded subscriptions schedule their exact terminal transition;
- claimed state schedules from the receipt's UTC day rather than only the
  browser's current calendar day;
- receipt-history advice and RPC receipts fail closed on malformed shapes;
- the absent Lunar SKU remains unreachable under both payment-flag states.

One focused re-review covered those changed seams and found no remaining P0/P1
finding. The remaining advisory risks are recorded below; broad review was not
restarted because the fix batch did not introduce a new architecture or public
protocol.

## Verification

All commands ran from
`/home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets`.

### Targeted Slice 16 matrix

```text
npm test -- --run src/lib/lunarPass.test.ts src/store/useWalletStore.test.ts src/components/panels/ShopPanel.test.tsx
```

```text
Test Files  3 passed (3)
Tests       68 passed (68)
Duration    5.58s
Exit        0
```

### Exact full suite

```text
npm test
```

```text
Test Files  3 failed | 130 passed
Tests       17 failed | 1269 passed
Duration    17.85s
Exit        1
```

All 17 failures are confined to the three pre-existing immutable-history
suites:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Each fails at its nested Git subprocess with:

```text
Error: spawnSync git EPERM
```

All Slice 16 tests passed in this exact full-suite run. This report does not
claim the full suite is green.

### Production build

```text
npm run build
```

```text
catalog/economy/runtime-asset/dice-manifest validators passed
1215 modules transformed
built in 5.78s
PWA precache  24 entries
Exit        0
```

The build emitted only the existing advisory that some minified chunks exceed
500 kB. TypeScript compilation and the production bundle completed.

## Risks and follow-ups

1. **Replay advice has a concurrent-tab race.** The owner-readable preflight is
   advisory. If another tab creates today's receipt between this tab's preflight
   and RPC, the RPC correctly returns the immutable existing receipt but this
   wrapper may label `alreadyClaimed` false. The UI still reaches the correct
   claimed-today state and the database still credits exactly once.
2. **One selected store snapshot is not an any-row entitlement query.**
   `fetchLunarSubscription` returns one ranked row. If multiple same-status Lunar
   subscription rows exist, that selected snapshot might not be the row that
   makes the server's `exists` predicate true. This is an existing read-boundary
   behavior outside Slice 16.
3. **Browser time drives presentation scheduling.** The receipt's authoritative
   `utcDay` anchors the reset boundary, but the countdown and timer scheduling
   use the device clock. A materially incorrect device clock can make the
   presentation early or late; the RPC remains authoritative.
4. **The general payment flag is not a Lunar launch flag.** Enabling
   `VITE_PAYMENTS_ENABLED` does not create a subscription SKU, checkout action,
   cancellation path, or legal clearance. The Lunar control intentionally
   remains disabled.
5. **Full-suite sandbox limitation.** The three immutable-history suites must be
   rerun in normal CI or another environment that permits Node to spawn Git.

## Boundary and repository state

- Branch: `econ/16-lunar-client`
- Base working-tree HEAD: `d7c4cce7d905a54ff850cc0c14752f8c110e6652`
- Backend/migrations changed: no
- Navigation changed: no
- `WalletHud` changed: no
- Purchase or subscription checkout path added: no
- Store shape/actions changed: no
- Commit created: no

Unrelated pre-existing untracked Slice task/report/design files were preserved.

## Provenance

The binding main runtime configuration is read from
`/home/donovanyohan/.codex/config.toml:1-2`:

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "high"
```

The collaboration surface did not expose a worker model override, so this
report makes no unverified worker-model claim.

---

# Revision 2 — Friendly economy error copy

Revision 1 is preserved above. This revision records the Slice 16 fix task only.

## Fix summary

- `LunarPassCard` now recognizes `LunarPassClaimError` and maps every declared
  kind to short player-facing copy:
  - `not_entitled`: prompts for an active Lunar Pass;
  - `unauthenticated`: asks the player to sign in again;
  - `not_configured`: says daily Lunar claims are temporarily unavailable;
  - `rpc_failure`: uses the neutral daily-claim retry message.
- `ShopPanel` now recognizes `WalletConversionError` and maps every declared
  conversion kind:
  - `invalid_request`: asks for a valid roll quantity;
  - `insufficient_funds`: explains that the player lacks enough Stars;
  - `rpc_failure`: uses the neutral conversion retry message.
- Unknown or non-typed failures use neutral retry copy in both flows. Raw
  exception messages, RPC operation names, backend details, and SQLSTATE codes
  are no longer rendered.
- Successful claim and conversion notices use `role="status"` with polite live
  announcements. Claim and conversion failures alone use `role="alert"`; the
  contradictory `aria-live="polite"` attribute was removed from errors.

## Regression coverage

`ShopPanel.test.tsx` now rejects the real mocked claim with:

```text
new LunarPassClaimError(
  'membership lookup failed inside claim_lunar_daily_stars',
  'not_entitled',
  '55000',
)
```

The test asserts that friendly Lunar Pass copy appears, the raw backend detail
does not appear, and the error alert is not marked polite.

The conversion equivalent rejects with a real `WalletConversionError` of kind
`insufficient_funds` and code `22003`. It likewise proves that friendly copy
appears while the raw operation detail does not. Existing conversion-success
coverage now also checks that the success notice remains a polite status.

## Revision 2 worker verification

```text
npm test -- --run src/lib/lunarPass.test.ts src/store/useWalletStore.test.ts src/components/panels/ShopPanel.test.tsx
```

```text
Test Files  3 passed (3)
Tests       68 passed (68)
Duration    5.83s
Exit        0
```

```text
npx eslint src/components/panels/LunarPassCard.tsx src/components/panels/ShopPanel.tsx src/components/panels/ShopPanel.test.tsx
```

```text
ESLint: No issues found
Exit: 0
```

```text
git diff --check
```

```text
Exit: 0
```

## Revision 2 closure gates

```text
npm test
```

```text
Test Files  3 failed | 130 passed (133)
Tests       17 failed | 1269 passed (1286)
Duration    18.42s
Exit        1
```

All 17 failures are confined to:

- `scripts/check-immutable-catalog-history.test.ts`
- `scripts/check-immutable-economy-history.test.ts`
- `scripts/check-immutable-migration-history.test.ts`

Each fails because its nested Git subprocess is blocked by this sandbox:

```text
Error: spawnSync git EPERM
```

`ShopPanel.test.tsx` passed all 27 tests within this full run. No Slice 16 test
failed.

```text
npm run build
```

```text
verified 69 catalog items
verified 1 immutable economy contract
verified 1 simulation scenario
verified 1 production edition
runtime dice asset validation passed for all 3 listed sets
dice manifest validated: 4 sets / 19 dice
1215 modules transformed
built in 6.02s
PWA precache  24 entries
Exit        0
```

The build emitted only the existing advisory that some minified chunks exceed
500 kB.

The focused adversarial review found no P0/P1 issue. Its sole P2 finding was
that the full suite and production build were still pending; the evidence above
resolves that finding.

## Revision 2 boundary

Changed for this fix:

- `src/components/panels/LunarPassCard.tsx`
- `src/components/panels/ShopPanel.tsx`
- `src/components/panels/ShopPanel.test.tsx`
- `SLICE-16-REPORT.md` (this appended revision)

No backend, store, navigation, checkout, shared notice component, or unrelated
production surface was changed. No commit was created.
