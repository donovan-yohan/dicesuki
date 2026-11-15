//! Real upgrade -> handler -> JWT/JWKS -> room regressions for #266.
//! The checked-in EC key is generated test-only material, never a credential.
use axum::{routing::get, Json, Router};
use dicesuki_server::{build_app, RoomManager, SharedRoomManager};
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::{
    net::TcpListener,
    sync::RwLock,
    time::{timeout, Duration, Instant},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

async fn text(socket: &mut Socket) -> Value {
    timeout(IO_TIMEOUT, async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(value))) => return serde_json::from_str(&value).unwrap(),
                Some(Ok(Message::Ping(_))) => socket.flush().await.unwrap(),
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => {
                    return json!({"type":"closed"})
                }
                other => panic!("unexpected frame: {other:?}"),
            }
        }
    })
    .await
    .unwrap()
}

async fn connect(addr: std::net::SocketAddr) -> (String, Socket) {
    let response = reqwest::Client::new()
        .post(format!("http://{addr}/api/rooms"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 201);
    let room = response.json::<Value>().await.unwrap()["roomId"]
        .as_str()
        .unwrap()
        .to_string();
    let (socket, _) = connect_async(format!("ws://{addr}/ws/{room}"))
        .await
        .unwrap();
    (room, socket)
}

fn join(room: &str, token: Option<&str>) -> Message {
    let mut value = json!({"type":"join", "roomId":room, "displayName":"Test", "color":"#FFF"});
    if let Some(token) = token {
        value["authToken"] = token.into();
    }
    Message::Text(value.to_string())
}

async fn assert_reaped(mut socket: Socket, room: String, auth_invalid: bool) {
    let started = Instant::now();
    let mut chatter = tokio::time::interval(Duration::from_secs(1));
    let mut chatter_writable = true;
    let closed = timeout(Duration::from_secs(17), async {
        loop {
            tokio::select! {
                message = socket.next() => match message {
                    None | Some(Err(_)) => panic!("prejoin retirement omitted the WebSocket Close frame"),
                    Some(Ok(Message::Close(frame))) => {
                        assert_eq!(frame.unwrap().code, tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal);
                        break;
                    },
                    Some(Ok(Message::Text(value))) => {
                        let value: Value = serde_json::from_str(&value).unwrap();
                        assert_ne!(value["type"], "room_state", "invalid connection joined");
                        if auth_invalid { assert_eq!(value["code"], "AUTH_INVALID"); }
                    }
                    Some(Ok(Message::Ping(_))) => { let _ = socket.flush().await; }
                    _ => {}
                },
                _ = chatter.tick(), if chatter_writable => {
                    let message = if auth_invalid { join(&room, Some("not-a-jwt")) }
                        else { Message::Pong(vec![1,2,3]) };
                    chatter_writable = socket.send(message).await.is_ok();
                }
            }
        }
    })
    .await;
    assert!(
        closed.is_ok(),
        "never-joined connection survived control/auth chatter beyond grace"
    );
    assert!(
        started.elapsed() >= Duration::from_secs(14),
        "refresh grace was cut short"
    );
}

#[tokio::test]
async fn cancelling_connection_retires_its_socket() {
    use axum::extract::ws::WebSocketUpgrade;
    use dicesuki_server::{ws_handler::handle_ws_connection, RollReporter};
    let (_, room) = RoomManager::new().create_room();
    let (tasks, mut connections) = tokio::sync::mpsc::unbounded_channel();
    let app = Router::new().route(
        "/ws",
        get(move |upgrade: WebSocketUpgrade| {
            let room = room.clone();
            let tasks = tasks.clone();
            async move {
                upgrade.on_upgrade(move |socket| async move {
                    let connection =
                        tokio::spawn(handle_ws_connection(socket, room, RollReporter::disabled()));
                    tasks.send(connection.abort_handle()).unwrap();
                    let _ = connection.await;
                })
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (mut socket, _) = connect_async(format!("ws://{addr}/ws")).await.unwrap();
    let connection = timeout(IO_TIMEOUT, connections.recv())
        .await
        .unwrap()
        .unwrap();
    socket.send(Message::Text("{}".into())).await.unwrap();
    assert_eq!(
        text(&mut socket).await["code"],
        "INVALID_MESSAGE",
        "writer must be positively active before cancellation"
    );
    connection.abort();
    let retired = timeout(Duration::from_secs(1), socket.next()).await;
    server.abort();
    assert!(
        matches!(
            retired,
            Ok(None) | Ok(Some(Err(_))) | Ok(Some(Ok(Message::Close(_))))
        ),
        "cancelled handler detached its writer and kept the socket alive"
    );
}

#[tokio::test]
async fn prejoin_deadline_preserves_guest_and_one_verified_refresh_retry() {
    // A separate integration binary owns AUTH's environment. Only local HTTP is used.
    let keys = json!({"keys":[{"kty":"EC","crv":"P-256","kid":"ws-test-only","alg":"ES256",
        "x":"jJcomY6ab9CQfi4gZjMhBkk8kl7XQS4X6KwFntrwq-8", "y":"tWsThK81u2NxaXxURCSbHQzZa0SDZRdbHeqiB4-tu1o"}]});
    let jwks = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", jwks.local_addr().unwrap());
    std::env::set_var("SUPABASE_URL", &root);
    let key_app = Router::new().route(
        "/auth/v1/.well-known/jwks.json",
        get(move || async move { Json(keys) }),
    );
    let key_server = tokio::spawn(async move { axum::serve(jwks, key_app).await.unwrap() });
    let manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = build_app(manager.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    let (guest_room, mut guest) = connect(addr).await;
    guest.send(join(&guest_room, None)).await.unwrap();
    assert_eq!(text(&mut guest).await["type"], "room_state");
    let (retry_room, mut retry) = connect(addr).await;
    let retry_started = Instant::now();
    // Positive handler marker without granting auth grace. Advance only the
    // idle wait, never actual HTTP/JWKS/WS I/O.
    retry.send(Message::Text("{}".into())).await.unwrap();
    assert_eq!(text(&mut retry).await["code"], "INVALID_MESSAGE");
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(8)).await;
    tokio::time::resume();
    retry
        .send(join(&retry_room, Some("not-a-jwt")))
        .await
        .unwrap();
    assert_eq!(text(&mut retry).await["code"], "AUTH_INVALID");
    assert!(retry_started.elapsed() >= Duration::from_secs(8));
    assert!(retry_started.elapsed() < Duration::from_secs(9));
    let (idle_room, idle) = connect(addr).await;
    let (bad_room, mut bad) = connect(addr).await;
    bad.send(join(&bad_room, Some("not-a-jwt"))).await.unwrap();
    assert_eq!(text(&mut bad).await["code"], "AUTH_INVALID");

    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some("ws-test-only".to_string());
    let token = encode(
        &header,
        &json!({"sub":"verified-test-user", "aud":"authenticated",
        "iss":format!("{root}/auth/v1"), "exp":4_102_444_800_u64}),
        &EncodingKey::from_ec_pem(include_bytes!("fixtures/ws-test-only-ec.pem")).unwrap(),
    )
    .unwrap();

    let idle_check = assert_reaped(idle, idle_room.clone(), false);
    let bad_check = assert_reaped(bad, bad_room.clone(), true);
    let recovery_check = async {
        // Retry at ~18s, beyond the original 15s but inside the refreshed ~23s.
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(10)).await;
        tokio::time::resume();
        assert!(retry_started.elapsed() > Duration::from_secs(15));
        assert!(retry_started.elapsed() < Duration::from_secs(23));
        // A closed socket is observed by the same room_state assertion below,
        // including when the grace-extension mutation causes an early close.
        let _ = retry.send(join(&retry_room, Some(&token))).await;
        let state = text(&mut retry).await;
        assert_eq!(state["type"], "room_state", "refresh response: {state}");
        let local = state["localPlayerId"].as_str().unwrap();
        let room = manager.read().await.get_room(&retry_room).unwrap();
        assert_eq!(
            room.read().await.players[local].user_id.as_deref(),
            Some("verified-test-user")
        );
        tokio::time::sleep(Duration::from_secs(6)).await;
        for (socket, room_id) in [(&mut guest, &guest_room), (&mut retry, &retry_room)] {
            socket.send(join(room_id, None)).await.unwrap();
            assert_eq!(
                text(socket).await["code"],
                "ALREADY_JOINED",
                "successful join must retire prejoin deadline"
            );
        }
    };
    tokio::join!(idle_check, bad_check, recovery_check);
    for room_id in [&idle_room, &bad_room] {
        let room = manager.read().await.get_room(room_id).unwrap();
        assert!(room.read().await.players.is_empty());
    }
    guest.close(None).await.unwrap();
    retry.close(None).await.unwrap();
    server.abort();
    key_server.abort();
}
