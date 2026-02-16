# Daisu - 3D Dice Simulator

> A physics-based 3D dice simulator with single-player and multiplayer support.

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests (Vitest) — 380 passing, 3 known failures |
| `npm run build` | Production build |
| `npm run dev` | Start dev server |
| `~/.cargo/bin/cargo test` | Run server tests (from server/ directory) — 76 total |

## Architecture

React 19 + Three.js + Rapier physics (WASM client / native Rust server). Zustand for state.
Dual physics: client-side for single-player, server-authoritative for multiplayer (20Hz snapshots).

```
src/           → React frontend (components, hooks, stores, lib, config, themes)
server/        → Rust/Axum multiplayer server (physics, WebSocket, rooms)
docs/guides/   → Detailed documentation (testing, patterns, debugging, etc.)
docs/adrs/     → Architecture Decision Records
docs/exec-plans/ → Execution plans (active + completed)
```

## Documentation Map

| Topic | Location |
|-------|----------|
| Testing & TDD | [docs/guides/testing.md](docs/guides/testing.md) |
| Git Workflow | [docs/guides/git-workflow.md](docs/guides/git-workflow.md) |
| Debugging | [docs/guides/debugging.md](docs/guides/debugging.md) |
| Code Patterns | [docs/guides/patterns.md](docs/guides/patterns.md) |
| Haptic Feedback | [docs/guides/haptic-feedback.md](docs/guides/haptic-feedback.md) |
| Custom Dice | [docs/guides/custom-dice.md](docs/guides/custom-dice.md) |
| Saved Rolls | [docs/guides/saved-rolls.md](docs/guides/saved-rolls.md) |
| Server (Rust) | [docs/guides/server.md](docs/guides/server.md) |
| Tech Stack | [docs/guides/tech-stack.md](docs/guides/tech-stack.md) |
| Changelog | [docs/guides/changelog.md](docs/guides/changelog.md) |
| Architecture Rules | [.claude/rules/architecture.md](.claude/rules/architecture.md) |
| ADRs | [docs/adrs/](docs/adrs/) |
| Active Plans | [docs/exec-plans/active/](docs/exec-plans/active/) |
| Completed Plans | [docs/exec-plans/completed/](docs/exec-plans/completed/) |

## Gotchas

- `cargo` not on PATH — use `~/.cargo/bin/cargo` for server commands
- axum 0.7.x uses `:param` path syntax (NOT `{param}` which is 0.8+) — wrong syntax silently never matches
- Zustand Map/Set updates require new instances (shallow equality) — never mutate in place
- Selective git commits: verify committed files don't import uncommitted code (local build passes, CI fails)
- 3 pre-existing test failures in `useHapticFeedback.test.ts` — don't fix unless asked
- All dice spawning goes through `src/lib/diceSpawner.ts` (single source of truth)

## Workflow

- Do NOT commit or push unless explicitly asked
- Use `/adr` skills for architectural decisions, NOT docs in CLAUDE.md
- Use `/harness:plan` for new features (routes through brainstorming + planning)
- Use `/harness:prune` if CLAUDE.md exceeds 120 lines or docs feel stale
- CLAUDE.md is a **map** — add detail to `docs/guides/*.md`, not here
