use assert_cmd::Command;
use predicates::prelude::*;

fn cmd() -> Command {
    Command::cargo_bin("claude-sandbox").unwrap()
}

#[test]
fn test_version_flag() {
    cmd()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("claude-sandbox"));
}

#[test]
fn test_default_to_run() {
    // No subcommand should default to `run`
    cmd()
        .assert()
        .success()
        .stdout(predicate::str::contains("run:"));
}

#[test]
fn test_run_subcommand() {
    cmd()
        .arg("run")
        .assert()
        .success()
        .stdout(predicate::str::contains("run:"));
}

#[test]
fn test_run_with_passthrough_args() {
    cmd()
        .args(["run", "--", "--model", "opus"])
        .assert()
        .success()
        .stdout(predicate::str::contains("run:"));
}

#[test]
fn test_setup_subcommand() {
    cmd()
        .arg("setup")
        .assert()
        .success()
        .stdout(predicate::str::contains("setup:"));
}

#[test]
fn test_init_subcommand() {
    cmd()
        .arg("init")
        .assert()
        .success()
        .stdout(predicate::str::contains("init:"));
}

#[test]
fn test_check_subcommand() {
    cmd()
        .arg("check")
        .assert()
        .success()
        .stdout(predicate::str::contains("check:"));
}

#[test]
fn test_list_profiles_subcommand() {
    cmd()
        .arg("list-profiles")
        .assert()
        .success()
        .stdout(predicate::str::contains("list-profiles:"));
}
