mod common;

use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_list_links() {
    let (server, _) = common::setup_mock_server();

    let list_links_mock = server.mock(|when, then| {
        when.method(GET).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/",
        );
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [{
                    "id": "test-link-id",
                    "url": "https://example.com",
                    "title": "Example Link"
                }]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("list")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"url\": \"https://example.com\""));

    list_links_mock.assert();
}

#[tokio::test]
async fn test_get_link() {
    let (server, _) = common::setup_mock_server();

    let get_link_mock = server.mock(|when, then| {
        when.method(GET).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/test-link-id/",
        );
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-link-id",
                "url": "https://example.com",
                "title": "Example Link"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("get")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("test-link-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"url\": \"https://example.com\""));

    get_link_mock.assert();
}

#[tokio::test]
async fn test_create_link() {
    let (server, _) = common::setup_mock_server();

    let create_link_mock = server.mock(|when, then| {
        when.method(POST)
            .path(
                "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/",
            )
            .json_body(json!({
                "url": "https://example.com"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-link-id",
                "url": "https://example.com",
                "title": null
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("--url")
        .arg("https://example.com")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"url\": \"https://example.com\""));

    create_link_mock.assert();
}

#[tokio::test]
async fn test_create_link_with_title() {
    let (server, _) = common::setup_mock_server();

    let create_link_mock = server.mock(|when, then| {
        when.method(POST)
            .path(
                "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/",
            )
            .json_body(json!({
                "url": "https://example.com",
                "title": "Example Link"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-link-id",
                "url": "https://example.com",
                "title": "Example Link"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("--url")
        .arg("https://example.com")
        .arg("--title")
        .arg("Example Link")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"title\": \"Example Link\""));

    create_link_mock.assert();
}

#[tokio::test]
async fn test_update_link() {
    let (server, _) = common::setup_mock_server();

    let update_link_mock = server.mock(|when, then| {
        when.method(PATCH)
            .path(
                "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/test-link-id/",
            )
            .json_body(json!({
                "title": "Updated Link Title"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-link-id",
                "url": "https://example.com",
                "title": "Updated Link Title"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("update")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("test-link-id")
        .arg("--title")
        .arg("Updated Link Title")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"title\": \"Updated Link Title\""));

    update_link_mock.assert();
}

#[tokio::test]
async fn test_update_link_url() {
    let (server, _) = common::setup_mock_server();

    let update_link_mock = server.mock(|when, then| {
        when.method(PATCH)
            .path(
                "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/test-link-id/",
            )
            .json_body(json!({
                "url": "https://newurl.com"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-link-id",
                "url": "https://newurl.com",
                "title": "Example Link"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("update")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("test-link-id")
        .arg("--url")
        .arg("https://newurl.com")
        .assert()
        .success()
        .stdout(predicate::str::contains("\"url\": \"https://newurl.com\""));

    update_link_mock.assert();
}

#[tokio::test]
async fn test_delete_link() {
    let (server, _) = common::setup_mock_server();

    let delete_link_mock = server.mock(|when, then| {
        when.method(DELETE).path(
            "/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/links/test-link-id/",
        );
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("link")
        .arg("delete")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("test-link-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("Link deleted successfully"));

    delete_link_mock.assert();
}
