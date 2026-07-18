//! Shared privileged Supabase transport configuration.
//!
//! Native-server integrations use one deliberately small credential boundary:
//! a validated project-root URL, a redirect-denying HTTP client, and either a
//! preferred opaque `sb_secret_...` API key or the deprecated legacy
//! `service_role` JWT fallback. Browser/WASM code cannot depend on this module.

use std::fmt;
use std::net::IpAddr;
use std::time::Duration;

pub(crate) const SUPABASE_URL_ENV: &str = "SUPABASE_URL";
pub(crate) const SUPABASE_SECRET_KEY_ENV: &str = "SUPABASE_SECRET_KEY";
pub(crate) const SUPABASE_SERVICE_ROLE_KEY_ENV: &str = "SUPABASE_SERVICE_ROLE_KEY";

/// Authentication mode selected for privileged Supabase calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupabaseCredentialMode {
    /// Preferred opaque `sb_secret_...` key, sent only in `apikey`.
    SecretApiKey,
    /// Deprecated JWT service-role key, sent as `apikey` and bearer auth.
    LegacyServiceRoleJwt,
}

#[derive(Clone)]
enum SupabaseCredential {
    SecretApiKey(String),
    LegacyServiceRoleJwt(String),
}

impl SupabaseCredential {
    fn mode(&self) -> SupabaseCredentialMode {
        match self {
            Self::SecretApiKey(_) => SupabaseCredentialMode::SecretApiKey,
            Self::LegacyServiceRoleJwt(_) => SupabaseCredentialMode::LegacyServiceRoleJwt,
        }
    }

    fn apply(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self {
            // New Supabase API keys are not JWTs. Sending one as bearer auth
            // causes the gateway to reject it before PostgREST sees the call.
            Self::SecretApiKey(key) => request.header("apikey", sensitive_header_value(key)),
            Self::LegacyServiceRoleJwt(key) => request
                .header("apikey", sensitive_header_value(key))
                .bearer_auth(key),
        }
    }
}

fn sensitive_header_value(value: &str) -> reqwest::header::HeaderValue {
    let mut header = reqwest::header::HeaderValue::from_bytes(value.as_bytes())
        .expect("validated Supabase credential must be a valid header value");
    header.set_sensitive(true);
    header
}

/// Invalid privileged Supabase environment configuration.
///
/// Variants retain only env names and categories, never the supplied values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupabaseServiceConfigError {
    Incomplete { missing: Vec<&'static str> },
    InvalidSupabaseUrl,
    InvalidSecretKey,
    InvalidLegacyServiceRoleKey,
}

impl fmt::Display for SupabaseServiceConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Incomplete { missing } => write!(
                formatter,
                "privileged Supabase configuration is incomplete; set {}",
                missing.join(", ")
            ),
            Self::InvalidSupabaseUrl => write!(
                formatter,
                "SUPABASE_URL must be a root base URL using https (http is allowed only for loopback development) with no path, credentials, query, or fragment"
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

impl std::error::Error for SupabaseServiceConfigError {}

/// Validated configuration for native privileged Supabase calls.
#[derive(Clone)]
pub struct SupabaseServiceConfig {
    root_url: String,
    credential: SupabaseCredential,
}

impl fmt::Debug for SupabaseServiceConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SupabaseServiceConfig")
            .field("root_url", &self.root_url)
            .field("credential_mode", &self.credential_mode())
            .finish()
    }
}

impl SupabaseServiceConfig {
    /// Resolve the privileged service configuration from the process env.
    /// `SUPABASE_URL` alone does not opt any write integration in.
    pub fn from_env() -> Result<Option<Self>, SupabaseServiceConfigError> {
        Self::resolve(|key| std::env::var(key).ok())
    }

    pub(crate) fn resolve(
        mut read: impl FnMut(&str) -> Option<String>,
    ) -> Result<Option<Self>, SupabaseServiceConfigError> {
        Self::from_values(
            normalize_env_value(read(SUPABASE_URL_ENV)),
            normalize_env_value(read(SUPABASE_SECRET_KEY_ENV)),
            normalize_env_value(read(SUPABASE_SERVICE_ROLE_KEY_ENV)),
        )
    }

