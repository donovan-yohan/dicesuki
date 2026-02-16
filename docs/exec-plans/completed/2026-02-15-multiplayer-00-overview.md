# Multiplayer Dice Rooms — Implementation Overview

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement each plan doc task-by-task.

**Goal:** Add multiplayer dice rooms where up to 8 players join via shared link, roll dice on a shared physics table, and see each other's rolls in real-time.

**Architecture:** Rust server (native Rapier3D physics) on Fly.io communicates with browser clients via WebSocket. Server runs physics at 60Hz, streams snapshots at 20Hz. Clients interpolate for smooth 60fps rendering. Single-player mode is unchanged (client-side Rapier).

**Tech Stack:**
- Server: Rust, rapier3d, tokio, tokio-tungstenite, serde, hyper
- Client: React 19, React Three Fiber, Zustand, react-router-dom
- Transport: WebSocket (JSON messages)
- Hosting: Fly.io (server), existing static host (frontend)

---

## Plan Documents (execute in order)

| # | Document | Description | Dependencies |
|---|----------|-------------|--------------|
| 01 | [multiplayer-01-rust-server-core](./2026-02-15-multiplayer-01-rust-server-core.md) | Rust project scaffold, message types, room manager, player struct | None |
| 02 | [multiplayer-02-server-physics](./2026-02-15-multiplayer-02-server-physics.md) | Rapier physics world, dice geometries, face detection, simulation loop | 01 |
| 03 | [multiplayer-03-websocket-networking](./2026-02-15-multiplayer-03-websocket-networking.md) | WebSocket handler, HTTP API, message routing, connection lifecycle | 01, 02 |
| 04 | [multiplayer-04-client-foundation](./2026-02-15-multiplayer-04-client-foundation.md) | Shared message types, routes, multiplayer stores, WebSocket hook | None (parallel with 01-03) |
| 05 | [multiplayer-05-client-scene](./2026-02-15-multiplayer-05-client-scene.md) | MultiplayerScene, MultiplayerDie, snapshot interpolation | 04 |
| 06 | [multiplayer-06-client-ui](./2026-02-15-multiplayer-06-client-ui.md) | Room join flow, player list, room header, roll history, toolbar | 04, 05 |
| 07 | [multiplayer-07-integration-deployment](./2026-02-15-multiplayer-07-integration-deployment.md) | Fly.io deployment, CORS, env config, end-to-end testing | 01-06 |

## Parallel Execution

Plans 01-03 (server) and 04-06 (client) can be developed in parallel since they share only the message protocol (defined in both 01 and 04).

```
01-rust-server-core ──→ 02-server-physics ──→ 03-websocket-networking ──┐
                                                                         ├──→ 07-integration
04-client-foundation ──→ 05-client-scene ──→ 06-client-ui ─────────────┘
```

## Key Design Decisions

- **Server-authoritative physics**: Rust server runs Rapier natively, all clients receive identical state
- **Snapshot + interpolation**: 20Hz server snapshots, client lerp/slerp for smooth 60fps
- **WebSocket over JSON**: Simple, debuggable; optimize to binary later if needed
- **No client-side Rapier in multiplayer**: `<Physics>` provider is not rendered; dice are positioned meshes only
- **Single-player unchanged**: Existing client-side Rapier, stores, and features are untouched
- **Ephemeral rooms**: In-memory only, destroyed when empty for 30 minutes

## MVP Scope

**In:** Room creation/joining, shared dice scene, per-player dice ownership, free-form rolling, color-coded dice, room roll history, 8 players, 30 dice limit

**Out:** Device motion, haptics, saved rolls/bonuses, inventory system, custom dice, accounts, persistent rooms, chat, GM controls, spectators, multi-region

## Shared Constants (must match between server and client)

```
Gravity:              -9.81 m/s^2
Dice restitution:     0.3
Dice friction:        0.6
D6 chamfer radius:    0.08
Rest velocity:        0.01 m/s (linear + angular)
Rest duration:        500ms
Roll horizontal:      1-3 units
Roll vertical:        3-5 units
Max dice velocity:    25 m/s
Snapshot rate:        20Hz (every 3rd physics tick)
Physics tick rate:    60Hz
Max players:          8
Max dice:             30
Room idle timeout:    30 minutes
```
