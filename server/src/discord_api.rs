//! Discord REST surface used by the room bot (issues #84, #246).
//!
//! Every Discord call the server makes goes through the [`DiscordApi`] trait so
//! the interesting logic above it (membership filtering, channel postability,
//! advert reconciliation) is unit-testable against a scripted transport with no
//! network — the same seam shape `roll_reporting` uses for the Supabase RPC.
//!
//! ## Endpoints and why they are safe to use
//!
//! * `GET /users/@me` — the bot's own user id, needed to look up its member
//!   overwrites and its own roles in a guild.
//! * `GET /users/@me/guilds` — the guilds the bot is installed in. The response
//!   is **privileged server-side data**: it is never returned to a client, only
//!   intersected with a caller's verified memberships (#246).
//! * `GET /guilds/{guild.id}/channels` — the guild's channels with their
//!   permission overwrites, fetched only for guilds already membership-verified
//!   for the caller.
//! * `GET /guilds/{guild.id}/members/{user.id}` — the single-member lookup that
//!   answers "is this Discord user in this guild?". Verified against the current
//!   Discord developer documentation: the `GUILD_MEMBERS` privileged intent is
//!   documented as a requirement of **List Guild Members**
//!   (`GET /guilds/{guild.id}/members`), not of this single-member GET, so the
//!   bot stays unprivileged and REST-only.
//! * `POST/PATCH/DELETE /channels/{channel.id}/messages[/{id}]` — the advert
//!   lifecycle.
//! * `POST /channels/{channel.id}/messages/{message.id}/threads` — **Start
//!   Thread from Message** (#255), used to hang a per-session thread off a
//!   host-posted advert. Verified against the current Discord developer
//!   documentation
//!   (<https://docs.discord.com/developers/resources/channel#start-thread-from-message>):
//!   the endpoint works on `GUILD_TEXT` **and** `GUILD_ANNOUNCEMENT` (type 5)
//!   channels — a text channel yields a `PUBLIC_THREAD`, an announcement channel
//!   yields an `ANNOUNCEMENT_THREAD` — and is documented as *not* working on
//!   `GUILD_FORUM` / `GUILD_MEDIA`. Since [`POSTABLE_CHANNEL_TYPES`] already
//!   restricts adverts to types 0 and 5, every channel the advert can reach is a
//!   channel this endpoint supports, so no channel-type special case is needed.
//!   The created thread's id equals the source message's id, and a message can
//!   therefore only ever have one thread.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::Deserialize;

/// Discord REST base. v10 is the current stable API version.
pub const DISCORD_API_BASE: &str = "https://discord.com/api/v10";

/// Guilds requested per `GET /users/@me/guilds` call. 200 is the documented
/// maximum. **Known limit:** the bot list is a single page, so a bot installed in
/// more than 200 guilds would not see the overflow, and members of those guilds
/// would get no targets. Cursor pagination (`after=<snowflake>`) is the follow-up
/// if the install count ever approaches this.
const BOT_GUILD_PAGE_LIMIT: u16 = 200;

/// Connect timeout for Discord calls. Short: a stalled Discord must never hold a
/// request handler (or the reconcile pass) open for long.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Total per-request timeout for Discord calls.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// `VIEW_CHANNEL` (`1 << 10`).
pub const PERMISSION_VIEW_CHANNEL: u64 = 1 << 10;
/// `SEND_MESSAGES` (`1 << 11`).
pub const PERMISSION_SEND_MESSAGES: u64 = 1 << 11;
/// `EMBED_LINKS` (`1 << 14`). The advert *is* an embed, so a channel where the
/// bot cannot embed is not a usable target even if it may send plain text.
pub const PERMISSION_EMBED_LINKS: u64 = 1 << 14;
/// `ADMINISTRATOR` (`1 << 3`). Grants every permission and short-circuits the
/// overwrite pass, exactly as Discord documents.
pub const PERMISSION_ADMINISTRATOR: u64 = 1 << 3;
/// `CREATE_PUBLIC_THREADS` (`1 << 35`, `0x800000000`) — needed to start the
/// per-session thread off an advert (#255).
///
/// **Not** `1 << 34`: that is `MANAGE_THREADS`. Issue #255's prose says `1<<34`
/// while its invite integer (`309237664768`) encodes `1 << 35`; the integer is
/// the correct one, and this constant is the value Discord documents
/// (<https://docs.discord.com/developers/topics/permissions>).
pub const PERMISSION_CREATE_PUBLIC_THREADS: u64 = 1 << 35;
/// `SEND_MESSAGES_IN_THREADS` (`1 << 38`) — needed to post the roll log into
/// that thread. Discord documents `SEND_MESSAGES` as having *no effect* inside a
/// thread, so this is a genuinely separate grant, not an implication of the
/// channel-level send permission.
pub const PERMISSION_SEND_MESSAGES_IN_THREADS: u64 = 1 << 38;

/// The permission integer the bot's canonical invite URL should carry (#255):
/// [`REQUIRED_POST_PERMISSIONS`] plus both thread permissions.
///
/// Deliberately **not** folded into [`REQUIRED_POST_PERMISSIONS`]: threads are
/// an additive enhancement, and a guild that grants only the original three must
/// keep getting adverts (embed-only) rather than silently losing every posting
/// target. Guilds that invited the bot before this exists degrade per the
/// thread-disabled path in `discord`, not by disappearing from the share sheet.
pub const INVITE_PERMISSIONS: u64 = REQUIRED_POST_PERMISSIONS
    | PERMISSION_CREATE_PUBLIC_THREADS
    | PERMISSION_SEND_MESSAGES_IN_THREADS;

/// What the bot must hold in a channel for that channel to be offered as a
/// posting target.
pub const REQUIRED_POST_PERMISSIONS: u64 =
    PERMISSION_VIEW_CHANNEL | PERMISSION_SEND_MESSAGES | PERMISSION_EMBED_LINKS;

/// Channel types the advert can be posted to: `GUILD_TEXT` (0) and
/// `GUILD_ANNOUNCEMENT` (5). Voice, category, forum, and thread types are
/// excluded — threads in particular are ephemeral and a poor home for a session
/// record that must survive the room (#246 archive-on-close).
pub const POSTABLE_CHANNEL_TYPES: [u8; 2] = [0, 5];

/// Overwrite applying to a role.
const OVERWRITE_TYPE_ROLE: u8 = 0;
/// Overwrite applying to a single member.
const OVERWRITE_TYPE_MEMBER: u8 = 1;

/// Whether `value` is a plausible Discord snowflake. Ids from clients and from
/// token claims are interpolated into REST paths, so they are validated as
/// digits-only before they can reach a URL. Also bounds the length so a
/// pathological value cannot be used to build an enormous request line.
#[must_use]
pub fn is_snowflake(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// A partial guild from `GET /users/@me/guilds`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BotGuild {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    /// "total permissions for the user in the guild (excludes overwrites and
    /// implicit permissions)" — i.e. already the union of `@everyone` and the
    /// bot's roles, which is precisely Discord's `computeBasePermissions`. Sent
    /// as a decimal string because the bitfield exceeds 53 bits.
    #[serde(default)]
    pub permissions: Option<String>,
}

/// One entry of a channel's `permission_overwrites` array.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PermissionOverwrite {
    pub id: String,
    /// 0 = role, 1 = member.
    #[serde(rename = "type")]
    pub kind: u8,
    #[serde(default)]
    pub allow: String,
    #[serde(default)]
    pub deny: String,
}

/// A guild channel from `GET /guilds/{id}/channels`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GuildChannel {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub kind: u8,
    #[serde(default)]
    pub position: Option<i64>,
    #[serde(default)]
    pub permission_overwrites: Vec<PermissionOverwrite>,
}

/// The subset of a guild member object the bot reads: the member's role ids.
/// A successful response *is* the membership proof; a 404 is a non-member.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct GuildMember {
    #[serde(default)]
    pub roles: Vec<String>,
}

/// A guild role from `GET /guilds/{id}/roles`. Needed to compute a *member's*
/// guild-level permissions: unlike the bot, whose totals arrive precomputed on
/// the partial guild, a caller's base permissions must be unioned from the roles
/// they hold.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GuildRole {
    pub id: String,
    #[serde(default)]
    pub permissions: String,
}

/// Why a Discord call did not produce a usable answer. Deliberately carries no
/// response body: Discord error payloads can echo request context, and this type
/// is logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscordApiError {
    /// The bot token is missing, revoked, or lacks access (401/403).
    Unauthorized,
    /// Discord returned some other non-success status.
    Status(u16),
    /// The request never completed, or the body was unreadable.
    Transport,
    /// No request was sent: this target is still cooling down after a terminal
    /// refusal. Not terminal itself; callers keep pending intent for a later pass.
    ResourceCooldown,
}

impl std::fmt::Display for DiscordApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unauthorized => write!(formatter, "discord rejected the bot credential"),
            Self::Status(status) => write!(formatter, "discord returned status {status}"),
            Self::Transport => write!(formatter, "discord request failed"),
            Self::ResourceCooldown => write!(formatter, "discord resource is cooling down"),
        }
    }
}

/// Boxed future returned by [`DiscordApi`] methods (the trait is used behind
/// `dyn`, so it cannot be `async fn`).
pub type ApiFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, DiscordApiError>> + Send + 'a>>;

