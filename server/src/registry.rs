//! Supabase `rooms` registry heartbeat (ADR 006, issue #83).
//!
//! The public room browser is driven by a Supabase `rooms` table (see
//! `supabase/migrations/0003_rooms_registry.sql`), which supersedes any ad-hoc
//! discovery. On startup and every [`HEARTBEAT_INTERVAL`] thereafter, a dev-box
//! server **upserts** one row keyed by its `INSTANCE_ID` (its public URL and
//! current player/room counts). The DB stamps `last_heartbeat` via a trigger, so
//! a room whose server dies simply stops refreshing and is filtered out / pruned
//! as stale — the same stale-cleanup shape the server already uses in memory
//! (Server-ADR-001).
//!
//! **Feature-gated & off by default.** The registry activates only when all
//! required environment variables are present:
//!
//! * `SUPABASE_URL` — the project REST base, e.g. `https://<proj>.supabase.co`.
//! * `SUPABASE_SERVICE_ROLE_KEY` — service-role key (bypasses RLS for writes).
//!   **Never committed** (ADR 006); supplied via env/secret storage.
//! * `PUBLIC_URL` — this server's publicly reachable base, e.g.
//!   `https://rooms.example.com` (behind the TLS reverse proxy; see
//!   `docs/guides/deployment.md`).
//!
//! When any is absent the feature is silently OFF and the server runs exactly as
//! it does today — no network calls, no behavior change.

use std::sync::Arc;
use std::time::Duration;

use log::{debug, info, warn};
use tokio::sync::RwLock;

use crate::room_manager::RoomManager;
use crate::INSTANCE_ID;

/// How often the server refreshes its registry row. Short enough that a dead
/// server is detectable within a minute, long enough that write volume is
/// negligible at hobby scale.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

/// Resolved registry configuration. Present only when the feature is enabled.
#[derive(Debug, Clone)]
pub struct RegistryConfig {
    /// Supabase REST endpoint for the `rooms` table
    /// (`{SUPABASE_URL}/rest/v1/rooms`).
    pub rest_url: String,
    /// Service-role key, used as both `apikey` and bearer token so the write
    /// bypasses RLS.
    pub service_role_key: String,
    /// This server's public base URL, stored so the client room browser can
    /// connect. Trailing slash trimmed.
    pub public_url: String,
}

impl RegistryConfig {
    /// Resolve config from the environment, or `None` if the feature is disabled
    /// (any required variable missing/empty). No side effects.
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let supabase_url = non_empty_env("SUPABASE_URL")?;
        let service_role_key = non_empty_env("SUPABASE_SERVICE_ROLE_KEY")?;
        let public_url = non_empty_env("PUBLIC_URL")?;

        let rest_url = format!(
            "{}/rest/v1/rooms",
            supabase_url.trim_end_matches('/')
        );
        Some(Self {
            rest_url,
            service_role_key,
            public_url: public_url.trim_end_matches('/').to_string(),
        })
    }
}

/// Read an env var, treating empty/whitespace as absent.
fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Aggregate room-server stats included in a heartbeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegistrySnapshot {
    /// Total connected + grace-held players across all rooms.
    pub player_count: usize,
    /// Number of live rooms on this server.
    pub room_count: usize,
}

/// Build the JSON body for a `rooms` upsert.
///
/// Column names are Postgres `snake_case` (the Supabase REST convention for
/// table columns) — distinct from the WebSocket protocol's camelCase
/// (Shared-ADR-002), which does not apply to the database schema. `last_heartbeat`
/// is intentionally **omitted**: a DB trigger stamps it with `now()` on every
/// write, avoiding dev-box clock-skew and keeping the payload minimal.
#[must_use]
pub fn build_heartbeat_payload(
    instance_id: &str,
    public_url: &str,
    snapshot: RegistrySnapshot,
) -> serde_json::Value {
    serde_json::json!({
        "instance_id": instance_id,
        "public_url": public_url,
        "player_count": snapshot.player_count,
        "room_count": snapshot.room_count,
    })
}

