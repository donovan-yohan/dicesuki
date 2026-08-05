//! Discord room-advertisement bot (issues #84, #244, #246).
//!
//! Posts and keeps up to date a room-status embed with a link-button **Join**
//! (issue #85), driven entirely by the in-memory rooms registry (`RoomManager`),
//! server-side, over Discord's REST API — no gateway/WebSocket connection and no
//! interaction handling are required (a style-5 *link* button carries a URL and
//! needs no callback).
//!
//! ## Two kinds of advert (#246)
//!
//! * [`AdvertKind::Billboard`] — the original #84 behaviour: every **public**
//!   room is mirrored into one operator-configured channel (`DISCORD_CHANNEL_ID`).
//!   Now **optional and legacy**; when the variable is unset no billboard exists.
//!   Billboard posts are deleted when their room closes.
//! * [`AdvertKind::HostPosted`] — a room's host explicitly posts *their* room to
//!   a channel they chose (`POST /api/rooms/:id/advertise`). Nothing is ever
//!   auto-posted to a guild. A host-posted advert is a **session record**: when
//!   the room closes it is archived in place (Join button removed, closing
//!   summary rendered) and never deleted.
//!
//! ## Why a channel bot, not per-user Rich Presence
//!
//! Issue #84 asks for "Discord Rich Presence" — the game showing on a player's
//! Discord profile. True per-user Rich Presence is **not reachable from a pure
//! web app**: the official mechanism (RPC) speaks to the *desktop* client's local
//! IPC socket, and the only in-browser path is the Embedded App SDK when the app
//! runs as a Discord **Activity** inside a voice call. The Activity is a future
//! phase (spike #86: GO, later) and depends on backend work that only just
//! landed. Rather than fake presence with a fragile third-party RPC bridge, this
//! delivers the *same user value now* — a live, auto-updating advertisement of
//! each room with one-click join — from the authoritative server state. When the
//! Activity ships, `discordSdk.commands.setActivity(...)` provides the real
//! per-user presence and this bot can remain as the channel-level billboard.
//!
//! ## Feature gating
//!
//! Off by default. Host-initiated posting activates when both are set (empty =
//! absent):
//!
//! * `DISCORD_BOT_TOKEN`  — bot token, sent as `Authorization: Bot <token>`.
//!   **Never committed** — supplied via env/secret storage.
//! * `APP_BASE_URL`       — the *frontend* origin (e.g. `https://dicesuki.app`)
//!   used to build room deep links `<APP_BASE_URL>/room/<id>`. Distinct from the
//!   registry's `PUBLIC_URL`, which is the room *server's* own base.
//!
//! `DISCORD_CHANNEL_ID` is optional and powers only the legacy billboard.
//! When the bot token or base URL is absent the bot is silently OFF and the
//! server runs unchanged.

use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, info, warn};
use tokio::sync::{Mutex, RwLock};

use crate::discord_api::{is_terminal_for_resource, DiscordApi, HttpDiscordApi};
use crate::discord_targets::{DiscordDirectory, IdentityLookup};
use crate::messages::DiceType;
use crate::room::{RecentRoll, RecentRollDie, Room};
use crate::room_manager::RoomManager;
use crate::supabase::SupabaseServiceConfig;
use crate::INSTANCE_ID;

/// How often the bot reconciles its posted embeds against live room state.
/// Matches the registry heartbeat cadence: responsive enough that a new room is
/// advertised within half a minute, infrequent enough that edit volume stays far
/// under Discord's rate limits (edits are only issued when a room's advertised
/// state actually changes).
pub const SYNC_INTERVAL: Duration = Duration::from_secs(30);

/// Discord "blurple", used as the embed accent colour.
const EMBED_COLOR: u32 = 0x5865_F2;
/// A muted grey for an archived (closed-session) embed, so a scrolled-back
/// channel reads live-vs-finished at a glance.
const ARCHIVED_EMBED_COLOR: u32 = 0x4E5058;

/// Appended once per die that landed its natural maximum face.
const CRIT_HIGH: &str = "\u{1F4A5}";
/// Appended once per die that landed its natural minimum face.
const CRIT_LOW: &str = "\u{1F480}";

/// Characters kept from a player's display name in a roll line.
const ROLL_NAME_MAX_LEN: usize = 24;

/// Characters kept from a roll's saved-roll name in a roll line (#244).
///
/// Matches [`THEME_LABEL_MAX_LEN`], the embed's other secondary label, rather
/// than core's `SAVED_ROLL_NAME_MAX_LEN` (40): core caps to keep room state
/// bounded, this caps to keep the line readable next to the player name and the
/// whole field inside Discord's 1024-character limit. The tighter of the two
/// wins, and the render cap is applied unconditionally so it holds even if core
/// ever loosens.
const SAVED_ROLL_LABEL_MAX_LEN: usize = 32;

/// Characters kept from the host-chosen theme id in the embed's Theme field.
/// `Room::update_settings` imposes no length limit on `themeId`, so the cap is
/// enforced here rather than trusted from the room.
const THEME_LABEL_MAX_LEN: usize = 32;

/// How many times a crit emoji repeats before a roll line collapses it to
/// `<emoji>xN`. Without this an arbitrarily large dice pool could push the field
/// past Discord's 1024-character embed-field-value limit.
const CRIT_REPEAT_LIMIT: usize = 3;

/// How many names the closing summary lists before collapsing the tail into
/// `+N more`. Keeps the field inside Discord's 1024-character limit even for a
/// full room of hostile display names.
const ARCHIVE_PLAYER_LIST_MAX: usize = 12;

/// How many distinct channels one room may be advertised to. A host picks one
/// server/channel in v1; the small allowance covers a host posting to a second
/// community without turning the endpoint into a broadcast tool.
pub const MAX_CHANNELS_PER_ROOM: usize = 4;

/// Hard ceiling on rooms with host-posted adverts tracked at once, so the
/// registry cannot grow without bound.
pub const MAX_ADVERTISED_ROOMS: usize = 512;

/// Burst of `advertise` calls one user may make.
const ADVERTISE_BURST: f64 = 5.0;
/// Steady-state `advertise` refill rate (one every 30s).
const ADVERTISE_REFILL_PER_SEC: f64 = 1.0 / 30.0;
/// Burst of `targets` reads one user may make.
const TARGETS_BURST: f64 = 20.0;
/// Steady-state `targets` refill rate (one every 5s).
const TARGETS_REFILL_PER_SEC: f64 = 1.0 / 5.0;
/// Size bound on each per-user rate-limit table.
const RATE_LIMIT_MAX_USERS: usize = 4096;

/// Die types in the order a mixed pool is conventionally written (largest
/// first). Also fixes the order crit emoji are emitted in, so the same roll
/// always renders the same string and cannot cause a spurious edit.
const DIE_RENDER_ORDER: [DiceType; 7] = [
    DiceType::D20,
    DiceType::D12,
    DiceType::D10Tens,
    DiceType::D10,
    DiceType::D8,
    DiceType::D6,
    DiceType::D4,
];

/// Resolved bot configuration. Present only when the feature is enabled.
#[derive(Clone)]
pub struct DiscordConfig {
    /// Bot token (`Authorization: Bot <token>`).
    pub bot_token: String,
    /// Legacy billboard channel (#84). `None` when `DISCORD_CHANNEL_ID` is unset,
    /// in which case only host-posted adverts exist.
    pub channel_id: Option<String>,
    /// Frontend origin for room deep links; trailing slash trimmed.
    pub app_base_url: String,
}

impl fmt::Debug for DiscordConfig {
    /// Redacts the bot token: this type is reachable from log/error formatting.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DiscordConfig")
            .field("channel_id", &self.channel_id)
            .field("app_base_url", &self.app_base_url)
            .finish_non_exhaustive()
    }
}

impl DiscordConfig {
    /// Resolve config from the environment, or `None` if the feature is disabled.
    /// Host-initiated posting (#246) needs only the bot token and the app base
    /// URL; `DISCORD_CHANNEL_ID` stays optional and only powers the legacy
    /// billboard. No side effects.
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let bot_token = non_empty_env("DISCORD_BOT_TOKEN")?;
        let app_base_url = non_empty_env("APP_BASE_URL")?;
        Some(Self {
            bot_token,
            channel_id: non_empty_env("DISCORD_CHANNEL_ID"),
            app_base_url: app_base_url.trim_end_matches('/').to_string(),
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

/// The advertised state of a single room. Derived from `RoomManager`; equality
/// drives the "did anything change?" decision so unchanged rooms are never
/// re-edited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomAdvert {
    pub room_id: String,
    pub name: Option<String>,
    pub player_count: usize,
    pub player_cap: usize,
    pub theme_id: Option<String>,
    /// Seated players' display names in join order. Rendered in the closing
    /// summary of an archived advert (#246). Part of the advert's identity, so a
    /// rename plans an edit just as a join or leave does.
    pub player_names: Vec<String>,
    /// The room's recent completed rolls, oldest first, as core retains them
    /// (`Room::recent_rolls`, capped at `RECENT_ROLL_HISTORY`). Part of the
    /// advert's identity, so a new roll is a real change and plans an edit.
    pub recent_rolls: Vec<RecentRoll>,
}

/// Which lifecycle a posted advert follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvertKind {
    /// Operator-configured billboard channel (#84). Deleted on room close.
    Billboard,
    /// Host-chosen channel (#246). Archived in place on room close, never
    /// deleted — the message is the group's session record.
    HostPosted,
}

/// One channel a room's advert must appear in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdvertTarget {
    pub channel_id: String,
    pub kind: AdvertKind,
}

/// A live room plus every channel it must currently be advertised in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesiredAdvert {
    pub advert: RoomAdvert,
    pub targets: Vec<AdvertTarget>,
}

/// A currently-posted embed: where it lives, the Discord message id, the advert
/// state it was last rendered from, and when it was first posted (the origin for
/// the archived session length).
#[derive(Debug, Clone)]
pub struct TrackedPost {
    pub channel_id: String,
    pub message_id: String,
    pub kind: AdvertKind,
    pub advert: RoomAdvert,
    pub posted_at: Instant,
}

/// One reconciliation step for the sync loop to apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    /// No message yet for this room in this channel — create one.
    Create {
        channel_id: String,
        kind: AdvertKind,
        advert: RoomAdvert,
    },
    /// Existing message whose room state changed — edit it.
    Update {
        channel_id: String,
        message_id: String,
        kind: AdvertKind,
        advert: RoomAdvert,
    },
    /// A billboard post whose room is gone (or went unlisted) — delete it.
    Delete {
        room_id: String,
        channel_id: String,
        message_id: String,
    },
    /// A host-posted advert whose room is gone — rewrite it as a closed-session
    /// record (Join button removed) and stop tracking it. Never deleted.
    Archive {
        room_id: String,
        channel_id: String,
        message_id: String,
        advert: RoomAdvert,
        duration: Duration,
    },
}

