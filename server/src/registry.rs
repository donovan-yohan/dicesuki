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
//! * `SUPABASE_SECRET_KEY` — preferred dedicated `sb_secret_...` server key.
//!   It is sent only in the `apikey` header. `SUPABASE_SERVICE_ROLE_KEY` remains
//!   an explicitly deprecated fallback for legacy JWT service-role keys.
//!   **Neither is ever committed** (ADR 006); supply one via secret storage.
//! * `PUBLIC_URL` — this server's publicly reachable base, e.g.
//!   `https://rooms.example.com` (behind the TLS reverse proxy; see
//!   `docs/guides/deployment.md`).
//!
//! `PUBLIC_URL` is the registry intent signal. Without it the registry is OFF,
//! even when a privileged Supabase credential enables another native service
//! such as authoritative-roll reporting. Once `PUBLIC_URL` is present, missing
//! or malformed registry dependencies are a startup error so an intended
//! heartbeat cannot fail open.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use log::{debug, info, warn};
use tokio::sync::RwLock;

use crate::room_manager::RoomManager;
use crate::supabase::{
    normalize_env_value, SupabaseCredentialMode, SupabaseServiceConfig, SupabaseServiceConfigError,
    SUPABASE_SECRET_KEY_ENV, SUPABASE_SERVICE_ROLE_KEY_ENV, SUPABASE_URL_ENV,
};
use crate::INSTANCE_ID;

/// How often the server refreshes its registry row. Short enough that a dead
/// server is detectable within a minute, long enough that write volume is
/// negligible at hobby scale.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
/// Maximum wall-clock time for one registry heartbeat request.
const HEARTBEAT_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Maximum time allowed to establish the registry connection.
const HEARTBEAT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

const PUBLIC_URL_ENV: &str = "PUBLIC_URL";

/// Authentication mode used for registry writes. This intentionally exposes
/// only the mode, never the credential value.
pub type RegistryCredentialMode = SupabaseCredentialMode;

/// Invalid registry environment configuration. Variants deliberately retain
/// env names and error categories only, never credential values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryConfigError {
    Incomplete { missing: Vec<&'static str> },
    InvalidSupabaseUrl,
    InvalidPublicUrl,
    InvalidSecretKey,
    InvalidLegacyServiceRoleKey,
}

impl fmt::Display for RegistryConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Incomplete { missing } => write!(
                formatter,
                "rooms registry configuration is incomplete; set {}",
                missing.join(", ")
            ),
            Self::InvalidSupabaseUrl => write!(
                formatter,
                "SUPABASE_URL must be a root base URL using https (http is allowed only for loopback development) with no path, credentials, query, or fragment"
            ),
            Self::InvalidPublicUrl => write!(
                formatter,
                "PUBLIC_URL must be a root http(s) base URL with no path, credentials, query, or fragment"
            ),
            Self::InvalidSecretKey => write!(
                formatter,
                "SUPABASE_SECRET_KEY must contain a dedicated sb_secret_ API key"
            ),
            Self::InvalidLegacyServiceRoleKey => write!(
                formatter,
                "SUPABASE_SERVICE_ROLE_KEY is a deprecated fallback and must contain a legacy JWT; put sb_secret_ keys in SUPABASE_SECRET_KEY"
            ),
        }
    }
}

impl std::error::Error for RegistryConfigError {}

/// Resolved registry configuration. Present only when the feature is enabled.
#[derive(Clone)]
pub struct RegistryConfig {
    /// Supabase REST endpoint for the `rooms` table
    /// (`{SUPABASE_URL}/rest/v1/rooms`).
    pub rest_url: String,
    service: SupabaseServiceConfig,
    /// This server's public base URL, stored so the client room browser can
    /// connect. Trailing slash trimmed.
    pub public_url: String,
}

impl fmt::Debug for RegistryConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RegistryConfig")
            .field("rest_url", &self.rest_url)
            .field("credential_mode", &self.credential_mode())
            .field("public_url", &self.public_url)
            .finish()
    }
}

