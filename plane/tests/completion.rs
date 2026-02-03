use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn test_completion_bash() {
    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.arg("completion").arg("bash");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("complete -F _plane-cli"));
}

#[test]
fn test_completion_zsh() {
    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.arg("completion").arg("zsh");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("#compdef plane-cli"));
}

#[test]
fn test_completion_invalid_shell() {
    let mut cmd = Command::cargo_bin("plane-cli").unwrap();
    cmd.arg("completion").arg("invalid");
    cmd.assert().failure().stderr(predicate::str::contains(
        "error: invalid value 'invalid' for '<SHELL>'",
    ));
}
