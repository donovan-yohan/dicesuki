# Slice 11 Report — Xsolla recurring webhook dispatch

## Summary

The signed `xsolla-webhook` pipeline now handles all four Xsolla subscription
lifecycle notifications through migration 0023's service-only
`record_subscription_event` RPC. The dispatch layer:

- validates the migration 0023 field contract before calling the RPC, while
  normalizing vendor-only `date_create` fields on non-renewal/cancel events;
- accepts a bounded string subscription ID or stringifies a finite numeric ID,
  while rejecting arrays, objects, booleans, empty strings, non-finite numbers,
  and values longer than 255 characters;
- resolves `user.id` through the existing `userExists` dependency and returns
  `400 INVALID_USER` without an RPC call when it cannot resolve;
- forwards parsed identifiers, exact event dates, the verified raw envelope,
  and the raw-body SHA-256 to the subscription RPC;
- returns `204 No Content` for both new receipts and idempotent duplicate rows;
- lets RPC failures escape pure dispatch, then maps them through the
  Web-standard HTTP seam used by the Edge handler to `500` so Xsolla retries
  without advancing sequential delivery; and
- leaves the existing payment, refund, signature-failure, and unknown-event
  behavior unchanged.

The raw-body SHA-256 is computed only in `xsolla-webhook/index.ts`, where the
exact signed request bytes still exist. It is passed explicitly through the
HTTP/dispatch seam into `recordSubscriptionEvent`; no JSON reserialization is
used for the digest.

## Files and lines

| File | Changed lines | Result |
|---|---:|---|
| `supabase/functions/_shared/webhookDispatch.ts` | +199 / -0; subscription contract at lines 61–105, vendor-date normalization at 289–304, dispatch at 270–375, HTTP seam at 382–410 | Adds subscription dependency/arguments, validation/normalization, user resolution, and the testable 204/500 response boundary. |
| `supabase/functions/xsolla-webhook/index.ts` | +43 / -3; SHA-256 at lines 83–88, RPC wiring at 158–182, HTTP seam use at 219–227 | Computes SHA-256 from raw bytes, calls `record_subscription_event`, and uses the tested response seam while preserving error logging. |
| `supabase/functions/_shared/webhookDispatch.test.ts` | +336 / -0; helper coverage at lines 67–75, subscription matrix at lines 236–555, unknown behavior at lines 573–583 | Covers official event shapes, required/meaningful forbidden fields, normalization, IDs, users, raw hash, duplicates, actual empty 204, actual JSON 500, logging, and unchanged unknown behavior. |
| `supabase/functions/README.md` | +30 / -1; subscription operations at lines 90–117 | Documents canonical event fields, normalization, official references, 204 responses, sequential delivery/retries, and sandbox limitations. |
| `SLICE-11-REPORT.md` | new file, 157 lines | Records implementation, event behavior, exact gates, risks, and provenance. |

No SQL, client code, other Edge Functions, or other production files changed.

## Event-to-behavior contract

