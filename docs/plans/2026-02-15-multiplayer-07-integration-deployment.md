# Multiplayer 07: Integration & Deployment

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the Rust server to Fly.io, configure CORS and environment variables, and verify the full end-to-end multiplayer flow.

**Architecture:** Rust server deployed as a Docker container on Fly.io. Frontend configured with server URL via environment variables. CORS allows the frontend origin.

**Tech Stack:** Docker, Fly.io CLI, environment variables

**Depends on:** Plans 01-06 (all previous plans)

---

## Task 1: Dockerfile

**Files:**
- Create: `server/Dockerfile`

**Step 1: Write multi-stage Dockerfile**

Create `server/Dockerfile`:

```dockerfile
# Stage 1: Build
FROM rust:1.77-slim-bookworm as builder

WORKDIR /app

# Copy manifests first for layer caching
COPY Cargo.toml Cargo.lock ./

# Create dummy src to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Copy actual source and rebuild
COPY src/ ./src/
# Touch main.rs so cargo knows to rebuild it
RUN touch src/main.rs
RUN cargo build --release

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/daisu-server /usr/local/bin/daisu-server

EXPOSE 8080

ENV RUST_LOG=info

CMD ["daisu-server"]
```

**Step 2: Test Docker build locally**

```bash
cd server && docker build -t daisu-server .
```

Expected: Builds successfully. Image should be ~20-40MB.

**Step 3: Test Docker run locally**

```bash
docker run -p 8080:8080 daisu-server &
curl -X POST http://localhost:8080/api/rooms
# Expected: {"roomId":"..."}
docker stop $(docker ps -q --filter ancestor=daisu-server)
```

**Step 4: Commit**

```bash
git add server/Dockerfile
git commit -m "feat(server): add multi-stage Dockerfile for production build"
```

---

## Task 2: Fly.io Configuration

**Files:**
- Create: `server/fly.toml`

**Step 1: Install Fly CLI (if not already installed)**

```bash
# macOS
brew install flyctl

# Or curl
curl -L https://fly.io/install.sh | sh
```

**Step 2: Create fly.toml**

Create `server/fly.toml`:

```toml
app = "daisu-server"
primary_region = "ord"  # Chicago — adjust to your preference

[build]
  dockerfile = "Dockerfile"

[env]
  RUST_LOG = "info"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "connections"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

**Step 3: Deploy to Fly.io**

```bash
cd server

# Login (first time only)
fly auth login

# Create the app (first time only)
fly apps create daisu-server

# Deploy
fly deploy

# Verify
fly status
curl https://daisu-server.fly.dev/health
# Expected: {"status":"ok"}
```

**Step 4: Test room creation on production**

```bash
curl -X POST https://daisu-server.fly.dev/api/rooms
# Expected: {"roomId":"abc123"}
```

**Step 5: Commit**

```bash
git add server/fly.toml
git commit -m "feat(server): add Fly.io deployment configuration"
```

---

## Task 3: Frontend Environment Configuration

**Files:**
- Modify: `.env.production`
- Modify: `.env.development`

**Step 1: Set server URLs**

Update `.env.development`:
```
VITE_MULTIPLAYER_SERVER_URL=ws://localhost:8080
```

Update `.env.production`:
```
VITE_MULTIPLAYER_SERVER_URL=wss://daisu-server.fly.dev
```

**Step 2: Update CreateRoomButton HTTP URL derivation**

Verify `src/components/multiplayer/CreateRoomButton.tsx` correctly derives HTTP URL from WS URL:

```typescript
const SERVER_URL = import.meta.env.VITE_MULTIPLAYER_SERVER_URL
  ?.replace('ws://', 'http://')
  ?.replace('wss://', 'https://')
  || 'http://localhost:8080'
```

**Step 3: Commit**

```bash
git add .env.development .env.production
git commit -m "feat(multiplayer): configure server URLs for development and production"
```

---

## Task 4: CORS Configuration

**Files:**
- Modify: `server/src/main.rs` (or equivalent HTTP handler)

**Step 1: Update CORS to allow specific origins**

Currently the server uses `Access-Control-Allow-Origin: *`. For production, restrict to the frontend origin:

```rust
// In the CORS headers function, use environment variable:
fn cors_origin() -> String {
    std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "*".to_string())
}
```

If using axum with tower-http:
```rust
let cors = CorsLayer::new()
    .allow_origin(
        std::env::var("CORS_ORIGIN")
            .unwrap_or_else(|_| "*".to_string())
            .parse::<HeaderValue>()
            .unwrap()
    )
    .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
    .allow_headers(Any);
