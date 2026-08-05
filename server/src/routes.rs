use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::Next,
    response::IntoResponse,
    Json,
};
use axum::http::{HeaderMap, HeaderValue, Method};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use log::info;

use crate::auth::SupabaseClaims;
use crate::discord::{authorize_advertise, host_user_id, AdvertiseRejection, DiscordService};
use crate::discord_targets::targets_response;
use crate::room::RoomListing;
use crate::{AppState, SharedRoomManager, INSTANCE_ID};

/// Default page size for the public room listing when the client omits one.
const DEFAULT_PAGE_SIZE: usize = 20;
/// Hard ceiling on `pageSize` so a single request can never demand an unbounded
/// number of rooms.
const MAX_PAGE_SIZE: usize = 100;

/// Query parameters for the paginated public room listing (`GET /api/rooms`).
#[derive(Debug, Deserialize)]
pub struct ListRoomsQuery {
    /// Zero-based page index. Defaults to 0.
    pub page: Option<usize>,
    /// Rooms per page. Defaults to [`DEFAULT_PAGE_SIZE`], clamped to
    /// `1..=MAX_PAGE_SIZE`.
    #[serde(rename = "pageSize")]
    pub page_size: Option<usize>,
}

/// Apply pagination to an already-filtered, sorted list of public rooms.
/// Returns the requested page slice alongside the effective (clamped) page and
/// page size and the total number of public rooms. Kept pure so the
/// slice/clamp arithmetic is unit-testable without a running server.
#[must_use]
pub fn paginate_listings(
    mut listings: Vec<RoomListing>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> (Vec<RoomListing>, usize, usize, usize) {
    // Deterministic ordering so pagination is stable across requests.
    listings.sort_by(|a, b| a.room_id.cmp(&b.room_id));
    let total = listings.len();
    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let start = page.saturating_mul(page_size);
    let paged = listings
        .into_iter()
        .skip(start)
        .take(page_size)
        .collect::<Vec<_>>();
    (paged, page, page_size, total)
}

/// Middleware that logs every incoming request and its response status.
pub async fn log_requests(req: Request, next: Next) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let version = req.version();
    let upgrade_header = req.headers().get("upgrade").map(|v| v.to_str().unwrap_or("?").to_string());

    // Log extra headers for WebSocket requests to diagnose proxy issues
    if uri.path().starts_with("/ws/") {
        let connection = req.headers().get("connection").map(|v| v.to_str().unwrap_or("?").to_string());
        let ws_version = req.headers().get("sec-websocket-version").map(|v| v.to_str().unwrap_or("?").to_string());
        let ws_key = req.headers().get("sec-websocket-key").is_some();
        info!(
            "[{}] --> {:?} {} {} (upgrade: {:?}, connection: {:?}, sec-ws-version: {:?}, sec-ws-key: {})",
            *INSTANCE_ID, version, method, uri, upgrade_header, connection, ws_version, ws_key
        );
    } else {
        info!("[{}] --> {:?} {} {} (upgrade: {:?})", *INSTANCE_ID, version, method, uri, upgrade_header);
    }

    let response = next.run(req).await;
    info!("[{}] <-- {} {} => {}", *INSTANCE_ID, method, uri, response.status());
    response
}

pub fn build_cors_layer() -> CorsLayer {
    if let Ok(origin) = std::env::var("CORS_ORIGIN") {
        info!("CORS restricted to: {origin}");
        CorsLayer::new()
            .allow_origin(origin.parse::<HeaderValue>().expect("Invalid CORS_ORIGIN"))
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(tower_http::cors::Any)
    } else {
        info!("CORS_ORIGIN not set, allowing all origins (dev mode)");
        CorsLayer::permissive()
    }
}

pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "instanceId": *INSTANCE_ID,
        "rollReporter": state.roll_reporter.status().as_str(),
    }))
}

pub async fn create_room(State(mgr): State<SharedRoomManager>) -> impl IntoResponse {
    let mut mgr = mgr.write().await;
    let (room_id, _) = mgr.create_room();
    info!("[{}] Room created via API: {} (total: {})", *INSTANCE_ID, room_id, mgr.room_count());
    (
        StatusCode::CREATED,
        Json(serde_json::json!({"roomId": room_id, "instanceId": *INSTANCE_ID})),
    )
}

