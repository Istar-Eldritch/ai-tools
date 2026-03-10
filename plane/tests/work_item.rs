mod common;

use assert_cmd::Command;
use httpmock::prelude::*;
use predicates::prelude::*;
use serde_json::json;

#[tokio::test]
async fn test_create_work_item() {
    let (server, _) = common::setup_mock_server();

    let create_work_item_mock = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/")
            .json_body(json!({
                "name": "New Task",
                "description_html": "<p>Description</p>",
                "priority": "medium"
            }));
        then.status(201)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "new-work-item-id",
                "name": "New Task",
                "description": "Description",
                "state": "Backlog",
                "project": "test-project-id",
                "created_at": "2023-10-27T10:00:00Z",
                "updated_at": "2023-10-27T10:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("create")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--name")
        .arg("New Task")
        .arg("--description-html")
        .arg("<p>Description</p>")
        .arg("--priority")
        .arg("medium")
        .assert()
        .success()
        .stdout(predicate::str::contains("new-work-item-id"))
        .stdout(predicate::str::contains("New Task"));

    create_work_item_mock.assert();
}

#[tokio::test]
async fn test_get_work_item() {
    let (server, _) = common::setup_mock_server();

    let get_work_item_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-work-item-id",
                "name": "Existing Task",
                "state": "In Progress",
                "project": "test-project-id",
                "created_at": "2023-10-27T10:00:00Z",
                "updated_at": "2023-10-27T10:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("get")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-work-item-id"))
        .stdout(predicate::str::contains("Existing Task"));

    get_work_item_mock.assert();
}

#[tokio::test]
async fn test_update_work_item() {
    let (server, _) = common::setup_mock_server();

    let update_work_item_mock = server.mock(|when, then| {
        when.method(PATCH)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/")
            .json_body(json!({
                "name": "Updated Task",
                "state": "Done"
            }));
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-work-item-id",
                "name": "Updated Task",
                "state": "Done",
                "project": "test-project-id",
                "created_at": "2023-10-27T10:00:00Z",
                "updated_at": "2023-10-27T10:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("update")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .arg("--name")
        .arg("Updated Task")
        .arg("--state")
        .arg("Done")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-work-item-id"))
        .stdout(predicate::str::contains("Updated Task"));

    update_work_item_mock.assert();
}

#[tokio::test]
async fn test_list_work_items() {
    let (server, _) = common::setup_mock_server();

    let list_work_items_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "results": [
                    {
                        "id": "item-1",
                        "name": "Task 1",
                        "state": "Todo",
                        "project": "test-project-id",
                        "created_at": "2023-10-27T10:00:00Z",
                        "updated_at": "2023-10-27T10:00:00Z"
                    },
                    {
                        "id": "item-2",
                        "name": "Task 2",
                        "state": "Doing",
                        "project": "test-project-id",
                        "created_at": "2023-10-27T10:00:00Z",
                        "updated_at": "2023-10-27T10:00:00Z"
                    }
                ]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("list")
        .arg("--project-id")
        .arg("test-project-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("item-1"))
        .stdout(predicate::str::contains("Task 1"))
        .stdout(predicate::str::contains("item-2"))
        .stdout(predicate::str::contains("Task 2"));

    list_work_items_mock.assert();
}

#[tokio::test]
async fn test_search_work_items() {
    let (server, _) = common::setup_mock_server();

    let search_work_items_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/work-items/search/")
            .query_param("search", "bug")
            .query_param("project", "test-project-id");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "issues": [
                    {
                        "id": "item-bug",
                        "name": "Fix Bug",
                        "sequence_id": 42,
                        "project__identifier": "TEST",
                        "project_id": "test-project-id",
                        "workspace__slug": "test-workspace",
                        "type_id": null
                    }
                ]
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("search")
        .arg("--search")
        .arg("bug")
        .arg("--project")
        .arg("test-project-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("item-bug"))
        .stdout(predicate::str::contains("Fix Bug"));

    search_work_items_mock.assert();
}

#[tokio::test]
async fn test_delete_work_item() {
    let (server, _) = common::setup_mock_server();

    let delete_work_item_mock = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/workspaces/test-workspace/projects/test-project-id/work-items/test-work-item-id/");
        then.status(204);
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("delete")
        .arg("--project-id")
        .arg("test-project-id")
        .arg("--work-item-id")
        .arg("test-work-item-id")
        .assert()
        .success()
        .stdout(predicate::str::contains("Work item deleted successfully"));

    delete_work_item_mock.assert();
}

#[tokio::test]
async fn test_get_work_item_by_identifier() {
    let (server, _) = common::setup_mock_server();

    let get_work_item_mock = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/workspaces/test-workspace/work-items/PROJ-123/");
        then.status(200)
            .header("content-type", "application/json")
            .json_body(json!({
                "id": "test-work-item-id",
                "name": "Existing Task",
                "state": "In Progress",
                "project": "test-project-id",
                "created_at": "2023-10-27T10:00:00Z",
                "updated_at": "2023-10-27T10:00:00Z"
            }));
    });

    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.env("PLANE_API_KEY", "test-api-key")
        .env("PLANE_WORKSPACE", "test-workspace")
        .env("PLANE_API_BASE_URL", server.base_url().to_string())
        .arg("work-item")
        .arg("get-by-identifier")
        .arg("--identifier")
        .arg("PROJ-123")
        .assert()
        .success()
        .stdout(predicate::str::contains("test-work-item-id"))
        .stdout(predicate::str::contains("Existing Task"));

    get_work_item_mock.assert();
}
