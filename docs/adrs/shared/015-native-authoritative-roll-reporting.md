# ADR 015: Native authoritative-roll completion reporting

**Status:** Accepted

## Context

ADR 014 and migration `0010` established a service-only, exactly-idempotent
Postgres boundary for earned roll completions, but the native multiplayer room
server did not produce those events. The old settlement host inferred
`RollComplete` from any newly-settled die. A later collision/re-settle could
repeat that inference, while spawn, drag, and motion activity were not tied to
one explicit player command. The browser/WASM room must remain unable to mint
Stars.

The native host also cannot make HTTP calls while holding the room write lock.
A best-effort detached request would silently lose rewards during an outage;
an unbounded queue would merely move the outage into memory pressure. Finally,
PostgREST retries must preserve the exact `server_event_id`, completion time,
and payload hash expected by migration `0010`.

## Decision

Treat each accepted explicit `Roll` command as one monotonic per-seat
generation. Freeze the initiating Supabase user id and sorted dice-id set at
initiation. Core consumes the pending generation exactly once only after that
exact set has settled. Re-settles, spawn settling, drag, and motion without a
pending explicit roll cannot manufacture another completion. A newer accepted
roll supersedes an unfinished older generation.

Keep the privileged transport native-only. Inject a cheap-clone
`RollReporter` through Axum application state into each WebSocket/simulation
host. Existing `build_app(manager)` callers receive an explicitly disabled
reporter; the native binary resolves privileged configuration and uses
`build_app_with_reporter`. Guest completions are skipped before event
construction, and the WASM host has no reporter dependency or credential path.

Canonical completion schema v1 binds these fields, in fixed struct order:

- schema version and `authority = server-authoritative-room`;
- event id, initiating user id, process instance, room, player, and roll
  sequence;
- UTC completion time normalized to PostgreSQL's microsecond precision;
- sorted presentation-free `(diceId, diceType, faceValue)` results and total.

The event id is
`roll.v1:{instance}:{room}:{player}:{sequence}`. SHA-256 is computed from the
canonical compact JSON. The reporter freezes the RPC JSON bytes once and posts
exactly `p_user_id`, `p_server_event_id`, `p_payload_sha256`, and
`p_completed_at` to
`/rest/v1/rpc/record_authoritative_roll_completion`. Presentation metadata is
never authority input.

Use one shared privileged Supabase adapter for the registry and reporter. It
accepts a validated root HTTPS URL (loopback HTTP only), prefers a dedicated
`sb_secret_...` key sent only as sensitive `apikey`, and retains the deprecated
legacy service-role JWT fallback as `apikey` plus bearer during migration. The
HTTP client refuses redirects and has bounded connect/request timeouts. No
secret, user id, canonical payload, request body, or response body is logged.

Place immutable events on a bounded Tokio mpsc queue with fixed worker
concurrency. `send().await` supplies backpressure after the simulation releases
the room write lock; no event is dropped to make space. A worker retries the
same immutable bytes indefinitely after a network failure, 408, 429, or 5xx,
using equal jitter over the upper half of a capped exponential window. This
retains randomized variance at the 30-second cap without allowing zero-delay
hot loops. Other responses are permanent:
they do not hot-loop, they emit only the HTTP status, and they leave reporter
health sticky-unhealthy. Transient health returns to healthy after the exact
event succeeds. `/health` exposes only `disabled`, `healthy`, or `unhealthy`
while keeping the room service alive.

This is explicitly **in-process at-least-once delivery plus database
exactly-once application**. It is not a durable outbox. A process crash after a
gameplay completion is broadcast but before the RPC commits can lose that
reward. Restart-proof zero loss requires a separate persistent outbox (or an
equivalent durable queue) and acknowledgment/replay design. Until then, the
public `RollComplete` message proves gameplay settlement, not reward credit.

## Consequences

- Explicit roll identity and single consumption replace settlement inference;
  a knock/re-settle cannot double report one command.
- Auth identity is frozen at initiation, so reconnect or later authentication
  cannot retroactively turn a guest roll into an earned event.
- Physics and WebSocket access never wait on HTTP while a room lock is held.
  A prolonged outage can eventually backpressure completed simulations rather
  than dropping or allocating without bound.
- PostgREST uncertainty is safe within one process because every retry is byte
  identical and migration `0010` returns exact replays while rejecting event-id
  mismatches.
- A deployment with only public `SUPABASE_URL` configured stays alive with a
  visibly disabled reporter. `SUPABASE_URL` plus a server credential is a valid
  reporter-only configuration: backend credentials do not opt into the rooms
  registry. Setting `PUBLIC_URL` is registry intent and still requires the
  project URL and dedicated server secret. Configured permanent reporter
  failures are visible without leaking the rejected response body.
- The remaining restart-loss window is documented rather than hidden. Any
  product promise of zero lost earned rolls must first add a durable outbox.

## Proof

Core tests prove monotonic generations, initiation identity/dice freezing,
single completion consumption, guest behavior, supersession, and the absence
of spawn/re-settle manufactured completions. Native reporter tests lock a fixed
canonical JSON/SHA-256 vector, result order independence, microsecond time,
event validation, exact RPC path/body, both redacted credential modes,
transient retry/recovery, saturated equal-jitter variance/capping, permanent
no-retry health, and bounded queue backpressure. Registry tests prove that only
`PUBLIC_URL` opts the registry in and that intended partial config fails closed.

The runtime integration test path continues to call `build_app(manager)` and
therefore cannot contact Supabase. Production activation additionally requires
the owner-supplied Render secret and a hosted database event/ledger proof.
