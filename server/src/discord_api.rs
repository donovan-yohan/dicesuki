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

use std::collections::BTreeSet;
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
    !value.is_empty()
        && value.len() <= 20
        && value.bytes().all(|byte| byte.is_ascii_digit())
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
}

impl std::fmt::Display for DiscordApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unauthorized => write!(formatter, "discord rejected the bot credential"),
            Self::Status(status) => write!(formatter, "discord returned status {status}"),
            Self::Transport => write!(formatter, "discord request failed"),
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
    fn delete_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
    ) -> ApiFuture<'a, ()>;
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
    /// `Authorization: Bot <token>`. Never logged, never rendered.
    authorization: reqwest::header::HeaderValue,
}

impl std::fmt::Debug for HttpDiscordApi {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("HttpDiscordApi").finish_non_exhaustive()
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
        }
    }

    fn request(&self, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .header(reqwest::header::AUTHORIZATION, self.authorization.clone())
    }

    /// Send `request` and deserialize a JSON body on success.
    async fn send_json<T: serde::de::DeserializeOwned>(
        request: reqwest::RequestBuilder,
    ) -> Result<T, DiscordApiError> {
        let response = request.send().await.map_err(|_| DiscordApiError::Transport)?;
        let status = response.status();
        if !status.is_success() {
            return Err(classify(status.as_u16()));
        }
        response.json::<T>().await.map_err(|_| DiscordApiError::Transport)
    }

    /// Send `request`, discarding the body.
    async fn send_empty(request: reqwest::RequestBuilder) -> Result<(), DiscordApiError> {
        let response = request.send().await.map_err(|_| DiscordApiError::Transport)?;
        let status = response.status();
        if status.is_success() {
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
            let user: IdOnly = Self::send_json(
                self.request(reqwest::Method::GET, format!("{DISCORD_API_BASE}/users/@me")),
            )
            .await?;
            Ok(user.id)
        })
    }

    fn bot_guilds(&self) -> ApiFuture<'_, Vec<BotGuild>> {
        Box::pin(Self::send_json(self.request(
            reqwest::Method::GET,
            format!("{DISCORD_API_BASE}/users/@me/guilds?limit={BOT_GUILD_PAGE_LIMIT}"),
        )))
    }

    fn guild_channels<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildChannel>> {
        Box::pin(async move {
            if !is_snowflake(guild_id) {
                return Err(DiscordApiError::Status(400));
            }
            Self::send_json(self.request(
                reqwest::Method::GET,
                format!("{DISCORD_API_BASE}/guilds/{guild_id}/channels"),
            ))
            .await
        })
    }

    fn guild_roles<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildRole>> {
        Box::pin(async move {
            if !is_snowflake(guild_id) {
                return Err(DiscordApiError::Status(400));
            }
            Self::send_json(self.request(
                reqwest::Method::GET,
                format!("{DISCORD_API_BASE}/guilds/{guild_id}/roles"),
            ))
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
            let url = format!("{DISCORD_API_BASE}/guilds/{guild_id}/members/{user_id}");
            let response = self
                .request(reqwest::Method::GET, url)
                .send()
                .await
                .map_err(|_| DiscordApiError::Transport)?;
            let status = response.status();
            // 404 is the documented "no such member" answer and is the whole
            // point of this call — it is an outcome, not a failure.
            if status.as_u16() == 404 {
                return Ok(None);
            }
            if !status.is_success() {
                return Err(classify(status.as_u16()));
            }
            response
                .json::<GuildMember>()
                .await
                .map(Some)
                .map_err(|_| DiscordApiError::Transport)
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
            let message: IdOnly = Self::send_json(
                self.request(
                    reqwest::Method::POST,
                    format!("{DISCORD_API_BASE}/channels/{channel_id}/messages"),
                )
                .json(payload),
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
            Self::send_empty(
                self.request(
                    reqwest::Method::PATCH,
                    format!("{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}"),
                )
                .json(payload),
            )
            .await
        })
    }

    fn delete_message<'a>(
        &'a self,
        channel_id: &'a str,
        message_id: &'a str,
    ) -> ApiFuture<'a, ()> {
        Box::pin(async move {
            if !is_snowflake(channel_id) || !is_snowflake(message_id) {
                return Err(DiscordApiError::Status(400));
            }
            match Self::send_empty(self.request(
                reqwest::Method::DELETE,
                format!("{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}"),
            ))
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
            let thread: IdOnly = Self::send_json(
                self.request(
                    reqwest::Method::POST,
                    format!(
                        "{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}/threads"
                    ),
                )
                .json(payload),
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
        .fold(0_u64, |acc, role| acc | parse_permissions(&role.permissions))
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
            &[overwrite(GUILD, OVERWRITE_TYPE_ROLE, 0, REQUIRED_POST_PERMISSIONS)],
        );
        assert_eq!(permissions & REQUIRED_POST_PERMISSIONS, REQUIRED_POST_PERMISSIONS);
    }

    #[test]
    fn everyone_overwrite_denies_then_a_role_overwrite_restores() {
        // @everyone loses SEND_MESSAGES in this channel...
        let denied = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[overwrite(GUILD, OVERWRITE_TYPE_ROLE, 0, PERMISSION_SEND_MESSAGES)],
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
        assert_eq!(restored & PERMISSION_SEND_MESSAGES, PERMISSION_SEND_MESSAGES);
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
        assert_eq!(permissions & PERMISSION_SEND_MESSAGES, PERMISSION_SEND_MESSAGES);
    }

    #[test]
    fn overwrites_for_roles_the_bot_does_not_hold_are_ignored() {
        let permissions = compute_channel_permissions(
            REQUIRED_POST_PERMISSIONS,
            GUILD,
            &roles(&[ROLE]),
            BOT,
            &[overwrite(OTHER_ROLE, OVERWRITE_TYPE_ROLE, 0, PERMISSION_SEND_MESSAGES)],
        );
        assert_eq!(permissions & PERMISSION_SEND_MESSAGES, PERMISSION_SEND_MESSAGES);
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
        assert!(bot_can_post(&plain, REQUIRED_POST_PERMISSIONS, GUILD, &roles(&[]), BOT));
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
        assert!(bot_can_post(&channel(5, vec![]), REQUIRED_POST_PERMISSIONS, GUILD, &roles(&[]), BOT));
        for kind in [2_u8, 4, 11, 15] {
            assert!(
                !bot_can_post(&channel(kind, vec![]), REQUIRED_POST_PERMISSIONS, GUILD, &roles(&[]), BOT),
                "channel type {kind} must not be offered"
            );
        }
    }

    #[test]
    fn channel_denied_by_everyone_overwrite_is_not_postable() {
        let locked = channel(
            0,
            vec![overwrite(GUILD, OVERWRITE_TYPE_ROLE, 0, PERMISSION_VIEW_CHANNEL)],
        );
        assert!(!bot_can_post(&locked, REQUIRED_POST_PERMISSIONS, GUILD, &roles(&[]), BOT));
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
            .request(reqwest::Method::GET, format!("{DISCORD_API_BASE}/users/@me"))
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
        assert!(is_terminal_for_thread_creation(DiscordApiError::Status(400)));
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