/// `GET /api/rooms` — the public room browser listing (#79). Returns only rooms
/// the host has marked `visibility = "public"`, each with its id, optional name,
/// current player count, and optional theme id, paginated. Unlisted rooms (the
/// default) never appear.
pub async fn list_rooms(
    State(mgr): State<SharedRoomManager>,
    Query(query): Query<ListRoomsQuery>,
) -> impl IntoResponse {
    // Snapshot the room handles, then release the manager lock before taking any
    // per-room read lock (avoids holding both locks at once).
    let rooms = {
        let mgr = mgr.read().await;
        mgr.rooms_snapshot()
    };

    let mut listings = Vec::new();
    for room in &rooms {
        if let Some(listing) = room.read().await.public_listing() {
            listings.push(listing);
        }
    }

    let (paged, page, page_size, total) =
        paginate_listings(listings, query.page, query.page_size);

    info!(
        "[{}] GET /api/rooms (public: {}, page: {}, pageSize: {})",
        *INSTANCE_ID, total, page, page_size
    );

    Json(serde_json::json!({
        "rooms": paged,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "instanceId": *INSTANCE_ID,
    }))
}

pub async fn get_room_info(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    // Clone the Arc before releasing the manager lock to avoid holding
    // the manager read lock across a nested room read lock acquisition.
    let maybe_room = {
        let mgr = mgr.read().await;
        info!("[{}] GET /api/rooms/{} (total rooms: {})", *INSTANCE_ID, room_id, mgr.room_count());
        mgr.get_room(&room_id)
    };
    // Manager lock is released here.
    match maybe_room {
        Some(room) => {
            let room = room.read().await;
            Json(serde_json::json!({
                "roomId": room.id,
                "playerCount": room.player_count(),
                "diceCount": room.dice_count(),
                "instanceId": *INSTANCE_ID,
            }))
            .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "ROOM_NOT_FOUND", "instanceId": *INSTANCE_ID})),
        )
            .into_response(),
    }
}

/// Body of `POST /api/rooms/:room_id/advertise`.
#[derive(Debug, Deserialize)]
pub struct AdvertiseRequest {
    #[serde(rename = "channelId")]
    pub channel_id: String,
}

/// Extract the bearer token from an `Authorization` header, if present and
/// well-formed. The scheme match is case-insensitive per RFC 7235.
#[must_use]
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("bearer")
        .then(|| token.trim())
        .filter(|token| !token.is_empty())
}

/// Verify the caller's Supabase access token. Unlike `join`, the authenticated
/// HTTP endpoints have **no guest mode**: an absent or unusable token is a 401,
/// never a silent downgrade.
async fn require_claims(headers: &HeaderMap) -> Result<SupabaseClaims, axum::response::Response> {
    let unauthorized = |code: &'static str| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": code, "instanceId": *INSTANCE_ID })),
        )
            .into_response()
    };
    let Some(token) = bearer_token(headers) else {
        return Err(unauthorized("AUTH_REQUIRED"));
    };
    crate::auth::verifier()
        .authenticate_claims(token)
        .await
        .map_err(|error| unauthorized(error.code()))
}

/// Render an [`AdvertiseRejection`] as its HTTP response.
fn rejection_response(rejection: AdvertiseRejection) -> axum::response::Response {
    (
        StatusCode::from_u16(rejection.status()).unwrap_or(StatusCode::FORBIDDEN),
        Json(serde_json::json!({
            "error": rejection.code(),
            "instanceId": *INSTANCE_ID,
        })),
    )
        .into_response()
}

/// `GET /api/discord/targets` (#246) — the Discord servers and channels the
/// **calling user** may post a room to.
///
/// Requires a valid Supabase access token. The response contains only guilds
/// where the bot is installed **and** the caller is a membership-verified member;
/// the bot's raw guild list never leaves the server. A caller with no Discord
/// identity (guest, email-only) gets an empty list with 200 — not an error, so
/// the share sheet can simply hide the option.
pub async fn discord_targets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let claims = match require_claims(&headers).await {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let Some(service) = state.discord.clone() else {
        return Json(targets_response(&[])).into_response();
    };
    // The listing fans out across every bot guild on a cold cache, against the
    // bot's shared Discord budget — so it is metered like any other outbound
    // amplifier, not left open because it is a GET.
    if !service.targets_rate_limiter.try_acquire(&claims.sub).await {
        return rejection_response(AdvertiseRejection::RateLimited);
    }
    Json(targets_response(&targets_for_claims(&service, &claims).await)).into_response()
}

