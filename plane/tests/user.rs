use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_get_current_user() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/users/me/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
                "first_name": "John",
                "last_name": "Doe",
                "email": "john.doe@example.com",
                "avatar": "avatar-123",
                "avatar_url": "https://example.com/avatars/avatar-123.png",
                "display_name": "John Doe"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("user")
        .arg("me")
        .assert()
        .success()
        .stdout(predicate::str::contains("John"))
        .stdout(predicate::str::contains("john.doe@example.com"));
}
