# Deployment & Playtest

> How to run the Daisu playtest stack: the Rust room server + the static frontend.

## Architecture recap

Daisu is two independently deployable pieces:

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
| `SUPABASE_SERVICE_ROLE_KEY` | unset → registry OFF | **Secret** (ADR 006 — never commit). Enables the rooms-registry heartbeat. Service-role key; bypasses RLS for registry writes. |
| `PUBLIC_URL` | unset → registry OFF | This server's public base URL behind the TLS proxy (e.g. `https://rooms.example.com`). Stored in the registry so the client browser can connect. |
| `INSTANCE_ID` | — | **Not** an env var. Auto-generated 8-char nanoid per process; appears in logs and `/health`. |

**Supabase feature gating:** JWT verification is always available (guest play needs no token; a valid token binds the player to their Supabase user id, an invalid/expired one is rejected with `AUTH_INVALID`). The rooms-registry heartbeat is **OFF** unless **all three** of `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `PUBLIC_URL` are set — with none set, the server runs exactly as it did before. See [Supabase integration](#supabase-integration-auth--rooms-registry) below.

Frontend build-time env vars (baked into the bundle, `src/lib/multiplayerServer.ts`):

| Env var | Default | Used by |
|---------|---------|---------|
| `VITE_MULTIPLAYER_SERVER_URL` | `ws://localhost:8080` | Public multiplayer mode (default). `.env.production` sets the Render URL. |
| `VITE_MULTIPLAYER_SERVER_HTTP_URL` | derived from WS URL | Optional; REST base for public mode. |
| `VITE_LOCAL_ROOM_SERVER_URL` | `ws://127.0.0.1:8080` | Local-loopback mode (`?server=local` query param). |
| `VITE_LOCAL_ROOM_SERVER_HTTP_URL` | derived from WS URL | Optional; REST base for loopback mode. |

## Frontend → server wiring

The client picks a WebSocket/HTTP base URL at **build time**:

- **Public mode (default):** uses `VITE_MULTIPLAYER_SERVER_URL`. Build the frontend with this pointed at wherever the server is reachable.
- **Local-loopback mode:** appending `?server=local` to the app URL switches to `VITE_LOCAL_ROOM_SERVER_URL` (default `ws://127.0.0.1:8080`) — handy when the server is on the same box on the default port.

Health of the selected server is polled via `GET {httpUrl}/health`, which must return `{"status":"ok","instanceId":"…"}`.

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

The server is a single stateless binary; supervise it so it restarts on crash/reboot. Health is `GET /health` → `{"status":"ok","instanceId":"…"}` (already wired as Render's `healthCheckPath`).

- **systemd** (bare-metal / dedicated host): a unit with `Restart=always`, `RestartSec=2`, and the env vars above (`EnvironmentFile=` for the secret service-role key so it never lands in the unit). `systemctl enable` for boot start.
- **Docker**: `docker run --restart=unless-stopped …` (or a Compose `restart: unless-stopped` + `healthcheck:` hitting `/health`).
- **Registry as liveness signal**: when the rooms registry is enabled, the ~30s heartbeat doubles as a liveness beacon — a row whose `last_heartbeat` has gone stale means that server is down, and the client browser filters it out.

## Supabase integration (auth + rooms registry)

Both features come from ADR 006 and are configured purely via env — no code changes per deployment.

**JWT verification (always on).** On `join`, the client MAY include `authToken` (a Supabase access token). The server verifies it locally against Supabase's JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), with the key set cached in-process (1-hour TTL, refreshed on `kid` miss) — **no per-request callout**. Outcomes:

- **No token** → silent guest (guest play is a product requirement).
- **Valid token** → the seat is bound to the player's Supabase user id (`sub`) for future ownership features.
- **Invalid/expired token** → join rejected with `error` code `AUTH_INVALID` (a stale token fails loudly rather than silently downgrading to guest).

`SUPABASE_URL` selects the project (defaults to the ADR 006 project id if unset). Nothing secret is needed for verification — JWKS is public.

**Rooms registry heartbeat (opt-in).** With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `PUBLIC_URL` all set, the server upserts a row into the Supabase `rooms` table (migration `supabase/migrations/0003_rooms_registry.sql`) keyed by its `INSTANCE_ID`, every ~30s, carrying `public_url`, `player_count`, and `room_count`. `last_heartbeat` is DB-stamped by a trigger. The client room browser is a public-read query over that table; stale rows (dead servers) are filtered/pruned. RLS: public read, **service-role-only** write.

```bash
# Enable both features (service-role key is a SECRET — inject at runtime only):
PORT=8090 \
SUPABASE_URL=https://htsgornelumjyjwknwby.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<owner-provided-secret> \
PUBLIC_URL=https://rooms.example.com \
./target/release/dicesuki-server
```

> **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` is an owner-provided secret and MUST NEVER be committed or baked into the Docker image (ADR 006). Supply it via `-e`, a systemd `EnvironmentFile`, or your host's secret store. The Supabase **anon key** and **project id** are public-safe. Apply migration `0003` (`supabase db push`) before enabling the registry.
