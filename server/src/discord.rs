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

/// Build the Discord message create/edit payload for a room: an embed carrying
/// name, theme, and player count, plus an action row with a single link-button
/// **Join** pointing at the room's deep link. The same shape serves both
/// `POST .../messages` and `PATCH .../messages/<id>`.
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

    serde_json::json!({
        "embeds": [{
            "title": format!("\u{1F3B2} {title}"),
            "description": "A Dicesuki dice room is live \u{2014} jump in and roll.",
            "color": EMBED_COLOR,
            "fields": [
                { "name": "Players", "value": players, "inline": true },
                { "name": "Theme", "value": theme, "inline": true }
            ],
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
        }
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
        };
        let payload = build_message_payload(&bare, "https://dicesuki.app");
        let embed = &payload["embeds"][0];
        assert!(embed["title"].as_str().unwrap().contains("Room xyz"));
        assert_eq!(embed["fields"][1]["value"], "default");
        assert_eq!(embed["fields"][0]["value"], "0/4");
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