| Event | Required fields | Forbidden non-null dates | Successful behavior |
|---|---|---|---|
| [`create_subscription`](https://developers.xsolla.com/webhooks/subscriptions/created-subscription/) | `subscription_id`, `plan_id`, `date_create`, `date_next_charge`, resolvable `user.id` | `date_end` | Call `record_subscription_event`; new or duplicate row → `204`. |
| [`update_subscription`](https://developers.xsolla.com/webhooks/subscriptions/updated-subscription/) | `subscription_id`, `plan_id`, `date_next_charge`, resolvable `user.id` | `date_create`, `date_end` | Call `record_subscription_event`; new or duplicate row → `204`. |
| [`non_renewal_subscription`](https://developers.xsolla.com/webhooks/subscriptions/nonrenewing-subscription/) | `subscription_id`, `date_next_charge`, resolvable `user.id` | `date_end` | Accept optional vendor `date_create`, retain it only in `rawPayload`, pass `dateCreate: null`, then new/duplicate row → `204`. |
| [`cancel_subscription`](https://developers.xsolla.com/webhooks/subscriptions/canceled-subscription/) | `subscription_id`, `date_end`, resolvable `user.id` | `date_next_charge` | Accept optional vendor `date_create`, retain it only in `rawPayload`, pass `dateCreate: null`, then new/duplicate row → `204`. |
| Unknown notification type | none added | none added | Existing `{ ok: true, ignored: type }` response remains `200`. |

For every known subscription event, a missing/invalid required field or a
meaningfully forbidden date returns `400 INVALID_PARAMETER` without calling
the RPC. A supplied `date_create` on non-renewal/cancel is accepted, retained
only in the immutable raw payload, and normalized to `null` for the RPC.
Unresolvable users return `400 INVALID_USER` without calling the RPC. RPC
exceptions are not caught by pure dispatch; the tested response seam used by
the Edge handler returns `500 INTERNAL_ERROR`, preserving retry semantics.

## Test output

Exact command:

```text
npm test -- webhookDispatch
```

Exact result:

```text
> dicesuki@0.1.0 test
> vitest webhookDispatch


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/functions/_shared/webhookDispatch.test.ts (38 tests) 17ms

 Test Files  1 passed (1)
      Tests  38 passed (38)
   Start at  03:57:20
   Duration  570ms (transform 49ms, setup 100ms, collect 35ms, tests 17ms, environment 322ms, prepare 6ms)
```

Exact command:

```text
npm test -- supabase/functions
```

Exact result:

```text
> dicesuki@0.1.0 test
> vitest supabase/functions


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/functions/_shared/catalog.test.ts (5 tests) 3ms
 ✓ supabase/functions/_shared/xsollaSignature.test.ts (11 tests) 7ms
 ✓ supabase/functions/_shared/xsollaToken.test.ts (8 tests) 4ms
 ✓ supabase/functions/_shared/webhookDispatch.test.ts (38 tests) 19ms

 Test Files  4 passed (4)
      Tests  62 passed (62)
   Start at  03:57:23
   Duration  778ms (transform 156ms, setup 425ms, collect 132ms, tests 32ms, environment 1.45s, prepare 25ms)
```

Exact orchestrator gate:

```text
rtk npm run lint
```

Exact result line:

```text
> eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
```

The lint command exited `0` with no warnings. `git diff --check` also completed
with no whitespace errors.

## Risks and limitations

1. The Publisher Account webhook test button cannot emit subscription events.
   End-to-end vendor proof requires a real sandbox subscription lifecycle. A
   sandbox plan with `trial=0` shortens renewal testing, but does not replace
   lifecycle exercise.
2. Vitest covers pure dispatch, the Web-standard HTTP 204/500 seam used by the
   entrypoint, and all existing signature helpers, but does not import the
   Deno-only Edge entrypoint. SHA-256 and Supabase RPC parameter wiring still
   need sandbox runtime smoke.
3. Xsolla provides no subscription event ID and may deliver duplicates. The
   webhook intentionally relies on migration 0023's semantic-date plus raw-body
   hash dedupe and treats either returned receipt row as `204` success.
4. Sequential delivery means a false 2xx would hide a missing lifecycle event.
   Subscription RPC errors therefore deliberately remain retryable 500s; an
   operationally persistent database/configuration error can block later
   subscription events until corrected.

## Provenance

- Implementation worker runtime model id: `gpt-5.6-terra`
- Implementation worker runtime effort: `xhigh`
- Worker effort source: runtime environment `CLAUDE_EFFORT=xhigh`
- Orchestrator runtime model id: `gpt-5.6-sol`
- Orchestrator reasoning effort: `high`
- Orchestrator provenance source: active runtime config keys `model` and
  `model_reasoning_effort` in `/home/donovanyohan/.codex/config.toml`

The agentic-engineering-delivery workflow supplied the intent/context/harness
map and the final contract/diff review. The executable Vitest suites remain the
authoritative local proof; vendor sandbox lifecycle evidence remains an
explicit follow-up gate.

---

# Revision 2 — poison-event queue-stall closure

## Outcome

Revision 2 closes both deterministic-rejection paths identified in review:

- subscription timestamps now require an RFC 3339 shape and an exact calendar
  field round-trip before they can reach PostgreSQL, so values such as
  `2026-02-30T10:00:00Z` return `400 INVALID_PARAMETER`;
- subscription envelopes are UTF-8 encoded after serialization and rejected
  above migration 0023's exact `65536`-byte bound;
- `dispatchWebhook` now requires `bodySha256` at the TypeScript signature and
  every call site supplies it;
- the `recordSubscriptionEvent` dependency classifies SQLSTATE `22023`,
  `22007`, and `22008` as deterministic, logs a loud `drained-invalid` marker,
  and returns an explicit drained result that the dispatcher branches on to
  produce `204`;
- all other RPC failures still throw through the HTTP seam to `500`, preserving
  retries for connection, serialization, and other transient failures; and
- the unused `SubscriptionRpcResult.duplicate` field was removed. Its
  replacement, `drainedInvalid`, is populated by the dependency and consumed by
  dispatch.

The dependency adapter is kept in the pure shared module with its RPC call and
logger injected. The Deno entrypoint supplies the real Supabase RPC and
`console.error`, which makes the production behavior directly testable without
importing the Deno-only entrypoint under Vitest.

## Changed files

| File | Revision 2 result |
|---|---|
| `supabase/functions/_shared/webhookDispatch.ts` | Adds strict calendar round-trip validation, the exact UTF-8 payload limit, the deterministic subscription rejection classifier/adapter, the required hash argument, and the consumed drained marker. |
| `supabase/functions/xsolla-webhook/index.ts` | Uses the tested subscription dependency adapter with the real Supabase RPC and loud error-level drain logging. |
| `supabase/functions/_shared/webhookDispatch.test.ts` | Adds compile-level signature proof, invalid-calendar and oversized UTF-8 cases, all three deterministic SQLSTATE drain cases, and a transient RPC-to-500 case. |
| `supabase/functions/README.md` | Documents deterministic drain versus transient retry behavior for sequential subscription delivery. |
| `SLICE-11-REPORT.md` | Preserves revision 1 verbatim and appends this revision 2 evidence. |

No SQL or other files were changed for this fix.

## Exact required test evidence

Command executed through the required RTK passthrough:

```text
rtk proxy npm test -- webhookDispatch
```

Underlying exact requested command and result:

```text
> dicesuki@0.1.0 test
> vitest webhookDispatch


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/functions/_shared/webhookDispatch.test.ts (43 tests) 20ms

 Test Files  1 passed (1)
      Tests  43 passed (43)
   Start at  04:16:38
   Duration  591ms (transform 52ms, setup 101ms, collect 39ms, tests 20ms, environment 334ms, prepare 5ms)
```

Command executed through the required RTK passthrough:

```text
rtk proxy npm test -- supabase/functions
```

Underlying exact requested command and result:

```text
> dicesuki@0.1.0 test
> vitest supabase/functions


 RUN  v4.0.8 /home/donovanyohan/Documents/Programs/personal/dicesuki-worktrees/slice1-roll-tickets

 ✓ supabase/functions/_shared/xsollaToken.test.ts (8 tests) 4ms
 ✓ supabase/functions/_shared/xsollaSignature.test.ts (11 tests) 7ms
 ✓ supabase/functions/_shared/catalog.test.ts (5 tests) 3ms
 ✓ supabase/functions/_shared/webhookDispatch.test.ts (43 tests) 21ms

 Test Files  4 passed (4)
      Tests  67 passed (67)
   Start at  04:16:42
   Duration  623ms (transform 175ms, setup 407ms, collect 145ms, tests 35ms, environment 1.42s, prepare 26ms)
```

Additional focused compile/lint evidence:

```text
rtk npx tsc --noEmit --skipLibCheck --moduleResolution Bundler --module ESNext --target ES2022 --lib ES2022,DOM --types vitest/globals --allowImportingTsExtensions supabase/functions/_shared/webhookDispatch.ts supabase/functions/_shared/webhookDispatch.test.ts
TypeScript: No errors found

rtk npx eslint supabase/functions/_shared/webhookDispatch.ts supabase/functions/_shared/webhookDispatch.test.ts --report-unused-disable-directives --max-warnings 0
ESLint: No issues found
```

`rtk git diff --check` also exited `0` with no whitespace errors.

## Review and remaining caveat

The focused adversarial pass verified that all three deterministic SQLSTATEs
take the explicit drain branch, the marker is both returned and logged, and a
representative connection-class error still reaches the actual `500` response
seam. It also verified that the UTF-8 test exceeds the byte limit while its
JavaScript character count remains below it, preventing a character-count
implementation from passing accidentally.

As in revision 1, the Deno entrypoint itself is not imported by Vitest and a
real Xsolla sandbox subscription lifecycle remains the runtime smoke gate.
Revision 2 reduces that untested surface by moving the full RPC parameter
wiring, classification, result, and logging contract into the injected adapter
covered by the shared test suite.