    pub(crate) fn from_values(
        supabase_url: Option<String>,
        secret_key: Option<String>,
        legacy_key: Option<String>,
    ) -> Result<Option<Self>, SupabaseServiceConfigError> {
        if secret_key.is_none() && legacy_key.is_none() {
            return Ok(None);
        }

        let Some(supabase_url) = supabase_url else {
            return Err(SupabaseServiceConfigError::Incomplete {
                missing: vec![SUPABASE_URL_ENV],
            });
        };

        let credential = if let Some(key) = secret_key {
            // A malformed preferred key must not silently fall back to a
            // second, operator-forgotten legacy credential.
            if !is_secret_api_key(&key) {
                return Err(SupabaseServiceConfigError::InvalidSecretKey);
            }
            SupabaseCredential::SecretApiKey(key)
        } else {
            let key = legacy_key.expect("credential presence checked above");
            if !is_legacy_service_role_jwt(&key) {
                return Err(SupabaseServiceConfigError::InvalidLegacyServiceRoleKey);
            }
            SupabaseCredential::LegacyServiceRoleJwt(key)
        };

        Ok(Some(Self {
            root_url: normalize_supabase_url(&supabase_url)?,
            credential,
        }))
    }

    /// Credential mode selected without exposing its value.
    #[must_use]
    pub fn credential_mode(&self) -> SupabaseCredentialMode {
        self.credential.mode()
    }

    /// Construct a redirect-denying, time-bounded HTTP client.
    #[must_use]
    pub fn http_client(
        &self,
        connect_timeout: Duration,
        request_timeout: Duration,
    ) -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(connect_timeout)
            .timeout(request_timeout)
            .build()
            .expect("static privileged Supabase HTTP client configuration must be valid")
    }

    /// URL for one table under the Supabase Data REST API.
    #[must_use]
    pub fn rest_table_url(&self, table: &str) -> String {
        debug_assert!(is_safe_path_segment(table));
        format!("{}/rest/v1/{table}", self.root_url)
    }

    /// URL for one PostgREST RPC function.
    #[must_use]
    pub fn rpc_url(&self, function: &str) -> String {
        debug_assert!(is_safe_path_segment(function));
        format!("{}/rest/v1/rpc/{function}", self.root_url)
    }

    /// Apply the privileged credential to a request. Credential values are
    /// marked sensitive so request Debug output redacts them.
    pub(crate) fn apply_auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.credential.apply(request)
    }
}

