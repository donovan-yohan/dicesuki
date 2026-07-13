//! Supabase JWT verification for the room server (ADR 006).
//!
//! Auth is **optional** on `join`: guest play is a product requirement, so a
//! player MAY connect without a token. The `join` message MAY carry an
//! `authToken` (a Supabase access token). Semantics:
//!
//! * **absent / empty** → silent guest (no `user_id` binding), join proceeds.
//! * **present + valid** → the player is bound to their Supabase `user_id`
//!   (`sub` claim) for future ownership features; join proceeds.
//! * **present + invalid/expired** → the join is **rejected** with a clear
//!   machine-readable error code (`AUTH_INVALID`) so a stale token surfaces
//!   loudly instead of silently downgrading to guest.
//!
//! Verification is **local**: Supabase signs access tokens asymmetrically and
//! publishes its public keys at a JWKS URL. We fetch that key set once, cache it
//! with a TTL, and verify every token against the cached keys — there is **no
//! per-request callout** to Supabase. A cache miss on the token's `kid` (key
//! rotation) triggers a single refresh; a fetch failure falls back to the last
//! good cached key set so a transient Supabase outage does not break auth for
//! already-known keys.

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

/// Default Supabase project (public-safe id, per ADR 006). Overridable via
/// `SUPABASE_URL` for a different project or a self-hosted instance.
const DEFAULT_SUPABASE_URL: &str = "https://htsgornelumjyjwknwby.supabase.co";

/// How long a fetched JWKS is trusted before a refresh is attempted. Supabase
/// keys rotate rarely; a 1-hour TTL keeps callouts negligible while bounding the
/// window after a rotation. A `kid` miss forces an immediate refresh regardless.
const JWKS_TTL: Duration = Duration::from_secs(3600);

/// Algorithms Supabase uses for asymmetric access tokens (RSA and ECDSA P-256).
/// HMAC is intentionally excluded here so a leaked/rotated symmetric secret can
/// never be used to forge a token against the production verifier.
const PROD_ALGORITHMS: &[Algorithm] = &[Algorithm::RS256, Algorithm::ES256];

/// Supabase access tokens carry `aud: "authenticated"` for signed-in users.
const EXPECTED_AUDIENCE: &str = "authenticated";

/// The subset of registered/Supabase claims we read. Registered-claim
/// validation (`exp`, `aud`, `iss`) is performed by `jsonwebtoken` itself; this
/// struct only needs the fields we consume downstream.
#[derive(Debug, Deserialize)]
pub struct SupabaseClaims {
    /// Supabase user id — the value a valid token binds the player to.
    pub sub: String,
    /// Supabase role, e.g. `authenticated` or `anon`. Informational (logging).
    #[serde(default)]
    pub role: Option<String>,
}

/// Result of authenticating a `join`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthOutcome {
    /// No token supplied — the player joins as a guest with no user binding.
    Guest,
    /// A valid token bound the player to this Supabase user id (`sub`).
    Authenticated { user_id: String },
}

/// Why a supplied token was rejected. The `code` is the machine-readable value
/// sent to the client in an `error` message (Shared-ADR-002).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// The token was malformed, unsigned by our keys, expired, or otherwise
    /// failed validation.
    Invalid(String),
    /// The JWKS could not be fetched and no cached keys were available, so the
    /// token could not be verified either way. Distinct from `Invalid` so the
    /// caller can decide policy; we reject (fail closed) for a supplied token.
    KeysUnavailable(String),
}

impl AuthError {
    /// Machine-readable error code for the client `error` message.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            AuthError::Invalid(_) => "AUTH_INVALID",
            AuthError::KeysUnavailable(_) => "AUTH_UNAVAILABLE",
        }
    }

    /// Human-readable message for the client `error` message.
    #[must_use]
    pub fn message(&self) -> String {
        match self {
            AuthError::Invalid(detail) => {
                format!("Authentication token is invalid or expired: {detail}")
            }
            AuthError::KeysUnavailable(detail) => {
                format!("Unable to verify authentication token right now: {detail}")
            }
        }
    }
}