/// Resolve a verified caller to their posting targets. Split out so the
/// "no Discord identity yields nothing" rule is exercised directly in tests.
async fn targets_for_claims(
    service: &DiscordService,
    claims: &SupabaseClaims,
) -> Vec<crate::discord_targets::TargetGuild> {
    match service.directory.resolve_discord_user_id(claims).await {
        Some(discord_user_id) => service.directory.targets_for(&discord_user_id).await,
        None => Vec::new(),
    }
}

/// `POST /api/rooms/:room_id/advertise` (#246) — the room's **host** posts it to
/// one channel they picked. From here the existing reconciler keeps the embed up
/// to date and archives it when the room closes.
/// The body is taken as `Option<Json<_>>` rather than `Json<_>` on purpose: an
/// extractor rejection is emitted *before* the handler body runs, so a
/// well-formed `Json<_>` would answer an unauthenticated caller with 400/422 and
/// disclose that their body was the problem. Deferring the parse keeps
/// authentication the first thing every request meets.
pub async fn advertise_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    body: Option<Json<AdvertiseRequest>>,
) -> impl IntoResponse {
    let claims = match require_claims(&headers).await {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let Some(Json(body)) = body else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "INVALID_BODY",
                "instanceId": *INSTANCE_ID,
            })),
        )
            .into_response();
    };
    let Some(service) = state.discord.clone() else {
        return rejection_response(AdvertiseRejection::Disabled);
    };
    match advertise(&state.room_manager, &service, &claims, &room_id, &body.channel_id).await {
        Ok(()) => {
            info!(
                "[{}] Room {room_id} advertised to a host-chosen Discord channel",
                *INSTANCE_ID
            );
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "roomId": room_id, "instanceId": *INSTANCE_ID })),
            )
                .into_response()
        }
        Err(rejection) => rejection_response(rejection),
    }
}

/// The authorization and registration core of `advertise`, with the caller
/// already authenticated. Checks are ordered cheapest-and-least-revealing first:
/// the rate limit before any outbound call, the host check before any Discord
/// lookup, and the channel re-verification against **this server's own**
/// membership view rather than anything the client asserted.
///
/// # Errors
///
/// Returns the [`AdvertiseRejection`] describing the first failed check.
pub async fn advertise(
    manager: &SharedRoomManager,
    service: &DiscordService,
    claims: &SupabaseClaims,
    room_id: &str,
    channel_id: &str,
) -> Result<(), AdvertiseRejection> {
    if !service.rate_limiter.try_acquire(&claims.sub).await {
        return Err(AdvertiseRejection::RateLimited);
    }

    let room = {
        let mgr = manager.read().await;
        mgr.get_room(room_id)
    }
    .ok_or(AdvertiseRejection::RoomNotFound)?;
    let host = host_user_id(&*room.read().await);
    if host.as_deref() != Some(claims.sub.as_str()) {
        return Err(AdvertiseRejection::NotHost);
    }

    let discord_user_id = service
        .directory
        .resolve_discord_user_id(claims)
        .await
        .ok_or(AdvertiseRejection::NoDiscordIdentity)?;
    let verified = service.directory.verified_channel_ids(&discord_user_id).await;
    authorize_advertise(host.as_deref(), &claims.sub, channel_id, &verified)?;

    service.registry.register(room_id, channel_id).await
}

/// Fallback handler — logs requests that don't match any route.
pub async fn fallback(req: Request) -> impl IntoResponse {
    info!(
        "[{}] FALLBACK (no route matched): {:?} {} {}",
        *INSTANCE_ID,
        req.version(),
        req.method(),
        req.uri()
    );
    StatusCode::NOT_FOUND
}

