---
name: gh-cli
description: GitHub CLI (gh) for managing repositories, issues, pull requests, releases, workflows, and more. Use when the user needs to interact with GitHub - creating/viewing/editing issues, PRs, repos, releases, searching code, managing workflows, or any GitHub operations from the command line.
---

# GitHub CLI (gh)

The `gh` CLI provides seamless GitHub integration from the terminal.

## Setup

Check authentication status:
```bash
gh auth status
```

If not authenticated, run:
```bash
gh auth login
```

## Quick Reference

### Issues

```bash
# List issues
gh issue list                          # Open issues in current repo
gh issue list --state all              # All issues
gh issue list --assignee @me           # Assigned to me
gh issue list --label bug              # With specific label
gh issue list --search "keyword"       # Search issues

# Create issue
gh issue create                        # Interactive
gh issue create --title "Title" --body "Body"
gh issue create --label bug,urgent --assignee username

# View/Edit issue
gh issue view 123                      # View issue #123
gh issue view 123 --web                # Open in browser
gh issue edit 123 --title "New title"
gh issue edit 123 --add-label bug --add-assignee user

# Close/Reopen
gh issue close 123
gh issue close 123 --comment "Closing because..."
gh issue reopen 123

# Comment
gh issue comment 123 --body "My comment"
```

### Pull Requests

```bash
# List PRs
gh pr list                             # Open PRs
gh pr list --state all                 # All PRs
gh pr list --author @me                # My PRs
gh pr list --search "review:required"  # Needs review

# Create PR
gh pr create                           # Interactive
gh pr create --fill                    # Auto-fill from commits
gh pr create --title "Title" --body "Body"
gh pr create --base main --head feature-branch
gh pr create --draft                   # Create as draft
gh pr create --reviewer user1,user2

# View PR
gh pr view                             # Current branch's PR
gh pr view 456                         # PR #456
gh pr view --web                       # Open in browser
gh pr diff 456                         # View diff

# Checkout PR
gh pr checkout 456                     # Checkout PR branch

# Review PR
gh pr review 456 --approve
gh pr review 456 --request-changes --body "Please fix..."
gh pr review 456 --comment --body "Looks good but..."

# Merge PR
gh pr merge 456                        # Interactive merge
gh pr merge 456 --merge                # Merge commit
gh pr merge 456 --squash               # Squash and merge
gh pr merge 456 --rebase               # Rebase and merge
gh pr merge 456 --auto                 # Auto-merge when checks pass

# Other PR operations
gh pr ready 456                        # Mark ready for review
gh pr close 456
gh pr reopen 456
gh pr edit 456 --title "New title"
gh pr comment 456 --body "Comment"
gh pr checks 456                       # View CI status
```

### Repositories

```bash
# List repos
gh repo list                           # Your repos
gh repo list OWNER                     # User/org repos
gh repo list --source                  # Only non-forks

# Create repo
gh repo create myrepo                  # Interactive
gh repo create myrepo --public
gh repo create myrepo --private --clone
gh repo create org/repo --template OWNER/TEMPLATE

# Clone
gh repo clone OWNER/REPO
gh repo clone OWNER/REPO -- --depth 1  # Shallow clone

# View
gh repo view                           # Current repo
gh repo view OWNER/REPO
gh repo view --web                     # Open in browser

# Fork
gh repo fork                           # Fork current repo
gh repo fork OWNER/REPO --clone

# Edit settings
gh repo edit --visibility public
gh repo edit --default-branch main
gh repo edit --enable-issues=false

# Sync fork
gh repo sync                           # Sync current fork
gh repo sync OWNER/REPO --source UPSTREAM/REPO
```

### Search

```bash
# Search repos
gh search repos "query"
gh search repos "query" --language python --stars ">1000"

# Search issues
gh search issues "bug"
gh search issues "bug" --repo OWNER/REPO
gh search issues "label:bug state:open"

# Search PRs
gh search prs "query"
gh search prs "review:required" --author @me

# Search code
gh search code "function" --repo OWNER/REPO
gh search code "TODO" --language javascript

# Search commits
gh search commits "fix bug" --author username
```

### Releases

```bash
# List releases
gh release list

# Create release
gh release create v1.0.0                    # Interactive
gh release create v1.0.0 --title "v1.0.0"
gh release create v1.0.0 --generate-notes   # Auto-generate notes
gh release create v1.0.0 ./dist/*           # Upload assets
gh release create v1.0.0 --prerelease
gh release create v1.0.0 --draft

# View release
gh release view v1.0.0
gh release view --web

# Download assets
gh release download v1.0.0
gh release download v1.0.0 --pattern "*.tar.gz"

# Edit/Delete
gh release edit v1.0.0 --title "New Title"
gh release delete v1.0.0
```

### Workflows (GitHub Actions)

```bash
# List workflows
gh workflow list

# View workflow
gh workflow view "CI"
gh workflow view ci.yml

# Run workflow
gh workflow run ci.yml
gh workflow run ci.yml --ref branch-name
gh workflow run ci.yml -f param=value

# List runs
gh run list
gh run list --workflow ci.yml
gh run list --status failure

# View run
gh run view 12345
gh run view 12345 --log
gh run view --web

# Watch run
gh run watch 12345

# Rerun
gh run rerun 12345
gh run rerun 12345 --failed   # Only failed jobs

# Cancel
gh run cancel 12345
```

### Gists

```bash
# List gists
gh gist list

# Create gist
gh gist create file.txt                # Public
gh gist create file.txt --public
gh gist create file1.txt file2.txt     # Multiple files
echo "code" | gh gist create           # From stdin

# View/Edit
gh gist view GIST_ID
gh gist edit GIST_ID

# Clone/Delete
gh gist clone GIST_ID
gh gist delete GIST_ID
```

### GitHub API

```bash
# GET request
gh api repos/OWNER/REPO
gh api user

# POST request
gh api repos/OWNER/REPO/issues -f title="Bug" -f body="Description"

# With pagination
gh api repos/OWNER/REPO/issues --paginate

# GraphQL
gh api graphql -f query='{ viewer { login } }'

# Output formatting
gh api repos/OWNER/REPO --jq '.name'
gh api repos/OWNER/REPO --template '{{.name}}'
```

### Status & Browse

```bash
# Your GitHub status
gh status

# Open in browser
gh browse                              # Current repo
gh browse 123                          # Issue/PR #123
gh browse --settings                   # Repo settings
gh browse src/main.go:42               # File at line
```

## Common Flags

| Flag | Description |
|------|-------------|
| `-R, --repo OWNER/REPO` | Target a different repository |
| `--json fields` | Output as JSON with specified fields |
| `--jq expression` | Filter JSON output |
| `-w, --web` | Open in browser |
| `-h, --help` | Command help |

## JSON Output

Most commands support `--json` for structured output:

```bash
gh issue list --json number,title,state
gh pr view 123 --json title,body,reviews
gh repo view --json name,description,stargazerCount
```

Combine with `--jq` for filtering:

```bash
gh issue list --json number,title --jq '.[].title'
gh pr list --json number,mergeable --jq '.[] | select(.mergeable == "MERGEABLE")'
```

## Tips

1. **Set default repo**: `gh repo set-default OWNER/REPO`
2. **Aliases**: `gh alias set pv 'pr view'` then use `gh pv`
3. **Completions**: `gh completion -s bash >> ~/.bashrc`
4. **Config**: `gh config set editor vim`
