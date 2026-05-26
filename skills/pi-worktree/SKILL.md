---
name: pi-worktree
description: Manage git worktrees for parallel agentic workflows. Use when you need to work on multiple branches simultaneously, start a parallel feature while another pi session is running, or isolate work in a clean directory without stashing or committing in-progress changes.
---

# Git Worktrees for Parallel Pi Workflows

Use [git worktrees](https://git-scm.com/docs/git-worktree) to check out multiple branches at the same time in separate directories. This lets you run multiple pi sessions in parallel — each on its own branch — without file conflicts or stash juggling.

## When to Use This Skill

- **Parallel feature work:** One pi session is implementing a feature on `feature/auth`, you want to start another on `feature/payments`
- **Hotfix while implementing:** A long-running implementation is in progress and you need a quick fix on `main`
- **Clean separation:** Avoid mixing files from different branches in the same working tree
- **Review/rebase aid:** Check out a PR branch for review without disturbing your current work

## Quick Start

```bash
# From within a repo — create a worktree for a new branch off main
skills/pi-worktree/worktree.sh new my-feature

# From anywhere — create a worktree for a specific repo
skills/pi-worktree/worktree.sh create ~/code/catallactical/catacloud my-feature

# List all worktrees for a repo
skills/pi-worktree/worktree.sh list ~/code/catallactical/catacloud

# Remove a worktree when done
skills/pi-worktree/worktree.sh remove my-feature

# Remove worktree and delete the branch too
skills/pi-worktree/worktree.sh remove --branch my-feature

# Clean up stale/merged worktrees
skills/pi-worktree/worktree.sh clean ~/code/catallactical/catacloud
```

## Commands Reference

### `new <branch-name> [--base <branch>]`

Create a worktree from the current repository's directory. Defaults to branching from `main`.

```bash
# Branch off main
cd ~/code/catallactical/catacloud
skills/pi-worktree/worktree.sh new feature/payments

# Branch off a specific base
cd ~/code/catallactical/catacloud
skills/pi-worktree/worktree.sh new feature/payments --base develop
```

Output:
```
✅ Worktree created: ~/code/catallactical/catacloud-worktrees/feature-payments
   Branch: feature/payments (from main)
   To start a pi session there:
   cd ~/code/catallactical/catacloud-worktrees/feature-payments && pi "..."
```

### `create <repo-path> <branch-name> [--base <branch>]`

Create a worktree for a repository from any directory. The worktree path is derived automatically from the repo path.

```bash
skills/pi-worktree/worktree.sh create ~/code/catallactical/catacloud feature/payments
skills/pi-worktree/worktree.sh create ~/code/catallactical/catacloud feature/payments --base develop
```

### `list [repo-path]`

List all worktrees. If inside a repo, `repo-path` is optional.

```bash
# Inside a repo
skills/pi-worktree/worktree.sh list

# For a specific repo
skills/pi-worktree/worktree.sh list ~/code/catallactical/catacloud
```

### `remove [--branch] [--force] [repo-path] <branch-or-path>`

Remove a worktree. Use `--branch` to also delete the associated branch (merged branches are deleted automatically; unmerged branches prompt for confirmation). Use `--force` to skip all confirmation prompts.

```bash
# Inside a repo — remove by branch name, keeping the branch
skills/pi-worktree/worktree.sh remove feature/payments

# Remove worktree and delete the branch
skills/pi-worktree/worktree.sh remove --branch feature/payments

# Remove without confirmation prompts
skills/pi-worktree/worktree.sh remove --force --branch feature/payments

# Remove by absolute path
skills/pi-worktree/worktree.sh remove ~/code/catallactical/catacloud-worktrees/feature-payments
```

### `clean [repo-path]`

Remove worktrees whose branches have been merged into the main branch (or whose branches no longer exist). Prompts for confirmation before removing unmerged branches.

```bash
skills/pi-worktree/worktree.sh clean
skills/pi-worktree/worktree.sh clean ~/code/catallactical/catacloud
```

## Workflow Examples

### Running Two Pi Sessions in Parallel

**Terminal 1 — already running:**
```bash
cd ~/code/catallactical/catacloud
pi "implement the auth system from spec.md"
# Session is now busy implementing on branch feature/auth
```

**Terminal 2 — start parallel work:**
```bash
skills/pi-worktree/worktree.sh create ~/code/catallactical/catacloud feature/payments
# Output: cd ~/code/catallactical/catacloud-worktrees/feature-payments && pi "..."

cd ~/code/catallactical/catacloud-worktrees/feature-payments
pi "implement the payment webhook handler"
# This session works in isolation — no file conflicts with Terminal 1
```

### Hotfix While Implementing

```bash
# Terminal 1 is mid-implementation on feature/auth

# In Terminal 2:
skills/pi-worktree/worktree.sh create ~/code/catallactical/catacloud hotfix/login-bug --base main
cd ~/code/catallactical/catacloud-worktrees/hotfix-login-bug
pi "fix the login redirect bug described in issue #42"

# When done, merge the hotfix, then remove the worktree and delete the branch
skills/pi-worktree/worktree.sh remove --branch ~/code/catallactical/catacloud hotfix-login-bug
```

### Agent Creates Its Own Worktree

When acting as an agent, if the user asks to start parallel work, you can:

1. Run `skills/pi-worktree/worktree.sh create <repo> <branch>` to set up the worktree
2. Report the new worktree path to the user
3. Suggest they start a new pi session there, OR if appropriate, run `cd` to the worktree and continue working in the current session (this will abandon work in the original directory)

```bash
# Example: user says "start a parallel branch for feature X"
cd ~/code/catallactical/catacloud
skills/pi-worktree/worktree.sh new feature/x --base main
# Output shows the new path
cd ~/code/catallactical/catacloud-worktrees/feature-x
# Continue in this session
```

## Directory Conventions

By default, worktrees are placed alongside the original repo in a `<repo-name>-worktrees/` directory:

```
~/code/catallactical/
├── catacloud/                        # original repo (main branch)
│   ├── src/
│   └── .git/worktrees/
│
└── catacloud-worktrees/              # container for worktrees
    ├── feature-payments/             # branch: feature/payments
    ├── hotfix-login-bug/             # branch: hotfix/login-bug
    └── feature-auth/                 # branch: feature/auth
```

This keeps all related repos in one location and makes cleanup easy.

## Best Practices

1. **Branch naming:** Use kebab-case for branch names (`feature/payment-webhooks` not `feature/payment_webhooks`). Paths are derived by replacing `/` with `-`.
2. **Clean up quickly:** Remove worktrees once the branch is merged to avoid stale directories.
3. **Don't edit `.git`:** Each worktree shares the same `.git` object store — do not manually edit `.git/worktrees/` files.
4. **Dependencies:** If the project has `node_modules/` or build artifacts that differ between branches, note that worktrees share these only if they're in `.gitignore`. Build artifacts in the repo may need separate handling.
5. **Submodules:** If the repo uses git submodules, you may need to run `git submodule update --init --recursive` after entering a worktree.

## Troubleshooting

**"branch is already checked out"**: You already have this branch in another worktree. Use `worktree.sh list` to find it.

**"worktree already exists"**: The directory already exists. Either remove it first or use a different branch name.

**"main is behind origin/main"**: The base branch is out of date. Run `git fetch origin` in the original repo first.

**Changes appearing in both worktrees:** Files that are not in `.gitignore` and are modified in one worktree will appear modified in others (they share the index). Add them to `.gitignore` or use the original repo's `.git/info/exclude`.