pub async fn ws_upgrade(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    ws: Option<axum::extract::ws::WebSocketUpgrade>,
) -> impl IntoResponse {
    let mgr = &state.room_manager;
    info!(
        "[{}] WS handler entered for room: {} (extractor: {})",
        *INSTANCE_ID,
        room_id,
        if ws.is_some() { "OK" } else { "FAILED" }
    );

    if let Some(ws) = ws {
        let mgr_read = mgr.read().await;
        if let Some(room) = mgr_read.get_room(&room_id) {
            info!("[{}] Room {} found, upgrading WebSocket", *INSTANCE_ID, room_id);
            drop(mgr_read);
            let reporter = state.roll_reporter.clone();
            ws.on_upgrade(move |socket| {
                crate::ws_handler::handle_ws_connection(socket, room, reporter)
            })
        } else {
            info!(
                "[{}] WS upgrade failed: room {} not found (total: {})",
                *INSTANCE_ID,
                room_id,
                mgr_read.room_count()
            );
            StatusCode::NOT_FOUND.into_response()
        }
    } else {
        info!(
            "[{}] WebSocket extractor FAILED for room: {} — upgrade headers missing or connection not upgradable",
            *INSTANCE_ID, room_id
        );
        (StatusCode::BAD_REQUEST, "WebSocket upgrade required").into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discord::DiscordService;
    use crate::discord_targets::test_support::{FakeDiscord, FakeIdentities};
    use crate::messages::ServerMessage;
    use crate::player::Player;
    use crate::room::RoomListing;
    use crate::sink::MessageSink;
    use crate::RoomManager;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn listing(id: &str) -> RoomListing {
        RoomListing {
            room_id: id.to_string(),
            name: None,
            player_count: 0,
            theme_id: None,
        }
    }

    #[test]
    fn paginate_defaults_to_page_zero_size_twenty() {
        let listings: Vec<RoomListing> = (0..5).map(|i| listing(&format!("r{i}"))).collect();
        let (paged, page, page_size, total) = paginate_listings(listings, None, None);
        assert_eq!(page, 0);
        assert_eq!(page_size, DEFAULT_PAGE_SIZE);
        assert_eq!(total, 5);
        assert_eq!(paged.len(), 5);
    }

    #[test]
    fn paginate_slices_requested_page() {
        let listings: Vec<RoomListing> = (0..10).map(|i| listing(&format!("r{i:02}"))).collect();
        let (paged, page, page_size, total) = paginate_listings(listings, Some(1), Some(3));
        assert_eq!((page, page_size, total), (1, 3, 10));
        // Sorted ascending, page 1 of size 3 => r03, r04, r05.
        let ids: Vec<&str> = paged.iter().map(|l| l.room_id.as_str()).collect();
        assert_eq!(ids, ["r03", "r04", "r05"]);
    }

    #[test]
    fn paginate_clamps_page_size_to_max() {
        let listings: Vec<RoomListing> = (0..3).map(|i| listing(&format!("r{i}"))).collect();
        let (_, _, page_size, _) = paginate_listings(listings, None, Some(9999));
        assert_eq!(page_size, MAX_PAGE_SIZE);
    }

    #[test]
    fn paginate_page_size_never_zero() {
        let (_, _, page_size, _) = paginate_listings(vec![], None, Some(0));
        assert_eq!(page_size, 1, "pageSize is clamped to at least 1");
    }

    #[test]
    fn paginate_page_past_end_is_empty() {
        let listings: Vec<RoomListing> = (0..3).map(|i| listing(&format!("r{i}"))).collect();
        let (paged, _, _, total) = paginate_listings(listings, Some(50), Some(10));
        assert!(paged.is_empty());
        assert_eq!(total, 3, "Total still reflects all public rooms");
    }

    #[test]
    fn paginate_sorts_deterministically() {
        let listings = vec![listing("zeta"), listing("alpha"), listing("mike")];
        let (paged, _, _, _) = paginate_listings(listings, None, None);
        let ids: Vec<&str> = paged.iter().map(|l| l.room_id.as_str()).collect();
        assert_eq!(ids, ["alpha", "mike", "zeta"]);
    }

    // --- Discord host posting (#246) ---------------------------------------

    const GUILD_X: &str = "100000000000000001";
    const GUILD_Y: &str = "100000000000000002";
    const CHANNEL_X: &str = "200000000000000001";
    const CHANNEL_Y: &str = "200000000000000002";
    const DISCORD_A: &str = "300000000000000001";
    const DISCORD_B: &str = "300000000000000002";
    const BOT: &str = "400000000000000001";

    /// A sink that drops everything — the room only needs *a* destination.
    struct NullSink;
    impl MessageSink for NullSink {
        fn send(&self, _msg: &ServerMessage) -> bool {
            true
        }
    }

    /// Claims for a Discord-linked Supabase user. The Discord id itself is NOT
    /// carried by the token (it is end-user writable there); it comes from the
    /// injected identity lookup, exactly as in production.
    fn discord_claims(supabase_user_id: &str) -> SupabaseClaims {
        serde_json::from_value(serde_json::json!({
            "sub": supabase_user_id,
            "app_metadata": { "provider": "discord", "providers": ["discord"] },
        }))
        .expect("claims parse")
    }

    /// Claims for an account with no Discord identity at all.
    fn guest_claims(supabase_user_id: &str) -> SupabaseClaims {
        serde_json::from_value(serde_json::json!({ "sub": supabase_user_id }))
            .expect("claims parse")
    }

    /// A manager holding one room hosted by `host_user_id` (or by a guest when
    /// `None`). Returns the manager and the room id.
    async fn room_hosted_by(host_user_id: Option<&str>) -> (SharedRoomManager, String) {
        let manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));
        let (room_id, room) = manager.write().await.create_room();
        let mut player = Player::new(
            "p1".to_string(),
            "Alex".to_string(),
            "#FFF".to_string(),
            NullSink,
        );
        player.user_id = host_user_id.map(str::to_string);
        room.write().await.add_player(player).expect("player joins");
        (manager, room_id)
    }

    /// Guild X holds Discord user A, guild Y holds Discord user B, with an
    /// authoritative identity record linking each Supabase account.
    fn two_tenant_service() -> DiscordService {
        DiscordService::with_identity_lookup(
            Arc::new(
                FakeDiscord::new(BOT)
                    .with_guild(GUILD_X, "Xanadu", CHANNEL_X, &[DISCORD_A])
                    .with_guild(GUILD_Y, "Yonder", CHANNEL_Y, &[DISCORD_B]),
            ),
            Some(FakeIdentities::of(&[
                ("supabase-a", DISCORD_A),
                ("supabase-b", DISCORD_B),
            ])),
            "https://dicesuki.app".to_string(),
            None,
        )
    }

    #[test]
    fn bearer_tokens_are_parsed_case_insensitively_and_never_empty() {
        let mut headers = HeaderMap::new();
        assert!(bearer_token(&headers).is_none());

        headers.insert(axum::http::header::AUTHORIZATION, "Bearer abc.def".parse().unwrap());
        assert_eq!(bearer_token(&headers), Some("abc.def"));

        headers.insert(axum::http::header::AUTHORIZATION, "bearer abc.def".parse().unwrap());
        assert_eq!(bearer_token(&headers), Some("abc.def"));

        for hostile in ["Basic abc", "Bearer", "Bearer   ", "abc.def"] {
            headers.insert(axum::http::header::AUTHORIZATION, hostile.parse().unwrap());
            assert!(bearer_token(&headers).is_none(), "{hostile} must not parse");
        }
    }

    #[tokio::test]
    async fn targets_are_scoped_per_caller_and_never_mention_another_tenant() {
        let service = two_tenant_service();

        let for_a = targets_for_claims(&service, &discord_claims("supabase-a")).await;
        let for_b = targets_for_claims(&service, &discord_claims("supabase-b")).await;

        assert_eq!(for_a.len(), 1);
        assert_eq!(for_a[0].id, GUILD_X);
        assert_eq!(for_b.len(), 1);
        assert_eq!(for_b[0].id, GUILD_Y);

        let body_a = targets_response(&for_a).to_string();
        for leaked in [GUILD_Y, CHANNEL_Y, "Yonder"] {
            assert!(!body_a.contains(leaked), "user A's response leaked {leaked}");
        }
        let body_b = targets_response(&for_b).to_string();
        for leaked in [GUILD_X, CHANNEL_X, "Xanadu"] {
            assert!(!body_b.contains(leaked), "user B's response leaked {leaked}");
        }
    }

    #[tokio::test]
    async fn a_caller_with_no_discord_identity_gets_an_empty_target_list() {
        let service = two_tenant_service();
        let targets = targets_for_claims(&service, &guest_claims("supabase-guest")).await;
        assert!(targets.is_empty());
        assert_eq!(
            targets_response(&targets),
            serde_json::json!({ "guilds": [] })
        );
    }

    #[tokio::test]
    async fn advertise_accepts_the_host_posting_to_their_own_guilds_channel() {
        let (manager, room_id) = room_hosted_by(Some("supabase-a")).await;
        let service = two_tenant_service();
        let claims = discord_claims("supabase-a");

        assert_eq!(
            advertise(&manager, &service, &claims, &room_id, CHANNEL_X).await,
            Ok(())
        );
        assert_eq!(
            service.registry.snapshot().await[&room_id],
            std::collections::BTreeSet::from([CHANNEL_X.to_string()])
        );
    }

    #[tokio::test]
    async fn advertise_rejects_a_caller_who_is_not_the_room_host() {
        let (manager, room_id) = room_hosted_by(Some("supabase-a")).await;
        let service = two_tenant_service();
        // User B is a perfectly valid Discord-linked user, and CHANNEL_Y is a
        // channel they may post to — but this is not their room.
        let claims = discord_claims("supabase-b");

        assert_eq!(
            advertise(&manager, &service, &claims, &room_id, CHANNEL_Y).await,
            Err(AdvertiseRejection::NotHost)
        );
        assert!(service.registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn advertise_rejects_a_guest_hosted_room_nobody_can_prove_ownership_of() {
        let (manager, room_id) = room_hosted_by(None).await;
        let service = two_tenant_service();
        assert_eq!(
            advertise(
                &manager,
                &service,
                &discord_claims("supabase-a"),
                &room_id,
                CHANNEL_X
            )
            .await,
            Err(AdvertiseRejection::NotHost)
        );
    }

    #[tokio::test]
    async fn advertise_rejects_a_channel_outside_the_callers_verified_guilds() {
        let (manager, room_id) = room_hosted_by(Some("supabase-a")).await;
        let service = two_tenant_service();
        let claims = discord_claims("supabase-a");

        // The host aims at guild Y's channel, which they are not a member of.
        assert_eq!(
            advertise(&manager, &service, &claims, &room_id, CHANNEL_Y).await,
            Err(AdvertiseRejection::ChannelNotVerified)
        );
        // ...and at a channel that does not exist anywhere.
        assert_eq!(
            advertise(&manager, &service, &claims, &room_id, "999999999999999999").await,
            Err(AdvertiseRejection::ChannelNotVerified)
        );
        assert!(service.registry.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn advertise_rejects_a_host_with_no_discord_identity() {
        let (manager, room_id) = room_hosted_by(Some("supabase-guest")).await;
        let service = two_tenant_service();
        assert_eq!(
            advertise(
                &manager,
                &service,
                &guest_claims("supabase-guest"),
                &room_id,
                CHANNEL_X
            )
            .await,
            Err(AdvertiseRejection::NoDiscordIdentity)
        );
    }

    #[tokio::test]
    async fn advertise_reports_an_unknown_room_and_exhausted_budgets() {
        let (manager, room_id) = room_hosted_by(Some("supabase-a")).await;
        let service = two_tenant_service();
        let claims = discord_claims("supabase-a");

        assert_eq!(
            advertise(&manager, &service, &claims, "no-such-room", CHANNEL_X).await,
            Err(AdvertiseRejection::RoomNotFound)
        );

        // The remaining budget is spent on repeats of a valid request; the next
        // call is refused rather than served.
        let mut refused = None;
        for _ in 0..10 {
            if let Err(rejection) =
                advertise(&manager, &service, &claims, &room_id, CHANNEL_X).await
            {
                refused = Some(rejection);
                break;
            }
        }
        assert_eq!(refused, Some(AdvertiseRejection::RateLimited));
    }
}