/// A room as the advertiser sees it: its advert plus whether it is publicly
/// listed (which decides billboard eligibility; host-posted adverts do not care,
/// because the host opted in explicitly).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomSnapshot {
    pub advert: RoomAdvert,
    pub is_public: bool,
}

/// The host's Supabase user id for a room: the `user_id` bound to the seat that
/// currently holds host. `None` for a guest host, an empty room, or an unknown
/// room. Host transfers on disconnect, so the *current* host is the authority —
/// whoever holds the room now can post it.
#[must_use]
pub fn host_user_id(room: &Room) -> Option<String> {
    room.host_id
        .as_deref()
        .and_then(|host_id| room.players.get(host_id))
        .and_then(|player| player.user_id.clone())
}

/// Collect every room as an advert snapshot. Clones the room handles under the
/// manager lock first, then reads each room under its own lock (matching the
/// lock-ordering discipline used by the registry/HTTP handlers: never hold the
/// manager lock across a room lock).
pub async fn collect_adverts(manager: &Arc<RwLock<RoomManager>>) -> Vec<RoomSnapshot> {
    let rooms = {
        let mgr = manager.read().await;
        mgr.rooms_snapshot()
    };
    let mut snapshots = Vec::new();
    for room in &rooms {
        let room = room.read().await;
        let mut seated: Vec<(u64, String)> = room
            .players
            .values()
            .map(|player| (player.join_order, player.display_name.clone()))
            .collect();
        seated.sort_by_key(|(join_order, _)| *join_order);
        snapshots.push(RoomSnapshot {
            is_public: room.is_public(),
            advert: RoomAdvert {
                room_id: room.id.clone(),
                name: room.room_name(),
                player_count: room.player_count(),
                player_cap: room.player_cap(),
                theme_id: room.theme_id().map(str::to_string),
                player_names: seated.into_iter().map(|(_, name)| name).collect(),
                recent_rolls: room.recent_rolls().to_vec(),
            },
        });
    }
    // Deterministic order so the planner's output is stable between passes.
    snapshots.sort_by(|a, b| a.advert.room_id.cmp(&b.advert.room_id));
    snapshots
}

/// Resolve live rooms plus registrations into the set of adverts that *should*
/// exist right now. Pure, so the "which room goes where" policy is unit-tested
/// without a network or a room manager:
///
/// * the legacy billboard (when configured) carries every **public** room;
/// * host-posted channels carry exactly the room whose host registered them,
///   listed or not — the host opted in explicitly, so visibility does not gate it.
#[must_use]
pub fn desired_adverts(
    snapshots: &[RoomSnapshot],
    billboard_channel_id: Option<&str>,
    host_posts: &HashMap<String, BTreeSet<String>>,
) -> Vec<DesiredAdvert> {
    snapshots
        .iter()
        .filter_map(|snapshot| {
            let mut targets = Vec::new();
            if let Some(channel_id) = billboard_channel_id {
                if snapshot.is_public {
                    targets.push(AdvertTarget {
                        channel_id: channel_id.to_string(),
                        kind: AdvertKind::Billboard,
                    });
                }
            }
            for channel_id in host_posts
                .get(&snapshot.advert.room_id)
                .into_iter()
                .flatten()
            {
                // A host-posted channel that also happens to be the billboard
                // keeps its host-posted (archiving) lifecycle.
                targets.retain(|target| &target.channel_id != channel_id);
                targets.push(AdvertTarget {
                    channel_id: channel_id.clone(),
                    kind: AdvertKind::HostPosted,
                });
            }
            (!targets.is_empty()).then(|| DesiredAdvert {
                advert: snapshot.advert.clone(),
                targets,
            })
        })
        .collect()
}

/// Build the room deep link for a room's Join button (issue #85). Room ids are
/// nanoid (URL-safe alphabet), so no percent-encoding is needed.
#[must_use]
pub fn join_url(app_base_url: &str, room_id: &str) -> String {
    format!("{}/room/{}", app_base_url.trim_end_matches('/'), room_id)
}

/// The human-facing title for a room's embed: its host-chosen name, or a
/// `Room <id>` fallback when unnamed.
#[must_use]
fn advert_title(advert: &RoomAdvert) -> String {
    advert
        .name
        .clone()
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("Room {}", advert.room_id))
}

/// The display label for a die type in a roll expression. Presentation only —
/// the percentile tens die reads as the conventional `d%` rather than its wire
/// name `d10tens`.
#[must_use]
const fn dice_type_label(dice_type: DiceType) -> &'static str {
    match dice_type {
        DiceType::D4 => "d4",
        DiceType::D6 => "d6",
        DiceType::D8 => "d8",
        DiceType::D10 => "d10",
        DiceType::D10Tens => "d%",
        DiceType::D12 => "d12",
        DiceType::D20 => "d20",
    }
}

