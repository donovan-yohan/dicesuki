const BLUEPRINT: &str = include_str!("../render.yaml");

fn env_block(key: &str) -> String {
    let marker = format!("- key: {key}");
    let mut collecting = false;
    let mut block = String::new();

    for line in BLUEPRINT.lines() {
        if line.trim() == marker {
            collecting = true;
        } else if collecting && line.trim_start().starts_with("- key: ") {
            break;
        }

        if collecting {
            block.push_str(line);
            block.push('\n');
        }
    }

    assert!(
        !block.is_empty(),
        "missing Render env declaration for {key}"
    );
    block
}

fn assert_literal(key: &str, value: &str) {
    let block = env_block(key);
    assert!(
        block
            .lines()
            .any(|line| line.trim() == format!("value: {value}")),
        "Render env {key} must have the expected public value"
    );
}

#[test]
fn render_blueprint_declares_safe_registry_environment() {
    assert_literal("RUST_LOG", "info");
    assert_literal("SUPABASE_URL", "https://nksxdfcjabgbxeefwkdc.supabase.co");
    assert_literal("PUBLIC_URL", "https://dicesuki.onrender.com");
    assert_literal("CORS_ORIGIN", "https://dicesuki.vercel.app");

    let secret = env_block("SUPABASE_SECRET_KEY");
    assert!(secret.lines().any(|line| line.trim() == "sync: false"));
    assert!(
        !secret
            .lines()
            .any(|line| line.trim_start().starts_with("value:")),
        "SUPABASE_SECRET_KEY must be supplied in Render, never in source"
    );
    assert!(
        !BLUEPRINT.contains("- key: SUPABASE_SERVICE_ROLE_KEY"),
        "deprecated legacy fallback must not be the Blueprint default"
    );
}
