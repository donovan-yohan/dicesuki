# ADR 006 - Supabase Hybrid Backend Architecture (Auth + Durable Data)

* Date: 2026/07/13
* Status: Accepted
* Deciders: Donovan, Development Team

## Context

Dicesuki has no auth, profiles, or durable storage today. Inventory, saved rolls, and
settings live in `localStorage` via zustand/persist (Frontend-ADR-002). Epic #66
requires a backend platform that provides:

- **Accounts** with Discord OAuth as the primary login and a preserved guest mode (#81).
- **Profile/settings storage** plus **server-side sync** of inventory and saved rolls,
  with a local cache and a migration path from existing local data (#82).
- A **public room registry/browser** where physics servers running on personal dev
  boxes (WSL2 today, Docker → dedicated host later) register and are discovered (#83).
- Later: **Discord Rich Presence** and possibly **Discord Activities** (embedded iframe
  app, with CSP/proxy constraints).

Several hard constraints shape the decision:

- The physics server is **already Rust/Axum**, **server-authoritative**, WebSocket over
  HTTP/1.1 (Shared-ADR-002), with `INSTANCE_ID` logging and a stale-room cleanup task
  (Server-ADR-001). Physics **stays on the dev-box Axum server** regardless of choice —
  no managed platform runs our Rapier simulation. ADR 005 already models solo play as a
  one-player local loopback room, so the room is the single dice primitive.
- This is **hobby-scale D&D**: dozens to low-hundreds of players, not thousands. Free
  tiers are the relevant cost bracket, and ops burden dominates dollar cost.
- The data is **relational** (users → profiles, inventory items, saved rolls, room
  rows). A SQL/Postgres shape fits far better than a document store.

The decision therefore splits into two coupled questions: (1) **where identity and
durable data live**, and (2) **how dev-box room servers register and get discovered**.
The registry answer falls out of the data answer, so it is folded into the decision
below. Full options analysis with vendor pricing/limits is in issue #80's options
comment.

## Decision

The project MUST adopt a **Supabase hybrid backend** (Option B from issue #80).
Supabase owns identity and durable data; the dev-box Axum room servers remain
authoritative for physics and gain thin JWT verification plus heartbeat-based
registration.

The canonical Supabase project is the fresh project **`nksxdfcjabgbxeefwkdc`** (the
project id is public-safe and may appear in client configuration and docs). It starts
without legacy production data, so rollout applies the repository migrations in order
instead of migrating data from the retired project.

### Identity and Durable Data Live in Supabase

- Supabase MUST hold identity via **Discord OAuth as the primary provider** (native
  social provider), with **guest mode preserved** for account-free play.
- Durable user data MUST live in **Supabase Postgres with Row-Level Security (RLS)**:
  `profiles`, `settings`, dice `inventory`, and `saved_rolls`. A player MUST only be
  able to write their own rows; RLS enforces per-user authorization declaratively rather
  than through hand-written checks.
- The frontend MUST use the **Supabase JS client** for auth and data sync. Local
  cache/offline behavior and the first-sign-in migration path from existing
  `localStorage` data MUST be preserved per Frontend-ADR-002 (versioned persisted
  stores; no direct Map/Set persistence). Detailed sync/migration design belongs to #82.

### Dev-Box Axum Servers Stay Physics-Authoritative, Add JWT Verification

- The room servers MUST remain exactly as they are for physics and gain a **JWT
  verification middleware**. Supabase issues asymmetric (JWKS) JWTs, so the Axum server
  MUST verify a player's token locally against Supabase's cached JWKS URL — no shared
  secret and no per-request callout. This is how a room server authenticates users on
  `join`.

### Public Rooms Registry Supersedes Ad-Hoc Discovery

- A Supabase **`rooms` registry table** MUST be the source of truth for room discovery,
  superseding any ad-hoc discovery mechanism. On startup each dev-box server MUST upsert
  a row keyed by its `INSTANCE_ID` (public URL, player count, `last_heartbeat`) and
  heartbeat every N seconds; the existing stale-cleanup pattern (Server-ADR-001) evicts
  dead rows. The client's room browser MUST be a public-read query (optionally Supabase
  Realtime for live updates). This satisfies #83's "register with INSTANCE_ID."

### Distribution Artifact

- The **Docker image MUST be the distribution artifact** for the room server, targeting
  a future dedicated container host while running on dev boxes (WSL2) today.

### Secrets Management

- The Supabase **anon key is public-safe** and MAY live in client environment
  configuration (it is protected by RLS).
- The **service-role key** and any **JWT signing secret** are **owner-provided secrets**
  and MUST NEVER be committed to the repository. They are supplied via environment/secret
  storage on the systems that need them.
- The **Supabase project id is public-safe** and may appear in client env and
  documentation (including this ADR).

## Alternatives Considered

**Option A — Self-host everything on the Axum server (Postgres + OAuth crate):**
Rejected. Adding Postgres (sqlx) and hand-rolled Discord OAuth/session/RLS-equivalent
logic to the Rust server puts the entire security burden and a weak single-dev-box
backup story on us, with the highest effort to a secure v1 and login availability tied
to the dev box. Managed auth retires the highest-risk, lowest-fun work; the OSS/Docker
self-host escape hatch means we can still migrate to A later without an auth rewrite.

**Option C — Clerk for auth only + our own Postgres:** Rejected. Clerk has excellent
auth DX but **no database**, so inventory/saved-rolls/settings and the room registry
still need a Postgres somewhere — either A's dev-box backup problem or a second managed
service. It duplicates a service Supabase already bundles and has no self-host escape,
adding moving parts for no benefit over B at this scale.

**Firebase:** Rejected. Discord is **not a native Firebase provider** (it needs
custom-token minting or an awkward OIDC path), and Firestore's document model is a poor
fit for relational inventory. Weakest on both axes that matter here (Discord-first,
relational data), plus proprietary Google lock-in.

## Consequences

### Positive

- **Discord OAuth becomes a checkbox**, not a subsystem — the highest single risk is
  retired.
- Postgres + RLS fits the relational inventory model and provides per-user authorization
  declaratively.
- Auth and data survive a dev-box reboot; **backups are Supabase's responsibility**, so
  the collection-loss risk of a self-hosted-only design disappears.
- Room servers stay thin: they add roughly one middleware plus one heartbeat writer, no
  auth storage.
- Free tier comfortably covers hobby scale (50k MAU; the whole dataset is tiny).
- **Self-host escape preserved:** Supabase is open-source and Docker-self-hostable, so
  choosing it now does not lock us out of Option A later.

### Negative / Considerations

- A third-party dependency sits in the login path; a Supabase outage blocks new sign-in
  (rooms already in progress keep running).
- Free projects **auto-pause after 7 days of no DB activity** (~30s cold wake). This is
  neutralized by the room-server heartbeat we are building anyway; Pro (~$25/mo) removes
  it if ever wanted.
- Two systems to reason about (Supabase + Axum) and one integration seam (JWT verify +
  registry writes).
- For **Discord Activities** later, Supabase lives on `*.supabase.co`, so we would add a
  URL-mapping entry and route its calls through the `<app_id>.discordsays.com` proxy (or
  proxy them via the Axum server) — one extra config step.
- Shared physics/arena constants still require manual client/server synchronization
  (unchanged from ADR 001/003/005).

## References

- Builds on ADR 001/003 (shared physics constants), ADR 002 (WebSocket JSON Protocol),
  and ADR 005 (Room-First Local Loopback Architecture — the room is the single dice
  primitive).
- Epic #66 (backend platform for accounts, profiles, and persistence).
- Decision source: issue #80 options comment (Option B — Supabase hybrid, recommended).
- Downstream implementation: #81 (Discord auth + guest mode + profile), #82 (Postgres
  tables + RLS + local-cache/migration), #83 (Axum JWT middleware + `rooms` heartbeat +
  TLS/WS reverse proxy).
- Supabase project id: `nksxdfcjabgbxeefwkdc` (public-safe).
</content>
</invoke>
