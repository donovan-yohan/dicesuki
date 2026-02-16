# Multiplayer Dice Rooms — Design Document

**Date:** 2026-02-15
**Status:** Approved

---

## Problem

Daisu is currently a single-player dice simulator. TTRPG players want to roll dice together in shared sessions — seeing each other's dice on a shared table with real physics interactions.

## Solution

Add multiplayer dice rooms where up to 8 players join via shared link, roll dice on a shared physics table, and see each other's results in real-time.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Physics authority | Server-side (Rust + native Rapier3D) | Perfect consistency across all clients; anti-cheat |
| Transport | WebSocket (JSON) | Industry standard for web games; proven at scale; excellent Rust support |
| Sync strategy | 20Hz snapshot + client interpolation | 3x less bandwidth than full streaming; proven technique; imperceptible delay for dice |
| Room identity | Share link + display name | Low friction; no accounts needed; great for in-person TTRPG |
| Single-player | Unchanged (client-side Rapier) | No regressions; works offline; zero latency |
| Backend host | Fly.io | First-class WebSocket/Rust support; multi-region; auto-stop billing |
| Roll model | Free-form (anyone anytime) | Matches real table behavior; simplest to implement |
| Dice rendering | Same scene, player-customizable colors | Immersive shared table feel |

## Architecture

```
Clients (React + R3F, render only)  ←—WebSocket—→  Fly.io (Rust + Rapier, physics authority)
```

- Server runs Rapier at 60Hz per active room
- Server sends position/rotation snapshots at 20Hz
- Clients interpolate for smooth 60fps (lerp position, slerp quaternion)
- No `<Physics>` provider in multiplayer mode — dice are positioned meshes only
- Rooms are ephemeral (in-memory, 30-min idle timeout)

## MVP Scope

**In:** Rooms (create/join via link), shared dice scene, per-player ownership, free-form rolling, customizable player colors, room roll history, 8 players, 30 dice max

**Out:** Device motion, haptics, saved rolls/bonuses, inventory system, custom dice (GLB), accounts, persistent rooms, chat, GM controls, spectators, multi-region deployment

## Implementation Plans

See [multiplayer-00-overview.md](./2026-02-15-multiplayer-00-overview.md) for the ordered list of implementation plan documents.
