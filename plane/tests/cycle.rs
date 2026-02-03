use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_list_cycles() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [
                    {
                        "id": "cycle-1",
                        "name": "Cycle 1",
                        "created_at": "2023-01-01T00:00:00Z",
                        "updated_at": "2023-01-01T00:00:00Z",
                        "project": "proj-1",
                        "workspace": "test-workspace"
                    }
                ]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("list")
        .arg("--project-id")
        .arg("proj-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Cycle 1"));
}

#[tokio::test]
async fn test_get_cycle() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "cycle-1",
                "name": "Cycle 1",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z",
                "project": "proj-1",
                "workspace": "test-workspace"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("get")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Cycle 1"));
}

#[tokio::test]
async fn test_create_cycle() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/")
            .header("X-API-Key", "test-api-key")
            .json_body(json!({
                "name": "New Cycle",
                "project_id": "proj-1",
                "owned_by": "user-1"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "new-cycle",
                "name": "New Cycle",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z",
                "project": "proj-1",
                "workspace": "test-workspace"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("create")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--name")
        .arg("New Cycle")
        .arg("--owned-by")
        .arg("user-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("new-cycle"));
}

#[tokio::test]
async fn test_update_cycle() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(PATCH)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/")
            .header("X-API-Key", "test-api-key")
            .json_body(json!({
                "name": "Updated Cycle"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "cycle-1",
                "name": "Updated Cycle",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z",
                "project": "proj-1",
                "workspace": "test-workspace"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("update")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .arg("--name")
        .arg("Updated Cycle")
        .assert()
        .success()
        .stdout(predicate::str::contains("Updated Cycle"));
}

#[tokio::test]
async fn test_delete_cycle() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/")
            .header("X-API-Key", "test-api-key");
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("delete")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Cycle deleted successfully"));
}

#[tokio::test]
async fn test_cycle_items() {
    let server = MockServer::start();

    // List items
    let _mock_list = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/cycle-issues/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [
                    {
                        "id": "item-1",
                        "name": "Item 1",
                        "project": "proj-1",
                        "workspace": "test-workspace",
                        "identifier": "PROJ-1",
                        "created_at": "2023-01-01T00:00:00Z",
                        "updated_at": "2023-01-01T00:00:00Z",
                        "state": "state-1"
                    }
                ]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("items")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("Item 1"));

    // Add items
    let _mock_add = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/cycle-issues/")
            .header("X-API-Key", "test-api-key")
            .json_body(json!({
                "issues": ["item-2"]
            }));
        then.status(200);
    });

    let mut cmd_add = Command::cargo_bin("plane-cli").unwrap();
    cmd_add
        .env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("items")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .arg("add")
        .arg("item-2")
        .assert()
        .success()
        .stdout(predicate::str::contains("Work items added to cycle"));

    // Remove items
    let _mock_remove = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/cycles/cycle-1/cycle-issues/item-2/")
            .header("X-API-Key", "test-api-key");
        then.status(204);
    });

    let mut cmd_remove = Command::cargo_bin("plane-cli").unwrap();
    cmd_remove
        .env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("cycle")
        .arg("items")
        .arg("--project-id")
        .arg("proj-1")
        .arg("--cycle-id")
        .arg("cycle-1")
        .arg("remove")
        .arg("--item-id")
        .arg("item-2")
        .assert()
        .success()
        .stdout(predicate::str::contains("Work item removed from cycle"));
}
