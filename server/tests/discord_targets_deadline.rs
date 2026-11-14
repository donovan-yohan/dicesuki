//! The aggregate HTTP deadline includes JWT/JWKS admission, not only Discord fanout.
use axum::{routing::get, Router};
use dicesuki_server::{build_app, RoomManager};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::{
    net::TcpListener,
    sync::{Notify, RwLock},
    time::{timeout, Duration},
};

#[tokio::test]
async fn targets_deadline_includes_a_stalled_auth_key_fetch() {
    let entered = Arc::new(Notify::new());
    let signal = entered.clone();
    let jwks_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", jwks_listener.local_addr().unwrap());
    std::env::set_var("SUPABASE_URL", &root);
    let jwks_app = Router::new().route(
        "/auth/v1/.well-known/jwks.json",
        get(move || {
            let signal = signal.clone();
            async move {
                signal.notify_one();
                std::future::pending::<axum::Json<Value>>().await
            }
        }),
    );
    let jwks_server = tokio::spawn(async { axum::serve(jwks_listener, jwks_app).await.unwrap() });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = build_app(Arc::new(RwLock::new(RoomManager::new())));
    let server = tokio::spawn(async { axum::serve(listener, app).await.unwrap() });
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some("ws-test-only".to_string());
    let token = encode(
        &header,
        &json!({"sub":"test-caller", "aud":"authenticated",
        "iss":format!("{root}/auth/v1"), "exp":4_102_444_800_u64}),
        &EncodingKey::from_ec_pem(include_bytes!("fixtures/ws-test-only-ec.pem")).unwrap(),
    )
    .unwrap();
    let mut request = tokio::spawn(async move {
        reqwest::Client::new()
            .get(format!("http://{addr}/api/discord/targets"))
            .bearer_auth(token)
            .send()
            .await
    });
    // Prove that the actual auth consumer is stalled before moving the clock.
    timeout(Duration::from_secs(2), entered.notified())
        .await
        .unwrap();
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(15)).await;
    tokio::time::resume();
    let result = timeout(Duration::from_secs(2), &mut request).await;
    request.abort();
    server.abort();
    jwks_server.abort();
    let response = result
        .expect("overall targets deadline did not cover authentication")
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        json!({"guilds":[]})
    );
}
