const MANIFEST: &str = include_str!("../Cargo.toml");
const DOCKERFILE: &str = include_str!("../Dockerfile");

#[test]
fn docker_build_includes_every_declared_workspace_member() {
    // This workspace declares its member paths in a single literal array.
    // Default-member exclusion does not exempt a crate from Cargo resolution.
    let members = MANIFEST
        .lines()
        .find_map(|line| line.trim().strip_prefix("members = "))
        .expect("workspace must declare members");
    let members: Vec<_> = members.split('"').skip(1).step_by(2).collect();
    assert!(!members.is_empty(), "expected declared workspace members");

    for member in members {
        for instruction in [
            format!("COPY {member}/Cargo.toml {member}/Cargo.toml"),
            format!("COPY {member}/src/ {member}/src/"),
        ] {
            assert!(
                DOCKERFILE.lines().any(|line| line.trim() == instruction),
                "Docker build context omits workspace input: {instruction}"
            );
        }
    }
}
