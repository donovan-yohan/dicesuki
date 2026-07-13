# `src/generated/wasm-room/` — generated WASM room engine (issue #113)

**Do not edit these files by hand.** They are produced by
[`scripts/build-wasm-room.sh`](../../../scripts/build-wasm-room.sh)
(`npm run build:wasm-room`) from the Rust crates `server/core` (`dicesuki-core`,
the engine) and `server/wasm` (`dicesuki-wasm`, the wasm-bindgen glue).

The `.wasm` here is the **same `dicesuki-core` engine the native multiplayer
server links**, compiled to `wasm32-unknown-unknown` — never a re-implementation
(epic #111 anti-drift guardrail).

## Why these artifacts are committed

The Vercel production build (`npm run build`) runs **without a Rust toolchain**,
so it cannot compile the WASM module itself. The generated ES-module package is
therefore **committed to the repository** and consumed directly by Vite/Vercel.

Tradeoff considered:

- **Committed artifacts (chosen).** Deploys need no Rust toolchain; `npm run
  build` works anywhere. Cost: a binary `.wasm` lives in git and must be
  regenerated + committed whenever `dicesuki-core` or `dicesuki-wasm` changes.
- **Build on CI/deploy (rejected).** Would keep git clean but requires
  installing `rustup` + the `wasm32` target + `wasm-bindgen-cli` in the Vercel
  build image, which is not available and slows every deploy.

## Regenerating

After any change to `server/core` or `server/wasm`:

```bash
npm run build:wasm-room   # rebuilds these files
git add src/generated/wasm-room
```

Toolchain prerequisites:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.108   # must match Cargo.lock's wasm-bindgen
# optional: binaryen's `wasm-opt` for a further -Oz size pass
```

The build uses the workspace `wasm-release` profile (`opt-level = "z"`, LTO,
`strip`) defined in `server/Cargo.toml`.
