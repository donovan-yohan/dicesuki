# Discord Integration

How Dicesuki meets Discord today (issues #84, #85, #246) and where true Rich
Presence fits later (spike #86).

## What ships now

| Capability | Mechanism | Where |
|-----------|-----------|-------|
| **Host-initiated room posting (#246)** | A room's host picks one of *their own* Discord servers + a channel; the room's advert embed posts there and live-updates, then **archives** when the room closes | `server/src/discord.rs`, `server/src/discord_api.rs`, `server/src/discord_targets.rs` |
| Legacy billboard (#84) | Optional: when `DISCORD_CHANNEL_ID` is set, every **public** room is also mirrored into that one operator-configured channel | `server/src/discord.rs` |
| Join a room from a Discord link (#85) | Existing `/room/:id` deep-link join flow + OpenGraph unfurl so pasted links preview nicely | `api/og.js`, `vercel.json`, `index.html`, `src/components/multiplayer/MultiplayerRoom.tsx` (pre-existing) |

## Multi-tenant model (#246)

Dicesuki's bot is **self-serve and multi-tenant**. There is no per-guild setup
and no hardcoded channel:

1. A guild admin installs the bot themselves via the invite URL.
2. **Nothing is ever auto-posted to any guild.** A room appears in a channel only
   because its host explicitly posted it from the Dicesuki share UI. (The
   operator's own server uses this same flow; the #84 billboard is a separate,
   optional legacy path.)
3. The target channel is per-guild *data chosen at post time*, not deployment
   configuration.

### Privacy guarantee: no cross-user guild leakage

**The bot's guild list never leaves the server.** `GET /api/discord/targets`
returns only guilds where *both* hold:

- the Dicesuki bot is installed, **and**
- the calling user is a **membership-verified** member of that guild.

Membership is proved bot-side with `GET /guilds/{guild.id}/members/{user.id}`.
That single-member lookup does **not** require the privileged `GUILD_MEMBERS`
intent — Discord documents that requirement on the *List* Guild Members endpoint,
not on the single-member GET — so the bot stays unprivileged and REST-only, and
no extra OAuth scope or user token is involved.

#### Where the caller's Discord id comes from — and where it must not

The Discord user id is read **only** from the Supabase Auth admin API
(`GET /auth/v1/admin/users/{id}` → `identities[]`), which Supabase writes on
OAuth link and the end user cannot touch. It is deliberately **not** read from
the access token: Supabase's `user_metadata` is `auth.users.raw_user_meta_data`,
which any signed-in user can rewrite with `PUT /auth/v1/user {"data": {...}}`,
and those keys ride along in their next token. Trusting a `provider_id` from
there would let anyone with a throwaway Discord account claim someone else's
identity and read their guild list. The token's `app_metadata` (Supabase-written,
user-immutable) is consulted only as a *negative* filter, to skip the lookup for
accounts with no Discord link.

Consequence for operators: **host posting needs `SUPABASE_SECRET_KEY`.** Without
a privileged credential there is no trustworthy identity source, so
`/api/discord/targets` returns an empty list for everyone. The server logs a
warning at startup when the bot is on but the credential is missing.

A channel is offered only when the **caller could have posted there themselves**
— they need `VIEW_CHANNEL` **and** `SEND_MESSAGES`, not just the bot. The bot
commonly holds `ADMINISTRATOR`, so filtering on its permissions alone would name
every private channel to every member, and permitting read-only channels would
let a rank-and-file member use the bot as a proxy to post in `#announcements`.
The caller's permissions are computed from their guild roles
(`GET /guilds/{id}/roles`) with the same documented algorithm.

#### Embed content is untrusted

These embeds are posted under the bot's identity into servers the room's host may
not control, so every client-supplied string (player display names, the
host-chosen `themeId`, a roll's saved-roll name) passes through one sanitizer —
`render_embed_text` — before it can enter a field value: control characters
collapse to spaces, a hard length cap applies, and Discord markdown is escaped —
including `[`, `]`, `(`, `)`, so a name like `[go](http://a.gd)` renders inert
instead of becoming a live masked link.

A **Recent rolls** line reads `Alex — 3d6 → 14 💥`, or
`Alex — Sneak Attack (3d6) → 14 💥` when the roll came from a saved roll (#244).
That name arrives as optional `savedRollName` display metadata on the room
protocol's `roll` message (same trust model as Shared-ADR-005 `presentation`:
never interpreted, never affects physics or totals). It is capped twice on
purpose — `SAVED_ROLL_NAME_MAX_LEN` (40) in core, so room state stays bounded no
matter what a client sends, and `SAVED_ROLL_LABEL_MAX_LEN` (32) at render, so the
line stays readable and the field stays inside Discord's 1024-character limit. It
deliberately does **not** reach `CompletedRoll`, the authoritative event the
server persists as durable roll history: unverified client text stops at the
room's in-memory display tail.

Consequences, all enforced server-side (client-side filtering would be no
enforcement at all):

- A caller with **no Discord identity** (guest, email-only) gets `{"guilds": []}`
  with a 200, not an error, so the UI can simply hide the option.
- `POST /api/rooms/:id/advertise` re-derives the caller's verified channel set
  from the server's own caches and rejects any `channelId` outside it. The
  client's claim about which guild a channel belongs to is never trusted.
- Every failure mode fails **closed**: an unreachable Discord, an unparsable
  permissions bitfield, or an errored membership lookup all yield "not a target".
- Guild ids, guild names, and channel lists are never written to the log; only
  counts are.

### Advert lifecycle: archive, don't delete

A host-posted embed is a **session record**, not just an advertisement:

| Phase | Behaviour |
|-------|-----------|
| Room live | Reconciler `PATCH`es the embed as players/theme/rolls change (edits only on a real change) |
| Room closes | One final `PATCH` rewrites it as an archive: the Join button is removed (`"components": []`), the colour goes grey, and a closing summary reports the final player list, session length, and the tail of the roll history |
| After close | The message **stays in the channel** as history. It is never deleted |

Legacy **billboard** posts keep the original #84 lifecycle and are deleted when
their room closes or goes unlisted.

### Endpoints (room server, authenticated)

Both require `Authorization: Bearer <supabase access token>`.

| Endpoint | Behaviour |
|----------|-----------|
| `GET /api/discord/targets` | `{"guilds": [{"id", "name", "icon", "channels": [{"id", "name"}]}]}` — membership-filtered, cached. A guild the bot is in but cannot post to anywhere is still listed with an empty `channels` array |
| `POST /api/rooms/:room_id/advertise` `{"channelId"}` | Host-only, rate-limited (5 burst, one refilled per 30s per user). `202` on success; `403 NOT_ROOM_HOST` / `403 CHANNEL_NOT_VERIFIED` / `403 NO_DISCORD_IDENTITY` / `404 ROOM_NOT_FOUND` / `409 TOO_MANY_ADVERTS` / `429 RATE_LIMITED` / `503 DISCORD_DISABLED` otherwise |

Caching: bot guild list, per-guild channels and roles ~60s; per-user membership
~5min; Supabase user → Discord user id ~10min. All caches are size-bounded, and
both endpoints are per-user rate limited (the listing fans out across every bot
guild on a cold cache, against the bot's shared Discord budget).

> **Caveat:** because `advertise` re-verifies against the same 5-minute
> membership cache the listing uses, a user removed from a guild keeps the
> ability to make the bot post there for up to `MEMBERSHIP_TTL`. Shorten that
> constant if a tighter revocation window matters more than the request volume.

## Why a channel bot, not per-user Rich Presence

"Rich Presence" classically means the game showing on a player's Discord
**profile**. That is not reachable from a pure web app:

- The official RPC mechanism talks to the **desktop client's local IPC socket** —
  desktop only, no browser path.
- The only in-browser presence path is the **Embedded App SDK** when the app runs
  as a Discord **Activity** inside a voice call. That is a later phase (spike #86:
  *GO, but after #84/#85 and the ADR-006 backend*), and depends on room servers
  sitting behind TLS/443 under a shared wildcard domain.

Rejected alternatives:

- **Desktop RPC bridge / arRPC** — requires the user to run extra local software;
  fragile, unofficial, wrong shape for a web app. Rejected.
- **Faking presence** — dishonest; rejected.

So #84 delivers the *same user value now* — a live, auto-updating billboard of
each room with a working Join — from authoritative server state. When the
Activity ships, `discordSdk.commands.setActivity(...)` provides real per-user
presence and this bot can remain as the channel-level billboard. **The seam is
documented in the spike (#86); no Activity code lands here.**

## How the room bot works (#84, #246)

`server/src/discord.rs`, spawned from `main.rs` alongside the registry heartbeat.

### Environment matrix

| Variable | Required for | Effect when unset |
|----------|--------------|-------------------|
| `DISCORD_BOT_TOKEN` | **everything** | Bot fully OFF; server unchanged |
| `APP_BASE_URL` | **everything** | Bot fully OFF (Join links are unbuildable) |
| `DISCORD_CHANNEL_ID` | legacy billboard only (#84) | No billboard; host-posted adverts still work |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | **host posting** (identity resolution) | No caller can be linked to a Discord account, so `/api/discord/targets` is empty for everyone and nothing can be advertised. Logged as a warning at startup. The billboard is unaffected |

The bot token is a **secret** — never committed, supplied via env/secret storage.

### The sync loop

Every `SYNC_INTERVAL` (30s) it snapshots all rooms from `RoomManager`, resolves
the set of adverts that *should* exist (`desired_adverts`), and reconciles:

- billboard targets: **public** rooms only (`is_public()` gate)
- host-posted targets: exactly the room whose host registered that channel —
  listed or not, because the host opted in explicitly

then applies the diff:

- desired (room, channel) with no message → `POST /channels/{id}/messages`
  (embed + link-button Join)
- changed advert (players/name/theme/rolls) → `PATCH` the message (edits only on
  a real change — no rate-limit churn)
- retired billboard post → `DELETE`
- retired host-posted advert → final archive `PATCH` (never deleted)

The Join button is a **link button** (component type 2, style 5) pointing at
`<APP_BASE_URL>/room/<id>` — no interaction endpoint or gateway connection
needed. Reconciliation is a pure planner (`plan_actions`) and target resolution
is a pure function (`desired_adverts`), so both are unit-tested without a
network; the Discord REST surface sits behind the `DiscordApi` trait
(`server/src/discord_api.rs`) and is mocked at that seam in tests.

### Channel postability

A channel is offered as a target only when it is a `GUILD_TEXT` (0) or
`GUILD_ANNOUNCEMENT` (5) channel **and** the bot holds `VIEW_CHANNEL` +
`SEND_MESSAGES` + `EMBED_LINKS` there. Permissions are computed with Discord's
documented algorithm: the guild-level `permissions` from `GET /users/@me/guilds`
(already `@everyone` ∪ the bot's roles) as the base, then the `@everyone`
overwrite, then the union of the bot's role overwrites (all denies before all
allows), then the bot's member overwrite — with an `ADMINISTRATOR` short-circuit.

**Caveats (document for operators):**

- Assumes a **single** advertising server instance per channel. If multiple room
  servers point at the same `DISCORD_CHANNEL_ID`, each posts its own embeds.
- Advert tracking is in-memory. On server restart the map resets, so live rooms
  are re-posted and any previously posted embed is orphaned (a host-posted embed
  is then never archived — persisting `room_adverts` in Supabase is the #246 v2
  follow-up).

## How join-from-Discord works (#85)

The deep-link join flow already existed (sharing epic): `/room/:id` →
`MultiplayerRoom` preflights `GET /api/rooms/:id` and shows kind errors for
**room-gone** (404) and **server-down** (network), while the store surfaces
**room-full** (`ROOM_FULL`) and room-closed. This issue makes those links unfurl
in Discord:

- `vercel.json` rewrites `/room/:id` → `/api/og?id=:id`.
- `api/og.js` (Vercel serverless, no secrets) fetches the real built
  `index.html` — so humans still get the working SPA + client routing — and
  injects room-specific OpenGraph/Twitter tags into `<head>` for the crawler.
- `index.html` carries default OG tags for the root and non-room routes.

The bot's Join button and any pasted room link land in the **same** join flow —
no duplicate join screen.

> Enhancement seam: the unfurl currently echoes the room id. Richer per-room
> detail (name/theme/player count) in the card needs a cross-instance
> room-detail endpoint; deliberately deferred to keep this small.

## Owner checklist — one-time Discord app + bot setup

These are manual steps in the Discord Developer Portal / your server. Do them once
to turn the bot on; nothing here is committed.

1. **Create the application** at <https://discord.com/developers/applications> →
   *New Application*. (Reuse the existing app if you already made one for Discord
   OAuth in #81.)
2. **Add a bot user**: *Bot* tab → *Add Bot*. Copy the **token** (this is the
   secret → `DISCORD_BOT_TOKEN`). You do **not** need any privileged gateway
   intents — the bot only makes REST calls, and the single-member membership
   lookup it relies on is not gated by `GUILD_MEMBERS`.
3. **Build the invite URL** that guild admins will use (this is the self-serve
   install link the share sheet offers): *OAuth2 → URL Generator*, scope `bot`,
   permissions **View Channel** + **Send Messages** + **Embed Links** +
   **Manage Messages** (Manage Messages lets it edit/archive its own embeds).
4. **Set the frontend origin**: `APP_BASE_URL` = your deployed frontend base
   (e.g. `https://dicesuki.app`), used to build `/room/<id>` join links.
5. *(Optional, legacy #84 billboard only)* **Get the channel id**: enable
   *Developer Mode* (User Settings → Advanced), right-click the target channel →
   *Copy Channel ID* → `DISCORD_CHANNEL_ID`. Leave unset for the host-posting
   model.
6. **Provide the env vars** to the room server (env/secret storage, e.g. the
   Docker deploy from #83). On next start the log prints
   `Discord room bot enabled: ...`.
7. **Verify**: sign in with Discord, open a room you host, post it to a server
   from the share sheet, and confirm an embed appears with the room
   name/theme/player count and a working **Join room** button. Change the player
   count and confirm the embed updates; close the room and confirm the embed
   turns into a closing summary with no Join button.

For the OG unfurl (#85), no Discord setup is needed — it works for any pasted
`/room/<id>` link once deployed on Vercel. Optional polish: drop a 1200×630
`public/og-image.png` and add an `og:image` tag to enrich the preview card.
