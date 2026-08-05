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
//! Every step fails **closed**: an unreachable Discord, an unparsable
//! permissions bitfield, or a membership lookup that errors all yield "not a
//! target" rather than a guess.

use std::collections::{BTreeSet, HashMap};
use std::hash::Hash;
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, warn};
use tokio::sync::RwLock;

use crate::auth::{SupabaseClaims, DISCORD_PROVIDER};
use crate::discord_api::{
    bot_can_post, is_snowflake, parse_permissions, BotGuild, DiscordApi, GuildChannel, GuildMember,
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

/// The Supabase admin-API fallback used when a token carries no Discord identity
/// claim (older sessions, or a Discord account linked after the token was
/// minted). Absent when the server holds no privileged Supabase credential, in
/// which case only the token claims are consulted.
struct AdminIdentityLookup {
    config: SupabaseServiceConfig,
    client: reqwest::Client,
}

impl AdminIdentityLookup {
    fn new(config: SupabaseServiceConfig) -> Self {
        let client = config.http_client(ADMIN_CONNECT_TIMEOUT, ADMIN_REQUEST_TIMEOUT);
        Self { config, client }
    }

    /// `GET /auth/v1/admin/users/{id}` → the linked Discord user id, if any.
    async fn discord_user_id(&self, supabase_user_id: &str) -> Option<String> {
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
    }
}

/// Resolves callers to Discord identities and Discord identities to the guilds
/// and channels they may post into. Shared process-wide behind an `Arc`.
pub struct DiscordDirectory {
    api: Arc<dyn DiscordApi>,
    admin: Option<AdminIdentityLookup>,
    /// The bot's own user id, resolved once (it never changes for a token).
    bot_user_id: RwLock<Option<String>>,
    bot_guilds: RwLock<TtlCache<(), Arc<Vec<BotGuild>>>>,
    guild_channels: RwLock<TtlCache<String, Arc<Vec<GuildChannel>>>>,
    bot_members: RwLock<TtlCache<String, Arc<GuildMember>>>,
    /// `(discord_user_id, guild_id) -> is member`.
    membership: RwLock<TtlCache<(String, String), bool>>,
    /// `supabase_user_id -> discord_user_id`, `None` for "no Discord identity".
    identities: RwLock<TtlCache<String, Option<String>>>,
}

impl DiscordDirectory {
    /// Build a directory over `api`, optionally able to fall back to the
    /// Supabase admin API for identity resolution.
    #[must_use]
    pub fn new(api: Arc<dyn DiscordApi>, supabase: Option<SupabaseServiceConfig>) -> Self {
        Self {
            api,
            admin: supabase.map(AdminIdentityLookup::new),
            bot_user_id: RwLock::new(None),
            bot_guilds: RwLock::new(TtlCache::new(BOT_GUILD_TTL, 2)),
            guild_channels: RwLock::new(TtlCache::new(BOT_GUILD_TTL, GUILD_CACHE_MAX)),
            bot_members: RwLock::new(TtlCache::new(BOT_GUILD_TTL, GUILD_CACHE_MAX)),
            membership: RwLock::new(TtlCache::new(MEMBERSHIP_TTL, MEMBERSHIP_CACHE_MAX)),
            identities: RwLock::new(TtlCache::new(IDENTITY_TTL, IDENTITY_CACHE_MAX)),
        }
    }

    /// The caller's Discord user id: from the verified token claims when present,
    /// otherwise from the Supabase admin API. `None` means "this account has no
    /// Discord identity" — a normal, non-error outcome that yields no targets.
    pub async fn resolve_discord_user_id(&self, claims: &SupabaseClaims) -> Option<String> {
        if let Some(from_token) = claims.discord_user_id() {
            return Some(from_token.to_string());
        }
        let now = Instant::now();
        if let Some(cached) = self.identities.read().await.get(&claims.sub, now) {
            return cached.clone();
        }
        let admin = self.admin.as_ref()?;
        let resolved = admin.discord_user_id(&claims.sub).await;
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
            if !is_snowflake(&guild.id) || !self.is_member(discord_user_id, &guild.id).await {
                continue;
            }
            targets.push(TargetGuild {
                id: guild.id.clone(),
                name: guild.name.clone(),
                icon: guild.icon.clone(),
                channels: self.postable_channels(guild, &bot_user_id).await,
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

    /// Whether `discord_user_id` is a member of `guild_id`, per the bot-side
    /// single-member lookup. A transport/permission failure is **not** cached and
    /// answers `false`, so an outage can only ever hide a guild.
    async fn is_member(&self, discord_user_id: &str, guild_id: &str) -> bool {
        let key = (discord_user_id.to_string(), guild_id.to_string());
        let now = Instant::now();
        if let Some(cached) = self.membership.read().await.get(&key, now) {
            return *cached;
        }
        match self.api.guild_member(guild_id, discord_user_id).await {
            Ok(member) => {
                let is_member = member.is_some();
                self.membership
                    .write()
                    .await
                    .insert(key, is_member, Instant::now());
                is_member
            }
            Err(error) => {
                warn!(
                    "[{}] Discord membership check failed for a guild: {error}",
                    *INSTANCE_ID
                );
                false
            }
        }
    }

    /// The channels of `guild` the bot can post an advert embed into.
    async fn postable_channels(&self, guild: &BotGuild, bot_user_id: &str) -> Vec<TargetChannel> {
        // The partial guild's `permissions` is already the union of @everyone
        // and the bot's roles, i.e. Discord's `computeBasePermissions`. Absent
        // (an unexpected response shape) means no base permissions and therefore
        // no offered channels — fail closed.
        let base = guild
            .permissions
            .as_deref()
            .map_or(0, parse_permissions);
        let Some(channels) = self.channels_of(&guild.id).await else {
            return Vec::new();
        };
        let bot_roles: BTreeSet<String> = self
            .bot_member_of(&guild.id)
            .await
            .map(|member| member.roles.iter().cloned().collect())
            .unwrap_or_default();

        let mut postable: Vec<(i64, TargetChannel)> = channels
            .iter()
            .filter(|channel| bot_can_post(channel, base, &guild.id, &bot_roles, bot_user_id))
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

    /// The bot's own member record in a guild — read for its role ids, which
    /// decide which channel role-overwrites apply to it.
    async fn bot_member_of(&self, guild_id: &str) -> Option<Arc<GuildMember>> {
        let now = Instant::now();
        if let Some(cached) = self.bot_members.read().await.get(&guild_id.to_string(), now) {
            return Some(cached.clone());
        }
        let bot_user_id = self.bot_user_id().await?;
        let member = Arc::new(
            self.api
                .guild_member(guild_id, &bot_user_id)
                .await
                .ok()
                .flatten()?,
        );
        self.bot_members.write().await.insert(
            guild_id.to_string(),
            member.clone(),
            Instant::now(),
        );
        Some(member)
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
        /// `guild_id -> member user ids present in that guild`.
        pub members: HashMap<String, BTreeSet<String>>,
        /// `guild_id -> the bot's role ids there`.
        pub bot_roles: HashMap<String, Vec<String>>,
        /// When set, every call fails with this error.
        pub failure: Option<DiscordApiError>,
        pub guild_list_calls: AtomicUsize,
        pub member_calls: AtomicUsize,
        pub created: Mutex<Vec<(String, serde_json::Value)>>,
        pub edited: Mutex<Vec<(String, String, serde_json::Value)>>,
        pub deleted: Mutex<Vec<(String, String)>>,
    }

    impl FakeDiscord {
        pub fn new(bot_user_id: &str) -> Self {
            Self {
                bot_user_id: bot_user_id.to_string(),
                guilds: Vec::new(),
                channels: HashMap::new(),
                members: HashMap::new(),
                bot_roles: HashMap::new(),
                failure: None,
                guild_list_calls: AtomicUsize::new(0),
                member_calls: AtomicUsize::new(0),
                created: Mutex::new(Vec::new()),
                edited: Mutex::new(Vec::new()),
                deleted: Mutex::new(Vec::new()),
            }
        }

        /// Install a guild with `permissions` granting everything needed, one
        /// plain text channel `channel_id`, and the given human members.
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
            let mut present: BTreeSet<String> =
                members.iter().map(|id| (*id).to_string()).collect();
            // The bot is a member of every guild it is installed in.
            present.insert(self.bot_user_id.clone());
            self.members.insert(guild_id.to_string(), present);
            self
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

        fn guild_member<'a>(
            &'a self,
            guild_id: &'a str,
            user_id: &'a str,
        ) -> ApiFuture<'a, Option<GuildMember>> {
            Box::pin(async move {
                self.member_calls.fetch_add(1, Ordering::AcqRel);
                if let Some(failure) = self.failure {
                    return Err(failure);
                }
                let present = self
                    .members
                    .get(guild_id)
                    .is_some_and(|members| members.contains(user_id));
                Ok(present.then(|| GuildMember {
                    roles: if user_id == self.bot_user_id {
                        self.bot_roles.get(guild_id).cloned().unwrap_or_default()
                    } else {
                        Vec::new()
                    },
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
                if let Some(failure) = self.failure {
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
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::FakeDiscord;
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

    #[tokio::test]
    async fn identity_comes_from_the_token_when_it_carries_a_discord_provider() {
        let (_api, directory) = two_tenant_directory();
        let resolved = directory
            .resolve_discord_user_id(&claims(serde_json::json!({
                "sub": "supabase-a",
                "app_metadata": { "provider": "discord" },
                "user_metadata": { "provider_id": USER_A }
            })))
            .await;
        assert_eq!(resolved.as_deref(), Some(USER_A));
    }

    #[tokio::test]
    async fn identity_is_none_without_a_discord_claim_or_an_admin_fallback() {
        let (_api, directory) = two_tenant_directory();
        let resolved = directory
            .resolve_discord_user_id(&claims(serde_json::json!({ "sub": "supabase-guest" })))
            .await;
        assert!(resolved.is_none(), "no Discord identity resolves to None");
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
