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
fn test_default_to_run_fails_without_config() {
    // Without a valid profile on disk, `run` (the default command) should fail
    // with a config/profile error rather than silently succeeding.
    cmd()
        .assert()
        .failure();
}

#[test]
fn test_run_subcommand_fails_without_config() {
    cmd()
        .arg("run")
        .assert()
        .failure();
}

#[test]
fn test_run_dry_run_prints_bwrap_command() {
    // --dry-run prints the bwrap command line and exits successfully
    // (This works when a default "minimal" profile is available on disk)
    cmd()
        .args(["run", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("bwrap"))
        .stdout(predicate::str::contains("--unshare-user"))
        .stdout(predicate::str::contains("claude"));
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
