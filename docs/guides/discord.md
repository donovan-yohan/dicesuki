# Discord Integration

How Dicesuki meets Discord today (issues #84, #85) and where true Rich Presence
fits later (spike #86).

## What ships now

| Capability | Mechanism | Where |
|-----------|-----------|-------|
| Advertise live rooms with one-click Join (#84) | Server-side bot posts/updates a room-status **embed** per public room in a configured channel, via Discord REST | `server/src/discord.rs` |
| Join a room from a Discord link (#85) | Existing `/room/:id` deep-link join flow + OpenGraph unfurl so pasted links preview nicely | `api/og.js`, `vercel.json`, `index.html`, `src/components/multiplayer/MultiplayerRoom.tsx` (pre-existing) |

### Why a channel bot, not per-user Rich Presence

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

## How the room bot works (#84)

`server/src/discord.rs`, spawned from `main.rs` alongside the registry heartbeat.

- **Feature-gated, off by default.** Activates only when `DISCORD_BOT_TOKEN` +
  `DISCORD_CHANNEL_ID` + `APP_BASE_URL` are all set (see `.env.example`). Absent →
  silent no-op, server unchanged.
- Every `SYNC_INTERVAL` (30s) it reads **public** rooms from `RoomManager`
  (`is_public()` gate — unlisted rooms are never advertised) and reconciles the
  channel against live state:
  - new room → `POST /channels/{id}/messages` (embed + link-button Join)
  - changed room (players/name/theme) → `PATCH` the message (edits only on real
    change — no rate-limit churn)
  - vanished room → `DELETE` the message
- The Join button is a **link button** (component type 2, style 5) pointing at
  `<APP_BASE_URL>/room/<id>` — no interaction endpoint or gateway connection
  needed. Reconciliation is a pure planner (`plan_actions`) so it is unit-tested
  without a network.

**Caveats (document for operators):**

- Assumes a **single** advertising server instance per channel. If multiple room
  servers point at the same `DISCORD_CHANNEL_ID`, each posts its own embeds.
- On server restart the in-memory message map resets, so existing rooms are
  re-posted (old embeds may be orphaned until the room closes or you clear them).

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
   intents — the bot only makes REST calls.
3. **Invite the bot** to your server: *OAuth2 → URL Generator*, scope `bot`,
   permissions **Send Messages** + **Manage Messages** (Manage Messages lets it
   edit/delete its own advertisement embeds). Open the generated URL and add it to
   the server.
4. **Get the channel id**: enable *Developer Mode* (User Settings → Advanced),
   right-click the target channel → *Copy Channel ID* → `DISCORD_CHANNEL_ID`.
5. **Set the frontend origin**: `APP_BASE_URL` = your deployed frontend base
   (e.g. `https://dicesuki.app`), used to build `/room/<id>` join links.
6. **Provide the three env vars** to the room server (env/secret storage, e.g.
   the Docker deploy from #83). On next start the log prints
   `Discord room bot enabled: ...`.
7. **Verify**: create a **public** room, wait up to 30s, confirm an embed appears
   in the channel with the room name/theme/player count and a working **Join
   room** button. Change the player count and confirm the embed updates.

For the OG unfurl (#85), no Discord setup is needed — it works for any pasted
`/room/<id>` link once deployed on Vercel. Optional polish: drop a 1200×630
`public/og-image.png` and add an `og:image` tag to enrich the preview card.
