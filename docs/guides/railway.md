# Railway room server

Deploy the existing Rust server image to one long-running Railway service. Keep the static frontend on Vercel and auth/registry/reporting on the existing Supabase project. This guide describes required settings, not a claim that a deployment or cutover has occurred.

## Build choice and context

Use `server/Dockerfile`, with the repository service root set to `/server`. Docker sees `server/` as its context and detects `Dockerfile` automatically. Do not build this Dockerfile with the repository root as context. `server/.dockerignore` allows only the Dockerfile, Cargo manifests/lockfile and current Rust source directories, excluding credentials, tests and build caches.

The Docker build retains Rust 1.93 and the committed lockfile. Both Cargo build steps use `--locked --jobs 2`. Every declared workspace member needs a manifest and a valid source target in the dependency layer, even `wasm`, which is excluded from default native compilation. The final runtime contains only the server binary and its runtime dependencies, not a WASM/browser build.

Railpack supports automatic language builds but would replace this explicit toolchain/runtime contract. There is no demonstrated need for a second build path here.

## Settings the deployment owner must apply

Apply these in the isolated service's Railway settings/API, then read them back on the actual deployment before routing traffic.

| Setting | Required value |
| --- | --- |
| Source | Reviewed, merged repository revision. Record exact commit and tree. |
| Root directory | `/server` |
| Builder | Detected Dockerfile, not Railpack. Build logs must confirm Dockerfile use. |
| Dockerfile | `Dockerfile`, relative to the service root |
| Build/start overrides | None. Use Dockerfile build and `CMD ["dicesuki-server"]`. |
| Watch paths | `/server/**` if using automatic repository deploys |
| Service variable and public domain target port | `PORT=8080`, HTTP target `8080` |
| Healthcheck | `/health`, timeout `300` seconds |
| Replicas/regions | Exactly one replica total, in one region |
| Serverless / app sleeping | Disabled before deployment. Read back the deployed setting. |
| Restart | On failure, maximum `10` retries |
| Resource limits | Set explicit service CPU/memory limits before deployment. Start with `1` vCPU and `512` MiB; this is a smoke-test starting limit, not a capacity guarantee. Record actual limits. |
| Deployment overlap | `0` seconds. Rooms are process-local, not shared across old/new images. Redeploys still disconnect existing rooms. |
| Storage/add-ons | No volume, new database or extra service required |

Railway's current [Infrastructure as Code documentation](https://docs.railway.com/infrastructure-as-code) says new services cannot opt into legacy `railway.toml`/`railway.json`, and legacy files stop being read on 2026-12-01. The [legacy schema](https://railway.com/railway.schema.json) still lists deployment fields; that does not make them supported for new services. This repository therefore adds no legacy config file or IaC SDK dependency. Root directory, variables, generated domain, replica/sleep/resource settings and healthcheck remain owner-applied settings, not invented TOML fields. Future IaC adoption is a separate change.

Railway terminates TLS and must forward WebSocket upgrades. Do not set a GraphQL `builder: DOCKERFILE`; that API enum need not match the legacy config-file schema. Use Dockerfile auto-detection and the service's Dockerfile path setting instead. Generate an HTTPS domain targeting port 8080 and derive its WSS origin from the same host. The image contains no provider hostname. Healthchecks gate startup, not continuous availability. See [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [monorepo roots](https://docs.railway.com/deployments/monorepo), [healthchecks](https://docs.railway.com/deployments/healthchecks), [replicas](https://docs.railway.com/deployments/scaling) and [serverless](https://docs.railway.com/deployments/serverless).

## Runtime configuration

Set values through Railway's runtime variable/secret store. Never pass credentials as Docker build arguments or commit their values.

| Variable | Production contract |
| --- | --- |
| `PORT` | `8080` |
| `RUST_LOG` | `info` |
| `CORS_ORIGIN` | Existing Vercel frontend's exact public origin |
| `SUPABASE_URL` | Existing Supabase project's HTTPS base |
| `SUPABASE_SECRET_KEY` | Owner-transferred dedicated backend secret. Preferred registry/reporting credential. |
| `PUBLIC_URL` | Generated Railway HTTPS origin, no placeholder or Render origin |
| `SUPABASE_SERVICE_ROLE_KEY` | Deprecated legacy JWT fallback only. Leave unset when using the preferred secret. |

`PUBLIC_URL` declares registry intent. With it set, incomplete registry credentials fail startup. With `SUPABASE_URL` and the backend secret, authoritative-roll reporting is enabled; it does not require `PUBLIC_URL`. Preserve these existing contracts. After owner configuration, require HTTP 200 health and `rollReporter: "healthy"`, plus owner-verified registry heartbeat. Do not claim that health alone proves auth, registry delivery or rewarded-roll persistence.

Guest play requires no credential. For a private image smoke test, leave all provider credentials and `PUBLIC_URL` unset, restrict egress and require `rollReporter: "disabled"`. Do not turn this credential-free qualification into a production configuration.

Existing optional Discord bot settings (`DISCORD_BOT_TOKEN`, `APP_BASE_URL`, optional legacy `DISCORD_CHANNEL_ID`) are separate from Activity. Do not enable them merely to qualify packaging. Preserve any owner-approved bot configuration through private runtime transfer, never source values. **Activity remains disabled.** Its separately held ingress policy is Render-specific and is not qualified by this migration.

## Cutover and rollback

The deployment owner must first qualify the exact Railway artifact, HTTPS health and real WebSocket room behavior. Only then update the existing Vercel Production build variables and rebuild the accepted frontend revision:

- `VITE_MULTIPLAYER_SERVER_URL` gets the generated `wss://` origin.
- `VITE_MULTIPLAYER_SERVER_HTTP_URL` gets the corresponding `https://` origin.

Do not change `src/lib/multiplayerServer.ts` or its intentional localhost development fallback. Verify the endpoint bytes in the shipped bundle and an ordinary browser guest create/join/leave flow. Solo remains the standalone in-browser worker.

Keep Render running for old compiled clients and rollback. Record the previous Vercel build variables/deployment privately. Roll back by restoring those build values and redeploying the previously qualified frontend. In-memory rooms and pending roll-report delivery do not migrate between processes or survive restarts. No database migration, payment activation or Activity cutover is part of this procedure.

## Deployment receipt

Record project, service and environment IDs; exact source commit/tree; builder/context; build, image and deployment identities; HTTPS/WSS origins; port and health path; replica/region count; deployed sleep state; CPU/memory limits; registry/reporter mode; health and WebSocket evidence; current usage/cost and rollback target. Record credential names and configuration status only, never values or live private room handles.
