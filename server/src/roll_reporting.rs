//! Native authoritative-roll completion reporting.
//!
//! The physics loop hands completed explicit rolls to a bounded queue. A fixed
//! worker pool performs the privileged Supabase RPC outside every room lock.
//! Retries reuse the exact event id, completion timestamp, payload hash, and
//! request bytes; migration 0010 makes those replays exactly-once in Postgres.
//!
//! This queue is deliberately process-local. It provides in-process
//! at-least-once delivery and backpressure, not restart-proof durability. See
//! ADR 015 before treating an acknowledged-but-not-yet-recorded event as
//! durable across a server crash.

use std::fmt;
use std::fmt::Write as _;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dicesuki_core::messages::DiceType;
use dicesuki_core::room::CompletedRoll;
use log::{error, info, warn};
use rand::Rng;
use reqwest::StatusCode;
use serde::Serialize;
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::supabase::{SupabaseCredentialMode, SupabaseServiceConfig, SupabaseServiceConfigError};

const RPC_FUNCTION: &str = "record_authoritative_roll_completion";
const QUEUE_CAPACITY: usize = 64;
const WORKER_CONCURRENCY: usize = 2;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const RETRY_BASE_DELAY: Duration = Duration::from_millis(250);
const RETRY_MAX_DELAY: Duration = Duration::from_secs(30);

/// Operational state exposed through `/health` without exposing event data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollReporterStatus {
    Disabled,
    Healthy,
    Unhealthy,
}

impl RollReporterStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Healthy => "healthy",
            Self::Unhealthy => "unhealthy",
        }
    }
}

/// Why one completion was not queued.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Queued,
    SkippedDisabled,
    SkippedGuest,
    RejectedInvalid,
    WorkerUnavailable,
}

#[derive(Default)]
struct ReporterHealth {
    permanent_failure: AtomicBool,
    retrying_deliveries: AtomicUsize,
}

impl ReporterHealth {
    fn status(&self) -> RollReporterStatus {
        if self.permanent_failure.load(Ordering::Acquire)
            || self.retrying_deliveries.load(Ordering::Acquire) > 0
        {
            RollReporterStatus::Unhealthy
        } else {
            RollReporterStatus::Healthy
        }
    }

    fn mark_permanent_failure(&self) {
        self.permanent_failure.store(true, Ordering::Release);
    }
}

#[derive(Clone)]
enum ReporterMode {
    Disabled,
    Enabled {
        sender: mpsc::Sender<Arc<AuthoritativeRollCompletion>>,
        health: Arc<ReporterHealth>,
    },
}

/// Cheap cloneable handle injected into WebSocket and simulation hosts.
#[derive(Clone)]
pub struct RollReporter {
    instance_id: Arc<str>,
    mode: ReporterMode,
}

impl fmt::Debug for RollReporter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RollReporter")
            .field("status", &self.status())
            .finish_non_exhaustive()
    }
}

impl RollReporter {
    /// Disabled reporter used by local/WASM-compatible paths and existing
    /// integration tests. It never spawns a task or performs network I/O.
    #[must_use]
    pub fn disabled() -> Self {
        Self {
            instance_id: Arc::from("disabled"),
            mode: ReporterMode::Disabled,
        }
    }

    /// Resolve privileged config and spawn the native reporter worker pool.
    /// Missing credentials leave reporting explicitly disabled; malformed
    /// operator intent is a startup error.
    pub fn from_env(instance_id: String) -> Result<Self, SupabaseServiceConfigError> {
        let Some(config) = SupabaseServiceConfig::from_env()? else {
            info!(
                "Authoritative roll reporting disabled (set SUPABASE_URL and SUPABASE_SECRET_KEY to enable)"
            );
            return Ok(Self::disabled());
        };

        if config.credential_mode() == SupabaseCredentialMode::LegacyServiceRoleJwt {
            warn!(
                "Authoritative roll reporting is using deprecated SUPABASE_SERVICE_ROLE_KEY fallback; migrate to SUPABASE_SECRET_KEY"
            );
        }

        let transport = Arc::new(HttpRollRpcTransport::new(&config));
        info!(
            "Authoritative roll reporting enabled with {} workers and bounded queue capacity {}",
            WORKER_CONCURRENCY, QUEUE_CAPACITY
        );
        Ok(Self::spawn(
            instance_id,
            QUEUE_CAPACITY,
            WORKER_CONCURRENCY,
            transport,
            RetryPolicy::production(),
        ))
    }