/// Collapse a roll's dice into a pool expression like `3d6+2d4`.
#[must_use]
fn roll_expression(dice: &[RecentRollDie]) -> String {
    DIE_RENDER_ORDER
        .iter()
        .filter_map(|die_type| {
            let count = dice.iter().filter(|d| d.dice_type == *die_type).count();
            (count > 0).then(|| format!("{count}{}", dice_type_label(*die_type)))
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Append `count` copies of `emoji`, collapsing to `<emoji>xN` past
/// [`CRIT_REPEAT_LIMIT`].
fn push_crit_marker(out: &mut String, emoji: &str, count: usize) {
    if count == 0 {
        return;
    }
    if count <= CRIT_REPEAT_LIMIT {
        for _ in 0..count {
            out.push_str(emoji);
        }
    } else {
        out.push_str(&format!("{emoji}\u{00D7}{count}"));
    }
}

/// Per-die crit decoration for a roll: one [`CRIT_HIGH`] per die showing its
/// natural maximum face, one [`CRIT_LOW`] per natural minimum. Dice whose
/// extremes are not unambiguous (percentile tens — see
/// [`DiceType::natural_faces`]) are never decorated.
#[must_use]
fn crit_markers(dice: &[RecentRollDie]) -> String {
    let mut high = 0_usize;
    let mut low = 0_usize;
    for die_type in DIE_RENDER_ORDER {
        let Some((min_face, max_face)) = die_type.natural_faces() else {
            continue;
        };
        for die in dice.iter().filter(|d| d.dice_type == die_type) {
            if die.face_value == max_face {
                high += 1;
            } else if die.face_value == min_face {
                low += 1;
            }
        }
    }
    let mut markers = String::new();
    push_crit_marker(&mut markers, CRIT_HIGH, high);
    push_crit_marker(&mut markers, CRIT_LOW, low);
    markers
}

/// Render **any** client-supplied string for an embed: control characters
/// collapsed to single spaces, truncated to `max_len` characters, and Discord
/// markdown escaped. `fallback` stands in when nothing survives.
///
/// This is the only door client text may enter an embed through, because these
/// embeds now land in **third-party guilds** (#246). The escape set covers every
/// character that can begin an inline construct, and `[` `]` `(` `)` are in it
/// for a specific reason: without them a 17-character display name such as
/// `[go](http://a.gd)` renders as a live **masked link** inside a message posted
/// under the bot's name, in a server the author may not even be able to write
/// to. Truncation alone is no defence — the payload fits in any cap.
#[must_use]
fn render_embed_text(raw: &str, max_len: usize, fallback: &str) -> String {
    let collapsed = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_len)
        .collect::<String>();
    if collapsed.is_empty() {
        return fallback.to_string();
    }
    let mut escaped = String::with_capacity(collapsed.len());
    for c in collapsed.chars() {
        // Heading/blockquote markers (`#`, `>`) are deliberately absent: control
        // characters are already collapsed to spaces, so client text is always a
        // single line and those are only significant at a line start.
        if matches!(
            c,
            '*' | '_' | '~' | '`' | '|' | '\\' | '[' | ']' | '(' | ')'
        ) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// Render a client-supplied display name for an embed line.
#[must_use]
fn render_player_name(raw: &str) -> String {
    render_embed_text(raw, ROLL_NAME_MAX_LEN, "Player")
}

/// Render the host-chosen theme id for the embed's **Theme** field.
///
/// `Room::update_settings` accepts any non-empty string for `themeId`, so this
/// is unvalidated host input reaching a third-party guild exactly like a display
/// name — it needs the same sanitizer and its own hard cap.
#[must_use]
fn render_theme_label(theme_id: Option<&str>) -> String {
    render_embed_text(theme_id.unwrap_or_default(), THEME_LABEL_MAX_LEN, "default")
}

/// Render a roll's saved-roll name for an embed line (#244).
///
/// This is client-supplied text exactly like a display name — core bounds it,
/// but nothing validates its *content* — so it goes through
/// [`render_embed_text`], the single door for client text in an embed. Without
/// that escaping, a saved roll named `[click](http://evil.example)` would post
/// as a live masked link in a third-party guild under the bot's name.
#[must_use]
fn render_saved_roll_name(raw: &str) -> String {
    render_embed_text(raw, SAVED_ROLL_LABEL_MAX_LEN, "Saved roll")
}

/// One line of the **Recent rolls** field, e.g. `Alex \u{2014} 3d6 \u{2192} 14 \u{1F4A5}`.
///
/// A roll that came from a saved roll names it and parenthesizes the pool:
/// `Alex \u{2014} Sneak Attack (3d6) \u{2192} 14`.
#[must_use]
fn roll_line(roll: &RecentRoll) -> String {
    let markers = crit_markers(&roll.dice);
    let separator = if markers.is_empty() { "" } else { " " };
    let expression = roll_expression(&roll.dice);
    let what = match roll.saved_roll_name.as_deref() {
        Some(name) => format!("{} ({expression})", render_saved_roll_name(name)),
        None => expression,
    };
    format!(
        "{} \u{2014} {what} \u{2192} {}{separator}{markers}",
        render_player_name(&roll.player_name),
        roll.total
    )
}

/// The **Recent rolls** field body, newest first, or `None` when the room has
/// not completed a roll yet (Discord rejects an empty field value).
#[must_use]
fn render_recent_rolls(rolls: &[RecentRoll]) -> Option<String> {
    (!rolls.is_empty()).then(|| {
        rolls
            .iter()
            .rev()
            .map(roll_line)
            .collect::<Vec<_>>()
            .join("\n")
    })
}

/// The closing summary's player roster, escaped and length-capped.
#[must_use]
fn render_player_roster(names: &[String]) -> String {
    if names.is_empty() {
        return "Nobody was left at the table".to_string();
    }
    let shown = names
        .iter()
        .take(ARCHIVE_PLAYER_LIST_MAX)
        .map(|name| render_player_name(name))
        .collect::<Vec<_>>()
        .join(", ");
    match names.len().saturating_sub(ARCHIVE_PLAYER_LIST_MAX) {
        0 => shown,
        more => format!("{shown} +{more} more"),
    }
}

/// Human-readable session length, e.g. `1h 12m` / `4m` / `<1m`.
#[must_use]
fn render_duration(duration: Duration) -> String {
    let minutes = duration.as_secs() / 60;
    match (minutes / 60, minutes % 60) {
        (0, 0) => "<1m".to_string(),
        (0, m) => format!("{m}m"),
        (h, m) => format!("{h}h {m}m"),
    }
}

/// Build the Discord message create/edit payload for a **live** room: an embed
/// carrying name, theme, player count, and recent rolls (#244), plus an action
/// row with a single link-button **Join** pointing at the room's deep link. The
/// same shape serves both `POST .../messages` and `PATCH .../messages/<id>`.
#[must_use]
pub fn build_message_payload(advert: &RoomAdvert, app_base_url: &str) -> serde_json::Value {
    let title = advert_title(advert);
    let theme = render_theme_label(advert.theme_id.as_deref());
    let players = format!("{}/{}", advert.player_count, advert.player_cap);
    let url = join_url(app_base_url, &advert.room_id);

    let mut fields = vec![
        serde_json::json!({ "name": "Players", "value": players, "inline": true }),
        serde_json::json!({ "name": "Theme", "value": theme, "inline": true }),
    ];
    if let Some(rolls) = render_recent_rolls(&advert.recent_rolls) {
        fields.push(serde_json::json!({
            "name": "Recent rolls",
            "value": rolls,
            "inline": false
        }));
    }

    serde_json::json!({
        "embeds": [{
            "title": format!("\u{1F3B2} {title}"),
            "description": "A Dicesuki dice room is live \u{2014} jump in and roll.",
            "color": EMBED_COLOR,
            "fields": fields,
            "footer": { "text": format!("Room {}", advert.room_id) }
        }],
        // Action row (type 1) containing a link button (type 2, style 5). Link
        // buttons need no interaction endpoint — Discord just opens the URL.
        "components": [{
            "type": 1,
            "components": [{
                "type": 2,
                "style": 5,
                "label": "Join room",
                "url": url
            }]
        }]
    })
}

/// Build the final PATCH payload for a **closed** host-posted room (#246): the
/// message becomes a session record. `"components": []` clears the action row,
/// so the dead Join button is gone rather than left to disappoint a late reader,
/// and the summary reports who was at the table, how long the session ran, and
/// the tail of the roll history.
#[must_use]
pub fn build_archive_payload(advert: &RoomAdvert, duration: Duration) -> serde_json::Value {
    let mut fields = vec![
        serde_json::json!({
            "name": "Players",
            "value": render_player_roster(&advert.player_names),
            "inline": false
        }),
        serde_json::json!({
            "name": "Session length",
            "value": render_duration(duration),
            "inline": true
        }),
    ];
    if let Some(rolls) = render_recent_rolls(&advert.recent_rolls) {
        fields.push(serde_json::json!({
            "name": "Last rolls",
            "value": rolls,
            "inline": false
        }));
    }

    serde_json::json!({
        "embeds": [{
            "title": format!("\u{1F3B2} {}", advert_title(advert)),
            "description": "This Dicesuki session has ended.",
            "color": ARCHIVED_EMBED_COLOR,
            "fields": fields,
            "footer": { "text": format!("Room {} \u{2014} closed", advert.room_id) }
        }],
        // Empty action row list removes the now-dead Join button.
        "components": []
    })
}

/// Pure reconciliation planner: diff the currently-tracked posts against the
/// desired adverts and return the actions needed to converge. Deterministic and
/// side-effect free, so the interesting logic is unit-testable without a network.
///
/// * A desired (room, channel) with no tracked post -> [`SyncAction::Create`].
/// * A tracked post whose advert differs -> [`SyncAction::Update`].
/// * A tracked post that is no longer desired (room closed, or the channel was
///   dropped) -> [`SyncAction::Delete`] for a billboard post,
///   [`SyncAction::Archive`] for a host-posted one.
/// * An unchanged advert -> no action (no needless edit).
///
/// `now` only feeds the archived session length, keeping the planner a pure
/// function of its inputs.
#[must_use]
pub fn plan_actions(
    tracked: &HashMap<String, Vec<TrackedPost>>,
    desired: &[DesiredAdvert],
    now: Instant,
) -> Vec<SyncAction> {
    let mut actions = Vec::new();

    for entry in desired {
        let posts = tracked.get(&entry.advert.room_id);
        for target in &entry.targets {
            let existing = posts.and_then(|posts| {
                posts
                    .iter()
                    .find(|post| post.channel_id == target.channel_id)
            });
            match existing {
                None => actions.push(SyncAction::Create {
                    channel_id: target.channel_id.clone(),
                    kind: target.kind,
                    advert: entry.advert.clone(),
                }),
                // A kind change with an identical advert costs one redundant
                // PATCH, but it is the only way to re-track the post under its
                // new lifecycle — and a billboard post that silently stayed a
                // billboard would be *deleted* on close instead of archived.
                Some(post) if post.advert != entry.advert || post.kind != target.kind => {
                    actions.push(SyncAction::Update {
                        channel_id: post.channel_id.clone(),
                        message_id: post.message_id.clone(),
                        kind: target.kind,
                        advert: entry.advert.clone(),
                    });
                }
                Some(_) => {} // unchanged — skip
            }
        }
    }

    // Retire tracked posts that are no longer wanted. Sorted so a pass over a
    // HashMap still yields a stable action order.
    let mut room_ids: Vec<&String> = tracked.keys().collect();
    room_ids.sort();
    for room_id in room_ids {
        let wanted = desired.iter().find(|entry| &entry.advert.room_id == room_id);
        for post in &tracked[room_id] {
            let still_wanted = wanted.is_some_and(|entry| {
                entry
                    .targets
                    .iter()
                    .any(|target| target.channel_id == post.channel_id)
            });
            if still_wanted {
                continue;
            }
            actions.push(match post.kind {
                AdvertKind::Billboard => SyncAction::Delete {
                    room_id: room_id.clone(),
                    channel_id: post.channel_id.clone(),
                    message_id: post.message_id.clone(),
                },
                AdvertKind::HostPosted => SyncAction::Archive {
                    room_id: room_id.clone(),
                    channel_id: post.channel_id.clone(),
                    message_id: post.message_id.clone(),
                    advert: post.advert.clone(),
                    duration: now.saturating_duration_since(post.posted_at),
                },
            });
        }
    }

    actions
}

/// Why a `POST /api/rooms/:id/advertise` was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvertiseRejection {
    /// Host posting is not configured on this server.
    Disabled,
    /// No such room on this instance.
    RoomNotFound,
    /// The caller is not the room's host.
    NotHost,
    /// The caller has no Discord identity, so no channel can be verified.
    NoDiscordIdentity,
    /// The channel is not in any guild the caller passed membership
    /// verification for (or is not a channel the bot can post to).
    ChannelNotVerified,
    /// The room already has [`MAX_CHANNELS_PER_ROOM`] adverts, or the server is
    /// tracking [`MAX_ADVERTISED_ROOMS`] rooms.
    TooManyAdverts,
    /// The caller exhausted their advertise budget.
    RateLimited,
}

impl AdvertiseRejection {
    /// Machine-readable error code for the JSON body.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Disabled => "DISCORD_DISABLED",
            Self::RoomNotFound => "ROOM_NOT_FOUND",
            Self::NotHost => "NOT_ROOM_HOST",
            Self::NoDiscordIdentity => "NO_DISCORD_IDENTITY",
            Self::ChannelNotVerified => "CHANNEL_NOT_VERIFIED",
            Self::TooManyAdverts => "TOO_MANY_ADVERTS",
            Self::RateLimited => "RATE_LIMITED",
        }
    }

    /// HTTP status for the refusal.
    #[must_use]
    pub const fn status(self) -> u16 {
        match self {
            Self::Disabled => 503,
            Self::RoomNotFound => 404,
            // A non-host, a caller with no Discord identity, and a caller
            // pointing at someone else's channel all get 403: the response must
            // not become an oracle for which channels exist.
            Self::NotHost | Self::NoDiscordIdentity | Self::ChannelNotVerified => 403,
            Self::TooManyAdverts => 409,
            Self::RateLimited => 429,
        }
    }
}

/// Authorize one advertise request. Pure, so both refusal axes the issue calls
/// out — *not the host* and *channel outside the caller's verified guilds* — are
/// unit-tested directly.
///
/// `verified_channels` must come from the server's own membership-verified view
/// of the caller (see `DiscordDirectory::verified_channel_ids`); the client's
/// claim about which guild a channel belongs to is never consulted.
///
/// # Errors
///
/// Returns the [`AdvertiseRejection`] describing the first failed check.
pub fn authorize_advertise(
    host_user_id: Option<&str>,
    caller_user_id: &str,
    channel_id: &str,
    verified_channels: &BTreeSet<String>,
) -> Result<(), AdvertiseRejection> {
    // A room whose host seat is a guest has no owner that can be proven, so it
    // can never be advertised by anyone.
    if host_user_id != Some(caller_user_id) {
        return Err(AdvertiseRejection::NotHost);
    }
    if !crate::discord_api::is_snowflake(channel_id) || !verified_channels.contains(channel_id) {
        return Err(AdvertiseRejection::ChannelNotVerified);
    }
    Ok(())
}

/// A single user's advertise budget.
#[derive(Debug, Clone, Copy)]
struct TokenBucket {
    tokens: f64,
    updated: Instant,
}

impl TokenBucket {
    fn new(burst: f64, now: Instant) -> Self {
        Self {
            tokens: burst,
            updated: now,
        }
    }

    /// Refill for elapsed time, then spend one token if any remain.
    fn try_take(&mut self, burst: f64, refill_per_sec: f64, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.updated).as_secs_f64();
        self.tokens = elapsed.mul_add(refill_per_sec, self.tokens).min(burst);
        self.updated = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// A full bucket is indistinguishable from an absent one, so it can be
    /// dropped when the table needs room.
    fn is_full(&self, burst: f64) -> bool {
        self.tokens >= burst
    }
}

/// Per-user token-bucket rate limiter.
pub struct UserRateLimiter {
    buckets: Mutex<HashMap<String, TokenBucket>>,
    burst: f64,
    refill_per_sec: f64,
}

impl UserRateLimiter {
    #[must_use]
    pub fn new(burst: f64, refill_per_sec: f64) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            burst,
            refill_per_sec,
        }
    }

    /// Spend one token for `user_id`, or refuse.
    pub async fn try_acquire(&self, user_id: &str) -> bool {
        self.try_acquire_at(user_id, Instant::now()).await
    }

    /// [`Self::try_acquire`] with an injected clock, for tests.
    async fn try_acquire_at(&self, user_id: &str, now: Instant) -> bool {
        let mut buckets = self.buckets.lock().await;
        if buckets.len() >= RATE_LIMIT_MAX_USERS {
            // Full buckets carry no state worth keeping.
            buckets.retain(|_, bucket| !bucket.is_full(self.burst));
            // Still full: evict the least recently touched entries. Clearing the
            // whole table would hand a fresh burst back to everyone currently
            // throttled, which an attacker holding enough tokens could trigger
            // on demand.
            while buckets.len() >= RATE_LIMIT_MAX_USERS {
                let Some(stalest) = buckets
                    .iter()
                    .min_by_key(|(_, bucket)| bucket.updated)
                    .map(|(key, _)| key.clone())
                else {
                    break;
                };
                buckets.remove(&stalest);
            }
        }
        buckets
            .entry(user_id.to_string())
            .or_insert_with(|| TokenBucket::new(self.burst, now))
            .try_take(self.burst, self.refill_per_sec, now)
    }
}

