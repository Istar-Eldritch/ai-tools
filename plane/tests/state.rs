mod common;

use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_list_states() {
    let (server, _) = common::setup_mock_server();

    let list_states_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/states/");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [{
                    "id": "test-state-id",
                    "name": "Test State",
                    "color": "#ffffff"
                }]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("state")
        .arg("list")
        .arg("--project-id")
        .arg("test-project-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Test State\""));

    list_states_mock.assert();
}

#[tokio::test]
async fn test_create_state() {
    let (server, _) = common::setup_mock_server();

    let create_state_mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/states/")
            .json_body(json!({
                "name": "Test State",
                "color": "#ffffff"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-state-id",
                "name": "Test State",
                "color": "#ffffff"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("state")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("Test State")
        .arg("#ffffff")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Test State\""));

    create_state_mock.assert();
}

#[tokio::test]
async fn test_delete_state() {
    let (server, _) = common::setup_mock_server();

    let delete_state_mock = server.mock(|when, then| {
        when.method(DELETE).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/states/test-state-id/",
        );
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("state")
        .arg("delete")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("test-state-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("State deleted"));

    delete_state_mock.assert();
}
