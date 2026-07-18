# Dicesuki - 3D Dice Simulator

A physics-based 3D dice-rolling PWA with single-player and multiplayer support.

Dice physics run in one shared Rust core, `dicesuki-core`, compiled to two targets from a
single source (see [Shared-ADR-007](docs/adrs/shared)):

- **Solo** runs that core as a **WASM room** inside a Web Worker in the browser — no network,
  no local server. `npm run dev` is all solo needs.
- **Multiplayer** runs the same core as a **native Rust/Axum server** that owns physics and
  streams server-authoritative snapshots (60Hz) over a WebSocket room protocol.

Both modes flow through the identical room protocol; they differ only in player count and where
the room runs, never in code path.

## Quick Start

```bash
npm install       # install dependencies
npm run dev       # start the dev server (solo runs entirely in-browser)
npm test          # run unit tests (Vitest)
npm run build     # production build
npm run preview   # preview the production build
```

To rebuild the committed WASM room artifacts after changing `server/core` or `server/wasm`:

```bash
npm run build:wasm-room
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests (Vitest) |
| `npm run build` | Production build |
| `npm run dev` | Start dev server |
| `~/.cargo/bin/cargo test` | Run server tests (from `server/`) |

> `cargo` is not on `PATH` in this environment — use `~/.cargo/bin/cargo` for server commands.

## Tech Stack

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS
- **3D rendering**: Three.js via `@react-three/fiber` v9 (+ drei, postprocessing)
- **Physics**: Rapier, run inside `dicesuki-core` (never client-side) — one engine for solo and multiplayer
- **State**: Zustand
- **Multiplayer server**: Rust + Axum + Tokio (`server/`)
- **Identity & durable data**: Supabase (Discord OAuth, Postgres with RLS)
- **PWA**: `vite-plugin-pwa`
- **Payments** (planned): Xsolla

## Project Structure

```
src/           → React frontend (components, hooks, stores, lib, config, themes)
server/        → Rust/Axum multiplayer server (native binary in server/src)
server/core/   → dicesuki-core: shared physics/room engine (native + WASM targets)
server/wasm/   → wasm-bindgen host for the in-browser room worker
supabase/      → database migrations
docs/          → guides and ADRs
```

## Documentation

- **Guides**: [docs/guides/](docs/guides/) — [testing](docs/guides/testing.md),
  [server](docs/guides/server.md), [debugging](docs/guides/debugging.md),
  [patterns](docs/guides/patterns.md), [tech stack](docs/guides/tech-stack.md),
  [deployment](docs/guides/deployment.md), and more (see [index](docs/guides/index.md)).
- **Architecture Decision Records**: [docs/adrs/](docs/adrs/) — the authoritative source for
  architecture rules ([.claude/rules/architecture.md](.claude/rules/architecture.md)).
- **Contributor map**: [CLAUDE.md](CLAUDE.md).

## License

MIT