/// Budget for `POST /api/rooms/:id/advertise`.
#[must_use]
pub fn advertise_rate_limiter() -> UserRateLimiter {
    UserRateLimiter::new(ADVERTISE_BURST, ADVERTISE_REFILL_PER_SEC)
}

/// Budget for `GET /api/discord/targets`.
///
/// The listing is read-only but far from free: on a cold cache it fans out one
/// membership lookup plus channel/role reads per bot guild, all against the
/// bot's shared global Discord budget. More generous than `advertise` because a
/// share sheet legitimately refetches.
#[must_use]
pub fn targets_rate_limiter() -> UserRateLimiter {
    UserRateLimiter::new(TARGETS_BURST, TARGETS_REFILL_PER_SEC)
}

/// Which channels each room has been explicitly posted to by its host.
#[derive(Default)]
pub struct HostPostRegistry {
    rooms: RwLock<HashMap<String, BTreeSet<String>>>,
}

impl HostPostRegistry {
    /// Record that `room_id` must be advertised in `channel_id`. Idempotent.
    ///
    /// # Errors
    ///
    /// Returns [`AdvertiseRejection::TooManyAdverts`] when the room or the
    /// server is already at its advert ceiling.
    pub async fn register(
        &self,
        room_id: &str,
        channel_id: &str,
    ) -> Result<(), AdvertiseRejection> {
        let mut rooms = self.rooms.write().await;
        match rooms.get_mut(room_id) {
            Some(channels) => {
                if !channels.contains(channel_id) && channels.len() >= MAX_CHANNELS_PER_ROOM {
                    return Err(AdvertiseRejection::TooManyAdverts);
                }
                channels.insert(channel_id.to_string());
            }
            None => {
                if rooms.len() >= MAX_ADVERTISED_ROOMS {
                    return Err(AdvertiseRejection::TooManyAdverts);
                }
                rooms.insert(
                    room_id.to_string(),
                    BTreeSet::from([channel_id.to_string()]),
                );
            }
        }
        Ok(())
    }

    /// Drop one registration once its advert has been archived, so a recycled
    /// room id cannot inherit a stranger's channel.
    pub async fn forget(&self, room_id: &str, channel_id: &str) {
        let mut rooms = self.rooms.write().await;
        if let Some(channels) = rooms.get_mut(room_id) {
            channels.remove(channel_id);
            if channels.is_empty() {
                rooms.remove(room_id);
            }
        }
    }

    /// Drop every registration for a room, used when a room disappeared without
    /// an advert ever being posted (registered and then closed inside one sync
    /// interval, or the create call failed). Without this the registry would
    /// retain entries no reconcile pass can ever clear.
    pub async fn forget_room(&self, room_id: &str) {
        self.rooms.write().await.remove(room_id);
    }

    /// A snapshot for the planner.
    pub async fn snapshot(&self) -> HashMap<String, BTreeSet<String>> {
        self.rooms.read().await.clone()
    }
}

/// Everything the Discord integration needs at runtime, shared between the HTTP
/// handlers (which register host posts) and the background sync loop (which
/// applies them).
pub struct DiscordService {
    pub api: Arc<dyn DiscordApi>,
    pub directory: DiscordDirectory,
    pub registry: HostPostRegistry,
    pub rate_limiter: UserRateLimiter,
    pub targets_rate_limiter: UserRateLimiter,
    /// Frontend origin for Join links.
    pub app_base_url: String,
    /// Legacy billboard channel, when configured (#84).
    pub billboard_channel_id: Option<String>,
}

impl DiscordService {
    /// Build the service from the environment, or `None` when the feature is off.
    ///
    /// A privileged Supabase credential is **required for host posting to do
    /// anything**: it is the only trustworthy source of a caller's Discord
    /// identity (a token cannot be one — see `discord_targets`). Without it the
    /// billboard still works, so this warns rather than failing startup; the
    /// room server's own validation owns malformed-credential errors.
    #[must_use]
    pub fn from_env() -> Option<Arc<Self>> {
        let config = DiscordConfig::from_env()?;
        let supabase = SupabaseServiceConfig::from_env().ok().flatten();
        if supabase.is_none() {
            warn!(
                "[{}] Discord host posting is inert without a privileged Supabase credential (set SUPABASE_URL + SUPABASE_SECRET_KEY); the legacy billboard is unaffected",
                *INSTANCE_ID
            );
        }
        Some(Arc::new(Self::new(
            Arc::new(HttpDiscordApi::new(&config.bot_token)),
            supabase,
            config.app_base_url,
            config.channel_id,
        )))
    }

    /// Construct with an explicit API implementation (used by `from_env` and
    /// tests).
    #[must_use]
    pub fn new(
        api: Arc<dyn DiscordApi>,
        supabase: Option<SupabaseServiceConfig>,
        app_base_url: String,
        billboard_channel_id: Option<String>,
    ) -> Self {
        Self {
            directory: DiscordDirectory::new(api.clone(), supabase),
            api,
            registry: HostPostRegistry::default(),
            rate_limiter: advertise_rate_limiter(),
            targets_rate_limiter: targets_rate_limiter(),
            app_base_url,
            billboard_channel_id,
        }
    }

    /// Construct with an explicit identity source, so tests can exercise the
    /// endpoints without a live Supabase admin API.
    #[must_use]
    pub fn with_identity_lookup(
        api: Arc<dyn DiscordApi>,
        identity: Option<Arc<dyn IdentityLookup>>,
        app_base_url: String,
        billboard_channel_id: Option<String>,
    ) -> Self {
        Self {
            directory: DiscordDirectory::with_identity_lookup(api.clone(), identity),
            api,
            registry: HostPostRegistry::default(),
            rate_limiter: advertise_rate_limiter(),
            targets_rate_limiter: targets_rate_limiter(),
            app_base_url,
            billboard_channel_id,
        }
    }
}

/// Spawn the advertisement background task if the feature is enabled. Returns
/// `true` when a task was started, `false` when the bot is disabled (config
/// absent) — in which case the server behaves exactly as before.
pub fn spawn_if_enabled(
    service: Option<Arc<DiscordService>>,
    manager: Arc<RwLock<RoomManager>>,
) -> bool {
    let Some(service) = service else {
        info!(
            "[{}] Discord room bot disabled (set DISCORD_BOT_TOKEN and APP_BASE_URL to enable)",
            *INSTANCE_ID
        );
        return false;
    };

    info!(
        "[{}] Discord room bot enabled: host-posted room adverts every {}s (join links -> {}); legacy billboard channel {}",
        *INSTANCE_ID,
        SYNC_INTERVAL.as_secs(),
        service.app_base_url,
        service
            .billboard_channel_id
            .as_deref()
            .unwrap_or("not configured"),
    );

    tokio::spawn(async move {
        let mut tracked: HashMap<String, Vec<TrackedPost>> = HashMap::new();
        loop {
            // Registry BEFORE rooms, and the order is load-bearing. Read the
            // other way round, a registration accepted between the two reads
            // names a room the snapshot predates; `desired_adverts` finds no
            // matching room, so nothing is posted, and `prune_registrations`
            // then discards the registration as stale — silently losing a
            // request the host already got a 202 for. Taking the registry first
            // means every room named in `host_posts` was registered before the
            // room snapshot, so a live room is guaranteed to appear in it.
            let host_posts = service.registry.snapshot().await;
            let snapshots = collect_adverts(&manager).await;
            let desired = desired_adverts(
                &snapshots,
                service.billboard_channel_id.as_deref(),
                &host_posts,
            );
            reconcile(&service, &mut tracked, &desired).await;
            prune_registrations(&service, &snapshots, &tracked, &host_posts).await;
            tokio::time::sleep(SYNC_INTERVAL).await;
        }
    });
    true
}

/// Drop host-post registrations for rooms that are gone and have no tracked
/// post left to archive. A room registered and then closed inside one sync
/// interval never reaches [`SyncAction::Archive`], so without this sweep its
/// registration would occupy a [`MAX_ADVERTISED_ROOMS`] slot forever.
async fn prune_registrations(
    service: &DiscordService,
    snapshots: &[RoomSnapshot],
    tracked: &HashMap<String, Vec<TrackedPost>>,
    host_posts: &HashMap<String, BTreeSet<String>>,
) {
    for room_id in host_posts.keys() {
        let live = snapshots
            .iter()
            .any(|snapshot| &snapshot.advert.room_id == room_id);
        if !live && !tracked.contains_key(room_id) {
            service.registry.forget_room(room_id).await;
        }
    }
}

/// Stop wanting `(room_id, channel_id)` after a permanent Discord refusal.
///
/// A host-posted target is a registration, so dropping it is what actually ends
/// the retry loop. The billboard is deployment configuration and cannot be
/// unconfigured at runtime; it keeps retrying at the sync cadence, which is the
/// pre-existing #84 behaviour and an operator-visible misconfiguration rather
/// than something a guild member can provoke.
async fn retire_target(
    service: &DiscordService,
    kind: AdvertKind,
    room_id: &str,
    channel_id: &str,
) {
    if kind == AdvertKind::HostPosted {
        service.registry.forget(room_id, channel_id).await;
    }
}

/// Insert or replace the tracked post for `(room_id, channel_id)`.
fn remember(tracked: &mut HashMap<String, Vec<TrackedPost>>, post: TrackedPost) {
    let posts = tracked.entry(post.advert.room_id.clone()).or_default();
    posts.retain(|existing| existing.channel_id != post.channel_id);
    posts.push(post);
}

/// Stop tracking `(room_id, channel_id)`.
fn forget(tracked: &mut HashMap<String, Vec<TrackedPost>>, room_id: &str, channel_id: &str) {
    if let Some(posts) = tracked.get_mut(room_id) {
        posts.retain(|post| post.channel_id != channel_id);
        if posts.is_empty() {
            tracked.remove(room_id);
        }
    }
}

