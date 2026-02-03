use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_list_projects() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [
                    {
                        "id": "proj-1",
                        "name": "Project 1",
                        "identifier": "PROJ1",
                        "created_at": "2023-01-01T00:00:00Z",
                        "updated_at": "2023-01-01T00:00:00Z"
                    }
                ]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("project")
        .arg("list")
        .assert()
        .success()
        .stdout(predicate::str::contains("Project 1"));
}

#[tokio::test]
async fn test_get_project() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/")
            .header("X-API-Key", "test-api-key");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "proj-1",
                "name": "Project 1",
                "identifier": "PROJ1",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("project")
        .arg("get")
        .arg("proj-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Project 1"));
}

#[tokio::test]
async fn test_create_project() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/")
            .header("X-API-Key", "test-api-key")
            .json_body(json!({
                "name": "New Project",
                "identifier": "NEW"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "new-proj",
                "name": "New Project",
                "identifier": "NEW",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("project")
        .arg("create")
        .arg("--name")
        .arg("New Project")
        .arg("--identifier")
        .arg("NEW")
        .assert()
        .success()
        .stdout(predicate::str::contains("new-proj"));
}

#[tokio::test]
async fn test_update_project() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(PATCH)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/")
            .header("X-API-Key", "test-api-key")
            .json_body(json!({
                "name": "Updated Project"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "proj-1",
                "name": "Updated Project",
                "identifier": "PROJ1",
                "created_at": "2023-01-01T00:00:00Z",
                "updated_at": "2023-01-01T00:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("project")
        .arg("update")
        .arg("proj-1")
        .arg("--name")
        .arg("Updated Project")
        .assert()
        .success()
        .stdout(predicate::str::contains("Updated Project"));
}

#[tokio::test]
async fn test_delete_project() {
    let server = MockServer::start();

    let _mock = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/workspaces/test-workspace/projects/proj-1/")
            .header("X-API-Key", "test-api-key");
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url())
        .arg("project")
        .arg("delete")
        .arg("proj-1")
        .assert()
        .success()
        .stdout(predicate::str::contains("Project deleted successfully"));
}