    /// Current coarse operational state. A transient delivery failure reports
    /// unhealthy until that byte-identical event succeeds. Permanent failures
    /// remain sticky until process restart/operator correction.
    #[must_use]
    pub fn status(&self) -> RollReporterStatus {
        match &self.mode {
            ReporterMode::Disabled => RollReporterStatus::Disabled,
            ReporterMode::Enabled { health, .. } => health.status(),
        }
    }

    /// Convert one core completion into an immutable native authority event and
    /// enqueue it with bounded backpressure. Guest completions are intentionally
    /// ignored: no browser/local-WASM path can acquire the privileged transport.
    pub async fn enqueue_completion(
        &self,
        room_id: String,
        completion: CompletedRoll,
    ) -> EnqueueOutcome {
        if matches!(&self.mode, ReporterMode::Disabled) {
            return EnqueueOutcome::SkippedDisabled;
        }
        let Some(user_id) = completion.user_id.as_deref() else {
            return EnqueueOutcome::SkippedGuest;
        };

        let user_id = match Uuid::parse_str(user_id) {
            Ok(user_id) => user_id,
            Err(_) => {
                self.mark_permanent_failure();
                error!(
                    "Authoritative roll completion rejected locally: authenticated user id is not a UUID"
                );
                return EnqueueOutcome::RejectedInvalid;
            }
        };
        let results = completion
            .results
            .into_iter()
            .map(|result| AuthoritativeRollResult {
                dice_id: result.dice_id,
                dice_type: result.dice_type,
                face_value: result.face_value,
            })
            .collect();
        let event = match AuthoritativeRollCompletion::new(
            self.instance_id.to_string(),
            room_id,
            completion.player_id,
            user_id,
            completion.generation,
            OffsetDateTime::now_utc(),
            results,
            completion.total,
        ) {
            Ok(event) => Arc::new(event),
            Err(_) => {
                self.mark_permanent_failure();
                error!(
                    "Authoritative roll completion rejected locally: immutable event invariants failed"
                );
                return EnqueueOutcome::RejectedInvalid;
            }
        };

        self.enqueue_event(event).await
    }

    async fn enqueue_event(&self, event: Arc<AuthoritativeRollCompletion>) -> EnqueueOutcome {
        match &self.mode {
            ReporterMode::Disabled => EnqueueOutcome::SkippedDisabled,
            ReporterMode::Enabled { sender, health } => {
                // Deliberately await bounded capacity. The simulation host drops
                // its room lock before this call, so backpressure cannot stall
                // physics or WebSocket access while a lock is held.
                if sender.send(event).await.is_ok() {
                    EnqueueOutcome::Queued
                } else {
                    health.mark_permanent_failure();
                    error!("Authoritative roll reporter worker queue is unavailable");
                    EnqueueOutcome::WorkerUnavailable
                }
            }
        }
    }

    fn mark_permanent_failure(&self) {
        if let ReporterMode::Enabled { health, .. } = &self.mode {
            health.mark_permanent_failure();
        }
    }

    fn spawn(
        instance_id: String,
        queue_capacity: usize,
        worker_concurrency: usize,
        transport: Arc<dyn RollRpcTransport>,
        retry_policy: RetryPolicy,
    ) -> Self {
        assert!(
            queue_capacity > 0,
            "reporter queue must be bounded above zero"
        );
        assert!(worker_concurrency > 0, "reporter needs at least one worker");

        let (sender, receiver) = mpsc::channel::<Arc<AuthoritativeRollCompletion>>(queue_capacity);
        let receiver = Arc::new(Mutex::new(receiver));
        let health = Arc::new(ReporterHealth::default());

        for _ in 0..worker_concurrency {
            let receiver = receiver.clone();
            let transport = transport.clone();
            let health = health.clone();
            tokio::spawn(async move {
                loop {
                    let event = {
                        // Tokio mpsc has one receiver; hold this mutex only while
                        // awaiting/dequeuing, never during HTTP delivery.
                        let mut receiver = receiver.lock().await;
                        receiver.recv().await
                    };
                    let Some(event) = event else { break };
                    deliver_with_retry(transport.as_ref(), &event, &health, retry_policy).await;
                }
            });
        }

        Self {
            instance_id: Arc::from(instance_id),
            mode: ReporterMode::Enabled { sender, health },
        }
    }
}

/// One presentation-free result committed into the canonical authority hash.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativeRollResult {
    pub dice_id: String,
    pub dice_type: DiceType,
    pub face_value: u32,
}