/// Apply one reconciliation pass. Network failures are logged, never propagated:
/// a Discord hiccup must never take down the physics server, and the next pass
/// simply retries.
pub async fn reconcile(
    service: &DiscordService,
    tracked: &mut HashMap<String, Vec<TrackedPost>>,
    desired: &[DesiredAdvert],
) {
    for action in plan_actions(tracked, desired, Instant::now()) {
        match action {
            SyncAction::Create {
                channel_id,
                kind,
                advert,
            } => {
                let payload = build_message_payload(&advert, &service.app_base_url);
                match service.api.create_message(&channel_id, &payload).await {
                    Ok(message_id) => {
                        debug!(
                            "[{}] Advertised room {} as message {message_id}",
                            *INSTANCE_ID, advert.room_id
                        );
                        remember(
                            tracked,
                            TrackedPost {
                                channel_id,
                                message_id,
                                kind,
                                advert,
                                posted_at: Instant::now(),
                            },
                        );
                    }
                    // The bot was kicked, lost SEND_MESSAGES, or the channel is
                    // gone. Nothing about the next pass will differ, so stop
                    // desiring this target instead of re-issuing the identical
                    // failing call every SYNC_INTERVAL forever.
                    Err(error) if is_terminal_for_resource(error) => {
                        warn!(
                            "[{}] Discord create is impossible for room {} ({error}); dropping the target",
                            *INSTANCE_ID, advert.room_id
                        );
                        retire_target(service, kind, &advert.room_id, &channel_id).await;
                    }
                    Err(error) => warn!(
                        "[{}] Discord create failed for room {}: {error}",
                        *INSTANCE_ID, advert.room_id
                    ),
                }
            }
            SyncAction::Update {
                channel_id,
                message_id,
                kind,
                advert,
            } => {
                let payload = build_message_payload(&advert, &service.app_base_url);
                let posted_at = tracked
                    .get(&advert.room_id)
                    .and_then(|posts| posts.iter().find(|p| p.channel_id == channel_id))
                    .map_or_else(Instant::now, |post| post.posted_at);
                match service
                    .api
                    .edit_message(&channel_id, &message_id, &payload)
                    .await
                {
                    Ok(()) => remember(
                        tracked,
                        TrackedPost {
                            channel_id,
                            message_id,
                            kind,
                            advert,
                            posted_at,
                        },
                    ),
                    // The message was deleted, or the bot lost the channel. The
                    // advert cannot be kept current, so stop tracking it and
                    // stop desiring the target — otherwise every pass for the
                    // life of the process re-issues the same failing PATCH.
                    Err(error) if is_terminal_for_resource(error) => {
                        warn!(
                            "[{}] Discord edit is impossible for room {} ({error}); dropping the advert",
                            *INSTANCE_ID, advert.room_id
                        );
                        forget(tracked, &advert.room_id, &channel_id);
                        retire_target(service, kind, &advert.room_id, &channel_id).await;
                    }
                    Err(error) => warn!(
                        "[{}] Discord edit failed for room {}: {error}",
                        *INSTANCE_ID, advert.room_id
                    ),
                }
            }
            SyncAction::Delete {
                room_id,
                channel_id,
                message_id,
            } => {
                if let Err(error) = service.api.delete_message(&channel_id, &message_id).await {
                    warn!(
                        "[{}] Discord delete failed for message {message_id}: {error}",
                        *INSTANCE_ID
                    );
                }
                // Dropped either way: the room is gone, so retrying an edit
                // against a possibly-deleted message buys nothing.
                forget(tracked, &room_id, &channel_id);
            }
            SyncAction::Archive {
                room_id,
                channel_id,
                message_id,
                advert,
                duration,
            } => {
                let payload = build_archive_payload(&advert, duration);
                match service
                    .api
                    .edit_message(&channel_id, &message_id, &payload)
                    .await
                {
                    Ok(()) => {
                        debug!(
                            "[{}] Archived the advert for closed room {room_id}",
                            *INSTANCE_ID
                        );
                        forget(tracked, &room_id, &channel_id);
                        service.registry.forget(&room_id, &channel_id).await;
                    }
                    // A message a moderator deleted (404), a channel the bot
                    // lost access to (403), or a gone resource (410) can never
                    // be archived. Retrying forever would pin the tracking entry
                    // and its registry slot for the process lifetime — a host
                    // could exhaust MAX_ADVERTISED_ROOMS just by deleting the
                    // bot's own messages. Give up on those.
                    Err(error) if is_terminal_for_resource(error) => {
                        warn!(
                            "[{}] Discord archive is impossible for room {room_id} ({error}); dropping it",
                            *INSTANCE_ID
                        );
                        forget(tracked, &room_id, &channel_id);
                        service.registry.forget(&room_id, &channel_id).await;
                    }
                    // Transient: keep tracking so the next pass retries, because
                    // an un-archived advert still shows a dead Join button.
                    Err(error) => warn!(
                        "[{}] Discord archive failed for room {room_id}: {error}",
                        *INSTANCE_ID
                    ),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::{MAX_DICE, MAX_PLAYERS, RECENT_ROLL_HISTORY};
    use crate::discord_targets::test_support::FakeDiscord;

    const BILLBOARD: &str = "800000000000000001";
    const HOST_CHANNEL: &str = "800000000000000002";
    const OTHER_CHANNEL: &str = "800000000000000003";

    fn advert(id: &str, players: usize) -> RoomAdvert {
        RoomAdvert {
            room_id: id.to_string(),
            name: Some("Taverna".to_string()),
            player_count: players,
            player_cap: 8,
            theme_id: Some("dungeon".to_string()),
            player_names: vec!["Alex".to_string()],
            recent_rolls: Vec::new(),
        }
    }

    fn die(dice_type: DiceType, face_value: u32) -> RecentRollDie {
        RecentRollDie { dice_type, face_value }
    }

    fn roll(player_name: &str, dice: Vec<RecentRollDie>) -> RecentRoll {
        let total = dice.iter().map(|d| d.face_value).sum();
        RecentRoll {
            player_id: "p1".to_string(),
            player_name: player_name.to_string(),
            saved_roll_name: None,
            dice,
            total,
        }
    }

    /// A roll that came from a saved roll of `saved_roll_name` (#244).
    fn named_roll(
        player_name: &str,
        saved_roll_name: &str,
        dice: Vec<RecentRollDie>,
    ) -> RecentRoll {
        RecentRoll {
            saved_roll_name: Some(saved_roll_name.to_string()),
            ..roll(player_name, dice)
        }
    }

    fn recent_rolls_field(payload: &serde_json::Value) -> Option<String> {
        field_value(payload, "Recent rolls")
    }

    fn field_value(payload: &serde_json::Value, name: &str) -> Option<String> {
        payload["embeds"][0]["fields"]
            .as_array()?
            .iter()
            .find(|f| f["name"] == name)?["value"]
            .as_str()
            .map(str::to_string)
    }

    fn tracked_post(
        channel_id: &str,
        message_id: &str,
        kind: AdvertKind,
        advert: RoomAdvert,
        posted_at: Instant,
    ) -> TrackedPost {
        TrackedPost {
            channel_id: channel_id.to_string(),
            message_id: message_id.to_string(),
            kind,
            advert,
            posted_at,
        }
    }

    fn tracked(posts: Vec<TrackedPost>) -> HashMap<String, Vec<TrackedPost>> {
        let mut map: HashMap<String, Vec<TrackedPost>> = HashMap::new();
        for post in posts {
            map.entry(post.advert.room_id.clone()).or_default().push(post);
        }
        map
    }

    fn desired(advert: RoomAdvert, targets: &[(&str, AdvertKind)]) -> DesiredAdvert {
        DesiredAdvert {
            advert,
            targets: targets
                .iter()
                .map(|(channel_id, kind)| AdvertTarget {
                    channel_id: (*channel_id).to_string(),
                    kind: *kind,
                })
                .collect(),
        }
    }

    fn service_with(api: Arc<FakeDiscord>, billboard: Option<&str>) -> DiscordService {
        DiscordService::new(
            api,
            None,
            "https://dicesuki.app".to_string(),
            billboard.map(str::to_string),
        )
    }

    #[test]
    fn join_url_trims_and_formats() {
        assert_eq!(
            join_url("https://dicesuki.app/", "abc123"),
            "https://dicesuki.app/room/abc123"
        );
        assert_eq!(
            join_url("https://dicesuki.app", "abc123"),
            "https://dicesuki.app/room/abc123"
        );
    }

    #[test]
    fn payload_carries_name_theme_players_and_join_button() {
        let payload = build_message_payload(&advert("abc123", 3), "https://dicesuki.app");
        let embed = &payload["embeds"][0];
        assert!(embed["title"].as_str().unwrap().contains("Taverna"));
        // Players field renders "count/cap".
        assert_eq!(embed["fields"][0]["name"], "Players");
        assert_eq!(embed["fields"][0]["value"], "3/8");
        assert_eq!(embed["fields"][1]["name"], "Theme");
        assert_eq!(embed["fields"][1]["value"], "dungeon");
        // Link button (type 2, style 5) with the room deep link.
        let button = &payload["components"][0]["components"][0];
        assert_eq!(button["type"], 2);
        assert_eq!(button["style"], 5);
        assert_eq!(button["url"], "https://dicesuki.app/room/abc123");
    }

    #[test]
    fn payload_falls_back_to_room_id_and_default_theme_when_unset() {
        let bare = RoomAdvert {
            room_id: "xyz".to_string(),
            name: None,
            player_count: 0,
            player_cap: 4,
            theme_id: None,
            player_names: Vec::new(),
            recent_rolls: Vec::new(),
        };
        let payload = build_message_payload(&bare, "https://dicesuki.app");
        let embed = &payload["embeds"][0];
        assert!(embed["title"].as_str().unwrap().contains("Room xyz"));
        assert_eq!(embed["fields"][1]["value"], "default");
        assert_eq!(embed["fields"][0]["value"], "0/4");
    }

    #[test]
    fn recent_rolls_field_is_absent_until_a_roll_completes() {
        let payload = build_message_payload(&advert("abc123", 1), "https://dicesuki.app");
        assert_eq!(payload["embeds"][0]["fields"].as_array().unwrap().len(), 2);
        assert!(recent_rolls_field(&payload).is_none());
    }

    #[test]
    fn recent_rolls_field_renders_newest_first_beside_players_and_theme() {
        let mut with_rolls = advert("abc123", 2);
        with_rolls.recent_rolls = vec![
            roll("Alex", vec![die(DiceType::D6, 5), die(DiceType::D6, 4)]),
            roll("Bo", vec![die(DiceType::D8, 3)]),
        ];
        let payload = build_message_payload(&with_rolls, "https://dicesuki.app");

        // Players/Theme keep their inline slots; rolls are a third, full-width field.
        let fields = payload["embeds"][0]["fields"].as_array().unwrap();
        assert_eq!(fields[0]["name"], "Players");
        assert_eq!(fields[1]["name"], "Theme");
        assert_eq!(fields[2]["name"], "Recent rolls");
        assert_eq!(fields[2]["inline"], false);
        assert_eq!(
            recent_rolls_field(&payload).unwrap(),
            "Bo \u{2014} 1d8 \u{2192} 3\nAlex \u{2014} 2d6 \u{2192} 9"
        );
    }

    #[test]
    fn roll_line_groups_mixed_pools_largest_die_first() {
        let line = roll_line(&roll(
            "Alex",
            vec![
                die(DiceType::D4, 2),
                die(DiceType::D6, 3),
                die(DiceType::D4, 1),
                die(DiceType::D6, 5),
                die(DiceType::D6, 2),
            ],
        ));
        assert_eq!(line, "Alex \u{2014} 3d6+2d4 \u{2192} 13 \u{1F480}");
    }

    #[test]
    fn roll_line_decorates_natural_max_and_min_per_die() {
        // Natural 20 and natural 1 on the same roll: one marker each, high first.
        let line = roll_line(&roll(
            "Alex",
            vec![die(DiceType::D20, 20), die(DiceType::D20, 1)],
        ));
        assert_eq!(line, "Alex \u{2014} 2d20 \u{2192} 21 \u{1F4A5}\u{1F480}");

        // A d10's engine faces read 0..=9, so 9 is the max and 0 the min.
        let line = roll_line(&roll(
            "Alex",
            vec![die(DiceType::D10, 9), die(DiceType::D10, 0)],
        ));
        assert_eq!(line, "Alex \u{2014} 2d10 \u{2192} 9 \u{1F4A5}\u{1F480}");

        // Mid-range faces are never decorated.
        let line = roll_line(&roll("Alex", vec![die(DiceType::D12, 7)]));
        assert_eq!(line, "Alex \u{2014} 1d12 \u{2192} 7");
    }

    #[test]
    fn roll_line_never_decorates_the_percentile_tens_die() {
        // `00` reads as 100 when paired with a `0` ones die, so neither extreme
        // of the tens die is unambiguously a crit.
        let line = roll_line(&roll(
            "Alex",
            vec![die(DiceType::D10Tens, 0), die(DiceType::D10, 5)],
        ));
        assert_eq!(line, "Alex \u{2014} 1d%+1d10 \u{2192} 5");
    }

    #[test]
    fn roll_line_collapses_crit_runs_past_the_repeat_limit() {
        let three = roll_line(&roll("Alex", vec![die(DiceType::D6, 6); 3]));
        assert_eq!(three, "Alex \u{2014} 3d6 \u{2192} 18 \u{1F4A5}\u{1F4A5}\u{1F4A5}");

        let many = roll_line(&roll("Alex", vec![die(DiceType::D6, 6); 9]));
        assert_eq!(many, "Alex \u{2014} 9d6 \u{2192} 54 \u{1F4A5}\u{00D7}9");
    }

    /// The embeds land in **third-party guilds**, so a crafted display name,
    /// themeId, or saved-roll name must never become a live masked link under
    /// the bot's identity.
    #[test]
    fn masked_link_payloads_render_inert_in_both_payload_builders() {
        const ATTACK: &str = "[x](http://evil)";

        let mut hostile = advert("abc123", 1);
        hostile.theme_id = Some(ATTACK.to_string());
        hostile.player_names = vec![ATTACK.to_string()];
        // Both client-supplied strings on a roll line at once (#244): the
        // roller's display name and the saved-roll name it rode in with.
        hostile.recent_rolls = vec![named_roll(ATTACK, ATTACK, vec![die(DiceType::D6, 3)])];

        const INERT: &str = "\\[x\\]\\(http://evil\\)";

        let live = build_message_payload(&hostile, "https://dicesuki.app");
        let archived = build_archive_payload(&hostile, Duration::from_secs(60));

        for payload in [&live, &archived] {
            // The link construct must not survive anywhere in the embed. An
            // escaped rendering interleaves backslashes, so this substring can
            // only appear if the escaping was skipped.
            assert!(
                !payload.to_string().contains("[x](http://evil)"),
                "an unescaped masked link reached the embed: {payload}"
            );
        }

        // Live embed: themeId and the roll's display name are both neutralised.
        assert_eq!(field_value(&live, "Theme").unwrap(), INERT);
        let rolls = recent_rolls_field(&live).unwrap();
        assert!(rolls.starts_with(INERT));
        assert_eq!(
            rolls.matches(INERT).count(),
            2,
            "display name AND saved-roll name must both be escaped: {rolls}",
        );
        assert_eq!(
            rolls,
            format!("{INERT} \u{2014} {INERT} (1d6) \u{2192} 3"),
        );

        // Archived embed: the final roster and the roll tail likewise.
        assert_eq!(field_value(&archived, "Players").unwrap(), INERT);
        assert!(field_value(&archived, "Last rolls").unwrap().starts_with(INERT));
    }

    #[test]
    fn theme_label_is_capped_and_falls_back() {
        // Room::update_settings accepts any non-empty string, so the cap lives
        // here. Escaping must not let a long value slip past it either.
        let long = "t".repeat(200);
        assert_eq!(render_theme_label(Some(&long)).chars().count(), THEME_LABEL_MAX_LEN);
        assert_eq!(render_theme_label(None), "default");
        assert_eq!(render_theme_label(Some("")), "default");
        assert_eq!(render_theme_label(Some("   ")), "default");
        assert_eq!(render_theme_label(Some("dungeon")), "dungeon");
    }

    #[test]
    fn roll_line_neutralises_hostile_display_names() {
        let line = roll_line(&roll("**Bo**\nrogue", vec![die(DiceType::D6, 3)]));
        assert_eq!(line, "\\*\\*Bo\\*\\* rogue \u{2014} 1d6 \u{2192} 3");

        let long = roll_line(&roll(&"n".repeat(80), vec![die(DiceType::D6, 3)]));
        assert!(long.starts_with(&"n".repeat(ROLL_NAME_MAX_LEN)));
        assert!(!long.contains(&"n".repeat(ROLL_NAME_MAX_LEN + 1)));

        let blank = roll_line(&roll("   ", vec![die(DiceType::D6, 3)]));
        assert_eq!(blank, "Player \u{2014} 1d6 \u{2192} 3");
    }

    /// Discord rejects an embed field whose value exceeds 1024 characters, and
    /// the whole embed with it — so a hostile room would stop advertising
    /// entirely. Naming saved rolls (#244) added a second capped client string
    /// to every line, so the worst case is asserted rather than reasoned about:
    /// a full ring of rolls, each with a max-length all-escapable player name
    /// and saved-roll name (escaping doubles both), a full table of dice spread
    /// across every type, and every die landing a crit.
    #[test]
    fn a_full_ring_of_hostile_roll_lines_stays_inside_discords_field_limit() {
        const DISCORD_FIELD_VALUE_LIMIT: usize = 1024;

        // Every character escapes to two, and none are collapsed as whitespace.
        let hostile_name = "*".repeat(ROLL_NAME_MAX_LEN * 4);
        let hostile_saved = "_".repeat(SAVED_ROLL_LABEL_MAX_LEN * 4);

        // A full table (MAX_DICE), spread so every die type contributes a group
        // to the expression, and every face is a natural max (a crit each).
        let dice: Vec<RecentRollDie> = DIE_RENDER_ORDER
            .iter()
            .flat_map(|die_type| {
                let max_face = die_type.natural_faces().map_or(1, |(_, max)| max);
                std::iter::repeat_n(die(*die_type, max_face), MAX_DICE)
            })
            .collect();

        let mut hostile = advert("abc123", MAX_PLAYERS);
        hostile.recent_rolls = (0..RECENT_ROLL_HISTORY)
            .map(|_| named_roll(&hostile_name, &hostile_saved, dice.clone()))
            .collect();

        let payload = build_message_payload(&hostile, "https://dicesuki.app");
        let field = recent_rolls_field(&payload).unwrap();

        // Discord counts UTF-16 code units, so emoji cost two apiece.
        assert!(
            field.encode_utf16().count() <= DISCORD_FIELD_VALUE_LIMIT,
            "recent-rolls field is {} UTF-16 units, over Discord's {DISCORD_FIELD_VALUE_LIMIT}:\n{field}",
            field.encode_utf16().count(),
        );
    }

    /// Issue #244's whole point: the line has to say *what* was rolled, not
    /// just the pool, and only when the roll actually came from a saved roll.
    #[test]
    fn roll_line_names_the_saved_roll_it_came_from() {
        let dice = vec![die(DiceType::D6, 5), die(DiceType::D6, 6), die(DiceType::D6, 3)];

        assert_eq!(
            roll_line(&named_roll("Alex", "Sneak Attack", dice.clone())),
            "Alex \u{2014} Sneak Attack (3d6) \u{2192} 14 \u{1F4A5}",
        );
        assert_eq!(
            roll_line(&roll("Alex", dice)),
            "Alex \u{2014} 3d6 \u{2192} 14 \u{1F4A5}",
            "a plain roll must keep the bare pool expression",
        );
    }

    /// The saved-roll name is client text with no server-side validation of its
    /// content, so it goes through the same door as a display name: escaped,
    /// capped, and never able to open a markdown construct.
    #[test]
    fn saved_roll_names_are_neutralised_and_capped_in_roll_lines() {
        let dice = vec![die(DiceType::D6, 3)];

        let hostile = roll_line(&named_roll("Alex", "**Crit**\n`fish`", dice.clone()));
        assert_eq!(
            hostile,
            "Alex \u{2014} \\*\\*Crit\\*\\* \\`fish\\` (1d6) \u{2192} 3",
        );

        // The render cap holds independently of core's ingestion cap, and
        // escaping must not smuggle characters past it.
        let long = roll_line(&named_roll("Alex", &"s".repeat(200), dice.clone()));
        assert!(long.contains(&"s".repeat(SAVED_ROLL_LABEL_MAX_LEN)));
        assert!(!long.contains(&"s".repeat(SAVED_ROLL_LABEL_MAX_LEN + 1)));

        // Core drops a blank name, but the renderer must not emit `()`-adjacent
        // emptiness if one ever reaches it another way.
        assert_eq!(
            roll_line(&named_roll("Alex", "   ", dice)),
            "Alex \u{2014} Saved roll (1d6) \u{2192} 3",
        );
    }

    // --- archived (closed-session) rendering -------------------------------

    #[test]
    fn archive_payload_removes_the_join_button_and_summarises_the_session() {
        let mut closed = advert("abc123", 3);
        closed.player_names = vec!["Alex".to_string(), "Bo".to_string(), "Cy".to_string()];
        closed.recent_rolls = vec![roll("Bo", vec![die(DiceType::D20, 20)])];

        let payload = build_archive_payload(&closed, Duration::from_secs(4_500));

        assert_eq!(
            payload["components"].as_array().unwrap().len(),
            0,
            "the dead Join button is removed"
        );
        assert!(!payload.to_string().contains("/room/abc123"));
        assert_eq!(field_value(&payload, "Players").unwrap(), "Alex, Bo, Cy");
        assert_eq!(field_value(&payload, "Session length").unwrap(), "1h 15m");
        assert_eq!(
            field_value(&payload, "Last rolls").unwrap(),
            "Bo \u{2014} 1d20 \u{2192} 20 \u{1F4A5}"
        );
        assert_eq!(payload["embeds"][0]["color"], ARCHIVED_EMBED_COLOR);
    }

    #[test]
    fn archive_roster_escapes_names_and_caps_the_tail() {
        let names: Vec<String> = (0..15).map(|i| format!("player{i}")).collect();
        let roster = render_player_roster(&names);
        assert!(roster.ends_with("+3 more"));

        assert_eq!(render_player_roster(&["**Bo**".to_string()]), "\\*\\*Bo\\*\\*");
        assert_eq!(render_player_roster(&[]), "Nobody was left at the table");
    }

    #[test]
    fn durations_render_in_human_units() {
        assert_eq!(render_duration(Duration::from_secs(20)), "<1m");
        assert_eq!(render_duration(Duration::from_secs(240)), "4m");
        assert_eq!(render_duration(Duration::from_secs(3_600)), "1h 0m");
        assert_eq!(render_duration(Duration::from_secs(7_380)), "2h 3m");
    }

    // --- planner ----------------------------------------------------------

    #[test]
    fn plan_creates_for_new_rooms() {
        let now = Instant::now();
        let actions = plan_actions(
            &HashMap::new(),
            &[
                desired(advert("a", 1), &[(BILLBOARD, AdvertKind::Billboard)]),
                desired(advert("b", 2), &[(HOST_CHANNEL, AdvertKind::HostPosted)]),
            ],
            now,
        );
        assert_eq!(actions.len(), 2);
        assert!(actions
            .iter()
            .all(|a| matches!(a, SyncAction::Create { .. })));
    }

    #[test]
    fn plan_skips_unchanged_and_updates_changed() {
        let now = Instant::now();
        let map = tracked(vec![
            tracked_post(BILLBOARD, "m-a", AdvertKind::Billboard, advert("a", 1), now),
            tracked_post(BILLBOARD, "m-b", AdvertKind::Billboard, advert("b", 1), now),
        ]);
        // Room "a" unchanged; room "b" gained a player.
        let actions = plan_actions(
            &map,
            &[
                desired(advert("a", 1), &[(BILLBOARD, AdvertKind::Billboard)]),
                desired(advert("b", 2), &[(BILLBOARD, AdvertKind::Billboard)]),
            ],
            now,
        );
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            SyncAction::Update { message_id, advert, .. } => {
                assert_eq!(message_id, "m-b");
                assert_eq!(advert.player_count, 2);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn plan_updates_when_a_roll_is_appended() {
        let now = Instant::now();
        let mut posted = advert("a", 1);
        posted.recent_rolls = vec![roll("Alex", vec![die(DiceType::D6, 4)])];
        let map = tracked(vec![tracked_post(
            BILLBOARD,
            "m-a",
            AdvertKind::Billboard,
            posted.clone(),
            now,
        )]);

        // Same players, same theme — only a new roll landed.
        let mut rolled = posted.clone();
        rolled.recent_rolls.push(roll("Bo", vec![die(DiceType::D20, 20)]));

        let actions = plan_actions(
            &map,
            &[desired(rolled, &[(BILLBOARD, AdvertKind::Billboard)])],
            now,
        );
        match actions.as_slice() {
            [SyncAction::Update { message_id, advert, .. }] => {
                assert_eq!(message_id, "m-a");
                assert_eq!(advert.recent_rolls.len(), 2);
            }
            other => panic!("expected a single Update, got {other:?}"),
        }

        // Replaying the same state plans nothing: no churn without a real change.
        assert!(plan_actions(
            &map,
            &[desired(posted, &[(BILLBOARD, AdvertKind::Billboard)])],
            now
        )
        .is_empty());
    }

    #[test]
    fn plan_deletes_billboard_posts_for_vanished_rooms() {
        let now = Instant::now();
        let map = tracked(vec![tracked_post(
            BILLBOARD,
            "m-gone",
            AdvertKind::Billboard,
            advert("gone", 1),
            now,
        )]);
        assert_eq!(
            plan_actions(&map, &[], now),
            vec![SyncAction::Delete {
                room_id: "gone".to_string(),
                channel_id: BILLBOARD.to_string(),
                message_id: "m-gone".to_string()
            }]
        );
    }

    #[test]
    fn plan_archives_host_posted_adverts_instead_of_deleting_them() {
        let start = Instant::now();
        let final_state = advert("gone", 2);
        let map = tracked(vec![tracked_post(
            HOST_CHANNEL,
            "m-gone",
            AdvertKind::HostPosted,
            final_state.clone(),
            start,
        )]);

        let actions = plan_actions(&map, &[], start + Duration::from_secs(1_800));
        match actions.as_slice() {
            [SyncAction::Archive { room_id, channel_id, message_id, advert, duration }] => {
                assert_eq!(room_id, "gone");
                assert_eq!(channel_id, HOST_CHANNEL);
                assert_eq!(message_id, "m-gone");
                // The archive renders the LAST known state of the room.
                assert_eq!(advert, &final_state);
                assert_eq!(*duration, Duration::from_secs(1_800));
            }
            other => panic!("expected a single Archive, got {other:?}"),
        }
    }

    #[test]
    fn plan_diffs_each_channel_of_a_multi_channel_room_independently() {
        let now = Instant::now();
        // Posted to the billboard and one host channel; only the host channel's
        // copy is stale.
        let map = tracked(vec![
            tracked_post(BILLBOARD, "m-bb", AdvertKind::Billboard, advert("a", 2), now),
            tracked_post(
                HOST_CHANNEL,
                "m-host",
                AdvertKind::HostPosted,
                advert("a", 1),
                now,
            ),
        ]);
        let actions = plan_actions(
            &map,
            &[desired(
                advert("a", 2),
                &[
                    (BILLBOARD, AdvertKind::Billboard),
                    (HOST_CHANNEL, AdvertKind::HostPosted),
                    (OTHER_CHANNEL, AdvertKind::HostPosted),
                ],
            )],
            now,
        );

        assert_eq!(actions.len(), 2, "one edit and one create, nothing else");
        assert!(actions.iter().any(|a| matches!(
            a,
            SyncAction::Update { message_id, .. } if message_id == "m-host"
        )));
        assert!(actions.iter().any(|a| matches!(
            a,
            SyncAction::Create { channel_id, kind: AdvertKind::HostPosted, .. }
                if channel_id == OTHER_CHANNEL
        )));
    }

    #[test]
    fn a_billboard_post_a_host_then_claims_is_re_tracked_as_host_posted() {
        // The room is public (so the billboard already carries it) and its host
        // then posts it to that same channel. The tracked post must switch
        // lifecycle, or closing the room would DELETE the host's session record.
        let now = Instant::now();
        let map = tracked(vec![tracked_post(
            BILLBOARD,
            "m-bb",
            AdvertKind::Billboard,
            advert("a", 1),
            now,
        )]);
        let actions = plan_actions(
            &map,
            &[desired(advert("a", 1), &[(BILLBOARD, AdvertKind::HostPosted)])],
            now,
        );
        match actions.as_slice() {
            [SyncAction::Update { kind, message_id, .. }] => {
                assert_eq!(*kind, AdvertKind::HostPosted);
                assert_eq!(message_id, "m-bb");
            }
            other => panic!("expected the post to be re-tracked, got {other:?}"),
        }
    }

    #[test]
    fn plan_retires_only_the_channel_that_was_dropped() {
        let now = Instant::now();
        let map = tracked(vec![
            tracked_post(BILLBOARD, "m-bb", AdvertKind::Billboard, advert("a", 1), now),
            tracked_post(
                HOST_CHANNEL,
                "m-host",
                AdvertKind::HostPosted,
                advert("a", 1),
                now,
            ),
        ]);
        // The room went unlisted: the billboard copy goes, the host copy stays.
        let actions = plan_actions(
            &map,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
            now,
        );
        assert_eq!(
            actions,
            vec![SyncAction::Delete {
                room_id: "a".to_string(),
                channel_id: BILLBOARD.to_string(),
                message_id: "m-bb".to_string(),
            }]
        );
    }

    // --- desired-state resolution ------------------------------------------

    fn snapshot(id: &str, is_public: bool) -> RoomSnapshot {
        RoomSnapshot {
            advert: advert(id, 1),
            is_public,
        }
    }

    #[test]
    fn the_billboard_carries_public_rooms_only_and_is_optional() {
        let snapshots = vec![snapshot("pub", true), snapshot("unlisted", false)];
        let with_billboard = desired_adverts(&snapshots, Some(BILLBOARD), &HashMap::new());
        assert_eq!(with_billboard.len(), 1);
        assert_eq!(with_billboard[0].advert.room_id, "pub");

        // No DISCORD_CHANNEL_ID configured: nothing is advertised on its own.
        assert!(desired_adverts(&snapshots, None, &HashMap::new()).is_empty());
    }

    #[test]
    fn a_host_posted_room_is_advertised_even_when_unlisted() {
        let host_posts = HashMap::from([(
            "unlisted".to_string(),
            BTreeSet::from([HOST_CHANNEL.to_string()]),
        )]);
        let desired = desired_adverts(&[snapshot("unlisted", false)], None, &host_posts);
        assert_eq!(desired.len(), 1);
        assert_eq!(
            desired[0].targets,
            vec![AdvertTarget {
                channel_id: HOST_CHANNEL.to_string(),
                kind: AdvertKind::HostPosted
            }]
        );
    }

    #[test]
    fn a_host_post_into_the_billboard_channel_keeps_the_archiving_lifecycle() {
        let host_posts = HashMap::from([(
            "pub".to_string(),
            BTreeSet::from([BILLBOARD.to_string()]),
        )]);
        let desired = desired_adverts(&[snapshot("pub", true)], Some(BILLBOARD), &host_posts);
        assert_eq!(desired[0].targets.len(), 1, "not posted twice");
        assert_eq!(desired[0].targets[0].kind, AdvertKind::HostPosted);
    }

    #[test]
    fn a_registration_for_a_room_that_no_longer_exists_desires_nothing() {
        let host_posts = HashMap::from([(
            "ghost".to_string(),
            BTreeSet::from([HOST_CHANNEL.to_string()]),
        )]);
        assert!(desired_adverts(&[], None, &host_posts).is_empty());
    }

    // --- advertise authorization -------------------------------------------

    fn verified(channels: &[&str]) -> BTreeSet<String> {
        channels.iter().map(|c| (*c).to_string()).collect()
    }

    #[test]
    fn advertise_requires_the_caller_to_be_the_room_host() {
        let channels = verified(&[HOST_CHANNEL]);
        assert_eq!(
            authorize_advertise(Some("host-user"), "host-user", HOST_CHANNEL, &channels),
            Ok(())
        );
        assert_eq!(
            authorize_advertise(Some("host-user"), "someone-else", HOST_CHANNEL, &channels),
            Err(AdvertiseRejection::NotHost)
        );
        // A guest-hosted (or empty) room has no provable owner.
        assert_eq!(
            authorize_advertise(None, "someone", HOST_CHANNEL, &channels),
            Err(AdvertiseRejection::NotHost)
        );
    }

    #[test]
    fn advertise_rejects_channels_outside_the_callers_verified_guilds() {
        // The caller IS the host, and the channel is a perfectly real Discord
        // channel — but not one their own membership was verified for.
        assert_eq!(
            authorize_advertise(
                Some("host-user"),
                "host-user",
                OTHER_CHANNEL,
                &verified(&[HOST_CHANNEL])
            ),
            Err(AdvertiseRejection::ChannelNotVerified)
        );
        // A caller with no verified channels at all (no Discord identity, or no
        // shared guild) can never advertise.
        assert_eq!(
            authorize_advertise(Some("host-user"), "host-user", HOST_CHANNEL, &BTreeSet::new()),
            Err(AdvertiseRejection::ChannelNotVerified)
        );
        // A malformed channel id never reaches Discord.
        assert_eq!(
            authorize_advertise(
                Some("host-user"),
                "host-user",
                "../../channels/@me",
                &verified(&[HOST_CHANNEL])
            ),
            Err(AdvertiseRejection::ChannelNotVerified)
        );
    }

    #[test]
    fn rejections_map_to_stable_codes_and_statuses() {
        assert_eq!(AdvertiseRejection::NotHost.status(), 403);
        assert_eq!(AdvertiseRejection::ChannelNotVerified.status(), 403);
        assert_eq!(AdvertiseRejection::NoDiscordIdentity.status(), 403);
        assert_eq!(AdvertiseRejection::RoomNotFound.status(), 404);
        assert_eq!(AdvertiseRejection::RateLimited.status(), 429);
        assert_eq!(AdvertiseRejection::NotHost.code(), "NOT_ROOM_HOST");
    }

    // --- registry and rate limiting ----------------------------------------

    #[tokio::test]
    async fn the_registry_is_idempotent_and_bounded_per_room() {
        let registry = HostPostRegistry::default();
        for _ in 0..3 {
            registry.register("room", HOST_CHANNEL).await.unwrap();
        }
        assert_eq!(registry.snapshot().await["room"].len(), 1);

        for i in 0..MAX_CHANNELS_PER_ROOM {
            registry
                .register("room", &format!("90000000000000000{i}"))
                .await
                .ok();
        }
        assert_eq!(
            registry.register("room", "999999999999999999").await,
            Err(AdvertiseRejection::TooManyAdverts)
        );

        registry.forget("room", HOST_CHANNEL).await;
        assert!(!registry.snapshot().await["room"].contains(HOST_CHANNEL));
    }

    #[tokio::test]
    async fn an_unarchivable_advert_is_dropped_instead_of_retried_forever() {
        // A host advertises a room in a guild they control, deletes the bot's
        // message, then closes the room. The archive can never succeed, so it
        // must not pin its tracking entry and registry slot for the process
        // lifetime — 512 of those would lock every host out of the feature.
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api, None);
        service.registry.register("a", HOST_CHANNEL).await.unwrap();
        let mut tracked = HashMap::new();
        reconcile(
            &service,
            &mut tracked,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        let gone = Arc::new({
            let mut fake = FakeDiscord::new("400000000000000001");
            // Discord's answer for a message that no longer exists.
            fake.failure = Some(crate::discord_api::DiscordApiError::Status(404));
            fake
        });
        let broken = service_with(gone, None);
        // The registry is shared with the live service in production; here the
        // tracked map is what matters for the leak.
        reconcile(&broken, &mut tracked, &[]).await;
        assert!(
            tracked.is_empty(),
            "a permanently unarchivable advert must be dropped"
        );
    }

    #[tokio::test]
    async fn a_permanently_refused_create_stops_being_desired() {
        // The bot was kicked from the guild (403). Re-issuing the identical POST
        // every 30s for the life of the process helps nobody, so the host-posted
        // registration is retired.
        let mut fake = FakeDiscord::new("400000000000000001");
        fake.failure = Some(crate::discord_api::DiscordApiError::Status(403));
        let service = service_with(Arc::new(fake), None);
        service.registry.register("a", HOST_CHANNEL).await.unwrap();

        let mut tracked = HashMap::new();
        reconcile(
            &service,
            &mut tracked,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        assert!(tracked.is_empty());
        assert!(
            service.registry.snapshot().await.is_empty(),
            "a channel the bot cannot post to is dropped, not retried forever"
        );
    }

    #[tokio::test]
    async fn a_permanently_refused_edit_drops_the_advert() {
        // Post successfully, then a moderator deletes the message (404 on PATCH).
        let live = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(live, None);
        service.registry.register("a", HOST_CHANNEL).await.unwrap();
        let mut tracked = HashMap::new();
        reconcile(
            &service,
            &mut tracked,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;
        assert_eq!(tracked["a"].len(), 1);

        let mut gone = FakeDiscord::new("400000000000000001");
        gone.failure = Some(crate::discord_api::DiscordApiError::Status(404));
        let broken = service_with(Arc::new(gone), None);
        broken.registry.register("a", HOST_CHANNEL).await.unwrap();
        // A changed advert forces an edit, which now fails permanently.
        reconcile(
            &broken,
            &mut tracked,
            &[desired(advert("a", 2), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        assert!(tracked.is_empty(), "a deleted message stops being tracked");
        assert!(broken.registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn a_transient_create_failure_is_still_retried() {
        // 500/network must NOT retire the target — only permanent refusals do.
        let mut flaky = FakeDiscord::new("400000000000000001");
        flaky.failure = Some(crate::discord_api::DiscordApiError::Status(500));
        let service = service_with(Arc::new(flaky), None);
        service.registry.register("a", HOST_CHANNEL).await.unwrap();

        reconcile(
            &service,
            &mut HashMap::new(),
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        assert!(
            !service.registry.snapshot().await.is_empty(),
            "a transient failure keeps the registration for the next pass"
        );
    }

    #[tokio::test]
    async fn a_full_rate_limit_table_evicts_rather_than_handing_everyone_a_new_burst() {
        let limiter = advertise_rate_limiter();
        let start = Instant::now();
        // Exhaust one user's budget, then flood the table with fresh users.
        for _ in 0..(ADVERTISE_BURST as usize) {
            assert!(limiter.try_acquire_at("victim", start).await);
        }
        assert!(!limiter.try_acquire_at("victim", start).await);

        for i in 0..RATE_LIMIT_MAX_USERS {
            // Each new user spends one token, so no bucket is full and the
            // "drop full buckets" pass cannot reclaim anything.
            limiter
                .try_acquire_at(&format!("flood-{i}"), start)
                .await;
        }

        assert!(
            !limiter.try_acquire_at("victim", start).await,
            "flooding the table must not restore a throttled user's burst"
        );
    }

    #[tokio::test]
    async fn a_registration_whose_room_died_before_it_was_posted_is_pruned() {
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api, None);
        service.registry.register("ghost", HOST_CHANNEL).await.unwrap();

        // The room is gone and nothing was ever posted for it, so there is no
        // advert to archive — the registration must not linger.
        let host_posts = service.registry.snapshot().await;
        prune_registrations(&service, &[], &HashMap::new(), &host_posts).await;
        assert!(service.registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn a_registration_with_a_posted_advert_survives_until_it_is_archived() {
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api, None);
        service.registry.register("a", HOST_CHANNEL).await.unwrap();
        let mut tracked = HashMap::new();
        reconcile(
            &service,
            &mut tracked,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        // Room closed, but its advert is still tracked and awaiting archival.
        let host_posts = service.registry.snapshot().await;
        prune_registrations(&service, &[], &tracked, &host_posts).await;
        assert!(!service.registry.snapshot().await.is_empty());

        // Once archived, the reconciler drops it and the sweep finds nothing.
        reconcile(&service, &mut tracked, &[]).await;
        assert!(service.registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn advertise_rate_limit_spends_a_burst_then_refills() {
        let limiter = advertise_rate_limiter();
        let start = Instant::now();
        for _ in 0..(ADVERTISE_BURST as usize) {
            assert!(limiter.try_acquire_at("user", start).await);
        }
        assert!(
            !limiter.try_acquire_at("user", start).await,
            "the burst is exhausted"
        );
        // A different user has their own budget.
        assert!(limiter.try_acquire_at("other", start).await);
        // Thirty seconds later one token is back.
        assert!(limiter
            .try_acquire_at("user", start + Duration::from_secs(31))
            .await);
    }

    // --- reconciliation against a scripted Discord --------------------------

    #[tokio::test]
    async fn reconcile_creates_then_archives_a_host_posted_advert() {
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api.clone(), None);
        let mut tracked = HashMap::new();

        let live = desired(advert("a", 2), &[(HOST_CHANNEL, AdvertKind::HostPosted)]);
        reconcile(&service, &mut tracked, std::slice::from_ref(&live)).await;
        assert_eq!(api.created.lock().unwrap().len(), 1);
        assert_eq!(tracked["a"].len(), 1);

        // Unchanged state plans nothing.
        reconcile(&service, &mut tracked, std::slice::from_ref(&live)).await;
        assert_eq!(api.edited.lock().unwrap().len(), 0);

        // Room closes: the message is PATCHed into an archive, never deleted.
        reconcile(&service, &mut tracked, &[]).await;
        assert!(tracked.is_empty());
        assert!(api.deleted.lock().unwrap().is_empty(), "never deleted");
        let edited = api.edited.lock().unwrap();
        assert_eq!(edited.len(), 1);
        assert_eq!(edited[0].0, HOST_CHANNEL);
        assert_eq!(edited[0].2["components"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn reconcile_deletes_billboard_posts_on_close() {
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api.clone(), Some(BILLBOARD));
        let mut tracked = HashMap::new();

        let live = desired(advert("a", 1), &[(BILLBOARD, AdvertKind::Billboard)]);
        reconcile(&service, &mut tracked, std::slice::from_ref(&live)).await;
        reconcile(&service, &mut tracked, &[]).await;

        assert_eq!(api.deleted.lock().unwrap().len(), 1);
        assert!(tracked.is_empty());
    }

    #[tokio::test]
    async fn a_failed_archive_is_retried_on_the_next_pass() {
        let api = Arc::new(FakeDiscord::new("400000000000000001"));
        let service = service_with(api.clone(), None);
        let mut tracked = HashMap::new();
        reconcile(
            &service,
            &mut tracked,
            &[desired(advert("a", 1), &[(HOST_CHANNEL, AdvertKind::HostPosted)])],
        )
        .await;

        // Discord is unavailable when the room closes.
        let failing = Arc::new({
            let mut fake = FakeDiscord::new("400000000000000001");
            fake.failure = Some(crate::discord_api::DiscordApiError::Transport);
            fake
        });
        let broken = service_with(failing, None);
        reconcile(&broken, &mut tracked, &[]).await;
        assert!(
            tracked.contains_key("a"),
            "still tracked, so the archive is retried"
        );

        reconcile(&service, &mut tracked, &[]).await;
        assert!(tracked.is_empty());
        assert_eq!(api.edited.lock().unwrap().len(), 1);
    }

    #[test]
    fn config_disabled_when_env_absent() {
        // Not set in the unit-test environment -> feature resolves to None.
        if std::env::var("DISCORD_BOT_TOKEN").is_err() && std::env::var("APP_BASE_URL").is_err() {
            assert!(DiscordConfig::from_env().is_none());
        }
    }

    #[test]
    fn config_never_renders_the_bot_token() {
        let config = DiscordConfig {
            bot_token: "super-secret-bot-token".to_string(),
            channel_id: Some(BILLBOARD.to_string()),
            app_base_url: "https://dicesuki.app".to_string(),
        };
        assert!(!format!("{config:?}").contains("super-secret-bot-token"));
    }
}