/// The Discord REST operations the server needs. Implemented by
/// [`HttpDiscordApi`] in production and by scripted fakes in tests.
pub trait DiscordApi: Send + Sync {
    /// `GET /users/@me` — the bot's own user id.
    fn current_user_id(&self) -> ApiFuture<'_, String>;
    /// `GET /users/@me/guilds` — every guild the bot is installed in.
    fn bot_guilds(&self) -> ApiFuture<'_, Vec<BotGuild>>;
    /// `GET /guilds/{guild_id}/channels`.
    fn guild_channels<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildChannel>>;
    /// `GET /guilds/{guild_id}` — authoritative owner id, never client metadata.
    fn guild_owner_id<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, String>;
    /// `GET /guilds/{guild_id}/roles`.
    fn guild_roles<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildRole>>;
    /// `GET /guilds/{guild_id}/members/{user_id}`. `Ok(None)` means Discord
    /// answered 404 — an authoritative "not a member of this guild".
    fn guild_member<'a>(
        &'a self,
        guild_id: &'a str,
        user_id: &'a str,
    ) -> ApiFuture<'a, Option<GuildMember>>;
    /// `POST /channels/{channel_id}/messages` — returns the new message id.
    fn create_message<'a>(
        &'a self,
        channel_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, String>;
    /// `PATCH /channels/{channel_id}/messages/{message_id}`.
    fn edit_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, ()>;
    /// `DELETE /channels/{channel_id}/messages/{message_id}`. A 404 (already
    /// gone) resolves as success — the intent is "this message must not exist".
    fn delete_message<'a>(&'a self, channel_id: &'a str, message_id: &'a str) -> ApiFuture<'a, ()>;
    /// `POST /channels/{channel_id}/messages/{message_id}/threads` — **Start
    /// Thread from Message** (#255). Returns the new thread's id, which is also
    /// a channel id: the roll log is posted with [`Self::create_message`]
    /// against it.
    fn create_thread_from_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, String>;
}

/// Production [`DiscordApi`] over `reqwest`.
pub struct HttpDiscordApi {
    client: reqwest::Client,
    base_url: String,
    admission: tokio::sync::Mutex<RequestAdmission>,
    /// `Authorization: Bot <token>`. Never logged, never rendered.
    authorization: reqwest::header::HeaderValue,
}

/// One owner for directory reads and reconciliation writes. Spacing and provider
/// failures are shared; resource refusals must not delay unrelated targets.
struct RequestAdmission {
    next: tokio::time::Instant,
    cooldown: tokio::time::Instant,
    failures: u32,
    // Increment on every failure, not dispatch. A body completing late can
    // clear only streaks that were already known when its request was sent.
    epoch: u64,
    shared_failure_epoch: u64,
    resources: HashMap<RequestTarget, ResourceBackoff>,
}

/// Explicit major resource, never a member/user id or an arbitrary URL/payload.
#[derive(Clone, PartialEq, Eq, Hash)]
enum RequestTarget {
    CurrentUser,
    BotGuilds,
    Guild(String),
    Channel(String),
}

struct ResourceBackoff {
    next: tokio::time::Instant,
    failures: u32,
    epoch: u64,
}

const REQUEST_SPACING: Duration = Duration::from_millis(50);
const MAX_RESOURCE_BACKOFFS: usize = 4096;
const RESOURCE_BACKOFF_RETENTION: Duration = Duration::from_secs(300);

impl RequestAdmission {
    fn shared_failed(&mut self, delay: Option<Duration>) {
        self.epoch = self
            .epoch
            .checked_add(1)
            .expect("admission epoch exhausted");
        self.shared_failure_epoch = self.epoch;
        self.failures = self.failures.saturating_add(1);
        let now = tokio::time::Instant::now();
        let fallback = Duration::from_secs(1_u64 << self.failures.saturating_sub(1).min(6));
        let until = delay
            .and_then(|delay| now.checked_add(delay))
            .unwrap_or(now + fallback);
        self.cooldown = self.cooldown.max(until);
    }

    fn succeeded(&mut self, target: &RequestTarget, epoch: u64) {
        if self.shared_failure_epoch <= epoch {
            self.failures = 0;
        }
        if self
            .resources
            .get(target)
            .is_some_and(|state| state.epoch <= epoch)
        {
            self.resources.remove(target);
        }
    }

    fn resource_failed(&mut self, target: RequestTarget) {
        self.epoch = self
            .epoch
            .checked_add(1)
            .expect("admission epoch exhausted");
        let now = tokio::time::Instant::now();
        // Keep streaks across cooldown expiry, but not indefinitely idle targets.
        self.resources.retain(|_, state| {
            now.saturating_duration_since(state.next) < RESOURCE_BACKOFF_RETENTION
        });
        if self.resources.len() >= MAX_RESOURCE_BACKOFFS && !self.resources.contains_key(&target) {
            // Bounded even under target churn. Evict the earliest retry deadline;
            // aggregate spacing still bounds pressure if a target is evicted.
            if let Some(oldest) = self
                .resources
                .iter()
                .min_by_key(|(_, state)| state.next)
                .map(|(target, _)| target.clone())
            {
                self.resources.remove(&oldest);
            }
        }
        let state = self.resources.entry(target).or_insert(ResourceBackoff {
            next: now,
            failures: 0,
            epoch: self.epoch,
        });
        state.epoch = self.epoch;
        state.failures = state.failures.saturating_add(1);
        state.next = now + Duration::from_secs(1_u64 << state.failures.saturating_sub(1).min(6));
    }
}

fn retry_delay(value: f64) -> Option<Duration> {
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    Duration::try_from_secs_f64(value).ok()
}

impl std::fmt::Debug for HttpDiscordApi {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpDiscordApi")
            .finish_non_exhaustive()
    }
}

impl HttpDiscordApi {
    /// Build a client for `bot_token`. The token is stored as a pre-built
    /// *sensitive* header value so it is redacted from any request `Debug`.
    #[must_use]
    pub fn new(bot_token: &str) -> Self {
        let mut authorization = reqwest::header::HeaderValue::from_str(&format!("Bot {bot_token}"))
            .unwrap_or_else(|_| {
                // A token with control characters or non-ASCII cannot be a
                // header value. Say so once at construction — otherwise every
                // Discord call 401s with no clue why.
                log::error!(
                    "DISCORD_BOT_TOKEN is not a valid HTTP header value; every Discord call will fail"
                );
                reqwest::header::HeaderValue::from_static("Bot invalid")
            });
        authorization.set_sensitive(true);
        Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("static Discord HTTP client configuration must be valid"),
            authorization,
            base_url: DISCORD_API_BASE.to_string(),
            admission: tokio::sync::Mutex::new(RequestAdmission {
                next: tokio::time::Instant::now(),
                cooldown: tokio::time::Instant::now(),
                epoch: 0,
                shared_failure_epoch: 0,
                failures: 0,
                resources: HashMap::new(),
            }),
        }
    }

    fn request(&self, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .header(reqwest::header::AUTHORIZATION, self.authorization.clone())
    }

    /// Never replay writes here. A 429 updates the shared admission deadline;
    /// ordinary callers/reconciliation decide whether the operation is retried.
    async fn send(
        &self,
        request: reqwest::RequestBuilder,
        missing_is_normal: bool,
        target: RequestTarget,
    ) -> Result<(reqwest::Response, u64), DiscordApiError> {
        let epoch = loop {
            let mut admission = self.admission.lock().await;
            let now = tokio::time::Instant::now();
            if admission
                .resources
                .get(&target)
                .is_some_and(|state| state.next > now)
            {
                return Err(DiscordApiError::ResourceCooldown);
            }
            let next = admission.next.max(admission.cooldown);
            if next <= now {
                admission.next = now + REQUEST_SPACING;
                break admission.epoch;
            }
            drop(admission);
            tokio::time::sleep_until(next).await;
            // A response can extend either cooldown while we sleep. Always
            // recheck under the short lock before reserving actual dispatch.
        };
        let response = request.send().await;
        let status = response
            .as_ref()
            .map(|response| response.status().as_u16())
            .unwrap_or(0);
        let header_delay = response
            .as_ref()
            .ok()
            .and_then(|response| response.headers().get(reqwest::header::RETRY_AFTER))
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<f64>().ok())
            .and_then(retry_delay);
        let (prior_cooldown, failure_epoch) = {
            let mut admission = self.admission.lock().await;
            let prior = admission.cooldown;
            if matches!(status, 403 | 410) || (status == 404 && !missing_is_normal) {
                admission.resource_failed(target.clone());
            }
            if status == 0 || matches!(status, 401 | 429 | 500..=599) {
                // Install known headers (or a cancellation-safe fallback) before
                // reading a 429 body. Never shorten another response's deadline.
                admission.shared_failed(if status == 429 { header_delay } else { None });
            }
            (prior, admission.epoch)
        };
        let mut response = response.map_err(|_| DiscordApiError::Transport)?;
        if status != 429 {
            return Ok((response, epoch));
        }
        // Error bodies are bounded and private; no admission lock spans I/O.
        let mut bytes = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            if bytes.len() + chunk.len() > 4096 {
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        let body_delay = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|body| body.get("retry_after").and_then(serde_json::Value::as_f64))
            .and_then(retry_delay);
        if let Some(until) =
            body_delay.and_then(|delay| tokio::time::Instant::now().checked_add(delay))
        {
            let mut admission = self.admission.lock().await;
            if header_delay.is_none() && admission.shared_failure_epoch == failure_epoch {
                // Only a newer shared failure invalidates replacement of this
                // provisional fallback; resource failures own separate deadlines.
                // Preserve any prior shared cooldown, plus actual spacing.
                admission.cooldown = prior_cooldown.max(until);
            } else {
                admission.cooldown = admission.cooldown.max(until);
            }
        }
        Err(DiscordApiError::Status(429))
    }

    /// Send `request` and deserialize a JSON body on success.
    async fn send_json<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        target: RequestTarget,
    ) -> Result<T, DiscordApiError> {
        let (response, epoch) = self.send(request, false, target.clone()).await?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify(status.as_u16()));
        }
        self.read_json(response, &target, epoch).await
    }

    async fn read_json<T: serde::de::DeserializeOwned>(
        &self,
        response: reqwest::Response,
        target: &RequestTarget,
        epoch: u64,
    ) -> Result<T, DiscordApiError> {
        let result = response.json::<T>().await;
        let mut admission = self.admission.lock().await;
        match result {
            Ok(value) => {
                admission.succeeded(target, epoch);
                Ok(value)
            }
            Err(_) => {
                admission.shared_failed(None);
                Err(DiscordApiError::Transport)
            }
        }
    }

    /// Send `request`, discarding the body.
    async fn send_empty(
        &self,
        request: reqwest::RequestBuilder,
        missing_is_normal: bool,
        target: RequestTarget,
    ) -> Result<(), DiscordApiError> {
        let (response, epoch) = self
            .send(request, missing_is_normal, target.clone())
            .await?;
        let status = response.status();
        if status.is_success() || (missing_is_normal && status.as_u16() == 404) {
            self.admission.lock().await.succeeded(&target, epoch);
            Ok(())
        } else {
            Err(classify(status.as_u16()))
        }
    }
}