/// Immutable completion event. Canonical JSON and RPC bytes are produced once
/// at construction and reused for every retry.
pub struct AuthoritativeRollCompletion {
    event_id: String,
    payload_sha256: String,
    completed_at: String,
    canonical_json: String,
    rpc_body: String,
}

impl fmt::Debug for AuthoritativeRollCompletion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthoritativeRollCompletion")
            .field("event_id", &self.event_id)
            .field("payload_sha256", &self.payload_sha256)
            .field("completed_at", &self.completed_at)
            .field("canonical_json", &"[redacted]")
            .field("rpc_body", &"[redacted]")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollCompletionBuildError {
    InvalidEventId,
    EmptyResults,
    InvalidResult,
    TotalMismatch,
    Timestamp,
    Serialization,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalPayload<'a> {
    schema_version: u8,
    authority: &'static str,
    event_id: &'a str,
    user_id: Uuid,
    instance_id: &'a str,
    room_id: &'a str,
    player_id: &'a str,
    sequence: u64,
    completed_at: &'a str,
    results: &'a [AuthoritativeRollResult],
    total: u32,
}

#[derive(Serialize)]
struct RpcArgs<'a> {
    p_user_id: Uuid,
    p_server_event_id: &'a str,
    p_payload_sha256: &'a str,
    p_completed_at: &'a str,
}

impl AuthoritativeRollCompletion {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        instance_id: String,
        room_id: String,
        player_id: String,
        initiation_user_id: Uuid,
        roll_generation: u64,
        completed_at_utc: OffsetDateTime,
        mut results: Vec<AuthoritativeRollResult>,
        total: u32,
    ) -> Result<Self, RollCompletionBuildError> {
        let event_id = format!("roll.v1:{instance_id}:{room_id}:{player_id}:{roll_generation}");
        if !valid_server_event_id(&event_id) {
            return Err(RollCompletionBuildError::InvalidEventId);
        }
        if results.is_empty() {
            return Err(RollCompletionBuildError::EmptyResults);
        }
        if results.iter().any(|result| {
            result.dice_id.is_empty()
                || result.dice_id.len() > 160
                || !is_valid_face(result.dice_type, result.face_value)
        }) {
            return Err(RollCompletionBuildError::InvalidResult);
        }
        results.sort_by(|left, right| {
            left.dice_id
                .cmp(&right.dice_id)
                .then_with(|| dice_type_name(left.dice_type).cmp(dice_type_name(right.dice_type)))
                .then_with(|| left.face_value.cmp(&right.face_value))
        });
        if results
            .windows(2)
            .any(|pair| pair[0].dice_id == pair[1].dice_id)
        {
            return Err(RollCompletionBuildError::InvalidResult);
        }
        let computed_total = results
            .iter()
            .try_fold(0_u32, |sum, result| sum.checked_add(result.face_value))
            .ok_or(RollCompletionBuildError::TotalMismatch)?;
        if total != computed_total {
            return Err(RollCompletionBuildError::TotalMismatch);
        }

        // PostgreSQL timestamptz stores microseconds. Normalize before both
        // hashing and RPC serialization so an exact replay remains exact after
        // the first value has round-tripped through Postgres.
        let completed_at_utc = completed_at_utc.to_offset(UtcOffset::UTC);
        let completed_at_utc = completed_at_utc
            .replace_nanosecond((completed_at_utc.nanosecond() / 1_000) * 1_000)
            .map_err(|_| RollCompletionBuildError::Timestamp)?;
        let completed_at = completed_at_utc
            .format(&Rfc3339)
            .map_err(|_| RollCompletionBuildError::Timestamp)?;
        let canonical_json = serde_json::to_string(&CanonicalPayload {
            schema_version: 1,
            authority: "server-authoritative-room",
            event_id: &event_id,
            user_id: initiation_user_id,
            instance_id: &instance_id,
            room_id: &room_id,
            player_id: &player_id,
            sequence: roll_generation,
            completed_at: &completed_at,
            results: &results,
            total,
        })
        .map_err(|_| RollCompletionBuildError::Serialization)?;
        let payload_sha256 = sha256_hex(canonical_json.as_bytes());
        let rpc_body = serde_json::to_string(&RpcArgs {
            p_user_id: initiation_user_id,
            p_server_event_id: &event_id,
            p_payload_sha256: &payload_sha256,
            p_completed_at: &completed_at,
        })
        .map_err(|_| RollCompletionBuildError::Serialization)?;

        Ok(Self {
            event_id,
            payload_sha256,
            completed_at,
            canonical_json,
            rpc_body,
        })
    }

    #[must_use]
    pub fn event_id(&self) -> &str {
        &self.event_id
    }

    #[must_use]
    pub fn payload_sha256(&self) -> &str {
        &self.payload_sha256
    }

    #[must_use]
    pub fn canonical_json(&self) -> &str {
        &self.canonical_json
    }
}