/// Pure verification core: check `token` against an already-fetched `jwks`.
///
/// Kept free of any network or cache concern so it is fully unit-testable
/// offline (the tests build a local key set and sign tokens with it). Validates
/// signature, expiry, audience (`authenticated`), and — when `issuer` is
/// `Some` — the `iss` claim.
///
/// # Errors
///
/// Returns [`AuthError::Invalid`] for any malformed token, unknown `kid`,
/// bad signature, or failed registered-claim check.
pub fn verify_with_jwks(
    token: &str,
    jwks: &JwkSet,
    issuer: Option<&str>,
    algorithms: &[Algorithm],
) -> Result<SupabaseClaims, AuthError> {
    let header = decode_header(token)
        .map_err(|e| AuthError::Invalid(format!("unreadable header: {e}")))?;
    let kid = header
        .kid
        .ok_or_else(|| AuthError::Invalid("token header has no key id (kid)".to_string()))?;

    let jwk = jwks
        .find(&kid)
        .ok_or_else(|| AuthError::Invalid(format!("no signing key matches kid {kid}")))?;
    let decoding_key = DecodingKey::from_jwk(jwk)
        .map_err(|e| AuthError::Invalid(format!("unusable signing key: {e}")))?;

    let mut validation = Validation::new(header.alg);
    validation.algorithms = algorithms.to_vec();
    validation.validate_exp = true;
    validation.set_audience(&[EXPECTED_AUDIENCE]);
    if let Some(iss) = issuer {
        validation.set_issuer(&[iss]);
    }

    let data = decode::<SupabaseClaims>(token, &decoding_key, &validation)
        .map_err(|e| AuthError::Invalid(e.to_string()))?;
    Ok(data.claims)
}

/// Cached JWKS plus the instant it was fetched (for TTL expiry).
struct CachedKeys {
    keys: JwkSet,
    fetched_at: Instant,
}

/// Verifies Supabase access tokens against a locally cached JWKS.
///
/// One instance is shared process-wide via [`verifier`]. Cheap to construct;
/// the first token verification lazily fetches the key set.
pub struct AuthVerifier {
    jwks_url: String,
    issuer: String,
    ttl: Duration,
    http: reqwest::Client,
    cache: RwLock<Option<CachedKeys>>,
}

impl AuthVerifier {
    /// Build a verifier from the environment. `SUPABASE_URL` selects the project
    /// (defaults to the ADR 006 project); the JWKS URL and expected issuer are
    /// derived from it.
    #[must_use]
    pub fn from_env() -> Self {
        let base = std::env::var("SUPABASE_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_SUPABASE_URL.to_string());
        let base = base.trim_end_matches('/').to_string();
        Self::new(
            format!("{base}/auth/v1/.well-known/jwks.json"),
            format!("{base}/auth/v1"),
            JWKS_TTL,
        )
    }

    /// Construct with explicit endpoints (used by `from_env` and tests).
    #[must_use]
    pub fn new(jwks_url: String, issuer: String, ttl: Duration) -> Self {
        Self {
            jwks_url,
            issuer,
            ttl,
            http: reqwest::Client::new(),
            cache: RwLock::new(None),
        }
    }

    /// Authenticate an optional `join` token.
    ///
    /// * `None` / empty → [`AuthOutcome::Guest`] (no network, no error).
    /// * valid → [`AuthOutcome::Authenticated`] bound to the token's `sub`.
    /// * invalid/expired/unverifiable → `Err`.
    ///
    /// # Errors
    ///
    /// Returns [`AuthError`] when a supplied token cannot be verified.
    pub async fn authenticate(
        &self,
        token: Option<&str>,
    ) -> Result<AuthOutcome, AuthError> {
        let token = match token {
            Some(t) if !t.trim().is_empty() => t,
            _ => return Ok(AuthOutcome::Guest),
        };

        // Which key signed this token? Refresh once if the kid is unknown.
        let kid = decode_header(token)
            .map_err(|e| AuthError::Invalid(format!("unreadable header: {e}")))?
            .kid;

        let mut keys = self.keys(false).await?;
        let known = kid
            .as_deref()
            .map(|k| keys.find(k).is_some())
            .unwrap_or(false);
        if !known {
            keys = self.keys(true).await?;
        }

        let claims =
            verify_with_jwks(token, &keys, Some(&self.issuer), PROD_ALGORITHMS)?;
        Ok(AuthOutcome::Authenticated {
            user_id: claims.sub,
        })
    }

    /// Return the cached JWKS, fetching if empty/expired or `force`d. On a fetch
    /// failure, falls back to a stale cached set if one exists.
    async fn keys(&self, force: bool) -> Result<JwkSet, AuthError> {
        if !force {
            let guard = self.cache.read().await;
            if let Some(cached) = guard.as_ref() {
                if cached.fetched_at.elapsed() < self.ttl {
                    return Ok(cached.keys.clone());
                }
            }
        }

        match self.fetch_jwks().await {
            Ok(keys) => {
                *self.cache.write().await = Some(CachedKeys {
                    keys: keys.clone(),
                    fetched_at: Instant::now(),
                });
                Ok(keys)
            }
            Err(fetch_err) => {
                // Fail soft to the last good key set if we have one.
                let guard = self.cache.read().await;
                if let Some(cached) = guard.as_ref() {
                    Ok(cached.keys.clone())
                } else {
                    Err(AuthError::KeysUnavailable(fetch_err))
                }
            }
        }
    }

    /// Fetch and parse the JWKS from Supabase. Returns a stringified error so the
    /// caller can wrap it in [`AuthError::KeysUnavailable`].
    async fn fetch_jwks(&self) -> Result<JwkSet, String> {
        let resp = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| format!("JWKS request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("JWKS endpoint returned {}", resp.status()));
        }
        resp.json::<JwkSet>()
            .await
            .map_err(|e| format!("JWKS parse failed: {e}"))
    }
}

/// Process-wide verifier, configured from the environment at first use. Mirrors
/// the `INSTANCE_ID` lazy-static pattern so no state threading through the
/// router is required.
pub static AUTH: LazyLock<AuthVerifier> = LazyLock::new(AuthVerifier::from_env);

/// Accessor for the shared verifier.
#[must_use]
pub fn verifier() -> &'static AuthVerifier {
    &AUTH
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde::Serialize;

