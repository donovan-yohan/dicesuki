# ADR 011 - Durable Room Resume, Presence, and Host Controls

* Date: 2026/07/17
* Status: Accepted
* Deciders: Donovan, Development Team
* Amends: [ADR 002 - WebSocket JSON Protocol](002-websocket-json-protocol.md) and [ADR 005 - Room-First Architecture](005-room-first-local-loopback-architecture.md)

## Context

Mobile browsers routinely background, freeze timers, discard tabs, or briefly
lose network. Treating every socket close as a final leave loses a player's seat
and dice. At the same time, a held seat needs visible presence, deterministic host
handoff, and a host-controlled way to remove an unwanted participant.

## Decision

* Network-room clients keep a versioned, bounded per-room resume record in
  `localStorage`: room id, display name, color, opaque reconnect credential, and
  update time. The credential is generated only with Web Crypto and is never put
  in a URL, log, DOM node, or persisted server URL. At most 12 records are retained
  for seven days. This browser lifetime intentionally exceeds the server's 600-second
  seat grace: after grace, a valid saved room may rejoin as a fresh seat rather than
  reclaiming its former identity. The record is cleared only by explicit
  Leave or `removed_from_room`; normal unmount/background is a transient detach.
* `/room/:id` may automatically preflight and resume that exact saved room. Root
  navigation never redirects unexpectedly. Foreground, `pageshow`, and online
  events may bypass delayed retry after mobile timer suspension.
* The server pings each native WebSocket every 20 seconds and treats 60 seconds
  without any inbound frame/pong as a disconnect. A disconnected seat remains in
  the roster with `connected: false` for a 600-second grace window. Presence changes
  use `player_presence_changed`; only final expiry/leave uses `player_left`.
* Host transfers immediately to the oldest connected player when the host drops
  or leaves. A sole disconnected host retains host during grace. A returning former
  host never displaces an active successor.
* `remove_player { playerId }` is host-only and rejects non-host, unknown, and self
  targets. Success sends `removed_from_room`, then deletes the target seat,
  reconnect credential, and dice, broadcasting normal removal events. Removal is
  not a permanent ban, but the deleted connection has no authorized seat even if it
  ignores the notice.
* A reconnect credential is a bearer secret. An authenticated seat additionally
  requires the same authenticated user id on reclaim; a different or guest caller
  is rejected even with the credential. Guest seats remain bearer-only.
* WASM solo accepts the protocol union exhaustively but does not emulate network
  timeout/presence. Its sole player cannot remove itself.

## Consequences

Mobile return is resilient without weakening per-seat ownership. Other players can
distinguish a temporary disconnect from a final departure, and rooms remain
manageable after host loss. `localStorage` increases credential lifetime relative
to tab-only storage, so bounded retention, explicit clearing, CSPRNG generation,
and authenticated-seat binding are required security controls.
