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
| `INSTANCE_ID` | — | **Not** an env var. Auto-generated 8-char nanoid per process; appears in logs and `/health`. |

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