    const TEST_KID: &str = "test-key-1";
    const TEST_ISSUER: &str = "https://test.supabase.co/auth/v1";
    const TEST_SECRET: &[u8] = b"super-secret-hmac-key-for-tests-only";

    #[derive(Serialize)]
    struct TestClaims {
        sub: String,
        aud: String,
        iss: String,
        role: String,
        exp: i64,
    }

    /// Build a single-key HMAC (oct) JWKS. `jsonwebtoken::DecodingKey::from_jwk`
    /// supports `oct` keys, so we can sign + verify entirely offline without an
    /// asymmetric keypair or any network access.
    fn test_jwks() -> JwkSet {
        let k = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(TEST_SECRET);
        let json = serde_json::json!({
            "keys": [{ "kty": "oct", "kid": TEST_KID, "alg": "HS256", "k": k }]
        });
        serde_json::from_value(json).expect("valid JWKS")
    }

    fn sign(claims: &TestClaims) -> String {
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(TEST_KID.to_string());
        encode(&header, claims, &EncodingKey::from_secret(TEST_SECRET))
            .expect("token encodes")
    }

    fn valid_claims() -> TestClaims {
        TestClaims {
            sub: "user-abc-123".to_string(),
            aud: EXPECTED_AUDIENCE.to_string(),
            iss: TEST_ISSUER.to_string(),
            role: "authenticated".to_string(),
            // Far-future expiry.
            exp: 4_102_444_800,
        }
    }

    #[test]
    fn accepts_valid_token_and_extracts_sub() {
        let token = sign(&valid_claims());
        let claims = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect("valid token verifies");
        assert_eq!(claims.sub, "user-abc-123");
        assert_eq!(claims.role.as_deref(), Some("authenticated"));
    }

    #[test]
    fn rejects_expired_token() {
        let mut claims = valid_claims();
        claims.exp = 1_000_000; // 1970-ish, long past.
        let token = sign(&claims);
        let err = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect_err("expired token rejected");
        assert_eq!(err.code(), "AUTH_INVALID");
    }

    #[test]
    fn rejects_bad_signature() {
        // Sign with a different secret than the JWKS holds.
        let claims = valid_claims();
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(TEST_KID.to_string());
        let token = encode(
            &header,
            &claims,
            &EncodingKey::from_secret(b"a-totally-different-secret"),
        )
        .expect("token encodes");
        let err = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect_err("forged token rejected");
        assert_eq!(err.code(), "AUTH_INVALID");
    }

    #[test]
    fn rejects_wrong_issuer() {
        let mut claims = valid_claims();
        claims.iss = "https://evil.example/auth/v1".to_string();
        let token = sign(&claims);
        let err = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect_err("wrong issuer rejected");
        assert_eq!(err.code(), "AUTH_INVALID");
    }

    #[test]
    fn rejects_wrong_audience() {
        let mut claims = valid_claims();
        claims.aud = "some-other-audience".to_string();
        let token = sign(&claims);
        let err = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect_err("wrong audience rejected");
        assert_eq!(err.code(), "AUTH_INVALID");
    }

    #[test]
    fn rejects_unknown_kid() {
        let claims = valid_claims();
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some("unknown-kid".to_string());
        let token = encode(&header, &claims, &EncodingKey::from_secret(TEST_SECRET))
            .expect("token encodes");
        let err = verify_with_jwks(
            &token,
            &test_jwks(),
            Some(TEST_ISSUER),
            &[Algorithm::HS256],
        )
        .expect_err("unknown kid rejected");
        assert_eq!(err.code(), "AUTH_INVALID");
    }

    #[tokio::test]
    async fn absent_token_is_guest_without_network() {
        // jwks_url points nowhere reachable; a guest must never trigger a fetch.
        let verifier = AuthVerifier::new(
            "http://127.0.0.1:1/unreachable".to_string(),
            TEST_ISSUER.to_string(),
            JWKS_TTL,
        );
        assert_eq!(verifier.authenticate(None).await.unwrap(), AuthOutcome::Guest);
        assert_eq!(
            verifier.authenticate(Some("")).await.unwrap(),
            AuthOutcome::Guest
        );
        assert_eq!(
            verifier.authenticate(Some("   ")).await.unwrap(),
            AuthOutcome::Guest
        );
    }
}