impl RegistryConfig {
    /// Resolve config from the environment. `PUBLIC_URL` alone expresses
    /// registry intent; without it this integration is disabled. Once present,
    /// partial or malformed registry dependencies are an error.
    pub fn from_env() -> Result<Option<Self>, RegistryConfigError> {
        Self::resolve(|key| std::env::var(key).ok())
    }

    /// Credential mode selected for this deployment, without exposing the key.
    #[must_use]
    pub fn credential_mode(&self) -> RegistryCredentialMode {
        self.service.credential_mode()
    }

    fn resolve(
        mut read: impl FnMut(&str) -> Option<String>,
    ) -> Result<Option<Self>, RegistryConfigError> {
        let supabase_url = normalize_env_value(read(SUPABASE_URL_ENV));
        let secret_key = normalize_env_value(read(SUPABASE_SECRET_KEY_ENV));
        let legacy_key = normalize_env_value(read(SUPABASE_SERVICE_ROLE_KEY_ENV));
        let public_url = normalize_env_value(read(PUBLIC_URL_ENV));

        // SUPABASE_URL and backend credentials are shared by authentication and
        // authoritative rewards. Only PUBLIC_URL opts the rooms registry in.
        if public_url.is_none() {
            return Ok(None);
        }

        let mut missing = Vec::new();
        if supabase_url.is_none() {
            missing.push(SUPABASE_URL_ENV);
        }
        if secret_key.is_none() && legacy_key.is_none() {
            missing.push("SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy)");
        }
        if !missing.is_empty() {
            return Err(RegistryConfigError::Incomplete { missing });
        }

        let service = SupabaseServiceConfig::from_values(supabase_url, secret_key, legacy_key)
            .map_err(map_service_error)?
            .expect("registry credential presence checked above");
        let public_url = normalize_http_url(
            &public_url.expect("PUBLIC_URL is the registry intent signal"),
            RegistryConfigError::InvalidPublicUrl,
        )?;

        Ok(Some(Self {
            rest_url: service.rest_table_url("rooms"),
            service,
            public_url,
        }))
    }
}

fn map_service_error(error: SupabaseServiceConfigError) -> RegistryConfigError {
    match error {
        SupabaseServiceConfigError::Incomplete { missing } => {
            RegistryConfigError::Incomplete { missing }
        }
        SupabaseServiceConfigError::InvalidSupabaseUrl => RegistryConfigError::InvalidSupabaseUrl,
        SupabaseServiceConfigError::InvalidSecretKey => RegistryConfigError::InvalidSecretKey,
        SupabaseServiceConfigError::InvalidLegacyServiceRoleKey => {
            RegistryConfigError::InvalidLegacyServiceRoleKey
        }
    }
}

fn parse_http_url(
    value: &str,
    error: RegistryConfigError,
) -> Result<reqwest::Url, RegistryConfigError> {
    let parsed = reqwest::Url::parse(value).map_err(|_| error.clone())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || parsed.path() != "/"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(error);
    }
    Ok(parsed)
}