/// Map a non-success HTTP status onto [`DiscordApiError`].
///
/// Only 401 is [`DiscordApiError::Unauthorized`] — that is "this bot credential
/// is bad", a global condition. A 403 stays a plain [`DiscordApiError::Status`]
/// because it is *per-resource* ("the bot lost access to this channel"), and
/// callers must be able to treat it as terminal for that one resource without
/// concluding the whole token died.
const fn classify(status: u16) -> DiscordApiError {
    match status {
        401 => DiscordApiError::Unauthorized,
        other => DiscordApiError::Status(other),
    }
}

/// Whether an error means "this specific message/channel is gone or off-limits"
/// — permanent for that resource, so retrying it forever is pointless.
#[must_use]
pub const fn is_terminal_for_resource(error: DiscordApiError) -> bool {
    matches!(error, DiscordApiError::Status(403 | 404 | 410))
}

/// [`is_terminal_for_resource`], plus 400, for **Start Thread from Message**
/// (#255).
///
/// This one endpoint turns "this request can never succeed" into a 400 rather
/// than a 403/404: the message already has a thread (its id *is* the thread id,
/// so there can only be one), the parent channel type does not support threads,
/// or the name/auto-archive value was rejected. None of those change by waiting
/// — the only part of the request that varies between passes is the date in the
/// thread name — so a 400 here ends the create loop rather than re-POSTing every
/// `SYNC_INTERVAL` forever. (The caller handles 400 specially before consulting
/// this, because "already has a thread" is recoverable; see `discord`.)
///
/// Scoped to thread *creation* only. A 400 on an ordinary message POST is not
/// treated this way, because there the payload varies with room state and a
/// later pass genuinely sends something different.
#[must_use]
pub const fn is_terminal_for_thread_creation(error: DiscordApiError) -> bool {
    is_terminal_for_resource(error) || matches!(error, DiscordApiError::Status(400))
}

#[derive(Deserialize)]
struct IdOnly {
    id: String,
}

impl DiscordApi for HttpDiscordApi {
    fn current_user_id(&self) -> ApiFuture<'_, String> {
        Box::pin(async move {
            let user: IdOnly = self
                .send_json(
                    self.request(reqwest::Method::GET, format!("{}/users/@me", self.base_url)),
                    RequestTarget::CurrentUser,
                )
                .await?;
            Ok(user.id)
        })
    }

    fn bot_guilds(&self) -> ApiFuture<'_, Vec<BotGuild>> {
        Box::pin(self.send_json(
            self.request(
                reqwest::Method::GET,
                format!(
                    "{}/users/@me/guilds?limit={BOT_GUILD_PAGE_LIMIT}",
                    self.base_url
                ),
            ),
            RequestTarget::BotGuilds,
        ))
    }

    fn guild_channels<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildChannel>> {
        Box::pin(async move {
            if !is_snowflake(guild_id) {
                return Err(DiscordApiError::Status(400));
            }
            self.send_json(
                self.request(
                    reqwest::Method::GET,
                    format!("{}/guilds/{guild_id}/channels", self.base_url),
                ),
                RequestTarget::Guild(guild_id.to_string()),
            )
            .await
        })
    }

    fn guild_owner_id<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, String> {
        Box::pin(async move {
            if !is_snowflake(guild_id) {
                return Err(DiscordApiError::Status(400));
            }
            #[derive(Deserialize)]
            struct GuildOwner {
                owner_id: String,
            }
            let guild: GuildOwner = self
                .send_json(
                    self.request(
                        reqwest::Method::GET,
                        format!("{}/guilds/{guild_id}", self.base_url),
                    ),
                    RequestTarget::Guild(guild_id.to_string()),
                )
                .await?;
            if !is_snowflake(&guild.owner_id) {
                return Err(DiscordApiError::Transport);
            }
            Ok(guild.owner_id)
        })
    }

    fn guild_roles<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildRole>> {
        Box::pin(async move {
            if !is_snowflake(guild_id) {
                return Err(DiscordApiError::Status(400));
            }
            self.send_json(
                self.request(
                    reqwest::Method::GET,
                    format!("{}/guilds/{guild_id}/roles", self.base_url),
                ),
                RequestTarget::Guild(guild_id.to_string()),
            )
            .await
        })
    }

    fn guild_member<'a>(
        &'a self,
        guild_id: &'a str,
        user_id: &'a str,
    ) -> ApiFuture<'a, Option<GuildMember>> {
        Box::pin(async move {
            if !is_snowflake(guild_id) || !is_snowflake(user_id) {
                return Ok(None);
            }
            let url = format!("{}/guilds/{guild_id}/members/{user_id}", self.base_url);
            let target = RequestTarget::Guild(guild_id.to_string());
            let (response, epoch) = self
                .send(
                    self.request(reqwest::Method::GET, url),
                    true,
                    target.clone(),
                )
                .await?;
            let status = response.status();
            // 404 is the documented "no such member" answer and is the whole
            // point of this call — it is an outcome, not a failure.
            if status.as_u16() == 404 {
                self.admission.lock().await.succeeded(&target, epoch);
                return Ok(None);
            }
            if !status.is_success() {
                return Err(classify(status.as_u16()));
            }
            self.read_json::<GuildMember>(response, &target, epoch)
                .await
                .map(Some)
        })
    }

    fn create_message<'a>(
        &'a self,
        channel_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, String> {
        Box::pin(async move {
            if !is_snowflake(channel_id) {
                return Err(DiscordApiError::Status(400));
            }
            let message: IdOnly = self
                .send_json(
                    self.request(
                        reqwest::Method::POST,
                        format!("{}/channels/{channel_id}/messages", self.base_url),
                    )
                    .json(payload),
                    RequestTarget::Channel(channel_id.to_string()),
                )
                .await?;
            Ok(message.id)
        })
    }

    fn edit_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, ()> {
        Box::pin(async move {
            if !is_snowflake(channel_id) || !is_snowflake(message_id) {
                return Err(DiscordApiError::Status(400));
            }
            self.send_empty(
                self.request(
                    reqwest::Method::PATCH,
                    format!(
                        "{}/channels/{channel_id}/messages/{message_id}",
                        self.base_url
                    ),
                )
                .json(payload),
                false,
                RequestTarget::Channel(channel_id.to_string()),
            )
            .await
        })
    }

    fn delete_message<'a>(&'a self, channel_id: &'a str, message_id: &'a str) -> ApiFuture<'a, ()> {
        Box::pin(async move {
            if !is_snowflake(channel_id) || !is_snowflake(message_id) {
                return Err(DiscordApiError::Status(400));
            }
            match self
                .send_empty(
                    self.request(
                        reqwest::Method::DELETE,
                        format!(
                            "{}/channels/{channel_id}/messages/{message_id}",
                            self.base_url
                        ),
                    ),
                    true,
                    RequestTarget::Channel(channel_id.to_string()),
                )
                .await
            {
                Err(DiscordApiError::Status(404)) | Ok(()) => Ok(()),
                Err(other) => Err(other),
            }
        })
    }

    fn create_thread_from_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
        payload: &'a serde_json::Value,
    ) -> ApiFuture<'a, String> {
        Box::pin(async move {
            if !is_snowflake(channel_id) || !is_snowflake(message_id) {
                return Err(DiscordApiError::Status(400));
            }
            let thread: IdOnly = self
                .send_json(
                    self.request(
                        reqwest::Method::POST,
                        format!(
                            "{}/channels/{channel_id}/messages/{message_id}/threads",
                            self.base_url
                        ),
                    )
                    .json(payload),
                    RequestTarget::Channel(channel_id.to_string()),
                )
                .await?;
            Ok(thread.id)
        })
    }
}

/// Parse a Discord permission bitfield, which arrives as a decimal **string**
/// (the field exceeds JSON's safe integer range). An unparsable value yields no
/// permissions — failing closed, so a Discord response shape change can only
/// ever hide a channel, never offer one the bot cannot post in.
#[must_use]
pub fn parse_permissions(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or(0)
}

