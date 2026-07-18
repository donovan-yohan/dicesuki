# Deployment & Playtest

> How to run the Dicesuki playtest stack: the Rust room server + the static frontend.

## Architecture recap

Dicesuki is two independently deployable pieces:

| Piece | What it is | How it's served |
|-------|-----------|-----------------|
| Room server | Rust/Axum binary (`server/`) — REST + WebSocket only | Long-running process / container |
| Frontend | Vite SPA (`src/` → `dist/`) — static files | Any static host (Vite preview, Netlify, Vercel, nginx, S3…) |

**The room server does NOT serve static files** (routes are only `/health`, `/api/rooms`, `/api/rooms/:id`, `/ws/:room_id`; see `server/src/lib.rs`). So the Docker image below is the **room server only**. The frontend is built and hosted separately, and connects to the server via a build-time URL (see [Frontend → server wiring](#frontend--server-wiring)). This is the simplest layout that yields one runnable server artifact and mirrors the production split (server on Render, static frontend elsewhere).

## Ports & env vars

Server reads these at runtime (`server/src/main.rs`, `server/src/routes.rs`):

| Env var | Default | Notes |
|---------|---------|-------|
| `PORT` | `8080` | TCP port. Bind address is always `0.0.0.0`. |
| `RUST_LOG` | `info` | `env_logger` filter, e.g. `debug`, `dicesuki_server=debug`. |
| `CORS_ORIGIN` | unset → permissive (dev) | Set to the frontend origin in production to restrict CORS. |
| `SUPABASE_URL` | unset → ADR 006 project | Supabase project base (`https://<proj>.supabase.co`). Selects the JWKS URL + expected issuer for JWT verification, and the REST base for the rooms registry. |
| `SUPABASE_SECRET_KEY` | unset → privileged registry/reward writes OFF unless legacy fallback is set | **Preferred server secret.** Use a dedicated `sb_secret_...` key from Supabase Settings → API Keys. It is sent only as `apikey`; never commit it or expose it to the frontend. Enables native authoritative-roll reporting; the rooms registry additionally requires `PUBLIC_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | unset → no legacy fallback | **Deprecated migration fallback only.** Must be the legacy JWT-format `service_role` key. Never place an `sb_secret_...` key in this variable. |
| `PUBLIC_URL` | unset → registry OFF | This server's public base URL behind the TLS proxy (e.g. `https://rooms.example.com`). Stored in the registry so the client browser can connect. |
| `INSTANCE_ID` | — | **Not** an env var. Auto-generated 8-char nanoid per process; appears in logs and `/health`. |

**Supabase feature gating:** JWT verification is always available (guest play needs no token; a valid token binds the player to their Supabase user id, an invalid/expired one is rejected with `AUTH_INVALID`). `SUPABASE_URL` alone enables no privileged write. Without a server credential, authoritative-roll reporting reports `disabled` and makes no request. `PUBLIC_URL` is the sole rooms-registry intent signal: without it the registry remains **OFF**, including a valid `SUPABASE_URL` + server-secret reporter-only deployment. Once `PUBLIC_URL` is present, startup requires `SUPABASE_URL` and one valid server credential; partial or malformed registry configuration exits clearly instead of silently disabling the intended heartbeat. When both credential variables are valid, `SUPABASE_SECRET_KEY` wins. See [Supabase integration](#supabase-integration-auth--rooms-registry--earned-rolls) below.

Frontend build-time env vars (baked into the bundle, `src/lib/multiplayerServer.ts`):

| Env var | Default | Used by |
|---------|---------|---------|
| `VITE_MULTIPLAYER_SERVER_URL` | `ws://localhost:8080` | Public multiplayer (the only network room server). `.env.production` sets the Render URL. |
| `VITE_MULTIPLAYER_SERVER_HTTP_URL` | derived from WS URL | Optional; REST base for the public server. |

> **Solo needs no server.** The default `/` route runs a one-player room in the in-browser WASM room worker (`src/workers/roomWorker.ts` + `src/generated/wasm-room/`) — the SAME `dicesuki-core` engine as the native server, compiled to WASM. There is no native loopback server and no `VITE_LOCAL_ROOM_SERVER_*` config; the whole `dev:local-room` / "Open Local Solo Room" / `?server=local` apparatus was retired in #114.

## Frontend → server wiring

Public multiplayer uses `VITE_MULTIPLAYER_SERVER_URL`, chosen at **build time** — build the frontend with this pointed at wherever the server is reachable. Health of the public server is polled via `GET {httpUrl}/health`, which returns `{"status":"ok","instanceId":"…","rollReporter":"disabled|healthy|unhealthy"}`. The reporter field makes privileged delivery failure visible without taking down multiplayer or exposing event data. Solo does not touch the network: it connects to the worker through the store's transport abstraction (`RoomSocket` / `WorkerRoomTransport`), speaking the identical JSON room protocol.

## Local bare-metal run

```bash
# 1. Build the server release binary (cargo is not on PATH)
cd server && ~/.cargo/bin/cargo build --release      # -> server/target/release/dicesuki-server

# 2. Run it (choose any free PORT)
PORT=8080 RUST_LOG=info ./target/release/dicesuki-server

# 3. Build the frontend pointed at that server, then serve the static bundle
cd ..
VITE_MULTIPLAYER_SERVER_URL=ws://localhost:8080 npm run build
npx vite preview --host 0.0.0.0 --port 4173          # serves dist/ on :4173
```

Then open `http://localhost:4173`. Verify end-to-end:

```bash
# REST: create a room
curl -X POST http://localhost:8080/api/rooms         # -> 201 {"roomId":"…","instanceId":"…"}
# Health
curl http://localhost:8080/health                    # -> {"status":"ok","instanceId":"…"}
```

For a persistent playtest process, run under a log file outside the repo:

```bash
mkdir -p ~/daisu-playtest
PORT=8080 RUST_LOG=info nohup ./target/release/dicesuki-server \
  > ~/daisu-playtest/server.log 2>&1 &
echo $! > ~/daisu-playtest/server.pid
# stop:    kill "$(cat ~/daisu-playtest/server.pid)"
# restart: repeat the nohup line
```

## Docker (server distribution artifact)

The image is a distribution artifact — **not** required for the local bare-metal run above. Multi-stage build (`rust:1.93-slim` builder → `debian:bookworm-slim` runtime, non-root user). Build context is `server/`.

```bash
# Build
docker build -t daisu-server ./server

# Run (maps container 8080 to host 8080)
docker run --rm -p 8080:8080 \
  -e RUST_LOG=info \
  -e CORS_ORIGIN=https://your-frontend.example \
  daisu-server

# Health check
curl http://localhost:8080/health
```

Runtime image ships only the ~4 MB static-ish Rust binary + `ca-certificates`. `server/render.yaml` deploys this same Dockerfile to Render (`healthCheckPath: /health`).

## WSL2 / exposing to friends

On this dev box (WSL2), the server binds `0.0.0.0:PORT` and is reachable at:

- `http://localhost:PORT` from the **same Windows host** (WSL2 forwards localhost).
- `http://<WSL-IP>:PORT` on the LAN, where `<WSL-IP>` is from `hostname -I` (e.g. `172.21.83.12`). Note the WSL IP changes across reboots.

Reaching a **friend over the internet** needs one of:

- **Windows-side port forwarding** (`netsh interface portproxy`) + router port-forward + firewall rule — brittle, exposes your IP. Not recommended.
- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8080`) — instant public HTTPS/WSS URL, no firewall changes. Rebuild the frontend with `VITE_MULTIPLAYER_SERVER_URL=wss://<tunnel-host>`.
- **Tailscale** — put friends on your tailnet; server reachable at the `100.x` tailnet IP with no public exposure.

Tunnel/tailnet setup is a Windows-side / account-side change and is intentionally left to the operator; the server itself needs no changes (already binds all interfaces).

## TLS & the reverse proxy (production / Discord Activity path)

The room server speaks **plain HTTP/WS on `0.0.0.0:$PORT`** and does **not** terminate TLS. Public exposure MUST put a reverse proxy in front that:

1. **Terminates TLS** and serves `https`/`wss` (Let's Encrypt or Cloudflare-managed certs).
2. **Supports WebSocket upgrades over HTTP/1.1** and does **not** force HTTP/2 on the `/ws/*` route (Shared-ADR-002 / Server-ADR-001). WebSocket upgrades require HTTP/1.1 `Upgrade: websocket` + `Connection: Upgrade`; forcing h2 silently breaks WS.
3. **Listens on port 443 under a shared TLS domain.** This is a **hard requirement** for the future Discord **Activity** integration: Activities can only reach external hosts through URL mappings that resolve to `https://<app_id>.discordsays.com/<prefix>` → your origin, and those mappings assume standard `443`. Design the domain now so room servers live at, e.g., `https://rooms.<shared-domain>` (or per-instance `https://<instance>.rooms.<shared-domain>`) on 443 — **not** an arbitrary high port. `PUBLIC_URL` (and the frontend's `VITE_MULTIPLAYER_SERVER_URL=wss://…`) must point at this 443 host.

Two reference fronting options — **owner applies these**; nothing is installed on the dev box by this change.

### Option A — Caddy (automatic HTTPS on 443)

Caddy fronts the server, auto-provisions a cert for the domain, and proxies WS transparently (Caddy keeps HTTP/1.1 for upgrade requests automatically).

```caddyfile
# /etc/caddy/Caddyfile
rooms.example.com {
    # Reverse-proxy everything (REST + WS) to the local room server on :8090.
    # Caddy auto-detects the WebSocket Upgrade/Connection headers and streams
    # the /ws/* upgrade over HTTP/1.1 — no special block needed.
    reverse_proxy 127.0.0.1:8090

    encode zstd gzip
    log {
        output file /var/log/caddy/rooms.log
    }
}
```

Then: `PORT=8090 ./dicesuki-server` behind it, and set `PUBLIC_URL=https://rooms.example.com`. DNS `rooms.example.com` → the box's public IP; ports 80+443 reachable (router/firewall) for the ACME challenge and traffic.

### Option B — Cloudflare Tunnel (`cloudflared`, no inbound ports)

No router/firewall changes and no exposed IP — the tunnel dials out to Cloudflare, which serves `https`/`wss` on 443 for the hostname. Cloudflare proxies WebSockets over HTTP/1.1 by default.

```yaml
# ~/.cloudflared/config.yml
tunnel: daisu-rooms
credentials-file: /home/USER/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: rooms.example.com
    service: http://127.0.0.1:8090
    originRequest:
      # Keep long-lived WS connections alive; do not force HTTP/2 to origin.
      noHappyEyeballs: true
      connectTimeout: 30s
  - service: http_status:404
```

```bash
cloudflared tunnel login
cloudflared tunnel create daisu-rooms
cloudflared tunnel route dns daisu-rooms rooms.example.com
cloudflared tunnel run daisu-rooms          # serves wss://rooms.example.com on 443
```

Set `PUBLIC_URL=https://rooms.example.com` and rebuild the frontend with `VITE_MULTIPLAYER_SERVER_URL=wss://rooms.example.com`.

### WebSocket upgrade smoke check (through the proxy)

After the proxy is up, confirm a real upgrade succeeds end-to-end over TLS. A `101 Switching Protocols` (not `200`/`426`/`502`) means WS-over-HTTP/1.1 works through the proxy:

```bash
# 1. Create a room via REST (through the proxy)
curl -sS -X POST https://rooms.example.com/api/rooms      # -> 201 {"roomId":"…"}

# 2. Attempt the WS upgrade for that room. Expect: "HTTP/1.1 101 Switching Protocols".
ROOM=<roomId-from-step-1>
curl -sSi -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(head -c16 /dev/urandom | base64)" \
  "https://rooms.example.com/ws/$ROOM" | head -1
# Server logs the diagnostic upgrade headers per Server-ADR-001; check for the
# matching "[<INSTANCE_ID>] --> HTTP/1.1 GET /ws/… (upgrade: Some("websocket"), …)".
```

If you see `HTTP/2` in the request log or a `426`, the proxy is forcing HTTP/2 on the WS route — fix the proxy, not the server.

## Restart policy & monitoring

The server is a single binary; supervise it so it restarts on crash/reboot. Health is `GET /health` → `{"status":"ok","instanceId":"…","rollReporter":"…"}` (already wired as Render's `healthCheckPath`). Room state and the authoritative-roll delivery queue are process-local: a restart clears both. PostgreSQL makes an exact RPC replay idempotent, but restart-proof zero-loss reporting still requires the persistent outbox called out in ADR 015.

- **systemd** (bare-metal / dedicated host): a unit with `Restart=always`, `RestartSec=2`, and the env vars above (`EnvironmentFile=` for the Supabase server key so it never lands in the unit). `systemctl enable` for boot start.
- **Docker**: `docker run --restart=unless-stopped …` (or a Compose `restart: unless-stopped` + `healthcheck:` hitting `/health`).
- **Registry as liveness signal**: when the rooms registry is enabled, the ~30s heartbeat doubles as a liveness beacon — a row whose `last_heartbeat` has gone stale means that server is down, and the client browser filters it out.

## Supabase integration (auth + rooms registry + earned rolls)

Auth and the rooms registry come from ADR 006; earned-roll authority is defined
by ADRs 014–015. All are configured via env—no code changes per deployment.

**JWT verification (always on).** On `join`, the client MAY include `authToken` (a Supabase access token). The server verifies it locally against Supabase's JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), with the key set cached in-process (1-hour TTL, refreshed on `kid` miss) — **no per-request callout**. Outcomes:

- **No token** → silent guest (guest play is a product requirement).
- **Valid token** → the seat is bound to the player's Supabase user id (`sub`) for future ownership features.
- **Invalid/expired token** → join rejected with `error` code `AUTH_INVALID` (a stale token fails loudly rather than silently downgrading to guest).

`SUPABASE_URL` selects the project (defaults to the ADR 006 project id if unset). Nothing secret is needed for verification — JWKS is public.

**Rooms registry heartbeat (opt-in).** With `SUPABASE_URL` + `SUPABASE_SECRET_KEY` + `PUBLIC_URL` set, the server upserts a row into the Supabase `rooms` table (migration `supabase/migrations/0003_rooms_registry.sql`) keyed by its `INSTANCE_ID`, every ~30s, carrying `public_url`, `player_count`, and `room_count`. `last_heartbeat` is DB-stamped by a trigger. The client room browser is a public-read query over that table; stale rows (dead servers) are filtered/pruned. RLS: public read, trusted-server-only write.

**Authoritative earned-roll reporting (opt-in).** With `SUPABASE_URL` plus the server credential set, authenticated explicit rolls completed by the native room server are queued to migration `0010`'s service-only `record_authoritative_roll_completion` RPC. `PUBLIC_URL` is not required for reporter-only operation. Guests are skipped, and solo WASM has no reporter. Each event freezes the initiation identity, room/player/generation, microsecond UTC completion time, sorted concrete die results, and total into canonical v1 JSON; only its SHA-256 plus the exact event identity/time are sent. A bounded fixed-concurrency worker pool retries the exact bytes after network/408/429/5xx failures. Retry delay uses equal jitter over the upper half of the capped exponential window, retaining variance at the 30-second cap without permitting a zero-delay hot loop. Other HTTP failures leave `rollReporter: "unhealthy"` and do not retry in a hot loop. Logs contain status/categories only—not user ids, payloads, response bodies, or credentials.

Delivery is in-process at-least-once and database exactly-once for an exact replay. It is **not restart-proof**: a crash between gameplay completion and the database commit can lose that event. Do not represent `RollComplete` as proof of reward credit. A persistent outbox/queue is required before promising zero-loss recovery across a room-server restart (ADR 015).

The preferred opaque `sb_secret_...` key is carried only in the `apikey` header. It is not a JWT and must not be used as `Authorization: Bearer`. For a bounded migration period, `SUPABASE_SERVICE_ROLE_KEY` accepts only a legacy JWT whose payload identifies the `service_role`, then sends that value as both `apikey` and bearer auth. Registry writes require HTTPS except for explicit loopback development, and the HTTP client does not follow redirects with either elevated credential. Supabase recommends replacing legacy server keys with secret keys; see [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys).

```bash
# Enable both features (secret key is injected at runtime only):
PORT=8090 \
SUPABASE_URL=https://nksxdfcjabgbxeefwkdc.supabase.co \
SUPABASE_SECRET_KEY=<owner-provided-dedicated-server-secret> \
PUBLIC_URL=https://rooms.example.com \
./target/release/dicesuki-server
```

> **Secrets:** `SUPABASE_SECRET_KEY` and the deprecated `SUPABASE_SERVICE_ROLE_KEY` fallback are owner-provided secrets and MUST NEVER be committed or baked into the Docker image (ADR 006). Supply one via `-e`, a systemd `EnvironmentFile`, or your host's secret store. The Supabase publishable key and project id are public-safe. Apply migrations through `0010` before enabling earned-roll reporting (`0003` remains the rooms-registry boundary).

### Render production setup

`server/render.yaml` declares the public deployment values and a `sync: false` placeholder for the secret. In Render Dashboard → service `dicesuki` → Environment:

1. In Supabase Settings → API Keys, create a dedicated secret key for the Render room server. Do not reuse a browser key and do not copy the value into chat or source control.
2. Set `SUPABASE_SECRET_KEY` to that value. Leave `SUPABASE_SERVICE_ROLE_KEY` unset after migration.
3. Confirm `SUPABASE_URL=https://nksxdfcjabgbxeefwkdc.supabase.co`.
4. Confirm `PUBLIC_URL=https://dicesuki.onrender.com`.
5. Confirm `CORS_ORIGIN=https://dicesuki.vercel.app`.
6. Save and deploy, then verify `/health` remains `200`, `rollReporter` is `healthy`, and a fresh `public.rooms` heartbeat appears within one interval. Logs name only the credential mode and never the key.
7. Complete one authenticated multiplayer roll and verify exactly one new `public.authoritative_roll_completion_events` row with the expected `authority_kind`, plus at most one linked promotional-Star ledger entry. Repeat/reconnect/knock testing must not create a second event for that generation. Use owner-side database tooling; never print the secret or raw user id into deployment logs or a PR.
