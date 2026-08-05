//! Discord room-advertisement bot (issue #84).
//!
//! Posts and keeps up to date one room-status embed **per public room** in a
//! configured Discord channel, each with a link-button **Join** that opens the
//! room's deep link (issue #85). Driven entirely by the in-memory rooms registry
//! (`RoomManager`), server-side, over Discord's REST API — no gateway/WebSocket
//! connection and no interaction handling are required (a style-5 *link* button
//! carries a URL and needs no callback).
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
//! Off by default. Activates only when all three are set (empty = absent):
//!
//! * `DISCORD_BOT_TOKEN`  — bot token, sent as `Authorization: Bot <token>`.
//!   **Never committed** — supplied via env/secret storage.
//! * `DISCORD_CHANNEL_ID` — snowflake id of the channel to post into.
//! * `APP_BASE_URL`       — the *frontend* origin (e.g. `https://dicesuki.app`)
//!   used to build room deep links `<APP_BASE_URL>/room/<id>`. Distinct from the
//!   registry's `PUBLIC_URL`, which is the room *server's* own base.
//!
//! When any is absent the bot is silently OFF and the server runs unchanged.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use log::{debug, info, warn};
use tokio::sync::RwLock;

use crate::messages::DiceType;
use crate::room::{RecentRoll, RecentRollDie};
use crate::room_manager::RoomManager;
use crate::INSTANCE_ID;

/// Discord REST base. v10 is the current stable API version.
const DISCORD_API_BASE: &str = "https://discord.com/api/v10";

/// How often the bot reconciles its posted embeds against live room state.
/// Matches the registry heartbeat cadence: responsive enough that a new room is
/// advertised within half a minute, infrequent enough that edit volume stays far
/// under Discord's rate limits (edits are only issued when a room's advertised
/// state actually changes).
pub const SYNC_INTERVAL: Duration = Duration::from_secs(30);

/// Discord "blurple", used as the embed accent colour.
const EMBED_COLOR: u32 = 0x5865_F2;

/// Appended once per die that landed its natural maximum face.
const CRIT_HIGH: &str = "\u{1F4A5}";
/// Appended once per die that landed its natural minimum face.
const CRIT_LOW: &str = "\u{1F480}";

/// Characters kept from a player's display name in a roll line.
const ROLL_NAME_MAX_LEN: usize = 24;

/// How many times a crit emoji repeats before a roll line collapses it to
/// `<emoji>xN`. Without this an arbitrarily large dice pool could push the field
/// past Discord's 1024-character embed-field-value limit.
const CRIT_REPEAT_LIMIT: usize = 3;

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
#[derive(Debug, Clone)]
pub struct DiscordConfig {
    /// Bot token (`Authorization: Bot <token>`).
    pub bot_token: String,
    /// Target channel snowflake id.
    pub channel_id: String,
    /// Frontend origin for room deep links; trailing slash trimmed.
    pub app_base_url: String,
}

