# syntax=docker/dockerfile:1
#
# Multi-stage build for the Dicesuki multiplayer room server.
# Build context is ./server for Railway and Render.
#
#   docker build -t dicesuki-server ./server
#   docker run --rm -p 8080:8080 dicesuki-server
#
# The image ships ONLY the Rust room server (REST + WebSocket). The frontend
# is a static Vite SPA hosted separately (see docs/guides/deployment.md).

# ---- Build stage ---------------------------------------------------------
FROM rust:1.93-slim AS builder

WORKDIR /app

# Copy all workspace manifests first, including non-default members. Cargo
# resolves every declared member even when only the native server is built.
# Stub targets keep the dependency layer independent of source changes.
COPY Cargo.toml Cargo.lock ./
COPY core/Cargo.toml core/Cargo.toml
COPY wasm/Cargo.toml wasm/Cargo.toml
RUN mkdir src core/src wasm/src \
    && echo 'fn main() {}' > src/main.rs \
    && echo '// dependency-cache stub' > src/lib.rs \
    && echo '// dependency-cache stub' > core/src/lib.rs \
    && echo '// dependency-cache stub' > wasm/src/lib.rs \
    && cargo build --release --locked --jobs 2

# Copy the real source and build the release binary. Touching the sources
# invalidates the stub fingerprint so the crates themselves are recompiled.
COPY src/ src/
COPY core/src/ core/src/
COPY wasm/src/ wasm/src/
RUN touch src/main.rs src/lib.rs core/src/lib.rs wasm/src/lib.rs \
    && cargo build --release --locked --jobs 2

# ---- Runtime stage -------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# ca-certificates for any outbound TLS; then create an unprivileged user.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --user-group --no-create-home --shell /usr/sbin/nologin daisu

COPY --from=builder /app/target/release/dicesuki-server /usr/local/bin/dicesuki-server

USER daisu

# Runtime env vars. Bind address is always 0.0.0.0. INSTANCE_ID is
# auto-generated (8-char nanoid), not configurable.
#
#   Core (existing):
#     PORT         TCP port (default 8080)
#     RUST_LOG     env_logger filter (default info)
#     CORS_ORIGIN  frontend origin; unset = permissive dev mode
#
#   Supabase JWT verification (ADR 006, optional — guest play works without it):
#     SUPABASE_URL                project base, e.g. https://<proj>.supabase.co
#                                 (also selects the JWKS URL + expected issuer).
#                                 Defaults to the ADR 006 project if unset.
#
#   Rooms registry heartbeat (ADR 006, OFF unless intentionally configured):
#     SUPABASE_URL                as above
#     SUPABASE_SECRET_KEY         *** SECRET — preferred dedicated sb_secret_
#                                 backend key. Never bake into the image or
#                                 commit; pass at run time via -e / secret store.
#     SUPABASE_SERVICE_ROLE_KEY   deprecated legacy JWT fallback only; never set
#                                 it to an sb_secret_ key.
#     PUBLIC_URL                  this server's public base behind the TLS proxy,
#                                 e.g. https://rooms.example.com
ENV RUST_LOG=info \
    PORT=8080
EXPOSE 8080

# Health: GET /health -> {"status":"ok","instanceId":"..."}
CMD ["dicesuki-server"]