```

**Step 2: Set CORS_ORIGIN on Fly.io**

```bash
fly secrets set CORS_ORIGIN="https://daisu.app" --app daisu-server
# Or if using a different domain:
fly secrets set CORS_ORIGIN="https://your-frontend-domain.vercel.app" --app daisu-server
```

For development, CORS_ORIGIN defaults to `*` when unset.

**Step 3: Commit**

```bash
git add server/src/main.rs
git commit -m "feat(server): add configurable CORS origin for production security"
```

---

## Task 5: End-to-End Integration Test

This is a manual test protocol to verify the full multiplayer flow.

**Prerequisites:**
- Server running locally (`cd server && cargo run`) or on Fly.io
- Frontend running (`npm run dev`)

**Test 1: Room Creation**

```
1. Open http://localhost:3000
2. Click "Create Multiplayer Room"
3. Verify redirect to /room/{roomId}
4. Verify room ID appears in URL and header
```

**Test 2: Join Room**

```
1. Copy the room URL
2. Open in a second browser tab (or incognito)
3. Enter a different display name and color
4. Click Join
5. Verify both tabs show 2 players in the header
```

**Test 3: Spawn & Roll Dice**

```
1. In Tab 1: Click d20 to spawn a die
2. Verify Tab 2 sees the die appear (with Tab 1's color)
3. In Tab 1: Click ROLL
4. Verify both tabs see the die rolling with identical physics
5. Verify both tabs show the same final result
6. Verify roll appears in Roll History on both tabs
```

**Test 4: Multi-Player Rolling**

```
1. In Tab 2: Spawn 2d6
2. In Tab 2: Click ROLL
3. Verify Tab 1 sees Tab 2's dice rolling
4. Verify Tab 2's roll appears in history on both tabs
5. In Tab 1 AND Tab 2: Click ROLL simultaneously
6. Verify all dice roll and settle correctly on both tabs
```

**Test 5: Disconnect Handling**

```
1. Close Tab 2
2. Verify Tab 1 sees player count drop to 1
3. Verify Tab 2's dice disappear from Tab 1's scene
4. Verify Tab 2's dice disappear from Tab 1's roll history display
```

**Test 6: Room Limits**

```
1. Spawn 30 dice total across multiple players
2. Attempt to spawn another — verify error message
3. Try to join with 9th player — verify error message
```

---

## Task 6: Production Build Verification

**Step 1: Build frontend**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors.

**Step 2: Preview production build locally**

```bash
npm run preview
# Open the preview URL
# Navigate to /room/test
# Verify the multiplayer UI renders correctly
```

**Step 3: Deploy frontend**

Deploy to your static hosting (Vercel, etc.) with the `VITE_MULTIPLAYER_SERVER_URL` environment variable set.

**Step 4: Full production test**

```
1. Open production URL
2. Create room
3. Share link with another device/browser
4. Both join, spawn dice, roll
5. Verify real-time sync
```

---

## Troubleshooting

### WebSocket Connection Fails

**Symptoms:** "Connecting..." forever, WebSocket error in console
**Check:**
- Is the server running? `curl https://daisu-server.fly.dev/health`
- Is VITE_MULTIPLAYER_SERVER_URL correct? Check browser console for the URL being connected to
- Is CORS configured? Check server logs for CORS rejections
- Is the server using wss:// in production? (Fly.io handles TLS termination)

### Physics Desync

**Symptoms:** Different positions on different clients
**This shouldn't happen** with server-side physics. If it does:
- Check that all clients receive the same physics_snapshot tick numbers
- Verify interpolation is working (positions should smoothly animate)
- Check server logs for errors in the simulation loop

### Dice Don't Settle

**Symptoms:** Dice keep rolling forever
**Check:**
- Server physics thresholds match client: `LINEAR_VELOCITY_THRESHOLD = 0.01`, `REST_DURATION_MS = 500`
- Dice aren't clipping through walls (check server viewport bounds vs. client camera)
- Simulation loop is running at 60Hz (not faster/slower)

### Room Not Found After Idle

**Symptoms:** Room URL returns 404 after leaving and coming back
**Expected:** Rooms are ephemeral. After 30 minutes with no players, they're destroyed.
**Solution:** Create a new room. Persistent rooms are post-MVP.

### High Latency

**Symptoms:** Noticeable delay between clicking ROLL and seeing dice move
**Expected:** ~50-100ms delay (network round trip + first snapshot delivery)
**If worse:**
- Check Fly.io region (is the server geographically close to players?)
- Check server CPU usage (`fly status`) — physics may be running slowly under load
- Consider deploying to a closer region