pub(crate) fn normalize_env_value(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_safe_path_segment(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn parse_root_http_url(
    value: &str,
    error: SupabaseServiceConfigError,
) -> Result<reqwest::Url, SupabaseServiceConfigError> {
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

fn normalize_supabase_url(value: &str) -> Result<String, SupabaseServiceConfigError> {
    let error = SupabaseServiceConfigError::InvalidSupabaseUrl;
    let parsed = parse_root_http_url(value, error.clone())?;
    if parsed.scheme() != "https"
        && !parsed.host_str().is_some_and(|host| {
            let unbracketed = host
                .strip_prefix('[')
                .and_then(|value| value.strip_suffix(']'))
                .unwrap_or(host);
            unbracketed.eq_ignore_ascii_case("localhost")
                || unbracketed
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        })
    {
        return Err(error);
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn is_secret_api_key(value: &str) -> bool {
    value.strip_prefix("sb_secret_").is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

#[derive(serde::Deserialize)]
struct LegacyServiceRoleClaims {
    role: String,
}

fn is_legacy_service_role_jwt(value: &str) -> bool {
    let segments = value.split('.').collect::<Vec<_>>();
    if segments.len() != 3
        || !segments.iter().all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'='))
        })
    {
        return false;
    }

    let Ok(header) = jsonwebtoken::decode_header(value) else {
        return false;
    };
    // Classification only: Supabase verifies the signature on receipt.
    let mut validation = jsonwebtoken::Validation::new(header.alg);
    validation.insecure_disable_signature_validation();
    validation.required_spec_claims.clear();
    validation.validate_exp = false;
    jsonwebtoken::decode::<LegacyServiceRoleClaims>(
        value,
        &jsonwebtoken::DecodingKey::from_secret(&[]),
        &validation,
    )
    .is_ok_and(|token| token.claims.role == "service_role")
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "https://example.supabase.co";
    const SECRET: &str = "sb_secret_test-fixture";
    const LEGACY: &str = concat!(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.",
        "eyJyb2xlIjoic2VydmljZV9yb2xlIn0.",
        "c2lnbmF0dXJl"
    );

    fn resolve(
        values: &[(&str, &str)],
    ) -> Result<Option<SupabaseServiceConfig>, SupabaseServiceConfigError> {
        SupabaseServiceConfig::resolve(|key| {
            values
                .iter()
                .find_map(|(candidate, value)| (*candidate == key).then(|| (*value).to_string()))
        })
    }

    #[test]
    fn url_alone_is_disabled_but_a_credential_requires_url() {
        assert!(resolve(&[]).unwrap().is_none());
        assert!(resolve(&[(SUPABASE_URL_ENV, ROOT)]).unwrap().is_none());
        assert_eq!(
            resolve(&[(SUPABASE_SECRET_KEY_ENV, SECRET)]).unwrap_err(),
            SupabaseServiceConfigError::Incomplete {
                missing: vec![SUPABASE_URL_ENV]
            }
        );
    }

    #[test]
    fn preferred_secret_uses_only_sensitive_apikey() {
        let config = resolve(&[
            (SUPABASE_URL_ENV, ROOT),
            (SUPABASE_SECRET_KEY_ENV, SECRET),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY),
        ])
        .unwrap()
        .unwrap();
        let request = config
            .apply_auth(reqwest::Client::new().post(config.rpc_url("record_event")))
            .build()
            .unwrap();

        assert_eq!(
            config.credential_mode(),
            SupabaseCredentialMode::SecretApiKey
        );
        assert_eq!(request.headers()["apikey"], SECRET);
        assert!(request.headers()["apikey"].is_sensitive());
        assert!(request.headers().get("authorization").is_none());
        assert!(!format!("{request:?}").contains(SECRET));
        assert!(!format!("{config:?}").contains(SECRET));
    }

    #[test]
    fn legacy_service_role_uses_sensitive_apikey_and_bearer() {
        let config = resolve(&[
            (SUPABASE_URL_ENV, ROOT),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY),
        ])
        .unwrap()
        .unwrap();
        let request = config
            .apply_auth(reqwest::Client::new().post(config.rpc_url("record_event")))
            .build()
            .unwrap();

        assert_eq!(
            config.credential_mode(),
            SupabaseCredentialMode::LegacyServiceRoleJwt
        );
        assert_eq!(request.headers()["apikey"], LEGACY);
        assert_eq!(
            request.headers()["authorization"],
            format!("Bearer {LEGACY}")
        );
        assert!(request.headers()["apikey"].is_sensitive());
        assert!(request.headers()["authorization"].is_sensitive());
        assert!(!format!("{request:?}").contains(LEGACY));
    }

    #[test]
    fn malformed_preferred_key_does_not_fall_back_or_leak() {
        let supplied = "operator-secret-value";
        let error = resolve(&[
            (SUPABASE_URL_ENV, ROOT),
            (SUPABASE_SECRET_KEY_ENV, supplied),
            (SUPABASE_SERVICE_ROLE_KEY_ENV, LEGACY),
        ])
        .unwrap_err();
        assert_eq!(error, SupabaseServiceConfigError::InvalidSecretKey);
        assert!(!error.to_string().contains(supplied));
        assert!(!format!("{error:?}").contains(supplied));
    }

    #[test]
    fn root_url_and_rpc_paths_are_validated_and_normalized() {
        let config = resolve(&[
            (SUPABASE_URL_ENV, "https://example.supabase.co/"),
            (SUPABASE_SECRET_KEY_ENV, SECRET),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(
            config.rest_table_url("rooms"),
            "https://example.supabase.co/rest/v1/rooms"
        );
        assert_eq!(
            config.rpc_url("record_authoritative_roll_completion"),
            "https://example.supabase.co/rest/v1/rpc/record_authoritative_roll_completion"
        );

        for invalid in [
            "http://example.supabase.co",
            "https://example.supabase.co/path",
            "https://user:password@example.supabase.co",
            "https://example.supabase.co?query=value",
        ] {
            assert!(matches!(
                resolve(&[
                    (SUPABASE_URL_ENV, invalid),
                    (SUPABASE_SECRET_KEY_ENV, SECRET)
                ]),
                Err(SupabaseServiceConfigError::InvalidSupabaseUrl)
            ));
        }

        for loopback in [
            "http://localhost:54321",
            "http://127.0.0.1:54321",
            "http://[::1]:54321",
        ] {
            assert!(resolve(&[
                (SUPABASE_URL_ENV, loopback),
                (SUPABASE_SECRET_KEY_ENV, SECRET)
            ])
            .unwrap()
            .is_some());
        }
    }
}
