//! Which Discord guilds and channels a *specific caller* may post a room to
//! (issue #246).
//!
//! ## The privacy rule this module exists to enforce
//!
//! The bot's guild list is privileged server-side data. Returning it to an
//! authenticated caller would itself be the leak the issue forbids, so it never
//! leaves this module: [`DiscordDirectory::targets_for`] intersects it with the
//! caller's **own** verified memberships and only the intersection is rendered.
//! Membership is proved bot-side (`GET /guilds/{id}/members/{user.id}`), so no
//! extra OAuth scope and no user token are involved, and a caller with no
//! Discord identity resolves to an empty list rather than an error.
//!
//! Two things the enforcement deliberately does **not** do:
//!
//! * It never reads the caller's Discord id out of their token. Supabase's
//!   `user_metadata` is end-user writable (`PUT /auth/v1/user {"data": ...}`),
//!   so a `provider_id` there is an attacker-controlled string, not an identity.
//!   The id comes only from the admin API's `identities` array
//!   ([`AdminIdentityLookup`]); the token's Supabase-controlled `app_metadata`
//!   is consulted only to *skip* that lookup for accounts with no Discord link.
//! * It never offers a channel on the strength of the bot's permissions alone.
//!   A channel is a target only if the **caller** could have posted there
//!   themselves ([`CALLER_REQUIRED_PERMISSIONS`]), or a rank-and-file member
//!   could name a staff-only channel and use the bot as a proxy to write into a
//!   read-only one.
//!
//! Every step fails **closed**: an unreachable Discord, an unparsable
//! permissions bitfield, or a membership lookup that errors all yield "not a
//! target" rather than a guess.

use std::collections::{BTreeSet, HashMap};
use std::hash::Hash;
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, warn};
use tokio::sync::RwLock;

use std::future::Future;
use std::pin::Pin;

use crate::auth::{SupabaseClaims, DISCORD_PROVIDER};
use crate::discord_api::{
    bot_can_post, compute_base_permissions, compute_channel_permissions, is_snowflake,
    parse_permissions, BotGuild, DiscordApi, GuildChannel, GuildRole, PERMISSION_SEND_MESSAGES,
    PERMISSION_VIEW_CHANNEL,
};
use crate::supabase::SupabaseServiceConfig;
use crate::INSTANCE_ID;

/// How long the bot's own guild list is trusted. Short, because a guild admin
/// installing the bot expects it to show up in the share sheet promptly.
pub const BOT_GUILD_TTL: Duration = Duration::from_secs(60);

/// How long a per-user membership answer is trusted. Longer than the guild TTL
/// because it is per-caller and therefore the hot, high-cardinality lookup; five
/// minutes bounds how long a departed member keeps seeing a guild.
pub const MEMBERSHIP_TTL: Duration = Duration::from_secs(300);

/// How long a Supabase user id → Discord user id resolution is trusted. Identity
/// links change rarely, so this mostly exists to keep the admin-API fallback off
/// the request path.
pub const IDENTITY_TTL: Duration = Duration::from_secs(600);

/// Size bound on the per-user membership cache. Well past any plausible
/// concurrent host population, and small enough that the map cannot grow without
/// limit under a hostile stream of distinct callers.
const MEMBERSHIP_CACHE_MAX: usize = 4096;
/// Size bound on the identity cache.
const IDENTITY_CACHE_MAX: usize = 4096;
/// Size bound on the per-guild channel/member caches (one entry per guild the
/// bot is installed in).
const GUILD_CACHE_MAX: usize = 512;

/// What the **caller** must hold in a channel for it to be offered to them.
///
/// Deliberately mirrors "could this person have posted this themselves?".
/// `VIEW_CHANNEL` stops private channels being named; `SEND_MESSAGES` stops the
/// bot being used as a proxy into read-only channels (announcements, rules) that
/// every member can see but only staff may write to.
const CALLER_REQUIRED_PERMISSIONS: u64 = PERMISSION_VIEW_CHANNEL | PERMISSION_SEND_MESSAGES;

/// Connect timeout for the Supabase admin-API fallback.
const ADMIN_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Total request timeout for the Supabase admin-API fallback.
const ADMIN_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// A small TTL + size bounded cache. Deliberately not a general-purpose LRU: the
/// access patterns here are "fetch, reuse for a few seconds, expire", and an
/// unbounded `HashMap` keyed by caller-influenced ids would be a memory leak.
struct TtlCache<K, V> {
    entries: HashMap<K, (Instant, V)>,
    ttl: Duration,
    max_entries: usize,
}

impl<K: Eq + Hash + Clone, V> TtlCache<K, V> {
    fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            ttl,
            max_entries,
        }
    }

    /// The cached value for `key` if it has not aged past the TTL.
    fn get(&self, key: &K, now: Instant) -> Option<&V> {
        self.entries
            .get(key)
            .filter(|(stored_at, _)| now.duration_since(*stored_at) < self.ttl)
            .map(|(_, value)| value)
    }

    /// Store `value`, first dropping expired entries and then, if the cache is
    /// still at capacity, the single oldest entry. Capacity is therefore a hard
    /// ceiling rather than a target.
    fn insert(&mut self, key: K, value: V, now: Instant) {
        let ttl = self.ttl;
        self.entries
            .retain(|_, (stored_at, _)| now.duration_since(*stored_at) < ttl);
        while self.entries.len() >= self.max_entries {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (stored_at, _))| *stored_at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.entries.remove(&oldest);
        }
        self.entries.insert(key, (now, value));
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

/// One channel a caller may post a room advert into.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetChannel {
    pub id: String,
    pub name: String,
}

/// One guild the caller is a verified member of **and** the bot is installed in,
/// with the channels the bot can actually post an embed to. A guild with no
/// postable channel is still returned (with an empty list) so the share sheet can
/// say "Dicesuki cannot post here" instead of silently hiding a server the host
/// knows the bot is in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetGuild {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub channels: Vec<TargetChannel>,
}

