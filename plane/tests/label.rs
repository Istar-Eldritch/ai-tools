mod common;

use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_list_labels() {
    let (server, _) = common::setup_mock_server();

    let list_labels_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/labels/");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [{
                    "id": "test-label-id",
                    "name": "Bug",
                    "description": "Bug label",
                    "color": "#ff0000"
                }]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("list")
        .arg("--project-id")
        .arg("test-project-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Bug\""));

    list_labels_mock.assert();
}

#[tokio::test]
async fn test_get_label() {
    let (server, _) = common::setup_mock_server();

    let get_label_mock = server.mock(|when, then| {
        when.method(GET).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/labels/test-label-id/",
        );
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-label-id",
                "name": "Bug",
                "description": "Bug label",
                "color": "#ff0000"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("get")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("test-label-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Bug\""));

    get_label_mock.assert();
}

#[tokio::test]
async fn test_create_label() {
    let (server, _) = common::setup_mock_server();

    let create_label_mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/labels/")
            .json_body(json!({
                "name": "Bug"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-label-id",
                "name": "Bug",
                "description": "",
                "color": ""
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("Bug")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Bug\""));

    create_label_mock.assert();
}

#[tokio::test]
async fn test_create_label_with_optional_fields() {
    let (server, _) = common::setup_mock_server();

    let create_label_mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/labels/")
            .json_body(json!({
                "name": "Bug",
                "description": "Bug label",
                "color": "#ff0000"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-label-id",
                "name": "Bug",
                "description": "Bug label",
                "color": "#ff0000"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("Bug")
        .arg("--description")
        .arg("Bug label")
        .arg("--color")
        .arg("#ff0000")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Bug\""));

    create_label_mock.assert();
}

#[tokio::test]
async fn test_update_label() {
    let (server, _) = common::setup_mock_server();

    let update_label_mock = server.mock(|when, then| {
        when.method(PATCH)
            .path(
                "/api/v1/workspaces/test-workspace/projects/test-project-id/labels/test-label-id/",
            )
            .json_body(json!({
                "name": "Critical Bug"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-label-id",
                "name": "Critical Bug",
                "description": "Bug label",
                "color": "#ff0000"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("update")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("test-label-id")
        .arg("--name")
        .arg("Critical Bug")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"name\": \"Critical Bug\""));

    update_label_mock.assert();
}

#[tokio::test]
async fn test_delete_label() {
    let (server, _) = common::setup_mock_server();

    let delete_label_mock = server.mock(|when, then| {
        when.method(DELETE).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/labels/test-label-id/",
        );
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("label")
        .arg("delete")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("test-label-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("Label deleted"));

    delete_label_mock.assert();
}