fn valid_server_event_id(value: &str) -> bool {
    value.len() >= 8
        && value.len() <= 160
        && value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

/// Whether `face` is a value this die type can physically settle on.
///
/// Deliberately tighter than a min/max range, because the two zero-based dice
/// have shapes a range cannot express:
/// - `D10` reads `0..=9`. It can never show 10 — the virtual d10 (1–10) is a
///   separate client-side mapping, not an engine face.
/// - `D10Tens` reads `00, 10, … 90`: only multiples of ten are legal faces, so a
///   corrupt 45 is rejected rather than silently reported.
/// - every other die is labelled `1..=N`.
///
/// A blanket `face == 0` rejection would have been wrong for both zero-based
/// dice, silently dropping those completions.
const fn is_valid_face(dice_type: DiceType, face: u32) -> bool {
    match dice_type {
        DiceType::D10 => face <= 9,
        DiceType::D10Tens => face <= 90 && face % 10 == 0,
        DiceType::D4 => face >= 1 && face <= 4,
        DiceType::D6 => face >= 1 && face <= 6,
        DiceType::D8 => face >= 1 && face <= 8,
        DiceType::D12 => face >= 1 && face <= 12,
        DiceType::D20 => face >= 1 && face <= 20,
    }
}

const fn dice_type_name(dice_type: DiceType) -> &'static str {
    match dice_type {
        DiceType::D4 => "d4",
        DiceType::D6 => "d6",
        DiceType::D8 => "d8",
        DiceType::D10 => "d10",
        DiceType::D10Tens => "d10tens",
        DiceType::D12 => "d12",
        DiceType::D20 => "d20",
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        write!(output, "{byte:02x}").expect("writing into String cannot fail");
    }
    output
}

enum RpcAttempt {
    Response(StatusCode),
    NetworkFailure,
}

type RpcFuture<'a> = Pin<Box<dyn Future<Output = RpcAttempt> + Send + 'a>>;

trait RollRpcTransport: Send + Sync {
    fn send<'a>(&'a self, event: &'a AuthoritativeRollCompletion) -> RpcFuture<'a>;
}

struct HttpRollRpcTransport {
    client: reqwest::Client,
    config: SupabaseServiceConfig,
    rpc_url: String,
}

impl HttpRollRpcTransport {
    fn new(config: &SupabaseServiceConfig) -> Self {
        Self {
            client: config.http_client(CONNECT_TIMEOUT, REQUEST_TIMEOUT),
            config: config.clone(),
            rpc_url: config.rpc_url(RPC_FUNCTION),
        }
    }

    fn build_request(&self, event: &AuthoritativeRollCompletion) -> reqwest::RequestBuilder {
        let request = self
            .client
            .post(&self.rpc_url)
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            // Body bytes were frozen at event construction; retries never
            // reserialize a mutable structure.
            .body(event.rpc_body.clone());
        self.config.apply_auth(request)
    }
}

impl RollRpcTransport for HttpRollRpcTransport {
    fn send<'a>(&'a self, event: &'a AuthoritativeRollCompletion) -> RpcFuture<'a> {
        Box::pin(async move {
            match self.build_request(event).send().await {
                Ok(response) => RpcAttempt::Response(response.status()),
                Err(_) => RpcAttempt::NetworkFailure,
            }
        })
    }
}

#[derive(Clone, Copy)]
struct RetryPolicy {
    base_delay: Duration,
    max_delay: Duration,
    jitter: bool,
}

impl RetryPolicy {
    const fn production() -> Self {
        Self {
            base_delay: RETRY_BASE_DELAY,
            max_delay: RETRY_MAX_DELAY,
            jitter: true,
        }
    }

    fn delay(self, failed_attempt: u32) -> Duration {
        self.delay_with_sample(failed_attempt, |upper_inclusive| {
            rand::thread_rng().gen_range(0..=upper_inclusive)
        })
    }