/// Discord's documented `computeBasePermissions`: the `@everyone` role (whose id
/// is the guild id) unioned with every role the member holds.
///
/// Needed for a *caller*, whose guild totals Discord does not precompute for us
/// — the bot's own base arrives ready-made on the partial guild's `permissions`
/// field. Roles the member does not hold contribute nothing; an unknown role id
/// contributes nothing (fail closed).
#[must_use]
pub fn compute_base_permissions(
    guild_id: &str,
    roles: &[GuildRole],
    member_role_ids: &BTreeSet<String>,
) -> u64 {
    roles
        .iter()
        .filter(|role| role.id == guild_id || member_role_ids.contains(&role.id))
        .fold(0_u64, |acc, role| {
            acc | parse_permissions(&role.permissions)
        })
}

/// Discord's documented channel permission computation for a member, given the
/// member's already-computed guild-level `base` permissions (`@everyone` unioned
/// with the member's roles — exactly what the `permissions` field on a partial
/// guild carries, and what [`compute_base_permissions`] derives for a caller).
///
/// Overwrites are applied in the documented order: `@everyone` (the role whose
/// id equals the guild id), then the union of the member's role overwrites
/// (all denies before all allows), then the member-specific overwrite. An
/// `ADMINISTRATOR` base short-circuits to "everything", as Discord specifies.
#[must_use]
pub fn compute_channel_permissions(
    base: u64,
    guild_id: &str,
    member_role_ids: &BTreeSet<String>,
    member_user_id: &str,
    overwrites: &[PermissionOverwrite],
) -> u64 {
    if base & PERMISSION_ADMINISTRATOR != 0 {
        return u64::MAX;
    }

    let mut permissions = base;

    // 1. @everyone overwrite (its role id is the guild id).
    if let Some(everyone) = overwrites
        .iter()
        .find(|o| o.kind == OVERWRITE_TYPE_ROLE && o.id == guild_id)
    {
        permissions &= !parse_permissions(&everyone.deny);
        permissions |= parse_permissions(&everyone.allow);
    }

    // 2. Role overwrites, accumulated across every role the member holds, with
    //    all denies applied before any allow (an allow on one role beats a deny
    //    on another).
    let mut role_allow = 0_u64;
    let mut role_deny = 0_u64;
    for overwrite in overwrites
        .iter()
        .filter(|o| o.kind == OVERWRITE_TYPE_ROLE && o.id != guild_id)
        .filter(|o| member_role_ids.contains(&o.id))
    {
        role_allow |= parse_permissions(&overwrite.allow);
        role_deny |= parse_permissions(&overwrite.deny);
    }
    permissions &= !role_deny;
    permissions |= role_allow;

    // 3. Member-specific overwrite, which wins outright.
    if let Some(member) = overwrites
        .iter()
        .find(|o| o.kind == OVERWRITE_TYPE_MEMBER && o.id == member_user_id)
    {
        permissions &= !parse_permissions(&member.deny);
        permissions |= parse_permissions(&member.allow);
    }

    permissions
}

