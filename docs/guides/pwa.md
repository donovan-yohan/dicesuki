# PWA safety and offline behavior

## Installation

Settings has a compact **App** section. A completed solo roll qualifies install education on a later page visit, not on the first visit. A supported browser's native install prompt opens only from **Install Dicesuki**. A prompt event is consumed once. **Not now** and native dismissal suppress education for seven days; a fresh valid native event can still support a quiet manual Settings action. Safari on iPhone/iPad receives inline Share → Add to Home Screen instructions. Installed and embedded contexts do not receive install invitations.

Optional collectible assets are not all available offline. The loaded shell, local WASM engine and basic dice are the offline floor. An optional asset must have been fetched and retained within the runtime cache budget.

## Waiting updates

`src/lib/swUpdate.ts` checks for deploys on registration, visibility return and every 15 minutes. `src/sw.ts` keeps the next worker waiting. Updates are explicit in Settings. **Later** never queues an idle reload.

The action rechecks room/roll state, checkout creation and unresolved pending-order status, pull preparation/commit/recovery, and unacknowledged reveal. Hidden tabs receive the same protection. A nonempty solo table must be cleared; a shared room must be left. A terminal purchase status is distinct from a pending marker or a watcher TTL.

Forced activation conservatively requires one same-origin app window. With another window open, including a sleeping or legacy client, the worker refuses activation. Close the other tabs and explicitly retry, or close all app windows and let the browser activate the waiting worker naturally. This is not an all-idle multi-tab voting protocol. A page reserves account mutation admission while its activation request is accepted or uncertain.

Installing a candidate uses a separate precache namespace derived from the built HTML revision. Running clients retain their old core cache. Old fingerprinted chunks can be read from that cache after activation. Core caches are retired at a later activation with no open windows, not while a running document can still import its old chunks. Browsers can independently evict origin storage; an app cache is not durable account storage.

## Cache boundaries and budget

Only the core shell/engine/lighting is precached. `/dice/` is excluded from precache. Runtime caching accepts same-origin public dice GLB/bin/image paths, without query parameters or Authorization headers. API, auth, entitlement, economy, checkout and third-party responses have no runtime caching route. Checkout, multiplayer, API and auth navigations do not use the offline SPA fallback.

Each shell revision has a dice cache under `dicesuki-dice-assets-v2-<shell revision>`. A deploy cannot keep stale content at an unchanged model URL. Old dice-cache namespaces are retired on accepted activation. The current namespace has these ceilings:

- 192 MiB total response-body bytes.
- 24 MiB per entry. Larger downloads remain usable online but are not cached.
- 256 request entries, independent of the byte ceiling.

Writes are serialized. The measured byte count is stored in the same atomic Cache API entry as its body, not in a second bookkeeping database. Oldest entries are evicted before writing. Partial/error/opaque responses do not populate the cache. A cached full response can serve a range request. Cache pressure or a failed put must not delete pull/payment localStorage or guest inventory.

## Account and commerce recovery

Guest/basic/local dice remain playable offline. Authenticated server copies are still **not persisted** as a new ownership database. A same-account in-memory collection can remain visible read-only with an offline label. A cold offline launch without that snapshot falls back to basic/local dice and explains that reconnect is required to load the collection. Stale wallet values display as unavailable rather than asserting a zero balance.

Claim, pull, conversion and checkout dispatch recheck offline/update admission at their consuming boundary. No paid or valuable action is queued for reconnect. Connectivity return rehydrates the same account through `dataSync`; it does not submit a deferred purchase or pull. Account replacement/sign-out retains the existing generation and local/server-copy separation.

A pull's idempotency pointer must be durably readable before preparation. A failed prepared-pointer write stops before commit. A prepared pointer can recover a committed reward through `get_committed_pull_reveal` without preparing a new pull. Checkout will not hand off to its SDK if persisting its pending-order marker fails. Payments remain disabled unless the existing environment flag is enabled; this work does not activate payments or supply a payment form.

`/checkout/return` remains status-only. Query parameters cannot confirm a payment, grant an item or start another purchase. A return in another browser/installed storage container gives same-account/original-container recovery guidance. Existing order reads remain server-authoritative and RLS-scoped.

## Reproduce compiled-browser checks

`npm run test:e2e:pwa` uses `playwright.pwa.config.ts`, not the development server, where service workers are disabled. Supply two immutable production `dist` directories through `PWA_BUILD_A` and `PWA_BUILD_B`. B must differ and enable the existing sandbox checkout route for the no-marker status-only assertion. Use credential-free local QA configuration, never production credentials or a real purchase. A pair of actual release revisions is preferred for migration qualification; dark and flag-enabled builds of one revision also exercise the waiting-worker lifecycle.

```sh
npm ci
npx playwright install chromium
PWA_BUILD_A=/path/to/build-a/dist \
PWA_BUILD_B=/path/to/build-b/dist \
PWA_EVIDENCE_DIR=/path/to/evidence \
npm run test:e2e:pwa
```

The runner owns an ephemeral loopback HTTP server and closes it. It checks actual waiting/activation, multiple windows, Later, old chunk retention, cold offline WASM rolls, network-only API behavior, checkout return and real Cache API byte pressure beyond 64 entries. Generated one-MiB binary responses are cache fixtures, not rendered catalog models. Chromium's full browser channel is used so the actual GPU admission gate runs; software-only environments can legitimately fail that gate. `PWA_HEADED=1` selects a headed run without bypassing product admission.

Unit tests separately exercise live pull/purchase consumers, interrupted persistence, recovery and install/focus behavior. These are not real provider, installed iOS or notification delivery proof.

## Not implemented by this slice

There is no utility-push permission UI, subscription endpoint or delivery pipeline. A real implementation first needs an approved utility event, account-bound subscription storage, VAPID signing-key custody, a server delivery/retry/expired-endpoint cleanup owner, unsubscribe/sign-out behavior and receiving-device proof with the app closed. Do not request permission for a service that cannot deliver.

Recovery telemetry also needs a real operational sink and a minimal non-secret event contract before it can be called collected telemetry. Console output is not that sink. Real payment-provider, installed iOS, legacy auto-update migration and deployed-release acceptance remain separate qualification. This is a bounded contribution to issue 152, not completion of that issue.