impl DiscordConfig {
    /// Resolve config from the environment, or `None` if the feature is disabled
    /// (any required variable missing/empty). No side effects.
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let bot_token = non_empty_env("DISCORD_BOT_TOKEN")?;
        let channel_id = non_empty_env("DISCORD_CHANNEL_ID")?;
        let app_base_url = non_empty_env("APP_BASE_URL")?;
        Some(Self {
            bot_token,
            channel_id,
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

/// The advertised state of a single public room. Derived from `RoomManager`;
/// equality drives the "did anything change?" decision so unchanged rooms are
/// never re-edited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomAdvert {
    pub room_id: String,
    pub name: Option<String>,
    pub player_count: usize,
    pub player_cap: usize,
    pub theme_id: Option<String>,
    /// The room's recent completed rolls, oldest first, as core retains them
    /// (`Room::recent_rolls`, capped at `RECENT_ROLL_HISTORY`). Part of the
    /// advert's identity, so a new roll is a real change and plans an edit.
    pub recent_rolls: Vec<RecentRoll>,
}

/// A currently-posted embed: the Discord message id plus the advert state it was
/// last rendered from.
#[derive(Debug, Clone)]
pub struct TrackedPost {
    pub message_id: String,
    pub advert: RoomAdvert,
}

/// One reconciliation step for the sync loop to apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    /// No message yet for this room — create one.
    Create(RoomAdvert),
    /// Existing message whose room state changed — edit it.
    Update {
        message_id: String,
        advert: RoomAdvert,
    },
    /// Room is gone (closed or went unlisted) — delete its message.
    Delete {
        room_id: String,
        message_id: String,
    },
}

/// Collect the current set of **public** rooms as adverts. Clones the room
/// handles under the manager lock first, then reads each room under its own lock
/// (matching the lock-ordering discipline used by the registry/HTTP handlers:
/// never hold the manager lock across a room lock).
pub async fn collect_adverts(manager: &Arc<RwLock<RoomManager>>) -> Vec<RoomAdvert> {
    let rooms = {
        let mgr = manager.read().await;
        mgr.rooms_snapshot()
    };
    let mut adverts = Vec::new();
    for room in &rooms {
        let room = room.read().await;
        if !room.is_public() {
            continue;
        }
        adverts.push(RoomAdvert {
            room_id: room.id.clone(),
            name: room.room_name(),
            player_count: room.player_count(),
            player_cap: room.player_cap(),
            theme_id: room.theme_id().map(str::to_string),
            recent_rolls: room.recent_rolls().to_vec(),
        });
    }
    adverts
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

/// Render a client-supplied display name for an embed line: control characters
/// collapsed to single spaces, truncated to [`ROLL_NAME_MAX_LEN`] characters,
/// and Discord markdown escaped so a crafted name cannot restyle the field.
#[must_use]
fn render_player_name(raw: &str) -> String {
    let collapsed = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(ROLL_NAME_MAX_LEN)
        .collect::<String>();
    if collapsed.is_empty() {
        return "Player".to_string();
    }
    let mut escaped = String::with_capacity(collapsed.len());
    for c in collapsed.chars() {
        if matches!(c, '*' | '_' | '~' | '`' | '|' | '\\') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

/// One line of the **Recent rolls** field, e.g. `Alex \u{2014} 3d6 \u{2192} 14 \u{1F4A5}`.
#[must_use]
fn roll_line(roll: &RecentRoll) -> String {
    let markers = crit_markers(&roll.dice);
    let separator = if markers.is_empty() { "" } else { " " };
    format!(
        "{} \u{2014} {} \u{2192} {}{separator}{markers}",
        render_player_name(&roll.player_name),
        roll_expression(&roll.dice),
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

/// Build the Discord message create/edit payload for a room: an embed carrying
/// name, theme, player count, and recent rolls (#244), plus an action row with a
/// single link-button **Join** pointing at the room's deep link. The same shape
/// serves both `POST .../messages` and `PATCH .../messages/<id>`.
#[must_use]
pub fn build_message_payload(advert: &RoomAdvert, app_base_url: &str) -> serde_json::Value {
    let title = advert_title(advert);
    let theme = advert
        .theme_id
        .clone()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "default".to_string());
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

/// Pure reconciliation planner: diff the currently-tracked posts against the live
/// adverts and return the actions needed to converge. Deterministic and
/// side-effect free, so the interesting logic is unit-testable without a network.
///
/// * A live room with no tracked post -> [`SyncAction::Create`].
/// * A live room whose advert differs from what was posted -> [`SyncAction::Update`].
/// * A tracked post whose room is no longer live/public -> [`SyncAction::Delete`].
/// * A live room whose advert is unchanged -> no action (no needless edit).
#[must_use]
pub fn plan_actions(
    tracked: &HashMap<String, TrackedPost>,
    current: &[RoomAdvert],
) -> Vec<SyncAction> {
    let mut actions = Vec::new();

    for advert in current {
        match tracked.get(&advert.room_id) {
            None => actions.push(SyncAction::Create(advert.clone())),
            Some(post) if post.advert != *advert => actions.push(SyncAction::Update {
                message_id: post.message_id.clone(),
                advert: advert.clone(),
            }),
            Some(_) => {} // unchanged — skip
        }
    }

    for (room_id, post) in tracked {
        if !current.iter().any(|a| &a.room_id == room_id) {
            actions.push(SyncAction::Delete {
                room_id: room_id.clone(),
                message_id: post.message_id.clone(),
            });
        }
    }

    actions
}

/// Spawn the advertisement background task if the feature is enabled. Returns
/// `true` when a task was started, `false` when the bot is disabled (config
/// absent) — in which case the server behaves exactly as before.
pub fn spawn_if_enabled(manager: Arc<RwLock<RoomManager>>) -> bool {
    let Some(config) = DiscordConfig::from_env() else {
        info!(
            "[{}] Discord room bot disabled (set DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, APP_BASE_URL to enable)",
            *INSTANCE_ID
        );
        return false;
    };

    info!(
        "[{}] Discord room bot enabled: advertising public rooms to channel {} every {}s (join links -> {})",
        *INSTANCE_ID,
        config.channel_id,
        SYNC_INTERVAL.as_secs(),
        config.app_base_url
    );

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut tracked: HashMap<String, TrackedPost> = HashMap::new();
        loop {
            let adverts = collect_adverts(&manager).await;
            reconcile(&client, &config, &mut tracked, &adverts).await;
            tokio::time::sleep(SYNC_INTERVAL).await;
        }
    });
    true
}

/// Apply one reconciliation pass. Network failures are logged, never propagated:
/// a Discord hiccup must never take down the physics server, and the next pass
/// simply retries.
async fn reconcile(
    client: &reqwest::Client,
    config: &DiscordConfig,
    tracked: &mut HashMap<String, TrackedPost>,
    adverts: &[RoomAdvert],
) {
    for action in plan_actions(tracked, adverts) {
        match action {
            SyncAction::Create(advert) => {
                if let Some(message_id) = create_message(client, config, &advert).await {
                    tracked.insert(
                        advert.room_id.clone(),
                        TrackedPost { message_id, advert },
                    );
                }
            }
            SyncAction::Update { message_id, advert } => {
                if edit_message(client, config, &message_id, &advert).await {
                    tracked.insert(
                        advert.room_id.clone(),
                        TrackedPost { message_id, advert },
                    );
                }
            }
            SyncAction::Delete { room_id, message_id } => {
                delete_message(client, config, &message_id).await;
                tracked.remove(&room_id);
            }
        }
    }
}

/// `POST /channels/{channel}/messages`. Returns the new message id on success.
async fn create_message(
    client: &reqwest::Client,
    config: &DiscordConfig,
    advert: &RoomAdvert,
) -> Option<String> {
    let url = format!("{DISCORD_API_BASE}/channels/{}/messages", config.channel_id);
    let body = build_message_payload(advert, &config.app_base_url);
    let result = client
        .post(&url)
        .header("Authorization", format!("Bot {}", config.bot_token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => {
            let json: serde_json::Value = resp.json().await.ok()?;
            let id = json.get("id").and_then(serde_json::Value::as_str)?.to_string();
            debug!(
                "[{}] Advertised room {} as message {id}",
                *INSTANCE_ID, advert.room_id
            );
            Some(id)
        }
        Ok(resp) => {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            warn!(
                "[{}] Discord create rejected for room {}: {status} {detail}",
                *INSTANCE_ID, advert.room_id
            );
            None
        }
        Err(e) => {
            warn!(
                "[{}] Discord create failed for room {}: {e}",
                *INSTANCE_ID, advert.room_id
            );
            None
        }
    }
}

/// `PATCH /channels/{channel}/messages/{id}`. Returns `true` on success.
async fn edit_message(
    client: &reqwest::Client,
    config: &DiscordConfig,
    message_id: &str,
    advert: &RoomAdvert,
) -> bool {
    let url = format!(
        "{DISCORD_API_BASE}/channels/{}/messages/{message_id}",
        config.channel_id
    );
    let body = build_message_payload(advert, &config.app_base_url);
    let result = client
        .patch(&url)
        .header("Authorization", format!("Bot {}", config.bot_token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            warn!(
                "[{}] Discord edit rejected for room {}: {status} {detail}",
                *INSTANCE_ID, advert.room_id
            );
            false
        }
        Err(e) => {
            warn!(
                "[{}] Discord edit failed for room {}: {e}",
                *INSTANCE_ID, advert.room_id
            );
            false
        }
    }
}

/// `DELETE /channels/{channel}/messages/{id}`. A 404 (already gone) is treated as
/// success by the caller, which drops the tracking entry regardless.
async fn delete_message(client: &reqwest::Client, config: &DiscordConfig, message_id: &str) {
    let url = format!(
        "{DISCORD_API_BASE}/channels/{}/messages/{message_id}",
        config.channel_id
    );
    let result = client
        .delete(&url)
        .header("Authorization", format!("Bot {}", config.bot_token))
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 404 => {
            debug!("[{}] Removed advertisement message {message_id}", *INSTANCE_ID);
        }
        Ok(resp) => {
            let status = resp.status();
            warn!(
                "[{}] Discord delete rejected for message {message_id}: {status}",
                *INSTANCE_ID
            );
        }
        Err(e) => {
            warn!(
                "[{}] Discord delete failed for message {message_id}: {e}",
                *INSTANCE_ID
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn advert(id: &str, players: usize) -> RoomAdvert {
        RoomAdvert {
            room_id: id.to_string(),
            name: Some("Taverna".to_string()),
            player_count: players,
            player_cap: 8,
            theme_id: Some("dungeon".to_string()),
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
            dice,
            total,
        }
    }

    fn recent_rolls_field(payload: &serde_json::Value) -> Option<String> {
        payload["embeds"][0]["fields"]
            .as_array()?
            .iter()
            .find(|f| f["name"] == "Recent rolls")?["value"]
            .as_str()
            .map(str::to_string)
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

    #[test]
    fn plan_creates_for_new_rooms() {
        let tracked = HashMap::new();
        let current = vec![advert("a", 1), advert("b", 2)];
        let actions = plan_actions(&tracked, &current);
        assert_eq!(actions.len(), 2);
        assert!(actions.iter().all(|a| matches!(a, SyncAction::Create(_))));
    }

    #[test]
    fn plan_skips_unchanged_and_updates_changed() {
        let mut tracked = HashMap::new();
        tracked.insert(
            "a".to_string(),
            TrackedPost { message_id: "m-a".to_string(), advert: advert("a", 1) },
        );
        tracked.insert(
            "b".to_string(),
            TrackedPost { message_id: "m-b".to_string(), advert: advert("b", 1) },
        );
        // Room "a" unchanged; room "b" gained a player.
        let current = vec![advert("a", 1), advert("b", 2)];
        let actions = plan_actions(&tracked, &current);
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            SyncAction::Update { message_id, advert } => {
                assert_eq!(message_id, "m-b");
                assert_eq!(advert.player_count, 2);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn plan_updates_when_a_roll_is_appended() {
        let mut posted = advert("a", 1);
        posted.recent_rolls = vec![roll("Alex", vec![die(DiceType::D6, 4)])];
        let mut tracked = HashMap::new();
        tracked.insert(
            "a".to_string(),
            TrackedPost { message_id: "m-a".to_string(), advert: posted.clone() },
        );

        // Same players, same theme — only a new roll landed.
        let mut rolled = posted.clone();
        rolled.recent_rolls.push(roll("Bo", vec![die(DiceType::D20, 20)]));

        let actions = plan_actions(&tracked, &[rolled]);
        match actions.as_slice() {
            [SyncAction::Update { message_id, advert }] => {
                assert_eq!(message_id, "m-a");
                assert_eq!(advert.recent_rolls.len(), 2);
            }
            other => panic!("expected a single Update, got {other:?}"),
        }

        // Replaying the same state plans nothing: no churn without a real change.
        tracked.insert(
            "a".to_string(),
            TrackedPost { message_id: "m-a".to_string(), advert: posted.clone() },
        );
        assert!(plan_actions(&tracked, &[posted]).is_empty());
    }

    #[test]
    fn plan_deletes_for_vanished_rooms() {
        let mut tracked = HashMap::new();
        tracked.insert(
            "gone".to_string(),
            TrackedPost { message_id: "m-gone".to_string(), advert: advert("gone", 1) },
        );
        let actions = plan_actions(&tracked, &[]);
        assert_eq!(
            actions,
            vec![SyncAction::Delete {
                room_id: "gone".to_string(),
                message_id: "m-gone".to_string()
            }]
        );
    }

    #[test]
    fn config_disabled_when_env_absent() {
        // Not set in the unit-test environment -> feature resolves to None.
        if std::env::var("DISCORD_BOT_TOKEN").is_err()
            && std::env::var("DISCORD_CHANNEL_ID").is_err()
        {
            assert!(DiscordConfig::from_env().is_none());
        }
    }
}