/// Whether `channel` is a text channel the bot may post an advert embed into.
#[must_use]
pub fn bot_can_post(
    channel: &GuildChannel,
    base: u64,
    guild_id: &str,
    bot_role_ids: &BTreeSet<String>,
    bot_user_id: &str,
) -> bool {
    if !POSTABLE_CHANNEL_TYPES.contains(&channel.kind) {
        return false;
    }
    let permissions = compute_channel_permissions(
        base,
        guild_id,
        bot_role_ids,
        bot_user_id,
        &channel.permission_overwrites,
    );
    permissions & REQUIRED_POST_PERMISSIONS == REQUIRED_POST_PERMISSIONS
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn mock_api(
        status: u16,
        retry_after: Option<&str>,
        body: &str,
        repeat_failure: bool,
    ) -> (HttpDiscordApi, tokio::task::JoinHandle<()>) {
        use axum::response::IntoResponse;
        use axum::{routing::any, Router};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let header = retry_after.map(str::to_string);
        let body = body.to_string();
        let app = Router::new().fallback(any(move || {
            let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
            let header = header.clone();
            let body = body.clone();
            async move {
                if first || repeat_failure {
                    let mut response =
                        (axum::http::StatusCode::from_u16(status).unwrap(), body).into_response();
                    if let Some(header) = header {
                        response
                            .headers_mut()
                            .insert("retry-after", header.parse().unwrap());
                    }
                    response
                } else {
                    axum::Json(serde_json::json!({"id": "123", "roles": []})).into_response()
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("private-test-token");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (api, task)
    }

    #[tokio::test]
    async fn slow_guild_headers_do_not_serialize_healthy_directory_reads() {
        use axum::{response::IntoResponse, routing::any, Router};
        use std::sync::Arc;
        let (started, mut held) = tokio::sync::mpsc::unbounded_channel();
        let app = Router::new().fallback(any(move |uri: axum::http::Uri| {
            let started = started.clone();
            async move {
                if uri.path().starts_with("/guilds/") {
                    started.send(uri.path().to_string()).unwrap();
                    tokio::time::sleep(Duration::from_secs(8)).await;
                    axum::http::StatusCode::FORBIDDEN.into_response()
                } else {
                    axum::Json(serde_json::json!({"id":"123"})).into_response()
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        let api = Arc::new(api);
        let first_api = api.clone();
        let first = tokio::spawn(async move { first_api.guild_roles("111").await });
        assert_eq!(held.recv().await.unwrap(), "/guilds/111/roles");
        let second_api = api.clone();
        let second = tokio::spawn(async move { second_api.guild_roles("222").await });
        // FIFO admission puts this healthy read behind both slow requests on the
        // predecessor, despite each request fitting its own 10-second timeout.
        tokio::task::yield_now().await;
        let healthy = tokio::time::timeout(Duration::from_secs(15), api.current_user_id()).await;
        let a = first.await.unwrap();
        let b = second.await.unwrap();
        server.abort();
        assert_eq!(a, Err(DiscordApiError::Status(403)));
        assert_eq!(b, Err(DiscordApiError::Status(403)));
        assert_eq!(
            healthy,
            Ok(Ok("123".to_string())),
            "healthy directory exceeded its whole handler budget behind slow headers"
        );
    }

    #[tokio::test]
    async fn malformed_json_and_member_bodies_accumulate_shared_transport_backoff() {
        for member in [false, true] {
            let (api, server) = mock_api(200, None, "not-json", true).await;
            for (attempt, seconds) in [1, 2, 4].into_iter().enumerate() {
                let result = if member {
                    api.guild_member("123", "456").await.map(|_| ())
                } else {
                    api.current_user_id().await.map(|_| ())
                };
                assert_eq!(result, Err(DiscordApiError::Transport));
                assert_eq!(
                    api.admission.lock().await.failures,
                    attempt as u32 + 1,
                    "successful headers must not reset the body failure streak"
                );
                assert!(
                    api.admission
                        .lock()
                        .await
                        .cooldown
                        .saturating_duration_since(tokio::time::Instant::now())
                        >= Duration::from_millis(seconds * 1000 - 100)
                );
                let started = tokio::time::Instant::now();
                // Poll a different route through actual admission, then advance
                // only the retry wait. Resume before loopback response I/O.
                let next = api.bot_guilds();
                tokio::pin!(next);
                tokio::time::pause();
                assert!(futures_util::poll!(&mut next).is_pending());
                tokio::time::advance(Duration::from_secs(seconds)).await;
                tokio::time::resume();
                drop(next);
                assert!(started.elapsed() >= Duration::from_secs(seconds));
            }
            server.abort();
        }
    }

    #[tokio::test]
    async fn truncated_success_body_feeds_shared_backoff() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).await.unwrap() > 0);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{\"id\":",
                )
                .await
                .unwrap();
            stream.shutdown().await.unwrap();
        });
        assert_eq!(api.current_user_id().await, Err(DiscordApiError::Transport));
        server.await.unwrap();
        assert_eq!(
            api.admission.lock().await.failures,
            1,
            "truncated body bypassed shared transport backoff"
        );
    }

    // Each request reaches a real loopback handler before the test supplies its
    // response. Bodies can be gated independently from headers.
    async fn controlled_api() -> (
        std::sync::Arc<HttpDiscordApi>,
        tokio::sync::mpsc::UnboundedReceiver<(
            String,
            tokio::sync::oneshot::Sender<axum::response::Response>,
        )>,
        tokio::task::JoinHandle<()>,
    ) {
        use axum::{routing::any, Router};
        let (sent, received) = tokio::sync::mpsc::unbounded_channel();
        let app = Router::new().fallback(any(move |uri: axum::http::Uri| {
            let sent = sent.clone();
            async move {
                let (response, wait) = tokio::sync::oneshot::channel();
                sent.send((uri.path().to_string(), response)).unwrap();
                wait.await.unwrap()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        (std::sync::Arc::new(api), received, server)
    }

    fn held_body(
        status: u16,
        header: Option<&str>,
    ) -> (
        axum::response::Response,
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<&'static str>,
    ) {
        let (entered, waiting) = tokio::sync::oneshot::channel();
        let (release, body) = tokio::sync::oneshot::channel();
        let stream = futures_util::stream::once(async move {
            let _ = entered.send(());
            Ok::<_, std::io::Error>(body.await.unwrap_or(""))
        });
        let mut response = axum::response::Response::builder().status(status);
        if let Some(header) = header {
            response = response.header("retry-after", header);
        }
        (
            response
                .body(axum::body::Body::from_stream(stream))
                .unwrap(),
            waiting,
            release,
        )
    }

    #[tokio::test]
    async fn late_success_body_cannot_clear_newer_shared_or_resource_failure() {
        use axum::response::IntoResponse;
        for status in [500, 403, 200] {
            let (api, mut requests, server) = controlled_api().await;
            let old_api = api.clone();
            let old = tokio::spawn(async move { old_api.guild_roles("111").await });
            let (_, respond) = requests.recv().await.unwrap();
            let (response, waiting, release) = held_body(200, None);
            respond.send(response).unwrap();
            waiting.await.unwrap();
            let new_api = api.clone();
            let new = tokio::spawn(async move { new_api.guild_channels("111").await });
            let (_, respond) = requests.recv().await.unwrap();
            respond
                .send(
                    (
                        axum::http::StatusCode::from_u16(status).unwrap(),
                        "not-json",
                    )
                        .into_response(),
                )
                .unwrap();
            let expected = if status == 200 {
                DiscordApiError::Transport
            } else {
                DiscordApiError::Status(status)
            };
            assert_eq!(new.await.unwrap(), Err(expected));
            let cooldown = api.admission.lock().await.cooldown;
            release.send("[]").unwrap();
            assert_eq!(old.await.unwrap(), Ok(vec![]));
            let admission = api.admission.lock().await;
            if status != 403 {
                assert_eq!(
                    admission.failures, 1,
                    "late successful body erased a newer failure"
                );
                assert_eq!(admission.cooldown, cooldown);
            } else {
                assert_eq!(
                    admission.resources[&RequestTarget::Guild("111".into())].failures,
                    1
                );
            }
            drop(admission);
            server.abort();
        }
    }

    #[tokio::test]
    async fn queued_callers_recheck_known_429_headers_even_if_body_reader_is_cancelled() {
        use axum::response::IntoResponse;
        let (api, mut requests, server) = controlled_api().await;
        let rate_api = api.clone();
        let rate = tokio::spawn(async move { rate_api.guild_roles("111").await });
        let (_, respond) = requests.recv().await.unwrap();
        let (response, waiting, release) = held_body(429, Some("0.4"));
        // Establish that the next call is already queued on spacing before the
        // provider publishes its cooldown, not merely started afterwards.
        let next = api.current_user_id();
        tokio::pin!(next);
        assert!(futures_util::poll!(&mut next).is_pending());
        respond.send(response).unwrap();
        waiting.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if api.admission.lock().await.failures == 1 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        rate.abort();
        assert!(rate.await.unwrap_err().is_cancelled());
        let _ = release.send("{}");
        tokio::time::pause();
        tokio::time::advance(Duration::from_millis(100)).await;
        assert!(futures_util::poll!(&mut next).is_pending());
        assert!(
            requests.try_recv().is_err(),
            "queued call bypassed known provider cooldown"
        );
        tokio::time::resume();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), async {
                tokio::select! {
                    request = requests.recv() => request,
                    result = &mut next => panic!("queued request completed before cooldown: {result:?}"),
                }
            }).await.is_err(),
            "queued request reached the actual provider before Retry-After elapsed"
        );
        tokio::time::pause();
        tokio::time::advance(Duration::from_millis(300)).await;
        tokio::time::resume();
        let reply = async {
            let (path, respond) = requests.recv().await.unwrap();
            assert_eq!(path, "/users/@me");
            respond
                .send(axum::Json(serde_json::json!({"id":"123"})).into_response())
                .unwrap();
        };
        let (result, ()) = tokio::join!(next, reply);
        assert_eq!(result, Ok("123".to_string()));
        assert_eq!(
            api.admission.lock().await.failures,
            0,
            "fresh successful body should reset streak"
        );
        server.abort();
    }

    #[tokio::test]
    async fn resource_failure_does_not_pin_json_429_provisional_shared_fallback() {
        use axum::response::IntoResponse;
        let (api, mut requests, server) = controlled_api().await;
        // Accumulate a real shared streak. Advance only completed retry waits;
        // every request and response is consumed over resumed loopback I/O.
        for (attempt, seconds) in [1, 2, 4, 8, 16, 32].into_iter().enumerate() {
            let failed_api = api.clone();
            let failed = tokio::spawn(async move { failed_api.guild_roles("111").await });
            let (path, respond) = tokio::time::timeout(Duration::from_secs(1), requests.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(path, "/guilds/111/roles");
            respond
                .send(axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response())
                .unwrap();
            assert_eq!(failed.await.unwrap(), Err(DiscordApiError::Status(500)));
            assert_eq!(api.admission.lock().await.failures, attempt as u32 + 1);
            tokio::time::pause();
            tokio::time::advance(Duration::from_secs(seconds)).await;
            tokio::time::resume();
        }

        // Dispatch the unrelated request before the seventh failure. Its held
        // headers let a resource refusal arrive during the 429's held body.
        let resource_api = api.clone();
        let resource = tokio::spawn(async move { resource_api.guild_roles("222").await });
        let (path, resource_reply) = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(path, "/guilds/222/roles");
        let rate_api = api.clone();
        let rate = tokio::spawn(async move { rate_api.guild_roles("111").await });
        let (path, rate_reply) = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(path, "/guilds/111/roles");
        let (response, waiting, release) = held_body(429, None);
        rate_reply.send(response).unwrap();
        waiting.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while api.admission.lock().await.failures != 7 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let (shared_epoch, provisional) = {
            let admission = api.admission.lock().await;
            assert_eq!(admission.epoch, admission.shared_failure_epoch);
            assert!(
                admission
                    .cooldown
                    .saturating_duration_since(tokio::time::Instant::now())
                    >= Duration::from_secs(63)
            );
            (admission.shared_failure_epoch, admission.cooldown)
        };
        resource_reply
            .send(axum::http::StatusCode::FORBIDDEN.into_response())
            .unwrap();
        assert_eq!(resource.await.unwrap(), Err(DiscordApiError::Status(403)));
        {
            let admission = api.admission.lock().await;
            assert!(admission.epoch > shared_epoch);
            assert_eq!(admission.shared_failure_epoch, shared_epoch);
            assert_eq!(admission.failures, 7);
            assert_eq!(admission.cooldown, provisional);
            assert_eq!(
                admission.resources[&RequestTarget::Guild("222".into())].failures,
                1
            );
        }

        let released = tokio::time::Instant::now();
        release.send(r#"{"retry_after":0.2}"#).unwrap();
        assert_eq!(rate.await.unwrap(), Err(DiscordApiError::Status(429)));
        let completed = tokio::time::Instant::now();
        let deadline = api.admission.lock().await.cooldown;
        assert_eq!(
            api.guild_roles("222").await,
            Err(DiscordApiError::ResourceCooldown),
            "shared refinement must not remove the resource cooldown"
        );

        // Exercise healthy actual dispatch as well as inspecting the deadline.
        // A stale 64s fallback must fail this bounded native transport check.
        let healthy = api.current_user_id();
        tokio::pin!(healthy);
        tokio::time::pause();
        assert!(futures_util::poll!(&mut healthy).is_pending());
        tokio::time::advance(Duration::from_millis(250)).await;
        tokio::time::resume();
        let reply = async {
            let (path, respond) = requests.recv().await.unwrap();
            assert_eq!(path, "/users/@me");
            respond
                .send(axum::Json(serde_json::json!({"id":"123"})).into_response())
                .unwrap();
        };
        let result = tokio::time::timeout(Duration::from_secs(1), async {
            let (result, ()) = tokio::join!(healthy, reply);
            result
        })
        .await;
        server.abort();
        assert!(
            deadline <= completed + Duration::from_millis(200),
            "resource-only failure kept the seventh 429's provisional 64s shared fallback"
        );
        assert!(
            deadline >= released + Duration::from_millis(200),
            "the legitimate JSON delay was shortened"
        );
        assert_eq!(
            result,
            Ok(Ok("123".to_string())),
            "healthy request remained blocked by a resource-only epoch change"
        );
    }

    #[tokio::test]
    async fn late_json_429_cannot_shorten_a_newer_provider_cooldown() {
        use axum::response::IntoResponse;
        let (api, mut requests, server) = controlled_api().await;
        let old_api = api.clone();
        let old = tokio::spawn(async move { old_api.guild_roles("111").await });
        let (_, respond) = requests.recv().await.unwrap();
        let (response, waiting, release) = held_body(429, None);
        respond.send(response).unwrap();
        waiting.await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while api.admission.lock().await.failures != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::resume();
        let new_api = api.clone();
        let new = tokio::spawn(async move { new_api.guild_roles("222").await });
        let (_, respond) = requests.recv().await.unwrap();
        let mut response = axum::http::StatusCode::TOO_MANY_REQUESTS.into_response();
        response
            .headers_mut()
            .insert("retry-after", "5".parse().unwrap());
        respond.send(response).unwrap();
        assert_eq!(new.await.unwrap(), Err(DiscordApiError::Status(429)));
        let deadline = api.admission.lock().await.cooldown;
        release.send(r#"{"retry_after":0.2}"#).unwrap();
        assert_eq!(old.await.unwrap(), Err(DiscordApiError::Status(429)));
        assert_eq!(
            api.admission.lock().await.cooldown,
            deadline,
            "old JSON response shortened newer cooldown"
        );
        server.abort();
    }

    #[tokio::test]
    async fn unrepresentable_retry_deadline_keeps_shared_fallback() {
        let (api, server) = mock_api(429, Some("10000000000000000000"), "{}", false).await;
        assert_eq!(
            api.current_user_id().await,
            Err(DiscordApiError::Status(429))
        );
        assert!(
            api.admission
                .lock()
                .await
                .cooldown
                .saturating_duration_since(tokio::time::Instant::now())
                >= Duration::from_millis(900),
            "an unrepresentable header deadline lost transport fallback"
        );
        server.abort();
    }

    #[tokio::test]
    async fn retry_after_delays_other_routes_without_replaying_a_post() {
        let (api, server) = mock_api(429, Some("0.2"), r#"{"retry_after": 0.2}"#, false).await;
        let payload = serde_json::json!({"content": "test"});
        assert_eq!(
            api.create_message("123", &payload).await,
            Err(DiscordApiError::Status(429))
        );
        let start = tokio::time::Instant::now();
        assert_eq!(api.current_user_id().await.unwrap(), "123");
        assert!(
            start.elapsed() >= Duration::from_millis(190),
            "shared cooldown was ignored"
        );
        server.abort();
    }

    #[tokio::test]
    async fn json_retry_after_is_used_when_the_header_is_absent() {
        let (api, server) =
            mock_api(429, None, r#"{"retry_after": 0.2, "global": true}"#, false).await;
        assert_eq!(
            api.guild_member("123", "456").await,
            Err(DiscordApiError::Status(429))
        );
        let start = tokio::time::Instant::now();
        api.current_user_id().await.unwrap();
        assert!(
            start.elapsed() >= Duration::from_millis(190),
            "JSON cooldown was ignored"
        );
        server.abort();
    }

    #[tokio::test]
    async fn terminal_failures_back_off_instead_of_hammering_a_deleted_channel() {
        for status in [403, 404, 410] {
            let (api, server) = mock_api(status, None, "{}", false).await;
            let payload = serde_json::json!({});
            assert_eq!(
                api.create_message("123", &payload).await,
                Err(DiscordApiError::Status(status))
            );
            // Every operation on this channel is skipped, not slept or replayed.
            assert_eq!(
                api.create_message("123", &payload).await,
                Err(DiscordApiError::ResourceCooldown)
            );
            assert_eq!(
                api.edit_message("123", "456", &payload).await,
                Err(DiscordApiError::ResourceCooldown)
            );
            assert_eq!(
                api.delete_message("123", "456").await,
                Err(DiscordApiError::ResourceCooldown)
            );
            assert_eq!(
                api.create_thread_from_message("123", "456", &payload).await,
                Err(DiscordApiError::ResourceCooldown)
            );
            assert!(!is_terminal_for_resource(DiscordApiError::ResourceCooldown));
            assert!(!is_terminal_for_thread_creation(
                DiscordApiError::ResourceCooldown
            ));
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(15), api.current_user_id())
                    .await
                    .unwrap()
                    .unwrap(),
                "123"
            );
            assert_eq!(api.create_message("789", &payload).await.unwrap(), "123");
            tokio::time::pause();
            tokio::time::advance(Duration::from_secs(1)).await;
            tokio::time::resume();
            assert_eq!(api.create_message("123", &payload).await.unwrap(), "123");
            assert!(
                api.admission.lock().await.resources.is_empty(),
                "success retires the streak"
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn concurrent_callers_share_aggregate_request_pacing() {
        let (api, server) = mock_api(200, None, r#"{"id":"123"}"#, false).await;
        let start = tokio::time::Instant::now();
        let results = futures_util::future::join_all((0..6).map(|_| api.current_user_id())).await;
        assert!(results.iter().all(|result| result.as_deref() == Ok("123")));
        assert!(
            start.elapsed() >= Duration::from_millis(240),
            "concurrent reads bypassed aggregate pacing"
        );
        server.abort();
    }

    #[tokio::test]
    async fn consecutive_terminal_failures_increase_only_the_resource_cooldown() {
        use axum::{response::IntoResponse, routing::any, Router};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        for status in [403, 404, 410] {
            let calls = Arc::new(AtomicUsize::new(0));
            let observed = calls.clone();
            let app = Router::new().fallback(any(move |uri: axum::http::Uri| {
                let calls = calls.clone();
                async move {
                    if uri.path().starts_with("/channels/123/") {
                        calls.fetch_add(1, Ordering::SeqCst);
                        axum::http::StatusCode::from_u16(status)
                            .unwrap()
                            .into_response()
                    } else {
                        axum::Json(serde_json::json!({"id":"123"})).into_response()
                    }
                }
            }));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let mut api = HttpDiscordApi::new("test-only");
            api.base_url = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
            let payload = serde_json::json!({});
            for (attempt, seconds) in [1, 2, 4, 8, 16, 32, 64, 64].into_iter().enumerate() {
                assert_eq!(
                    api.create_message("123", &payload).await,
                    Err(DiscordApiError::Status(status))
                );
                let deadline = api.admission.lock().await.resources
                    [&RequestTarget::Channel("123".to_string())]
                    .next;
                assert!(
                    deadline.saturating_duration_since(tokio::time::Instant::now())
                        >= Duration::from_millis(seconds * 1000 - 100)
                );
                for _ in 0..8 {
                    assert_eq!(
                        api.create_message("123", &payload).await,
                        Err(DiscordApiError::ResourceCooldown)
                    );
                }
                assert_eq!(
                    observed.load(Ordering::SeqCst),
                    attempt + 1,
                    "skips never send or replay POSTs"
                );
                // Healthy reads and writes neither wait on nor reset this streak.
                assert_eq!(
                    tokio::time::timeout(Duration::from_secs(15), api.current_user_id())
                        .await
                        .unwrap()
                        .unwrap(),
                    "123"
                );
                assert_eq!(api.create_message("789", &payload).await.unwrap(), "123");
                tokio::time::pause();
                tokio::time::advance(Duration::from_secs(seconds)).await;
                tokio::time::resume();
            }
            server.abort();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn resource_backoff_memory_is_bounded_and_idle_streaks_expire() {
        let mut admission = RequestAdmission {
            next: tokio::time::Instant::now(),
            cooldown: tokio::time::Instant::now(),
            epoch: 0,
            shared_failure_epoch: 0,
            failures: 0,
            resources: HashMap::new(),
        };
        for id in 0..MAX_RESOURCE_BACKOFFS + 1 {
            admission.resource_failed(RequestTarget::Channel(id.to_string()));
            assert!(admission.resources.len() <= MAX_RESOURCE_BACKOFFS);
        }
        tokio::time::advance(RESOURCE_BACKOFF_RETENTION + Duration::from_secs(1)).await;
        let fresh = RequestTarget::Channel("99999".to_string());
        admission.resource_failed(fresh.clone());
        assert_eq!(admission.resources.len(), 1);
        assert_eq!(admission.resources[&fresh].failures, 1);
        assert_eq!(
            admission.resources[&fresh].next - tokio::time::Instant::now(),
            Duration::from_secs(1)
        );
    }

    #[test]
    fn resource_cooldown_error_does_not_disclose_identity_or_look_terminal() {
        assert_eq!(
            DiscordApiError::ResourceCooldown.to_string(),
            "discord resource is cooling down"
        );
        assert_eq!(
            format!("{:?}", HttpDiscordApi::new("private-test-token")),
            "HttpDiscordApi { .. }"
        );
        assert!(!is_terminal_for_resource(DiscordApiError::ResourceCooldown));
        assert!(!is_terminal_for_thread_creation(
            DiscordApiError::ResourceCooldown
        ));
    }

    #[test]
    fn invalid_retry_delays_never_panic_or_disable_fallback() {
        for value in [f64::NAN, f64::INFINITY, -1.0, f64::MAX] {
            assert!(retry_delay(value).is_none());
        }
        assert_eq!(retry_delay(0.25), Some(Duration::from_millis(250)));
    }

    #[tokio::test]
    async fn reviewer_deleted_billboard_must_not_starve_healthy_directory() {
        use axum::{response::IntoResponse, routing::any, Router};
        let app = Router::new().fallback(any(|uri: axum::http::Uri| async move {
            if uri.path().contains("/channels/") {
                axum::http::StatusCode::NOT_FOUND.into_response()
            } else {
                axum::Json(serde_json::json!({"id":"123"})).into_response()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        for seconds in [1, 2, 4, 8, 16, 32] {
            assert_eq!(
                api.create_message("123", &serde_json::json!({})).await,
                Err(DiscordApiError::Status(404))
            );
            // Advance only retry waits; real HTTP runs with the clock resumed.
            tokio::time::pause();
            tokio::time::advance(Duration::from_secs(seconds)).await;
            tokio::time::resume();
        }
        api.create_message("123", &serde_json::json!({}))
            .await
            .unwrap_err();
        let result = tokio::time::timeout(Duration::from_secs(15), api.current_user_id()).await;
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(64)).await;
        tokio::time::resume();
        assert_eq!(
            api.current_user_id().await.unwrap(),
            "123",
            "same healthy route succeeds after unrelated cooldown expires"
        );
        server.abort();
        assert!(result.is_ok(), "healthy directory exceeded its entire handler budget due solely to another channel's 404s");
        assert_eq!(result.unwrap().unwrap(), "123");
    }

    #[tokio::test]
    async fn reconcile_retries_billboard_delete_skipped_by_another_rooms_cooldown() {
        use crate::discord::{
            reconcile, AdvertKind, AdvertTarget, DesiredAdvert, DiscordService, RoomAdvert,
        };
        use axum::{response::IntoResponse, routing::any, Router};
        use std::sync::{Arc, Mutex};
        let operations = Arc::new(Mutex::new(Vec::new()));
        let observed = operations.clone();
        let app = Router::new().fallback(any(
            move |method: axum::http::Method, uri: axum::http::Uri| {
                let operations = operations.clone();
                async move {
                    let mut calls = operations.lock().unwrap();
                    calls.push((method.clone(), uri.path().to_string()));
                    match method {
                        axum::http::Method::POST => {
                            axum::Json(serde_json::json!({"id":(100 + calls.len()).to_string()}))
                                .into_response()
                        }
                        // A moderator removed A. B's subsequent DELETE must be
                        // skipped locally, then recovered by ordinary reconciliation.
                        axum::http::Method::PATCH => {
                            axum::http::StatusCode::NOT_FOUND.into_response()
                        }
                        axum::http::Method::DELETE => {
                            axum::http::StatusCode::NO_CONTENT.into_response()
                        }
                        _ => panic!("unexpected provider method"),
                    }
                }
            },
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        let service = DiscordService::new(
            Arc::new(api),
            None,
            "https://example.invalid".into(),
            Some("123".into()),
        );
        let mut desired: Vec<_> = ["a", "b"]
            .into_iter()
            .map(|room| DesiredAdvert {
                advert: RoomAdvert {
                    room_id: room.into(),
                    name: None,
                    player_count: 1,
                    player_cap: 8,
                    theme_id: None,
                    player_names: vec![],
                    recent_rolls: vec![],
                },
                targets: vec![AdvertTarget {
                    channel_id: "123".into(),
                    kind: AdvertKind::Billboard,
                }],
            })
            .collect();
        let mut tracked = HashMap::new();
        reconcile(&service, &mut tracked, &desired).await;
        let old_button = tracked["b"][0].message_id.clone();
        desired.truncate(1);
        desired[0].advert.player_count = 2;
        reconcile(&service, &mut tracked, &desired).await;
        assert_eq!(
            observed.lock().unwrap().len(),
            3,
            "cooling DELETE must not dispatch"
        );
        assert!(
            tracked.contains_key("b"),
            "no-send DELETE forgot obsolete Join-button deletion intent"
        );
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::resume();
        reconcile(&service, &mut tracked, &[]).await;
        assert!(!tracked.contains_key("b"));
        assert_eq!(
            observed.lock().unwrap().last().unwrap(),
            &(
                axum::http::Method::DELETE,
                format!("/channels/123/messages/{old_button}")
            )
        );
        server.abort();
    }

    #[tokio::test]
    async fn reconcile_skips_cooling_channel_without_retiring_pending_host_intent() {
        use crate::discord::{
            reconcile, AdvertKind, AdvertTarget, DesiredAdvert, DiscordService, RoomAdvert,
        };
        use axum::{response::IntoResponse, routing::any, Router};
        use std::sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        };
        let broken = Arc::new(AtomicBool::new(true));
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let provider_broken = broken.clone();
        let app = Router::new().fallback(any(move |uri: axum::http::Uri| {
            let broken = provider_broken.clone();
            let calls = calls.clone();
            async move {
                if uri.path().starts_with("/channels/123/") {
                    calls.fetch_add(1, Ordering::SeqCst);
                    if broken.load(Ordering::SeqCst) {
                        return axum::http::StatusCode::NOT_FOUND.into_response();
                    }
                }
                axum::Json(serde_json::json!({"id":"456"})).into_response()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut api = HttpDiscordApi::new("test-only");
        api.base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
        let api = Arc::new(api);
        assert_eq!(
            api.create_message("123", &serde_json::json!({})).await,
            Err(DiscordApiError::Status(404))
        );
        let service = DiscordService::new(
            api,
            None,
            "https://example.invalid".to_string(),
            Some("123".to_string()),
        );
        service
            .registry
            .register("pending", "123", "verified-test-host")
            .await
            .unwrap();
        let desired: Vec<_> = [
            ("billboard-a", "123", AdvertKind::Billboard),
            ("billboard-b", "123", AdvertKind::Billboard),
            ("pending", "123", AdvertKind::HostPosted),
            ("healthy", "789", AdvertKind::HostPosted),
        ]
        .into_iter()
        .map(|(room, channel, kind)| DesiredAdvert {
            advert: RoomAdvert {
                room_id: room.to_string(),
                name: None,
                player_count: 1,
                player_cap: 8,
                theme_id: None,
                player_names: vec![],
                recent_rolls: vec![],
            },
            targets: vec![AdvertTarget {
                channel_id: channel.to_string(),
                kind,
            }],
        })
        .collect();
        let mut tracked = HashMap::new();
        tokio::time::timeout(
            Duration::from_secs(15),
            reconcile(&service, &mut tracked, &desired),
        )
        .await
        .unwrap();
        assert_eq!(
            observed.load(Ordering::SeqCst),
            1,
            "pending actions must not send during cooldown"
        );
        assert_eq!(tracked["healthy"][0].channel_id, "789");
        assert!(
            service.registry.snapshot().await["pending"].contains("123"),
            "a skipped request is not a terminal refusal of fresh intent"
        );
        broken.store(false, Ordering::SeqCst);
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(1)).await;
        tokio::time::resume();
        reconcile(&service, &mut tracked, &desired[2..3]).await;
        assert_eq!(
            tracked["pending"][0].channel_id, "123",
            "next ordinary pass recovers pending intent"
        );
        assert_eq!(observed.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn guild_refusal_is_local_and_expected_member_and_delete_404s_are_normal() {
        let (api, server) = mock_api(403, None, "{}", false).await;
        assert_eq!(
            api.guild_roles("123").await,
            Err(DiscordApiError::Status(403))
        );
        assert_eq!(
            api.guild_channels("123").await,
            Err(DiscordApiError::ResourceCooldown)
        );
        assert_eq!(
            api.guild_member("123", "456").await,
            Err(DiscordApiError::ResourceCooldown)
        );
        assert_eq!(
            api.guild_owner_id("123").await,
            Err(DiscordApiError::ResourceCooldown)
        );
        assert_eq!(api.current_user_id().await.unwrap(), "123");
        assert_eq!(
            api.create_message("123", &serde_json::json!({}))
                .await
                .unwrap(),
            "123",
            "guild and channel namespaces are separate"
        );
        server.abort();
        let (api, server) = mock_api(404, None, "{}", true).await;
        assert_eq!(api.guild_member("123", "456").await.unwrap(), None);
        assert_eq!(api.delete_message("123", "456").await, Ok(()));
        let admission = api.admission.lock().await;
        assert!(admission.resources.is_empty());
        assert_eq!(admission.failures, 0);
        server.abort();
    }

    #[tokio::test]
    async fn provider_failures_and_invalid_429_delays_keep_shared_fallback() {
        for status in [401, 500, 429] {
            let (api, server) = mock_api(status, Some("invalid"), "{}", false).await;
            assert_eq!(
                api.create_message("123", &serde_json::json!({})).await,
                Err(classify(status))
            );
            let start = tokio::time::Instant::now();
            assert_eq!(api.current_user_id().await.unwrap(), "123");
            assert!(
                start.elapsed() >= Duration::from_secs(1),
                "status {status} bypassed shared fallback"
            );
            server.abort();
        }
    }

    const GUILD: &str = "111111111111111111";
    const BOT: &str = "222222222222222222";
    const ROLE: &str = "333333333333333333";
    const OTHER_ROLE: &str = "444444444444444444";

    fn roles(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|id| (*id).to_string()).collect()
    }

    /// Alias used by the base-permission tests, where `roles` names the role
    /// *definitions* rather than the ids a member holds.
    fn roles_set(ids: &[&str]) -> BTreeSet<String> {
        roles(ids)
    }

    fn overwrite(id: &str, kind: u8, allow: u64, deny: u64) -> PermissionOverwrite {
        PermissionOverwrite {
            id: id.to_string(),
            kind,
            allow: allow.to_string(),
            deny: deny.to_string(),
        }
    }

    fn channel(kind: u8, overwrites: Vec<PermissionOverwrite>) -> GuildChannel {
        GuildChannel {
            id: "555555555555555555".to_string(),
            name: Some("general".to_string()),
            kind,
            position: Some(0),
            permission_overwrites: overwrites,
        }
    }

    #[test]
    fn snowflake_guard_rejects_anything_that_could_reshape_a_url() {
        assert!(is_snowflake("123456789012345678"));
        for hostile in [
            "",
            "../../users/@me",
            "123/../456",
            "12 34",
            "abc",
            "1234567890123456789012345",
        ] {
            assert!(!is_snowflake(hostile), "{hostile} must be rejected");
        }
    }

    #[test]
    fn permissions_parse_fails_closed_on_garbage() {
        assert_eq!(parse_permissions("2048"), PERMISSION_SEND_MESSAGES);
        assert_eq!(parse_permissions(""), 0);
        assert_eq!(parse_permissions("not-a-number"), 0);
        // Beyond u64 (Discord's field is 64-bit today) — no permissions, never a
        // wrapped value that could accidentally grant one.
        assert_eq!(parse_permissions("99999999999999999999999"), 0);
    }

    #[test]
    fn administrator_base_short_circuits_every_overwrite() {
        let permissions = compute_channel_permissions(
            PERMISSION_ADMINISTRATOR,
            GUILD,
            &roles(&[]),
            BOT,
            &[overwrite(
                GUILD,
                OVERWRITE_TYPE_ROLE,
                0,
                REQUIRED_POST_PERMISSIONS,
            )],
        );
        assert_eq!(
            permissions & REQUIRED_POST_PERMISSIONS,
            REQUIRED_POST_PERMISSIONS
        );
    }

    #[test]
    fn everyone_overwrite_denies_then_a_role_overwrite_restores() {
        // @everyone loses SEND_MESSAGES in this channel...
        let denied = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[overwrite(
                GUILD,
                OVERWRITE_TYPE_ROLE,
                0,
                PERMISSION_SEND_MESSAGES,
            )],
        );
        assert_eq!(denied & PERMISSION_SEND_MESSAGES, 0);

        // ...but the bot's role has an explicit allow, which is applied after.
        let restored = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[
                overwrite(GUILD, OVERWRITE_TYPE_ROLE, 0, PERMISSION_SEND_MESSAGES),
                overwrite(ROLE, OVERWRITE_TYPE_ROLE, PERMISSION_SEND_MESSAGES, 0),
            ],
        );
        assert_eq!(
            restored & PERMISSION_SEND_MESSAGES,
            PERMISSION_SEND_MESSAGES
        );
    }

    #[test]
    fn role_overwrites_apply_all_denies_before_any_allow() {
        // One held role denies, another held role allows: allow wins.
        let permissions = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE, OTHER_ROLE]),
            BOT,
            &[
                overwrite(ROLE, OVERWRITE_TYPE_ROLE, 0, PERMISSION_SEND_MESSAGES),
                overwrite(OTHER_ROLE, OVERWRITE_TYPE_ROLE, PERMISSION_SEND_MESSAGES, 0),
            ],
        );
        assert_eq!(
            permissions & PERMISSION_SEND_MESSAGES,
            PERMISSION_SEND_MESSAGES
        );
    }

    #[test]
    fn overwrites_for_roles_the_bot_does_not_hold_are_ignored() {
        let permissions = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[overwrite(
                OTHER_ROLE,
                OVERWRITE_TYPE_ROLE,
                0,
                PERMISSION_SEND_MESSAGES,
            )],
        );
        assert_eq!(
            permissions & PERMISSION_SEND_MESSAGES,
            PERMISSION_SEND_MESSAGES
        );
    }

    #[test]
    fn member_overwrite_is_applied_last_and_wins() {
        let permissions = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[
                overwrite(ROLE, OVERWRITE_TYPE_ROLE, PERMISSION_SEND_MESSAGES, 0),
                overwrite(BOT, OVERWRITE_TYPE_MEMBER, 0, PERMISSION_SEND_MESSAGES),
            ],
        );
        assert_eq!(permissions & PERMISSION_SEND_MESSAGES, 0);
    }

    #[test]
    fn postability_requires_view_send_and_embed_on_a_text_channel() {
        let plain = channel(0, vec![]);
        assert!(bot_can_post(
            &plain,
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[]),
            BOT
        ));
        // Missing EMBED_LINKS: the advert is an embed, so this is not a target.
        assert!(!bot_can_post(
            &plain,
            PERMISSION_VIEW_CHANNEL | PERMISSION_SEND_MESSAGES,
            GUILD,
            &roles(&[]),
            BOT
        ));
        // Announcement channels (type 5) are allowed; voice (2), category (4)
        // and threads (11) are not.
        assert!(bot_can_post(
            &channel(5, vec![]),
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[]),
            BOT
        ));
        for kind in [2_u8, 4, 11, 15] {
            assert!(
                !bot_can_post(
                    &channel(kind, vec![]),
                    REQUIRED_POST_PERMISSIONS,
                    GUILD,
                    &roles(&[]),
                    BOT
                ),
                "channel type {kind} must not be offered"
            );
        }
    }

    #[test]
    fn channel_denied_by_everyone_overwrite_is_not_postable() {
        let locked = channel(
            0,
            vec![overwrite(
                GUILD,
                OVERWRITE_TYPE_ROLE,
                0,
                PERMISSION_VIEW_CHANNEL,
            )],
        );
        assert!(!bot_can_post(
            &locked,
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[]),
            BOT
        ));
    }

    #[test]
    fn guild_and_channel_payloads_deserialize_from_discord_shapes() {
        let guilds: Vec<BotGuild> = serde_json::from_value(serde_json::json!([
            { "id": GUILD, "name": "Tavern", "icon": null, "permissions": "2147483647" }
        ]))
        .expect("guild list parses");
        assert_eq!(guilds[0].id, GUILD);
        assert_eq!(guilds[0].permissions.as_deref(), Some("2147483647"));

        let channels: Vec<GuildChannel> = serde_json::from_value(serde_json::json!([
            {
                "id": "555555555555555555",
                "name": "general",
                "type": 0,
                "position": 3,
                "permission_overwrites": [
                    { "id": GUILD, "type": 0, "allow": "0", "deny": "1024" }
                ]
            },
            // A channel with no overwrites key at all still parses.
            { "id": "666666666666666666", "type": 2 }
        ]))
        .expect("channel list parses");
        assert_eq!(channels[0].permission_overwrites.len(), 1);
        assert!(channels[1].permission_overwrites.is_empty());
        assert_eq!(channels[1].name, None);
    }

    #[test]
    fn bot_token_never_appears_in_client_debug_output() {
        let secret = "bot-token-must-not-leak";
        let api = HttpDiscordApi::new(secret);
        assert!(!format!("{api:?}").contains(secret));
        let request = api
            .request(
                reqwest::Method::GET,
                format!("{DISCORD_API_BASE}/users/@me"),
            )
            .build()
            .expect("request builds");
        assert!(request.headers()[reqwest::header::AUTHORIZATION].is_sensitive());
        assert!(!format!("{request:?}").contains(secret));
    }

    #[test]
    fn error_display_carries_no_response_body() {
        assert_eq!(
            DiscordApiError::Status(429).to_string(),
            "discord returned status 429"
        );
        assert_eq!(classify(401), DiscordApiError::Unauthorized);
        assert_eq!(classify(500), DiscordApiError::Status(500));
    }

    #[test]
    fn per_resource_failures_are_distinguishable_from_a_dead_credential() {
        // 403 is "the bot lost access to *this* channel", not "the token died",
        // so it must stay a Status and read as terminal for that resource.
        assert_eq!(classify(403), DiscordApiError::Status(403));
        for terminal in [403, 404, 410] {
            assert!(is_terminal_for_resource(DiscordApiError::Status(terminal)));
        }
        for retryable in [
            DiscordApiError::Transport,
            DiscordApiError::Unauthorized,
            DiscordApiError::Status(429),
            DiscordApiError::Status(500),
        ] {
            assert!(!is_terminal_for_resource(retryable));
        }
    }

    /// Thread creation (#255) is the one endpoint where a 400 is permanent: the
    /// message already owns a thread, or the channel cannot host one. Retrying
    /// the identical POST every sync interval for the process lifetime helps
    /// nobody, so it must read as terminal — while a 400 elsewhere stays
    /// retryable, because those payloads change with room state.
    #[test]
    fn a_bad_request_is_terminal_only_for_thread_creation() {
        assert!(is_terminal_for_thread_creation(DiscordApiError::Status(
            400
        )));
        assert!(!is_terminal_for_resource(DiscordApiError::Status(400)));
        for terminal in [403, 404, 410] {
            assert!(is_terminal_for_thread_creation(DiscordApiError::Status(
                terminal
            )));
        }
        for retryable in [
            DiscordApiError::Transport,
            DiscordApiError::Unauthorized,
            DiscordApiError::Status(429),
            DiscordApiError::Status(500),
        ] {
            assert!(!is_terminal_for_thread_creation(retryable));
        }
    }

    /// Locks the invite integer #255 asks operators to publish. The prose in
    /// that issue says `1<<34` for Create Public Threads, which is actually
    /// MANAGE_THREADS; Discord documents `1<<35`, and the issue's own integer
    /// agrees with Discord, so the integer is what this asserts.
    #[test]
    fn the_canonical_invite_permission_integer_is_the_documented_one() {
        assert_eq!(PERMISSION_CREATE_PUBLIC_THREADS, 0x0000_0008_0000_0000);
        assert_eq!(PERMISSION_SEND_MESSAGES_IN_THREADS, 0x0000_0040_0000_0000);
        assert_eq!(INVITE_PERMISSIONS, 309_237_664_768);
        // Threads are additive: the posting-target filter must not start
        // requiring them, or every guild invited before #255 loses its targets.
        assert_eq!(
            REQUIRED_POST_PERMISSIONS & PERMISSION_CREATE_PUBLIC_THREADS,
            0
        );
        assert_eq!(
            REQUIRED_POST_PERMISSIONS & PERMISSION_SEND_MESSAGES_IN_THREADS,
            0
        );
    }

    #[test]
    fn member_base_permissions_union_everyone_with_held_roles_only() {
        let roles = vec![
            GuildRole {
                id: GUILD.to_string(),
                permissions: PERMISSION_VIEW_CHANNEL.to_string(),
            },
            GuildRole {
                id: ROLE.to_string(),
                permissions: PERMISSION_SEND_MESSAGES.to_string(),
            },
            GuildRole {
                id: OTHER_ROLE.to_string(),
                permissions: PERMISSION_ADMINISTRATOR.to_string(),
            },
        ];

        // No roles: @everyone only.
        assert_eq!(
            compute_base_permissions(GUILD, &roles, &roles_set(&[])),
            PERMISSION_VIEW_CHANNEL
        );
        // One held role unions in; the unheld administrator role does not.
        assert_eq!(
            compute_base_permissions(GUILD, &roles, &roles_set(&[ROLE])),
            PERMISSION_VIEW_CHANNEL | PERMISSION_SEND_MESSAGES
        );
        // An unknown role id contributes nothing.
        assert_eq!(
            compute_base_permissions(GUILD, &roles, &roles_set(&["999999999999999999"])),
            PERMISSION_VIEW_CHANNEL
        );
    }
}