fn normalize_http_url(
    value: &str,
    error: RegistryConfigError,
) -> Result<String, RegistryConfigError> {
    parse_http_url(value, error)?;
    Ok(value.trim_end_matches('/').to_string())
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
pub fn spawn_if_enabled(manager: Arc<RwLock<RoomManager>>) -> Result<bool, RegistryConfigError> {
    let Some(config) = RegistryConfig::from_env()? else {
        info!(
            "[{}] Rooms registry disabled (set SUPABASE_URL, SUPABASE_SECRET_KEY, PUBLIC_URL to enable)",
            *INSTANCE_ID
        );
        return Ok(false);
    };

    if config.credential_mode() == RegistryCredentialMode::LegacyServiceRoleJwt {
        warn!(
            "[{}] Rooms registry is using deprecated SUPABASE_SERVICE_ROLE_KEY fallback; migrate to SUPABASE_SECRET_KEY",
            *INSTANCE_ID
        );
    }

    info!(
        "[{}] Rooms registry enabled: heartbeat every {}s to {} (public_url: {})",
        *INSTANCE_ID,
        HEARTBEAT_INTERVAL.as_secs(),
        config.rest_url,
        config.public_url
    );

    tokio::spawn(async move {
        let client = registry_client(&config);
        // Fire an immediate heartbeat so the room appears without waiting a full
        // interval, then settle into the periodic cadence.
        loop {
            let snapshot = collect_snapshot(&manager).await;
            send_heartbeat(&client, &config, snapshot).await;
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
        }
    });
    Ok(true)
}

fn registry_client(config: &RegistryConfig) -> reqwest::Client {
    config
        .service
        .http_client(HEARTBEAT_CONNECT_TIMEOUT, HEARTBEAT_REQUEST_TIMEOUT)
}

fn build_heartbeat_request(
    client: &reqwest::Client,
    config: &RegistryConfig,
    instance_id: &str,
    snapshot: RegistrySnapshot,
) -> reqwest::RequestBuilder {
    let body = build_heartbeat_payload(instance_id, &config.public_url, snapshot);

    // `on_conflict=instance_id` + `Prefer: resolution=merge-duplicates` makes
    // this an idempotent upsert keyed on the primary key.
    let request = client
        .post(format!("{}?on_conflict=instance_id", config.rest_url))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .json(&body);
    config.service.apply_auth(request)
}

/// Perform a single upsert. Errors are logged, not propagated: a failed
/// heartbeat must never take down the physics server.
async fn send_heartbeat(
    client: &reqwest::Client,
    config: &RegistryConfig,
    snapshot: RegistrySnapshot,
) {
    let result = build_heartbeat_request(client, config, &INSTANCE_ID, snapshot)
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
            // Never log a remote response body: a misconfigured or malicious
            // endpoint could echo request credentials into it.
            warn!("[{}] Heartbeat rejected: {status}", *INSTANCE_ID);
        }
        Err(e) => {
            warn!("[{}] Heartbeat request failed: {e}", *INSTANCE_ID);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUPABASE_URL: &str = "https://example.supabase.co";
    const PUBLIC_URL: &str = "https://rooms.example.com";
    const SECRET_KEY: &str = "sb_secret_test-fixture";
    const LEGACY_SERVICE_ROLE_JWT: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJyb2xlIjoic2VydmljZV9yb2xlIn0.",
        "c2lnbmF0dXJl"
    );
    const LEGACY_ANON_JWT: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJyb2xlIjoiYW5vbiJ9.",
        "c2lnbmF0dXJl"
    );
    const LEGACY_AUTHENTICATED_JWT: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.",
        "c2lnbmF0dXJl"
    );
    const LEGACY_INVALID_PAYLOAD_JWT: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "bm90LWpzb24.",
        "c2lnbmF0dXJl"
    );

    fn resolve(values: &[(&str, &str)]) -> Result<Option<RegistryConfig>, RegistryConfigError> {
        RegistryConfig::resolve(|key| {
            values
                .iter()
                .find_map(|(candidate, value)| (*candidate == key).then(|| (*value).to_string()))
        })
    }

    fn enabled_config(values: &[(&str, &str)]) -> RegistryConfig {
        resolve(values)
            .unwrap()
            .expect("registry should be enabled")
    }

    fn request_for(config: &RegistryConfig) -> reqwest::Request {
        build_heartbeat_request(
            &registry_client(config),
            config,
            "instance",
            RegistrySnapshot {
                player_count: 2,
                room_count: 1,
            },
        )
        .build()
        .unwrap()
    }

    #[test]
    fn payload_uses_snake_case_columns_and_omits_timestamp() {
        let payload = build_heartbeat_payload(
            "inst1234",
            "https://rooms.example.com",
            RegistrySnapshot {
                player_count: 3,
                room_count: 2,
            },
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
            RegistrySnapshot {
                player_count: 0,
                room_count: 0,
            },
        );
        assert_eq!(payload["player_count"], 0);
        assert_eq!(payload["room_count"], 0);
    }

    #[test]
    fn heartbeat_timeouts_are_bounded_before_the_next_interval() {
        assert_eq!(HEARTBEAT_CONNECT_TIMEOUT, Duration::from_secs(5));
        assert_eq!(HEARTBEAT_REQUEST_TIMEOUT, Duration::from_secs(15));
        assert!(HEARTBEAT_CONNECT_TIMEOUT < HEARTBEAT_REQUEST_TIMEOUT);
        assert!(HEARTBEAT_REQUEST_TIMEOUT < HEARTBEAT_INTERVAL);

        // The same constants are consumed directly by `registry_client`, so
        // constructing it also proves reqwest accepts the bounded policy.
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        let _client = registry_client(&config);
    }

    #[test]
    fn secret_key_mode_sends_only_apikey_header() {
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        let request = request_for(&config);

        assert_eq!(
            config.credential_mode(),
            RegistryCredentialMode::SecretApiKey
        );
        assert_eq!(request.headers()["apikey"].to_str().unwrap(), SECRET_KEY);
        assert!(request.headers()["apikey"].is_sensitive());
        assert!(request.headers().get("authorization").is_none());
        assert!(!format!("{request:?}").contains(SECRET_KEY));
    }

    #[test]
    fn legacy_mode_sends_apikey_and_bearer_headers() {
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY_SERVICE_ROLE_JWT),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        let request = request_for(&config);

        assert_eq!(
            config.credential_mode(),
            RegistryCredentialMode::LegacyServiceRoleJwt
        );
        assert_eq!(
            request.headers()["apikey"].to_str().unwrap(),
            LEGACY_SERVICE_ROLE_JWT
        );
        assert_eq!(
            request.headers()["authorization"].to_str().unwrap(),
            format!("Bearer {LEGACY_SERVICE_ROLE_JWT}")
        );
        assert!(request.headers()["apikey"].is_sensitive());
        assert!(request.headers()["authorization"].is_sensitive());
        assert!(!format!("{request:?}").contains(LEGACY_SERVICE_ROLE_JWT));
    }

    #[test]
    fn secret_key_is_preferred_when_both_credentials_are_valid() {
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY_SERVICE_ROLE_JWT),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        let request = request_for(&config);

        assert_eq!(
            config.credential_mode(),
            RegistryCredentialMode::SecretApiKey
        );
        assert_eq!(request.headers()["apikey"].to_str().unwrap(), SECRET_KEY);
        assert!(request.headers().get("authorization").is_none());
    }

    #[test]
    fn malformed_preferred_key_never_silently_falls_back_to_legacy() {
        let result = resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, "sb_publishable_wrong-kind"),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY_SERVICE_ROLE_JWT),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);

        assert!(matches!(result, Err(RegistryConfigError::InvalidSecretKey)));
    }

    #[test]
    fn secret_key_in_legacy_variable_is_rejected_as_ambiguous_migration_config() {
        let result = resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);

        assert!(matches!(
            result,
            Err(RegistryConfigError::InvalidLegacyServiceRoleKey)
        ));
    }

    #[test]
    fn legacy_fallback_requires_service_role_claim() {
        for invalid_key in [
            LEGACY_ANON_JWT,
            LEGACY_AUTHENTICATED_JWT,
            LEGACY_INVALID_PAYLOAD_JWT,
        ] {
            let result = resolve(&[
                (SUPABASE_URL_ENV, SUPABASE_URL),
                (SUPABASE_SERVICE_ROLE_KEY_ENV, invalid_key),
                (PUBLIC_URL_ENV, PUBLIC_URL),
            ]);
            assert!(matches!(
                result,
                Err(RegistryConfigError::InvalidLegacyServiceRoleKey)
            ));
        }
    }

    #[test]
    fn registry_is_disabled_without_public_url_even_for_reporter_credentials() {
        assert!(resolve(&[]).unwrap().is_none());
        assert!(resolve(&[(SUPABASE_URL_ENV, SUPABASE_URL)])
            .unwrap()
            .is_none());
        assert!(resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
        ])
        .unwrap()
        .is_none());
        assert!(resolve(&[(SUPABASE_SECRET_KEY_ENV, SECRET_KEY)])
            .unwrap()
            .is_none());

        // The reporter's config resolver owns validation when the registry is
        // not intended. Registry must not couple another service's credential
        // to PUBLIC_URL.
        assert!(resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, "malformed-reporter-key"),
        ])
        .unwrap()
        .is_none());
    }

    #[test]
    fn public_url_intent_fails_closed_with_only_missing_env_names() {
        let result = resolve(&[(PUBLIC_URL_ENV, PUBLIC_URL)]);
        assert_eq!(
            result.unwrap_err(),
            RegistryConfigError::Incomplete {
                missing: vec![
                    SUPABASE_URL_ENV,
                    "SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy)",
                ]
            }
        );

        let result = resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        assert_eq!(
            result.unwrap_err(),
            RegistryConfigError::Incomplete {
                missing: vec![
                    "SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy)"
                ]
            }
        );

        let result = resolve(&[
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        assert_eq!(
            result.unwrap_err(),
            RegistryConfigError::Incomplete {
                missing: vec![SUPABASE_URL_ENV]
            }
        );
    }

    #[test]
    fn malformed_urls_are_rejected_without_echoing_values() {
        let invalid_url = "https://user:top-secret@example.invalid?leak=top-secret";
        let error = resolve(&[
            (SUPABASE_URL_ENV, invalid_url),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ])
        .unwrap_err();

        assert_eq!(error, RegistryConfigError::InvalidSupabaseUrl);
        assert!(!error.to_string().contains("top-secret"));
        assert!(!format!("{error:?}").contains("top-secret"));
    }

    #[test]
    fn configured_urls_accept_root_bases_and_reject_paths() {
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, "https://example.supabase.co/"),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, "https://rooms.example.com/"),
        ]);
        assert_eq!(config.rest_url, "https://example.supabase.co/rest/v1/rooms");
        assert_eq!(config.public_url, "https://rooms.example.com");

        let supabase_path = resolve(&[
            (SUPABASE_URL_ENV, "https://example.supabase.co/project-path"),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        assert!(matches!(
            supabase_path,
            Err(RegistryConfigError::InvalidSupabaseUrl)
        ));

        let public_path = resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, "https://rooms.example.com/room-path"),
        ]);
        assert!(matches!(
            public_path,
            Err(RegistryConfigError::InvalidPublicUrl)
        ));
    }

    #[test]
    fn supabase_url_requires_tls_except_for_explicit_loopback_development() {
        let remote_http = resolve(&[
            (SUPABASE_URL_ENV, "http://example.supabase.co"),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        assert!(matches!(
            remote_http,
            Err(RegistryConfigError::InvalidSupabaseUrl)
        ));

        for loopback in [
            "http://localhost:54321",
            "http://127.0.0.1:54321",
            "http://[::1]:54321",
        ] {
            let config = enabled_config(&[
                (SUPABASE_URL_ENV, loopback),
                (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
                (PUBLIC_URL_ENV, "http://localhost:8080"),
            ]);
            assert!(config.rest_url.starts_with(loopback));
        }
    }

    #[test]
    fn config_debug_and_errors_never_expose_key_values() {
        let config = enabled_config(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, SECRET_KEY),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ]);
        let debug = format!("{config:?}");
        assert!(debug.contains("SecretApiKey"));
        assert!(!debug.contains(SECRET_KEY));

        let invalid_key = "operator-secret-value";
        let error = resolve(&[
            (SUPABASE_URL_ENV, SUPABASE_URL),
            (SUPABASE_SECRET_KEY_ENV, invalid_key),
            (PUBLIC_URL_ENV, PUBLIC_URL),
        ])
        .unwrap_err();
        assert!(!error.to_string().contains(invalid_key));
        assert!(!format!("{error:?}").contains(invalid_key));
    }
}