    /// Equal jitter: sample uniformly from the upper half of the already-capped
    /// exponential window. The half-window floor prevents a zero-delay hot loop,
    /// while sampling below the cap retains variance after saturation.
    fn delay_with_sample(
        self,
        failed_attempt: u32,
        sample: impl FnOnce(u64) -> u64,
    ) -> Duration {
        let multiplier = 1_u32 << failed_attempt.min(16);
        let capped = self
            .base_delay
            .checked_mul(multiplier)
            .unwrap_or(self.max_delay)
            .min(self.max_delay);
        if !self.jitter || capped.is_zero() {
            return capped;
        }

        let capped_millis = capped.as_millis().min(u128::from(u64::MAX)) as u64;
        if capped_millis == 0 {
            return capped;
        }
        let floor_millis = capped_millis / 2;
        let variance_millis = capped_millis - floor_millis;
        let sampled_millis = sample(variance_millis).min(variance_millis);
        Duration::from_millis(floor_millis.saturating_add(sampled_millis)).min(capped)
    }
}

async fn deliver_with_retry(
    transport: &dyn RollRpcTransport,
    event: &AuthoritativeRollCompletion,
    health: &ReporterHealth,
    retry_policy: RetryPolicy,
) {
    let mut failed_attempt = 0_u32;
    let mut marked_retrying = false;

    loop {
        match transport.send(event).await {
            RpcAttempt::Response(status) if status.is_success() => {
                if marked_retrying {
                    health.retrying_deliveries.fetch_sub(1, Ordering::AcqRel);
                }
                return;
            }
            RpcAttempt::NetworkFailure
            | RpcAttempt::Response(StatusCode::REQUEST_TIMEOUT)
            | RpcAttempt::Response(StatusCode::TOO_MANY_REQUESTS) => {}
            RpcAttempt::Response(status) if status.is_server_error() => {}
            RpcAttempt::Response(status) => {
                health.mark_permanent_failure();
                // Status is safe operational metadata. Never read/log the
                // response body or any event/user/payload identifiers.
                error!("Authoritative roll RPC rejected permanently with status {status}");
                if marked_retrying {
                    health.retrying_deliveries.fetch_sub(1, Ordering::AcqRel);
                }
                return;
            }
        }

        if !marked_retrying {
            health.retrying_deliveries.fetch_add(1, Ordering::AcqRel);
            marked_retrying = true;
            warn!("Authoritative roll RPC transient failure; retrying with backoff");
        }
        tokio::time::sleep(retry_policy.delay(failed_attempt)).await;
        failed_attempt = failed_attempt.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;
    use tokio::sync::Notify;

    const SECRET: &str = "sb_secret_test-fixture";
    const LEGACY: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJyb2xlIjoic2VydmljZV9yb2xlIn0.",
        "c2lnbmF0dXJl"
    );

    fn service(secret: &str, legacy: Option<&str>) -> SupabaseServiceConfig {
        SupabaseServiceConfig::from_values(
            Some("https://example.supabase.co".to_string()),
            Some(secret.to_string()),
            legacy.map(ToString::to_string),
        )
        .unwrap()
        .unwrap()
    }

    fn event_with_results(results: Vec<AuthoritativeRollResult>) -> AuthoritativeRollCompletion {
        AuthoritativeRollCompletion::new(
            "inst_123".to_string(),
            "room-abc".to_string(),
            "550e8400-e29b-41d4-a716-446655440001".to_string(),
            Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            7,
            OffsetDateTime::parse("2026-07-18T12:34:56Z", &Rfc3339).unwrap(),
            results,
            9,
        )
        .unwrap()
    }

    fn event() -> AuthoritativeRollCompletion {
        event_with_results(vec![
            AuthoritativeRollResult {
                dice_id: "die-b".to_string(),
                dice_type: DiceType::D6,
                face_value: 5,
            },
            AuthoritativeRollResult {
                dice_id: "die-a".to_string(),
                dice_type: DiceType::D8,
                face_value: 4,
            },
        ])
    }

    #[test]
    fn canonical_payload_is_order_independent_with_fixed_hash_vector() {
        let forward = event();
        let reversed = event_with_results(vec![
            AuthoritativeRollResult {
                dice_id: "die-a".to_string(),
                dice_type: DiceType::D8,
                face_value: 4,
            },
            AuthoritativeRollResult {
                dice_id: "die-b".to_string(),
                dice_type: DiceType::D6,
                face_value: 5,
            },
        ]);

        assert_eq!(
            forward.event_id(),
            "roll.v1:inst_123:room-abc:550e8400-e29b-41d4-a716-446655440001:7"
        );
        assert_eq!(forward.canonical_json(), reversed.canonical_json());
        assert_eq!(forward.payload_sha256(), reversed.payload_sha256());
        assert_eq!(
            forward.canonical_json(),
            r#"{"schemaVersion":1,"authority":"server-authoritative-room","eventId":"roll.v1:inst_123:room-abc:550e8400-e29b-41d4-a716-446655440001:7","userId":"550e8400-e29b-41d4-a716-446655440000","instanceId":"inst_123","roomId":"room-abc","playerId":"550e8400-e29b-41d4-a716-446655440001","sequence":7,"completedAt":"2026-07-18T12:34:56Z","results":[{"diceId":"die-a","diceType":"d8","faceValue":4},{"diceId":"die-b","diceType":"d6","faceValue":5}],"total":9}"#
        );
        // Fixed vector intentionally catches field-order, timestamp, result
        // ordering, and version drift. Update only with a reviewed schema bump.
        assert_eq!(
            forward.payload_sha256(),
            "714c60047c4ba712c9b568672046e41331ea1a1c1eeb2ab9c41aa81a825c632f"
        );
    }

    #[test]
    fn builder_rejects_bad_faces_duplicate_ids_and_total_mismatch() {
        let bad_face = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::UNIX_EPOCH,
            vec![AuthoritativeRollResult {
                dice_id: "die".into(),
                dice_type: DiceType::D6,
                face_value: 7,
            }],
            7,
        );
        assert_eq!(
            bad_face.unwrap_err(),
            RollCompletionBuildError::InvalidResult
        );

        let duplicate = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::UNIX_EPOCH,
            vec![
                AuthoritativeRollResult {
                    dice_id: "die".into(),
                    dice_type: DiceType::D6,
                    face_value: 1,
                },
                AuthoritativeRollResult {
                    dice_id: "die".into(),
                    dice_type: DiceType::D6,
                    face_value: 2,
                },
            ],
            3,
        );
        assert_eq!(
            duplicate.unwrap_err(),
            RollCompletionBuildError::InvalidResult
        );

        let mismatch = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::UNIX_EPOCH,
            vec![AuthoritativeRollResult {
                dice_id: "die".into(),
                dice_type: DiceType::D6,
                face_value: 6,
            }],
            5,
        );
        assert_eq!(
            mismatch.unwrap_err(),
            RollCompletionBuildError::TotalMismatch
        );
    }

    #[test]
    fn builder_accepts_percentile_pair_including_the_double_zero() {
        // A d100 roll is one tens die + one ones d10. The room total is a PLAIN
        // face sum, so "00 + 0" reports total 0 server-side even though the client
        // displays 100 (see src/lib/percentileRolls.ts). Both zeros must survive
        // validation — they are legal faces, not missing values.
        let completion = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::UNIX_EPOCH,
            vec![
                AuthoritativeRollResult {
                    dice_id: "tens".into(),
                    dice_type: DiceType::D10Tens,
                    face_value: 0,
                },
                AuthoritativeRollResult {
                    dice_id: "ones".into(),
                    dice_type: DiceType::D10,
                    face_value: 0,
                },
            ],
            0,
        );
        assert!(completion.is_ok(), "00 + 0 must be a reportable percentile roll");

        let ninety_nine = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            2,
            OffsetDateTime::UNIX_EPOCH,
            vec![
                AuthoritativeRollResult {
                    dice_id: "tens".into(),
                    dice_type: DiceType::D10Tens,
                    face_value: 90,
                },
                AuthoritativeRollResult {
                    dice_id: "ones".into(),
                    dice_type: DiceType::D10,
                    face_value: 9,
                },
            ],
            99,
        );
        assert!(ninety_nine.is_ok());

        let over_max = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            3,
            OffsetDateTime::UNIX_EPOCH,
            vec![AuthoritativeRollResult {
                dice_id: "tens".into(),
                dice_type: DiceType::D10Tens,
                face_value: 100,
            }],
            100,
        );
        assert_eq!(
            over_max.unwrap_err(),
            RollCompletionBuildError::InvalidResult
        );
    }

    /// Build a one-die completion so face validity can be probed directly.
    fn completion_with_face(
        dice_type: DiceType,
        face_value: u32,
    ) -> Result<AuthoritativeRollCompletion, RollCompletionBuildError> {
        AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::UNIX_EPOCH,
            vec![AuthoritativeRollResult {
                dice_id: "die".into(),
                dice_type,
                face_value,
            }],
            face_value,
        )
    }

    #[test]
    fn face_validity_matches_what_each_die_can_physically_show() {
        // The percentile tens die reads 00, 10, … 90 — nothing between.
        for face in 0..=9 {
            assert!(
                completion_with_face(DiceType::D10Tens, face * 10).is_ok(),
                "d10tens must accept {}",
                face * 10
            );
        }
        for bad in [1, 5, 45, 89, 91, 100] {
            assert_eq!(
                completion_with_face(DiceType::D10Tens, bad).unwrap_err(),
                RollCompletionBuildError::InvalidResult,
                "d10tens must reject {bad}"
            );
        }

        // The physical d10 reads 0..=9 and can NEVER show 10 (the 1-10 virtual
        // d10 is a client-side mapping, not an engine face).
        for face in 0..=9 {
            assert!(completion_with_face(DiceType::D10, face).is_ok(), "d10 must accept {face}");
        }
        assert_eq!(
            completion_with_face(DiceType::D10, 10).unwrap_err(),
            RollCompletionBuildError::InvalidResult,
            "d10 must reject 10"
        );

        // Every other die stays 1..=N — zero is still not a face for them.
        for (dice_type, max) in [
            (DiceType::D4, 4),
            (DiceType::D6, 6),
            (DiceType::D8, 8),
            (DiceType::D12, 12),
            (DiceType::D20, 20),
        ] {
            assert_eq!(
                completion_with_face(dice_type, 0).unwrap_err(),
                RollCompletionBuildError::InvalidResult,
                "{dice_type:?} must reject 0"
            );
            assert!(completion_with_face(dice_type, 1).is_ok(), "{dice_type:?} must accept 1");
            assert!(completion_with_face(dice_type, max).is_ok(), "{dice_type:?} must accept {max}");
            assert_eq!(
                completion_with_face(dice_type, max + 1).unwrap_err(),
                RollCompletionBuildError::InvalidResult,
                "{dice_type:?} must reject {}",
                max + 1
            );
        }
    }

    #[test]
    fn timestamp_is_utc_and_truncated_to_postgres_microseconds() {
        let completion = AuthoritativeRollCompletion::new(
            "instance".into(),
            "room".into(),
            "player".into(),
            Uuid::nil(),
            1,
            OffsetDateTime::parse("2026-07-18T14:34:56.123456789+02:00", &Rfc3339).unwrap(),
            vec![AuthoritativeRollResult {
                dice_id: "die".into(),
                dice_type: DiceType::D6,
                face_value: 6,
            }],
            6,
        )
        .unwrap();

        assert!(completion
            .canonical_json()
            .contains(r#""completedAt":"2026-07-18T12:34:56.123456Z""#));
        assert!(completion
            .rpc_body
            .contains(r#""p_completed_at":"2026-07-18T12:34:56.123456Z""#));
    }

    #[test]
    fn rpc_request_has_exact_path_body_and_secret_header_mode() {
        let event = event();
        let transport = HttpRollRpcTransport::new(&service(SECRET, Some(LEGACY)));
        let request = transport.build_request(&event).build().unwrap();
        let body = std::str::from_utf8(request.body().unwrap().as_bytes().unwrap()).unwrap();
        let expected = serde_json::json!({
            "p_user_id": "550e8400-e29b-41d4-a716-446655440000",
            "p_server_event_id": event.event_id(),
            "p_payload_sha256": event.payload_sha256(),
            "p_completed_at": "2026-07-18T12:34:56Z",
        });

        assert_eq!(
            request.url().as_str(),
            "https://example.supabase.co/rest/v1/rpc/record_authoritative_roll_completion"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(body).unwrap(),
            expected
        );
        assert_eq!(request.headers()["apikey"], SECRET);
        assert!(request.headers()["apikey"].is_sensitive());
        assert!(request.headers().get("authorization").is_none());
        assert!(!format!("{request:?}").contains(SECRET));
        assert!(!format!("{event:?}").contains(event.canonical_json()));
    }

    struct ScriptedTransport {
        responses: Mutex<VecDeque<RpcAttempt>>,
        calls: AtomicUsize,
        block: Option<Arc<Notify>>,
    }

    impl ScriptedTransport {
        fn new(responses: impl IntoIterator<Item = RpcAttempt>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
                calls: AtomicUsize::new(0),
                block: None,
            }
        }

        fn blocked(notify: Arc<Notify>) -> Self {
            Self {
                responses: Mutex::new(VecDeque::from([RpcAttempt::Response(StatusCode::OK)])),
                calls: AtomicUsize::new(0),
                block: Some(notify),
            }
        }
    }

    impl RollRpcTransport for ScriptedTransport {
        fn send<'a>(&'a self, _event: &'a AuthoritativeRollCompletion) -> RpcFuture<'a> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::AcqRel);
                if let Some(block) = &self.block {
                    block.notified().await;
                }
                self.responses
                    .lock()
                    .await
                    .pop_front()
                    .unwrap_or(RpcAttempt::Response(StatusCode::OK))
            })
        }
    }

    const TEST_RETRY: RetryPolicy = RetryPolicy {
        base_delay: Duration::ZERO,
        max_delay: Duration::ZERO,
        jitter: false,
    };

    #[tokio::test]
    async fn transient_responses_retry_same_event_then_recover_health() {
        let transport = ScriptedTransport::new([
            RpcAttempt::NetworkFailure,
            RpcAttempt::Response(StatusCode::TOO_MANY_REQUESTS),
            RpcAttempt::Response(StatusCode::SERVICE_UNAVAILABLE),
            RpcAttempt::Response(StatusCode::NO_CONTENT),
        ]);
        let health = ReporterHealth::default();
        deliver_with_retry(&transport, &event(), &health, TEST_RETRY).await;

        assert_eq!(transport.calls.load(Ordering::Acquire), 4);
        assert_eq!(health.status(), RollReporterStatus::Healthy);
    }

    #[test]
    fn saturated_equal_jitter_varies_deterministically_without_exceeding_cap() {
        let policy = RetryPolicy::production();
        for attempt in [16, 32, 100] {
            let low = policy.delay_with_sample(attempt, |_| 0);
            let middle = policy.delay_with_sample(attempt, |upper| upper / 2);
            let high = policy.delay_with_sample(attempt, |upper| upper);

            assert_eq!(low, RETRY_MAX_DELAY / 2);
            assert!(low < middle && middle < high);
            assert_eq!(high, RETRY_MAX_DELAY);
        }

        let first_low = policy.delay_with_sample(0, |_| 0);
        let first_high = policy.delay_with_sample(0, |upper| upper);
        assert_eq!(first_low, RETRY_BASE_DELAY / 2);
        assert_eq!(first_high, RETRY_BASE_DELAY);
        assert!(!first_low.is_zero());
    }

    #[tokio::test]
    async fn permanent_rejection_does_not_retry_and_sticks_unhealthy() {
        let transport = ScriptedTransport::new([
            RpcAttempt::Response(StatusCode::BAD_REQUEST),
            RpcAttempt::Response(StatusCode::OK),
        ]);
        let health = ReporterHealth::default();
        deliver_with_retry(&transport, &event(), &health, TEST_RETRY).await;

        assert_eq!(transport.calls.load(Ordering::Acquire), 1);
        assert_eq!(health.status(), RollReporterStatus::Unhealthy);
    }

    #[tokio::test]
    async fn bounded_queue_applies_backpressure_instead_of_dropping() {
        let release = Arc::new(Notify::new());
        let transport = Arc::new(ScriptedTransport::blocked(release.clone()));
        let reporter = RollReporter::spawn("instance".into(), 1, 1, transport.clone(), TEST_RETRY);

        assert_eq!(
            reporter.enqueue_event(Arc::new(event())).await,
            EnqueueOutcome::Queued
        );
        while transport.calls.load(Ordering::Acquire) == 0 {
            tokio::task::yield_now().await;
        }
        assert_eq!(
            reporter.enqueue_event(Arc::new(event())).await,
            EnqueueOutcome::Queued
        );
        let blocked = tokio::time::timeout(
            Duration::from_millis(20),
            reporter.enqueue_event(Arc::new(event())),
        )
        .await;
        assert!(
            blocked.is_err(),
            "third send must wait for bounded capacity"
        );

        release.notify_waiters();
    }

    #[tokio::test]
    async fn disabled_and_guest_paths_never_reach_transport() {
        let reporter = RollReporter::disabled();
        let guest = CompletedRoll {
            player_id: "player".to_string(),
            user_id: None,
            generation: 1,
            results: Vec::new(),
            total: 0,
        };
        assert_eq!(
            reporter.enqueue_completion("room".to_string(), guest).await,
            EnqueueOutcome::SkippedDisabled
        );
        assert_eq!(reporter.status(), RollReporterStatus::Disabled);

        let transport = Arc::new(ScriptedTransport::new([RpcAttempt::Response(
            StatusCode::OK,
        )]));
        let enabled = RollReporter::spawn("instance".into(), 1, 1, transport.clone(), TEST_RETRY);
        let guest = CompletedRoll {
            player_id: "player".to_string(),
            user_id: None,
            generation: 1,
            results: Vec::new(),
            total: 0,
        };
        assert_eq!(
            enabled.enqueue_completion("room".to_string(), guest).await,
            EnqueueOutcome::SkippedGuest
        );
        tokio::task::yield_now().await;
        assert_eq!(transport.calls.load(Ordering::Acquire), 0);
    }
}