/// Collect the current player/room counts from the manager. Clones the room
/// handles first, then reads each under its own lock (matching the lock-ordering
/// discipline used elsewhere: never hold the manager lock across a room lock).
pub async fn collect_snapshot(manager: &Arc<RwLock<RoomManager>>) -> RegistrySnapshot {
    let rooms = {
        let mgr = manager.read().await;
        mgr.rooms_snapshot()
    };
    let mut player_count = 0;
    for room in &rooms {
        player_count += room.read().await.player_count();
    }
    RegistrySnapshot {
        player_count,
        room_count: rooms.len(),
    }
}

/// Spawn the heartbeat background task if the feature is enabled. Returns `true`
/// when a task was started, `false` when the registry is disabled (config
/// absent) — in which case the server behaves exactly as before.
pub fn spawn_if_enabled(manager: Arc<RwLock<RoomManager>>) -> bool {
    let Some(config) = RegistryConfig::from_env() else {
        info!(
            "[{}] Rooms registry disabled (set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_URL to enable)",
            *INSTANCE_ID
        );
        return false;
    };

    info!(
        "[{}] Rooms registry enabled: heartbeat every {}s to {} (public_url: {})",
        *INSTANCE_ID,
        HEARTBEAT_INTERVAL.as_secs(),
        config.rest_url,
        config.public_url
    );

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        // Fire an immediate heartbeat so the room appears without waiting a full
        // interval, then settle into the periodic cadence.
        loop {
            let snapshot = collect_snapshot(&manager).await;
            send_heartbeat(&client, &config, snapshot).await;
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
        }
    });
    true
}

/// Perform a single upsert. Errors are logged, not propagated: a failed
/// heartbeat must never take down the physics server.
async fn send_heartbeat(
    client: &reqwest::Client,
    config: &RegistryConfig,
    snapshot: RegistrySnapshot,
) {
    let body = build_heartbeat_payload(&INSTANCE_ID, &config.public_url, snapshot);

    // `on_conflict=instance_id` + `Prefer: resolution=merge-duplicates` makes
    // this an idempotent upsert keyed on the primary key.
    let result = client
        .post(format!("{}?on_conflict=instance_id", config.rest_url))
        .header("apikey", &config.service_role_key)
        .header("Authorization", format!("Bearer {}", config.service_role_key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .json(&body)
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => {
            debug!(
                "[{}] Heartbeat ok ({} players, {} rooms)",
                *INSTANCE_ID, snapshot.player_count, snapshot.room_count
            );
        }
        Ok(resp) => {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            warn!(
                "[{}] Heartbeat rejected: {status} {detail}",
                *INSTANCE_ID
            );
        }
        Err(e) => {
            warn!("[{}] Heartbeat request failed: {e}", *INSTANCE_ID);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_uses_snake_case_columns_and_omits_timestamp() {
        let payload = build_heartbeat_payload(
            "inst1234",
            "https://rooms.example.com",
            RegistrySnapshot { player_count: 3, room_count: 2 },
        );
        assert_eq!(payload["instance_id"], "inst1234");
        assert_eq!(payload["public_url"], "https://rooms.example.com");
        assert_eq!(payload["player_count"], 3);
        assert_eq!(payload["room_count"], 2);
        // last_heartbeat is DB-stamped by a trigger, never sent by the server.
        assert!(payload.get("last_heartbeat").is_none());
        // Exactly the four columns, nothing stray.
        assert_eq!(payload.as_object().unwrap().len(), 4);
    }

    #[test]
    fn payload_reflects_zero_counts() {
        let payload = build_heartbeat_payload(
            "inst",
            "https://x",
            RegistrySnapshot { player_count: 0, room_count: 0 },
        );
        assert_eq!(payload["player_count"], 0);
        assert_eq!(payload["room_count"], 0);
    }

    #[test]
    fn config_disabled_when_env_absent() {
        // These vars are not set in the unit-test environment, so the feature
        // must resolve to None (server runs unchanged).
        // (Guarded to avoid interfering with any real env in CI.)
        if std::env::var("SUPABASE_URL").is_err()
            && std::env::var("SUPABASE_SERVICE_ROLE_KEY").is_err()
        {
            assert!(RegistryConfig::from_env().is_none());
        }
    }
}
