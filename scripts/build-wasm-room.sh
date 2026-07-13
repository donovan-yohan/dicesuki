#!/usr/bin/env bash
#
# build-wasm-room.sh — compile the dicesuki-core engine to an in-browser room
# worker module (issue #113) and emit an ES-module wasm-bindgen package into
# src/generated/wasm-room/.
#
# The engine is dicesuki-core compiled to wasm32-unknown-unknown; this crate
# (dicesuki-wasm) is thin wasm-bindgen glue only. The generated artifacts are
# COMMITTED to the repo (see src/generated/wasm-room/README.md) because the
# Vercel build has no Rust toolchain and cannot run this script — `npm run build`
# consumes the committed output.
#
# Toolchain prerequisites (documented in docs/guides/tech-stack.md):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version <matching Cargo.lock wasm-bindgen>
#   (optional) wasm-opt from binaryen for a further size pass
#
# Re-run this script after any change to dicesuki-core or dicesuki-wasm and
# commit the regenerated src/generated/wasm-room/ output.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
OUT_DIR="$REPO_ROOT/src/generated/wasm-room"
CRATE="dicesuki-wasm"
PROFILE="wasm-release"
TARGET="wasm32-unknown-unknown"
WASM_ARTIFACT="$REPO_ROOT/server/target/$TARGET/$PROFILE/dicesuki_wasm.wasm"

echo "[wasm-room] Building $CRATE ($PROFILE, $TARGET)..."
(cd "$REPO_ROOT/server" && "$CARGO" build -p "$CRATE" --profile "$PROFILE" --target "$TARGET")

# Locate wasm-bindgen: prefer PATH, fall back to the cargo bin dir.
BINDGEN="$(command -v wasm-bindgen || true)"
if [ -z "$BINDGEN" ] && [ -x "$HOME/.cargo/bin/wasm-bindgen" ]; then
  BINDGEN="$HOME/.cargo/bin/wasm-bindgen"
fi
if [ -z "$BINDGEN" ]; then
  echo "[wasm-room] ERROR: wasm-bindgen CLI not found." >&2
  echo "            Install it with: cargo install wasm-bindgen-cli --version 0.2.108" >&2
  exit 1
fi

echo "[wasm-room] Generating ES module bindings into src/generated/wasm-room/..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
"$BINDGEN" \
  --target web \
  --out-dir "$OUT_DIR" \
  --out-name dicesuki_wasm \
  "$WASM_ARTIFACT"

# Optional size pass with binaryen's wasm-opt, when available.
BG_WASM="$OUT_DIR/dicesuki_wasm_bg.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  echo "[wasm-room] Optimizing with wasm-opt -Oz..."
  wasm-opt -Oz "$BG_WASM" -o "$BG_WASM.opt"
  mv "$BG_WASM.opt" "$BG_WASM"
else
  echo "[wasm-room] wasm-opt not found — skipping extra size pass (optional)."
fi

SIZE="$(du -h "$BG_WASM" | cut -f1)"
echo "[wasm-room] Done. $BG_WASM ($SIZE)"