/// Render the caller's targets as the `GET /api/discord/targets` body.
///
/// The only place target data becomes a response, so it is also the only place
/// that could leak the raw bot-guild list — kept pure and asserted on in tests.
#[must_use]
pub fn targets_response(guilds: &[TargetGuild]) -> serde_json::Value {
    serde_json::json!({
        "guilds": guilds
            .iter()
            .map(|guild| serde_json::json!({
                "id": guild.id,
                "name": guild.name,
                "icon": guild.icon,
                "channels": guild
                    .channels
                    .iter()
                    .map(|channel| serde_json::json!({
                        "id": channel.id,
                        "name": channel.name,
                    }))
                    .collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>(),
    })
}

/// Extract a Discord user id from a Supabase admin-API user record.
///
/// Shape: `{ "identities": [ { "provider": "discord", "id": "...",
/// "identity_data": { "provider_id": "...", "sub": "..." } } ] }`. Kept pure so
/// the parsing is tested without a Supabase round trip.
#[must_use]
pub fn discord_id_from_admin_user(user: &serde_json::Value) -> Option<String> {
    user.get("identities")?
        .as_array()?
        .iter()
        .find(|identity| {
            identity.get("provider").and_then(serde_json::Value::as_str) == Some(DISCORD_PROVIDER)
        })
        .and_then(|identity| {
            let data = identity.get("identity_data");
            data.and_then(|data| data.get("provider_id"))
                .or_else(|| data.and_then(|data| data.get("sub")))
                .or_else(|| identity.get("id"))
                .and_then(serde_json::Value::as_str)
        })
        .filter(|id| is_snowflake(id))
        .map(str::to_string)
}

/// Whether `value` is safe to interpolate into a Supabase admin-API path.
/// Supabase user ids are UUIDs; anything else is rejected before it can reshape
/// a URL.
fn is_supabase_user_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Boxed future returned by [`IdentityLookup`] (used behind `dyn`).
pub type IdentityFuture<'a> = Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>>;

/// Resolves a Supabase user id to the Discord user id **actually linked** to
/// that account.
///
/// This is the *only* sanctioned source of a caller's Discord identity. It is a
/// trait so the P0 regression — a token whose user-writable metadata claims
/// someone else's snowflake — can be tested against a fake that returns the real
/// answer.
pub trait IdentityLookup: Send + Sync {
    fn discord_user_id<'a>(&'a self, supabase_user_id: &'a str) -> IdentityFuture<'a>;
}

/// The Supabase Auth **admin** API (`GET /auth/v1/admin/users/{id}`), whose
/// `identities` array is written by Supabase on OAuth link and is not reachable
/// by the end user. Requires the server's privileged Supabase credential; with
/// no credential configured there is no trustworthy identity source, so target
/// resolution yields nothing rather than trusting the token.
struct AdminIdentityLookup {
    config: SupabaseServiceConfig,
    client: reqwest::Client,
}

impl AdminIdentityLookup {
    fn new(config: SupabaseServiceConfig) -> Self {
        let client = config.http_client(ADMIN_CONNECT_TIMEOUT, ADMIN_REQUEST_TIMEOUT);
        Self { config, client }
    }
}

impl IdentityLookup for AdminIdentityLookup {
    fn discord_user_id<'a>(&'a self, supabase_user_id: &'a str) -> IdentityFuture<'a> {
        Box::pin(async move {
            if !is_supabase_user_id(supabase_user_id) {
                return None;
            }
            let url = self.config.auth_admin_user_url(supabase_user_id);
            let response = self
                .config
                .apply_auth(self.client.get(url))
                .send()
                .await
                .ok()?;
            if !response.status().is_success() {
                debug!(
                    "[{}] Supabase admin identity lookup returned {}",
                    *INSTANCE_ID,
                    response.status()
                );
                return None;
            }
            discord_id_from_admin_user(&response.json::<serde_json::Value>().await.ok()?)
        })
    }
}

/// Membership cache key: `(discord_user_id, guild_id)`.
type MembershipKey = (String, String);

/// A member's role ids in one guild, or `None` when they are not a member.
type MemberRoles = Option<Arc<BTreeSet<String>>>;

/// Resolves callers to Discord identities and Discord identities to the guilds
/// and channels they may post into. Shared process-wide behind an `Arc`.
pub struct DiscordDirectory {
    api: Arc<dyn DiscordApi>,
    identity: Option<Arc<dyn IdentityLookup>>,
    /// The bot's own user id, resolved once (it never changes for a token).
    bot_user_id: RwLock<Option<String>>,
    bot_guilds: RwLock<TtlCache<(), Arc<Vec<BotGuild>>>>,
    guild_channels: RwLock<TtlCache<String, Arc<Vec<GuildChannel>>>>,
    guild_roles: RwLock<TtlCache<String, Arc<Vec<GuildRole>>>>,
    bot_members: RwLock<TtlCache<String, Arc<BTreeSet<String>>>>,
    /// Roles are retained (not just a boolean) because the caller's own channel
    /// visibility is computed from them.
    membership: RwLock<TtlCache<MembershipKey, MemberRoles>>,
    /// `supabase_user_id -> discord_user_id`, `None` for "no Discord identity".
    identities: RwLock<TtlCache<String, Option<String>>>,
}

impl DiscordDirectory {
    /// Build a directory over `api`, resolving identities through the Supabase
    /// admin API when a privileged credential is configured.
    #[must_use]
    pub fn new(api: Arc<dyn DiscordApi>, supabase: Option<SupabaseServiceConfig>) -> Self {
        let identity = supabase.map(|config| {
            Arc::new(AdminIdentityLookup::new(config)) as Arc<dyn IdentityLookup>
        });
        Self::with_identity_lookup(api, identity)
    }

    /// Construct with an explicit identity source (used by `new` and tests).
    #[must_use]
    pub fn with_identity_lookup(
        api: Arc<dyn DiscordApi>,
        identity: Option<Arc<dyn IdentityLookup>>,
    ) -> Self {
        Self {
            api,
            identity,
            bot_user_id: RwLock::new(None),
            bot_guilds: RwLock::new(TtlCache::new(BOT_GUILD_TTL, 2)),
            guild_channels: RwLock::new(TtlCache::new(BOT_GUILD_TTL, GUILD_CACHE_MAX)),
            guild_roles: RwLock::new(TtlCache::new(BOT_GUILD_TTL, GUILD_CACHE_MAX)),
            bot_members: RwLock::new(TtlCache::new(BOT_GUILD_TTL, GUILD_CACHE_MAX)),
            membership: RwLock::new(TtlCache::new(MEMBERSHIP_TTL, MEMBERSHIP_CACHE_MAX)),
            identities: RwLock::new(TtlCache::new(IDENTITY_TTL, IDENTITY_CACHE_MAX)),
        }
    }

    /// The caller's Discord user id, from the **admin API only**.
    ///
    /// The access token deliberately contributes nothing but a negative filter:
    /// its `user_metadata` is end-user writable, so a `provider_id` there is an
    /// attacker-supplied string. `has_discord_provider()` reads the
    /// Supabase-controlled `app_metadata` and, when false, saves a lookup for
    /// guests and email-only accounts (which also bounds how much outbound
    /// admin-API traffic an anonymous caller can provoke).
    ///
    /// `None` means "this account has no provable Discord identity" — a normal,
    /// non-error outcome that yields no targets. It is also what a server with
    /// no privileged Supabase credential always returns: without one there is no
    /// trustworthy source, and guessing is exactly the bug this avoids.
    pub async fn resolve_discord_user_id(&self, claims: &SupabaseClaims) -> Option<String> {
        if !claims.has_discord_provider() {
            return None;
        }
        let now = Instant::now();
        if let Some(cached) = self.identities.read().await.get(&claims.sub, now) {
            return cached.clone();
        }
        let Some(identity) = self.identity.as_ref() else {
            warn!(
                "[{}] Discord targets need a privileged Supabase credential to resolve identities; set SUPABASE_SECRET_KEY",
                *INSTANCE_ID
            );
            return None;
        };
        let resolved = identity.discord_user_id(&claims.sub).await;
        self.identities
            .write()
            .await
            .insert(claims.sub.clone(), resolved.clone(), Instant::now());
        resolved
    }

    /// Every guild the caller may post to, with its postable channels. Empty for
    /// a caller with no Discord identity, for a caller who shares no guild with
    /// the bot, and whenever Discord cannot be reached.
    pub async fn targets_for(&self, discord_user_id: &str) -> Vec<TargetGuild> {
        if !is_snowflake(discord_user_id) {
            return Vec::new();
        }
        let Some(bot_user_id) = self.bot_user_id().await else {
            return Vec::new();
        };
        let Some(guilds) = self.bot_guild_list().await else {
            return Vec::new();
        };

        let mut targets = Vec::new();
        for guild in guilds.iter() {
            if !is_snowflake(&guild.id) {
                continue;
            }
            // Membership is the gate *and* the source of the caller's roles.
            let Some(member_roles) = self.member_roles(discord_user_id, &guild.id).await else {
                continue;
            };
            targets.push(TargetGuild {
                id: guild.id.clone(),
                name: guild.name.clone(),
                icon: guild.icon.clone(),
                channels: self
                    .shared_postable_channels(guild, &bot_user_id, discord_user_id, &member_roles)
                    .await,
            });
        }
        // Stable order so the share sheet does not reshuffle between requests.
        targets.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        targets
    }

    /// The channel ids the caller is allowed to advertise into, recomputed from
    /// this server's own caches. `POST /api/rooms/:id/advertise` re-checks its
    /// `channelId` against this set — the client's claim about which guild a
    /// channel belongs to is never trusted.
    pub async fn verified_channel_ids(&self, discord_user_id: &str) -> BTreeSet<String> {
        self.targets_for(discord_user_id)
            .await
            .into_iter()
            .flat_map(|guild| guild.channels.into_iter().map(|channel| channel.id))
            .collect()
    }

    /// The bot's own user id, needed to evaluate member-specific channel
    /// overwrites. Resolved once and kept for the process lifetime.
    async fn bot_user_id(&self) -> Option<String> {
        if let Some(cached) = self.bot_user_id.read().await.clone() {
            return Some(cached);
        }
        match self.api.current_user_id().await {
            Ok(id) => {
                *self.bot_user_id.write().await = Some(id.clone());
                Some(id)
            }
            Err(error) => {
                warn!("[{}] Discord bot identity lookup failed: {error}", *INSTANCE_ID);
                None
            }
        }
    }

    /// The bot's installed guilds. **Never returned to a client.**
    async fn bot_guild_list(&self) -> Option<Arc<Vec<BotGuild>>> {
        let now = Instant::now();
        if let Some(cached) = self.bot_guilds.read().await.get(&(), now) {
            return Some(cached.clone());
        }
        match self.api.bot_guilds().await {
            Ok(guilds) => {
                let guilds = Arc::new(guilds);
                // Count only — the ids and names are privileged.
                debug!(
                    "[{}] Refreshed Discord bot guild list ({} guilds)",
                    *INSTANCE_ID,
                    guilds.len()
                );
                self.bot_guilds
                    .write()
                    .await
                    .insert((), guilds.clone(), Instant::now());
                Some(guilds)
            }
            Err(error) => {
                warn!("[{}] Discord bot guild list failed: {error}", *INSTANCE_ID);
                None
            }
        }
    }

    /// The caller's role ids in `guild_id`, or `None` when they are not a member.
    ///
    /// A transport/permission failure is **not** cached and reads as "not a
    /// member", so an outage can only ever hide a guild, never reveal one.
    async fn member_roles(&self, discord_user_id: &str, guild_id: &str) -> MemberRoles {
        let key = (discord_user_id.to_string(), guild_id.to_string());
        let now = Instant::now();
        if let Some(cached) = self.membership.read().await.get(&key, now) {
            return cached.clone();
        }
        match self.api.guild_member(guild_id, discord_user_id).await {
            Ok(member) => {
                let roles =
                    member.map(|member| Arc::new(member.roles.into_iter().collect::<BTreeSet<_>>()));
                self.membership
                    .write()
                    .await
                    .insert(key, roles.clone(), Instant::now());
                roles
            }
            Err(error) => {
                warn!(
                    "[{}] Discord membership check failed for a guild: {error}",
                    *INSTANCE_ID
                );
                None
            }
        }
    }

    /// The channels of `guild` that **both** the bot can post an advert embed
    /// into and the caller could have posted in themselves.
    ///
    /// The caller's own permissions are the difference between a share sheet and
    /// a privilege escalation. The bot frequently holds ADMINISTRATOR, so
    /// filtering on its permissions alone would name every private channel to
    /// every member. `VIEW_CHANNEL` alone is not enough either: an
    /// announcements-style channel is readable by everyone but writable by
    /// staff, and offering it would let any member use the bot as a proxy to
    /// post where they cannot. The bar is therefore "the caller can see **and**
    /// send here", i.e. the advert is something they could have written.
    async fn shared_postable_channels(
        &self,
        guild: &BotGuild,
        bot_user_id: &str,
        discord_user_id: &str,
        member_roles: &BTreeSet<String>,
    ) -> Vec<TargetChannel> {
        // The partial guild's `permissions` is already the union of @everyone
        // and the bot's roles, i.e. Discord's `computeBasePermissions`. Absent
        // (an unexpected response shape) means no base permissions and therefore
        // no offered channels — fail closed.
        let bot_base = guild.permissions.as_deref().map_or(0, parse_permissions);
        let Some(channels) = self.channels_of(&guild.id).await else {
            return Vec::new();
        };
        // Fail closed: without the bot's roles its role-scoped *denies* would be
        // skipped, making postability read more permissive than it is.
        let Some(bot_roles) = self.bot_roles_in(&guild.id).await else {
            return Vec::new();
        };
        // Likewise for the caller's base permissions.
        let Some(roles) = self.roles_of(&guild.id).await else {
            return Vec::new();
        };
        let caller_base = compute_base_permissions(&guild.id, &roles, member_roles);

        let mut postable: Vec<(i64, TargetChannel)> = channels
            .iter()
            .filter(|channel| bot_can_post(channel, bot_base, &guild.id, &bot_roles, bot_user_id))
            .filter(|channel| {
                let caller = compute_channel_permissions(
                    caller_base,
                    &guild.id,
                    member_roles,
                    discord_user_id,
                    &channel.permission_overwrites,
                );
                caller & CALLER_REQUIRED_PERMISSIONS == CALLER_REQUIRED_PERMISSIONS
            })
            .map(|channel| {
                (
                    channel.position.unwrap_or(i64::MAX),
                    TargetChannel {
                        id: channel.id.clone(),
                        name: channel.name.clone().unwrap_or_else(|| "channel".to_string()),
                    },
                )
            })
            .collect();
        // Discord's own sidebar order, with the id as a deterministic tiebreak.
        postable.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
        postable.into_iter().map(|(_, channel)| channel).collect()
    }

    /// The guild's role definitions, needed to compute a caller's base
    /// permissions.
    async fn roles_of(&self, guild_id: &str) -> Option<Arc<Vec<GuildRole>>> {
        let now = Instant::now();
        if let Some(cached) = self.guild_roles.read().await.get(&guild_id.to_string(), now) {
            return Some(cached.clone());
        }
        match self.api.guild_roles(guild_id).await {
            Ok(roles) => {
                let roles = Arc::new(roles);
                self.guild_roles.write().await.insert(
                    guild_id.to_string(),
                    roles.clone(),
                    Instant::now(),
                );
                Some(roles)
            }
            Err(error) => {
                warn!("[{}] Discord role list failed: {error}", *INSTANCE_ID);
                None
            }
        }
    }

    async fn channels_of(&self, guild_id: &str) -> Option<Arc<Vec<GuildChannel>>> {
        let now = Instant::now();
        if let Some(cached) = self.guild_channels.read().await.get(&guild_id.to_string(), now) {
            return Some(cached.clone());
        }
        match self.api.guild_channels(guild_id).await {
            Ok(channels) => {
                let channels = Arc::new(channels);
                self.guild_channels.write().await.insert(
                    guild_id.to_string(),
                    channels.clone(),
                    Instant::now(),
                );
                Some(channels)
            }
            Err(error) => {
                warn!("[{}] Discord channel list failed: {error}", *INSTANCE_ID);
                None
            }
        }
    }

    /// The bot's own role ids in a guild, which decide which channel
    /// role-overwrites apply to it. `None` on any failure, and callers must
    /// treat that as "offer nothing" rather than "no roles".
    async fn bot_roles_in(&self, guild_id: &str) -> Option<Arc<BTreeSet<String>>> {
        let now = Instant::now();
        if let Some(cached) = self.bot_members.read().await.get(&guild_id.to_string(), now) {
            return Some(cached.clone());
        }
        let bot_user_id = self.bot_user_id().await?;
        let member = self
            .api
            .guild_member(guild_id, &bot_user_id)
            .await
            .ok()
            .flatten()?;
        let roles = Arc::new(member.roles.into_iter().collect::<BTreeSet<_>>());
        self.bot_members.write().await.insert(
            guild_id.to_string(),
            roles.clone(),
            Instant::now(),
        );
        Some(roles)
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::discord_api::{ApiFuture, DiscordApiError};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    /// A scripted [`DiscordApi`] standing in for Discord's REST surface, in the
    /// style of `roll_reporting`'s `ScriptedTransport`: no network, fully
    /// deterministic, and able to fail on demand.
    pub struct FakeDiscord {
        pub bot_user_id: String,
        pub guilds: Vec<BotGuild>,
        /// `guild_id -> channels`.
        pub channels: HashMap<String, Vec<GuildChannel>>,
        /// `guild_id -> roles defined in that guild`.
        pub roles: HashMap<String, Vec<GuildRole>>,
        /// `guild_id -> member user ids present in that guild`.
        pub members: HashMap<String, BTreeSet<String>>,
        /// `(guild_id, user_id) -> that member's role ids`.
        pub member_roles: HashMap<(String, String), Vec<String>>,
        /// When set, every call fails with this error.
        pub failure: Option<DiscordApiError>,
        pub guild_list_calls: AtomicUsize,
        pub member_calls: AtomicUsize,
        pub created: Mutex<Vec<(String, serde_json::Value)>>,
        pub edited: Mutex<Vec<(String, String, serde_json::Value)>>,
        pub deleted: Mutex<Vec<(String, String)>>,
        /// `(channel_id, message_id, payload)` per **Start Thread from Message**
        /// call (#255).
        pub threads_started: Mutex<Vec<(String, String, serde_json::Value)>>,
        /// When set, only `create_thread_from_message` fails with this error —
        /// the shape of a guild that grants posting but not thread creation.
        pub thread_failure: Option<DiscordApiError>,
        /// When set, `create_message` fails with this error but *only* for a
        /// channel id this fake handed out as a thread — the shape of a bot
        /// holding CREATE_PUBLIC_THREADS but not SEND_MESSAGES_IN_THREADS.
        pub thread_message_failure: Option<DiscordApiError>,
        /// Thread ids this fake has issued, so `create_message` can tell a
        /// thread post from a channel post.
        pub issued_thread_ids: Mutex<BTreeSet<String>>,
        /// When set, only `edit_message` fails — a Discord that accepts posts
        /// but cannot complete the anchor's archive PATCH.
        pub edit_failure: Option<DiscordApiError>,
    }

    impl FakeDiscord {
        pub fn new(bot_user_id: &str) -> Self {
            Self {
                bot_user_id: bot_user_id.to_string(),
                guilds: Vec::new(),
                channels: HashMap::new(),
                roles: HashMap::new(),
                members: HashMap::new(),
                member_roles: HashMap::new(),
                failure: None,
                guild_list_calls: AtomicUsize::new(0),
                member_calls: AtomicUsize::new(0),
                created: Mutex::new(Vec::new()),
                edited: Mutex::new(Vec::new()),
                deleted: Mutex::new(Vec::new()),
                threads_started: Mutex::new(Vec::new()),
                thread_failure: None,
                thread_message_failure: None,
                issued_thread_ids: Mutex::new(BTreeSet::new()),
                edit_failure: None,
            }
        }

        /// Messages this fake received on a channel it issued as a thread id.
        pub fn thread_messages(&self) -> Vec<(String, serde_json::Value)> {
            let threads = self.issued_thread_ids.lock().expect("fake lock");
            self.created
                .lock()
                .expect("fake lock")
                .iter()
                .filter(|(channel_id, _)| threads.contains(channel_id))
                .cloned()
                .collect()
        }

        /// Install a guild with `permissions` granting everything needed, one
        /// plain text channel `channel_id` everyone can see, and the given human
        /// members.
        pub fn with_guild(
            mut self,
            guild_id: &str,
            name: &str,
            channel_id: &str,
            members: &[&str],
        ) -> Self {
            self.guilds.push(BotGuild {
                id: guild_id.to_string(),
                name: name.to_string(),
                icon: None,
                permissions: Some(crate::discord_api::REQUIRED_POST_PERMISSIONS.to_string()),
            });
            self.channels.insert(
                guild_id.to_string(),
                vec![GuildChannel {
                    id: channel_id.to_string(),
                    name: Some(format!("{name}-general")),
                    kind: 0,
                    position: Some(0),
                    permission_overwrites: Vec::new(),
                }],
            );
            // @everyone can see and talk in the default channel — the realistic
            // baseline for an ordinary member.
            self.roles.insert(
                guild_id.to_string(),
                vec![GuildRole {
                    id: guild_id.to_string(),
                    permissions: (crate::discord_api::PERMISSION_VIEW_CHANNEL
                        | crate::discord_api::PERMISSION_SEND_MESSAGES)
                        .to_string(),
                }],
            );
            let mut present: BTreeSet<String> =
                members.iter().map(|id| (*id).to_string()).collect();
            // The bot is a member of every guild it is installed in.
            present.insert(self.bot_user_id.clone());
            self.members.insert(guild_id.to_string(), present);
            self
        }

        /// Add a channel to an existing guild.
        pub fn with_channel(mut self, guild_id: &str, channel: GuildChannel) -> Self {
            self.channels.entry(guild_id.to_string()).or_default().push(channel);
            self
        }
    }

    /// A scripted [`IdentityLookup`]: `supabase_user_id -> discord_user_id`.
    /// Standing in for the Supabase admin API's `identities` array, which is the
    /// only authoritative source of a caller's Discord id.
    pub struct FakeIdentities(pub HashMap<String, String>);

    impl FakeIdentities {
        pub fn of(pairs: &[(&str, &str)]) -> Arc<Self> {
            Arc::new(Self(
                pairs
                    .iter()
                    .map(|(supabase, discord)| ((*supabase).to_string(), (*discord).to_string()))
                    .collect(),
            ))
        }
    }

    impl IdentityLookup for FakeIdentities {
        fn discord_user_id<'a>(&'a self, supabase_user_id: &'a str) -> IdentityFuture<'a> {
            Box::pin(async move { self.0.get(supabase_user_id).cloned() })
        }
    }

    impl DiscordApi for FakeDiscord {
        fn current_user_id(&self) -> ApiFuture<'_, String> {
            Box::pin(async move {
                self.failure
                    .map_or_else(|| Ok(self.bot_user_id.clone()), Err)
            })
        }

        fn bot_guilds(&self) -> ApiFuture<'_, Vec<BotGuild>> {
            Box::pin(async move {
                self.guild_list_calls.fetch_add(1, Ordering::AcqRel);
                self.failure.map_or_else(|| Ok(self.guilds.clone()), Err)
            })
        }

        fn guild_channels<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildChannel>> {
            Box::pin(async move {
                self.failure.map_or_else(
                    || Ok(self.channels.get(guild_id).cloned().unwrap_or_default()),
                    Err,
                )
            })
        }

        fn guild_roles<'a>(&'a self, guild_id: &'a str) -> ApiFuture<'a, Vec<GuildRole>> {
            Box::pin(async move {
                self.failure.map_or_else(
                    || Ok(self.roles.get(guild_id).cloned().unwrap_or_default()),
                    Err,
                )
            })
        }

        fn guild_member<'a>(
            &'a self,
            guild_id: &'a str,
            user_id: &'a str,
        ) -> ApiFuture<'a, Option<crate::discord_api::GuildMember>> {
            Box::pin(async move {
                self.member_calls.fetch_add(1, Ordering::AcqRel);
                if let Some(failure) = self.failure {
                    return Err(failure);
                }
                let present = self
                    .members
                    .get(guild_id)
                    .is_some_and(|members| members.contains(user_id));
                Ok(present.then(|| crate::discord_api::GuildMember {
                    roles: self
                        .member_roles
                        .get(&(guild_id.to_string(), user_id.to_string()))
                        .cloned()
                        .unwrap_or_default(),
                }))
            })
        }

        fn create_message<'a>(
            &'a self,
            channel_id: &'a str,
            payload: &'a serde_json::Value,
        ) -> ApiFuture<'a, String> {
            Box::pin(async move {
                if let Some(failure) = self.failure {
                    return Err(failure);
                }
                let is_thread = self
                    .issued_thread_ids
                    .lock()
                    .expect("fake lock")
                    .contains(channel_id);
                if is_thread {
                    if let Some(failure) = self.thread_message_failure {
                        return Err(failure);
                    }
                }
                let mut created = self.created.lock().expect("fake lock");
                created.push((channel_id.to_string(), payload.clone()));
                Ok(format!("9{:017}", created.len()))
            })
        }

        fn edit_message<'a>(
            &'a self,
            channel_id: &'a str,
            message_id: &'a str,
            payload: &'a serde_json::Value,
        ) -> ApiFuture<'a, ()> {
            Box::pin(async move {
                if let Some(failure) = self.failure.or(self.edit_failure) {
                    return Err(failure);
                }
                self.edited.lock().expect("fake lock").push((
                    channel_id.to_string(),
                    message_id.to_string(),
                    payload.clone(),
                ));
                Ok(())
            })
        }

        fn delete_message<'a>(
            &'a self,
            channel_id: &'a str,
            message_id: &'a str,
        ) -> ApiFuture<'a, ()> {
            Box::pin(async move {
                if let Some(failure) = self.failure {
                    return Err(failure);
                }
                self.deleted
                    .lock()
                    .expect("fake lock")
                    .push((channel_id.to_string(), message_id.to_string()));
                Ok(())
            })
        }

        fn create_thread_from_message<'a>(
            &'a self,
            channel_id: &'a str,
            message_id: &'a str,
            payload: &'a serde_json::Value,
        ) -> ApiFuture<'a, String> {
            Box::pin(async move {
                if let Some(failure) = self.failure.or(self.thread_failure) {
                    return Err(failure);
                }
                let mut started = self.threads_started.lock().expect("fake lock");
                started.push((
                    channel_id.to_string(),
                    message_id.to_string(),
                    payload.clone(),
                ));
                // Discord makes the thread id equal the source message id; the
                // fake keeps that invariant so nothing can accidentally depend
                // on them differing.
                let thread_id = message_id.to_string();
                self.issued_thread_ids
                    .lock()
                    .expect("fake lock")
                    .insert(thread_id.clone());
                Ok(thread_id)
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{FakeDiscord, FakeIdentities};
    use super::*;
    use crate::discord_api::{DiscordApiError, PermissionOverwrite, PERMISSION_SEND_MESSAGES};

    const GUILD_X: &str = "100000000000000001";
    const GUILD_Y: &str = "100000000000000002";
    const CHANNEL_X: &str = "200000000000000001";
    const CHANNEL_Y: &str = "200000000000000002";
    const USER_A: &str = "300000000000000001";
    const USER_B: &str = "300000000000000002";
    const BOT: &str = "400000000000000001";

    /// Guild X holds user A, guild Y holds user B; the bot is in both.
    fn two_tenant_directory() -> (Arc<FakeDiscord>, DiscordDirectory) {
        let api = Arc::new(
            FakeDiscord::new(BOT)
                .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A])
                .with_guild(GUILD_Y, "Yonder", CHANNEL_Y, &[USER_B]),
        );
        let directory = DiscordDirectory::new(api.clone(), None);
        (api, directory)
    }

    fn claims(value: serde_json::Value) -> SupabaseClaims {
        serde_json::from_value(value).expect("claims parse")
    }

    #[tokio::test]
    async fn each_caller_sees_only_their_own_guild_and_never_the_others() {
        let (_api, directory) = two_tenant_directory();

        let for_a = directory.targets_for(USER_A).await;
        assert_eq!(for_a.len(), 1);
        assert_eq!(for_a[0].id, GUILD_X);
        assert_eq!(for_a[0].channels.len(), 1);
        assert_eq!(for_a[0].channels[0].id, CHANNEL_X);

        let for_b = directory.targets_for(USER_B).await;
        assert_eq!(for_b.len(), 1);
        assert_eq!(for_b[0].id, GUILD_Y);

        // The rendered responses must not mention the other tenant *anywhere* —
        // not the guild id, not its name, not its channel id.
        let body_a = targets_response(&for_a).to_string();
        for leaked in [GUILD_Y, CHANNEL_Y, "Yonder"] {
            assert!(!body_a.contains(leaked), "response A leaked {leaked}");
        }
        let body_b = targets_response(&for_b).to_string();
        for leaked in [GUILD_X, CHANNEL_X, "Xanadu"] {
            assert!(!body_b.contains(leaked), "response B leaked {leaked}");
        }
    }

    #[tokio::test]
    async fn a_caller_in_no_bot_guild_gets_nothing() {
        let (_api, directory) = two_tenant_directory();
        let stranger = "300000000000000009";
        assert!(directory.targets_for(stranger).await.is_empty());
        assert!(targets_response(&[]).to_string().contains("\"guilds\":[]"));
    }

    #[tokio::test]
    async fn a_caller_in_both_guilds_sees_both_in_a_stable_order() {
        let api = Arc::new(
            FakeDiscord::new(BOT)
                .with_guild(GUILD_Y, "Yonder", CHANNEL_Y, &[USER_A])
                .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A]),
        );
        let directory = DiscordDirectory::new(api, None);
        let names: Vec<String> = directory
            .targets_for(USER_A)
            .await
            .into_iter()
            .map(|guild| guild.name)
            .collect();
        assert_eq!(names, ["Xanadu", "Yonder"], "guilds are sorted by name");
    }

    #[tokio::test]
    async fn verified_channel_ids_are_scoped_to_the_caller() {
        let (_api, directory) = two_tenant_directory();
        let for_a = directory.verified_channel_ids(USER_A).await;
        assert!(for_a.contains(CHANNEL_X));
        assert!(
            !for_a.contains(CHANNEL_Y),
            "a channel in someone else's guild is never verified"
        );
    }

    #[tokio::test]
    async fn unreachable_discord_yields_no_targets_rather_than_a_guess() {
        let mut fake = FakeDiscord::new(BOT).with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A]);
        fake.failure = Some(DiscordApiError::Transport);
        let directory = DiscordDirectory::new(Arc::new(fake), None);
        assert!(directory.targets_for(USER_A).await.is_empty());
    }

    #[tokio::test]
    async fn a_membership_failure_is_not_cached_as_a_positive() {
        // Membership answers false on error, and because the failure is not
        // cached the next attempt re-asks Discord.
        let mut fake = FakeDiscord::new(BOT).with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A]);
        fake.failure = Some(DiscordApiError::Status(500));
        let api = Arc::new(fake);
        let directory = DiscordDirectory::new(api.clone(), None);
        assert!(directory.targets_for(USER_A).await.is_empty());
        assert!(directory.targets_for(USER_A).await.is_empty());
    }

    #[tokio::test]
    async fn a_malformed_discord_id_never_reaches_discord() {
        let (api, directory) = two_tenant_directory();
        assert!(directory.targets_for("../../users/@me").await.is_empty());
        assert_eq!(
            api.member_calls.load(std::sync::atomic::Ordering::Acquire),
            0
        );
    }

    #[tokio::test]
    async fn repeat_lookups_reuse_the_cached_bot_guild_list() {
        let (api, directory) = two_tenant_directory();
        directory.targets_for(USER_A).await;
        directory.targets_for(USER_B).await;
        assert_eq!(
            api.guild_list_calls.load(std::sync::atomic::Ordering::Acquire),
            1,
            "the bot guild list is fetched once per TTL, not per caller"
        );
    }

    #[tokio::test]
    async fn channels_the_bot_cannot_post_in_are_not_offered() {
        let mut fake = FakeDiscord::new(BOT).with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A]);
        fake.channels.get_mut(GUILD_X).expect("guild exists")[0]
            .permission_overwrites
            .push(PermissionOverwrite {
                id: GUILD_X.to_string(),
                kind: 0,
                allow: "0".to_string(),
                deny: PERMISSION_SEND_MESSAGES.to_string(),
            });
        let directory = DiscordDirectory::new(Arc::new(fake), None);
        let targets = directory.targets_for(USER_A).await;
        assert_eq!(targets.len(), 1, "the guild is still listed");
        assert!(targets[0].channels.is_empty(), "but has no usable channel");
    }

    /// The same two tenants, plus an authoritative identity source.
    fn two_tenant_directory_with_identities(
        pairs: &[(&str, &str)],
    ) -> (Arc<FakeDiscord>, DiscordDirectory) {
        let api = Arc::new(
            FakeDiscord::new(BOT)
                .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A])
                .with_guild(GUILD_Y, "Yonder", CHANNEL_Y, &[USER_B]),
        );
        let directory = DiscordDirectory::with_identity_lookup(
            api.clone(),
            Some(FakeIdentities::of(pairs)),
        );
        (api, directory)
    }

    #[tokio::test]
    async fn identity_comes_from_the_admin_record_not_the_token() {
        let (_api, directory) = two_tenant_directory_with_identities(&[("supabase-a", USER_A)]);
        let resolved = directory
            .resolve_discord_user_id(&claims(serde_json::json!({
                "sub": "supabase-a",
                "app_metadata": { "provider": "discord" },
            })))
            .await;
        assert_eq!(resolved.as_deref(), Some(USER_A));
    }

    /// The #246 privacy requirement's sharpest edge. Supabase's `user_metadata`
    /// is end-user writable (`PUT /auth/v1/user {"data": {...}}`), so a token
    /// can *claim* any Discord snowflake. Only the admin `identities` record
    /// decides, and it must win.
    #[tokio::test]
    async fn a_token_claiming_someone_elses_discord_id_gets_its_own_targets_only() {
        // The attacker really did sign in with Discord (so app_metadata is
        // honest), but stuffed the victim's snowflake into user_metadata.
        let (_api, directory) = two_tenant_directory_with_identities(&[
            ("supabase-attacker", USER_B),
            ("supabase-victim", USER_A),
        ]);
        let spoofed = claims(serde_json::json!({
            "sub": "supabase-attacker",
            "app_metadata": { "provider": "discord", "providers": ["discord"] },
            "user_metadata": { "provider_id": USER_A, "sub": USER_A },
        }));

        let resolved = directory.resolve_discord_user_id(&spoofed).await;
        assert_eq!(
            resolved.as_deref(),
            Some(USER_B),
            "the admin record decides, never the token's user_metadata"
        );

        // ...and the targets that follow are the attacker's own guild only.
        let targets = directory.targets_for(&resolved.unwrap()).await;
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].id, GUILD_Y);
        let body = targets_response(&targets).to_string();
        for leaked in [GUILD_X, CHANNEL_X, "Xanadu"] {
            assert!(!body.contains(leaked), "spoofed token leaked {leaked}");
        }
    }

    #[tokio::test]
    async fn identity_is_none_for_accounts_with_no_discord_provider() {
        let (_api, directory) = two_tenant_directory_with_identities(&[("supabase-a", USER_A)]);
        // Guest/email-only: app_metadata is Supabase-controlled, so this is a
        // trustworthy "don't bother looking".
        assert!(directory
            .resolve_discord_user_id(&claims(serde_json::json!({ "sub": "supabase-guest" })))
            .await
            .is_none());
        // Signed in with Discord but with no linked identity on record.
        assert!(directory
            .resolve_discord_user_id(&claims(serde_json::json!({
                "sub": "supabase-unknown",
                "app_metadata": { "provider": "discord" },
            })))
            .await
            .is_none());
    }

    #[tokio::test]
    async fn without_a_privileged_credential_no_identity_can_be_proven() {
        // No identity lookup configured: the token cannot stand in for one, so
        // even an honest Discord sign-in resolves to nothing.
        let (_api, directory) = two_tenant_directory();
        assert!(directory
            .resolve_discord_user_id(&claims(serde_json::json!({
                "sub": "supabase-a",
                "app_metadata": { "provider": "discord" },
                "user_metadata": { "provider_id": USER_A },
            })))
            .await
            .is_none());
    }

    // --- caller-side channel visibility ------------------------------------

    fn private_channel(id: &str, guild_id: &str, allowed_role: &str) -> GuildChannel {
        GuildChannel {
            id: id.to_string(),
            name: Some("mod-private".to_string()),
            kind: 0,
            position: Some(1),
            permission_overwrites: vec![
                // Hidden from @everyone...
                PermissionOverwrite {
                    id: guild_id.to_string(),
                    kind: 0,
                    allow: "0".to_string(),
                    deny: PERMISSION_VIEW_CHANNEL.to_string(),
                },
                // ...but visible to one privileged role.
                PermissionOverwrite {
                    id: allowed_role.to_string(),
                    kind: 0,
                    allow: PERMISSION_VIEW_CHANNEL.to_string(),
                    deny: "0".to_string(),
                },
            ],
        }
    }

    #[tokio::test]
    async fn a_channel_the_caller_cannot_see_is_never_offered_even_when_the_bot_can_post() {
        const MOD_ROLE: &str = "500000000000000001";
        const PRIVATE: &str = "200000000000000009";

        // The bot is an administrator, so it can post anywhere. USER_A is an
        // ordinary member with no roles.
        let mut fake = FakeDiscord::new(BOT)
            .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A])
            .with_channel(GUILD_X, private_channel(PRIVATE, GUILD_X, MOD_ROLE));
        fake.guilds[0].permissions =
            Some(crate::discord_api::PERMISSION_ADMINISTRATOR.to_string());
        let api = Arc::new(fake);
        let directory = DiscordDirectory::new(api.clone(), None);

        let targets = directory.targets_for(USER_A).await;
        let channels: Vec<&str> = targets[0]
            .channels
            .iter()
            .map(|channel| channel.id.as_str())
            .collect();
        assert_eq!(
            channels,
            [CHANNEL_X],
            "the staff channel must not be named to an ordinary member"
        );
        assert!(!directory.verified_channel_ids(USER_A).await.contains(PRIVATE));
        assert!(!targets_response(&targets).to_string().contains("mod-private"));
    }

    #[tokio::test]
    async fn a_caller_holding_the_privileged_role_does_see_the_private_channel() {
        const MOD_ROLE: &str = "500000000000000001";
        const PRIVATE: &str = "200000000000000009";

        let mut fake = FakeDiscord::new(BOT)
            .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A])
            .with_channel(GUILD_X, private_channel(PRIVATE, GUILD_X, MOD_ROLE));
        fake.guilds[0].permissions =
            Some(crate::discord_api::PERMISSION_ADMINISTRATOR.to_string());
        fake.member_roles.insert(
            (GUILD_X.to_string(), USER_A.to_string()),
            vec![MOD_ROLE.to_string()],
        );
        let directory = DiscordDirectory::new(Arc::new(fake), None);

        assert!(directory.verified_channel_ids(USER_A).await.contains(PRIVATE));
    }

    #[tokio::test]
    async fn a_read_only_channel_is_not_offered_even_though_the_caller_can_see_it() {
        // #announcements: everyone can read, only staff can post. The bot is an
        // administrator, so it *could* post — offering it would let any member
        // use the bot as a proxy to write where they cannot.
        const ANNOUNCEMENTS: &str = "200000000000000008";
        let mut fake = FakeDiscord::new(BOT)
            .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A])
            .with_channel(
                GUILD_X,
                GuildChannel {
                    id: ANNOUNCEMENTS.to_string(),
                    name: Some("announcements".to_string()),
                    kind: 0,
                    position: Some(1),
                    permission_overwrites: vec![PermissionOverwrite {
                        id: GUILD_X.to_string(),
                        kind: 0,
                        allow: PERMISSION_VIEW_CHANNEL.to_string(),
                        deny: PERMISSION_SEND_MESSAGES.to_string(),
                    }],
                },
            );
        fake.guilds[0].permissions =
            Some(crate::discord_api::PERMISSION_ADMINISTRATOR.to_string());
        let directory = DiscordDirectory::new(Arc::new(fake), None);

        let targets = directory.targets_for(USER_A).await;
        let channels: Vec<&str> = targets[0]
            .channels
            .iter()
            .map(|channel| channel.id.as_str())
            .collect();
        assert_eq!(
            channels,
            [CHANNEL_X],
            "a read-only channel must not become a posting target"
        );
        assert!(!directory
            .verified_channel_ids(USER_A)
            .await
            .contains(ANNOUNCEMENTS));
    }

    #[tokio::test]
    async fn a_failed_bot_role_lookup_offers_nothing_rather_than_over_permitting() {
        // No member record for the bot in this guild: without its roles the
        // role-scoped denies cannot be applied, so nothing may be offered.
        let mut fake = FakeDiscord::new(BOT).with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[USER_A]);
        fake.members
            .get_mut(GUILD_X)
            .expect("guild exists")
            .remove(BOT);
        let directory = DiscordDirectory::new(Arc::new(fake), None);

        let targets = directory.targets_for(USER_A).await;
        assert_eq!(targets.len(), 1, "membership still holds");
        assert!(targets[0].channels.is_empty(), "but no channel is offered");
    }

    #[test]
    fn admin_user_records_yield_the_linked_discord_id() {
        let user = serde_json::json!({
            "id": "8a3f",
            "identities": [
                { "provider": "email", "id": "someone@example.com" },
                {
                    "provider": "discord",
                    "id": USER_A,
                    "identity_data": { "provider_id": USER_A, "sub": USER_A }
                }
            ]
        });
        assert_eq!(discord_id_from_admin_user(&user).as_deref(), Some(USER_A));

        // No Discord identity linked.
        let email_only = serde_json::json!({
            "identities": [{ "provider": "email", "id": "someone@example.com" }]
        });
        assert!(discord_id_from_admin_user(&email_only).is_none());

        // A non-snowflake provider id is rejected rather than used in a path.
        let malformed = serde_json::json!({
            "identities": [{ "provider": "discord", "identity_data": { "provider_id": "../x" } }]
        });
        assert!(discord_id_from_admin_user(&malformed).is_none());

        assert!(discord_id_from_admin_user(&serde_json::json!({})).is_none());
    }

    #[test]
    fn supabase_user_ids_are_validated_before_reaching_an_admin_url() {
        assert!(is_supabase_user_id("2f1c8b7a-0000-4000-8000-abcdefabcdef"));
        for hostile in ["", "../admin/users", "a/b", "a b", &"x".repeat(65)] {
            assert!(!is_supabase_user_id(hostile), "{hostile} must be rejected");
        }
    }

    #[test]
    fn ttl_cache_expires_and_stays_bounded() {
        let mut cache: TtlCache<String, u32> = TtlCache::new(Duration::from_secs(10), 3);
        let start = Instant::now();
        cache.insert("a".to_string(), 1, start);
        assert_eq!(cache.get(&"a".to_string(), start), Some(&1));
        // Past the TTL the entry is invisible even before it is evicted.
        assert!(cache
            .get(&"a".to_string(), start + Duration::from_secs(11))
            .is_none());

        for i in 0..10 {
            cache.insert(format!("k{i}"), i, start);
        }
        assert!(cache.len() <= 3, "cache never exceeds its capacity");
    }
}
