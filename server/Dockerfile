# syntax=docker/dockerfile:1
#
# Multi-stage build for the Daisu multiplayer room server.
# Build context is ./server (see server/render.yaml -> dockerContext).
#
#   docker build -t daisu-server ./server
#   docker run --rm -p 8080:8080 daisu-server
#
# The image ships ONLY the Rust room server (REST + WebSocket). The frontend
# is a static Vite SPA hosted separately (see docs/guides/deployment.md).

# ---- Build stage ---------------------------------------------------------
FROM rust:1.93-slim AS builder

WORKDIR /app

# Copy manifests first so the dependency layer is cached independently of
# source changes. dicesuki-server is a lib + bin crate, so both src/lib.rs
# and src/main.rs must exist for `cargo build` to resolve the manifest.
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && echo '// dependency-cache stub' > src/lib.rs \
    && cargo build --release || true

# Copy the real source and build the release binary. Touching the sources
# invalidates the stub fingerprint so the crate itself is recompiled.
COPY src/ src/
RUN touch src/main.rs src/lib.rs && cargo build --release

# ---- Runtime stage -------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# ca-certificates for any outbound TLS; then create an unprivileged user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --user-group --no-create-home --shell /usr/sbin/nologin daisu

COPY --from=builder /app/target/release/dicesuki-server /usr/local/bin/dicesuki-server

USER daisu

# Runtime env vars: PORT (default 8080), RUST_LOG (default info),
# CORS_ORIGIN (unset = permissive dev mode). Bind address is always
# 0.0.0.0. INSTANCE_ID is auto-generated (8-char nanoid), not configurable.
ENV RUST_LOG=info \
    PORT=8080
EXPOSE 8080

# Health: GET /health -> {"status":"ok","instanceId":"..."}
CMD ["dicesuki-server"]
