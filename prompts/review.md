# /review - Code Review for Pull Requests

Review a GitHub pull request or local changes and add inline comments to the code.

## Target

**PR URL or scope:** `$1`
**Base branch (optional):** `$2` (defaults to `main` if not provided)

If no argument is provided, review the diff between HEAD and the base branch (default: `main`) on the current repository.

## Workflow

### For GitHub PR (when URL like `https://github.com/owner/repo/pull/123` is provided):

1. **Parse the PR URL**
   - Extract owner, repo, and PR number from URL (e.g., `https://github.com/owner/repo/pull/123`)

2. **Fetch PR Details**
   - Use `gh pr view <number> --repo <owner/repo> --json title,body,state,author,files,commits,additions,deletions`
   - Use `gh pr diff <number> --repo <owner/repo>` to get the full diff

3. **Checkout the PR Branch**
   - `gh pr checkout <number> --repo <owner/repo>`

### For Local Changes (no PR provided):

1. **Determine Base Branch**
   - Use `$2` as the base branch if provided, otherwise default to `main`
   - Store in a variable like `BASE_BRANCH="${2:-main}"`

2. **Get the Diff**
   - Use `git diff ${BASE_BRANCH}...HEAD` to get the diff between base branch and current HEAD
   - Use `git log ${BASE_BRANCH}..HEAD --oneline` to see commits being reviewed
   - Use `git diff ${BASE_BRANCH}...HEAD --stat` to get list of changed files

3. **Stay on Current Branch**
   - No checkout needed, review changes in place

4. **Analyze the Changes**
   - Read each modified/added file in full
   - Compare with existing similar code in the codebase for consistency
   - Check for:
     - Code correctness and logic errors
     - Naming consistency with existing codebase
     - Missing error handling
     - Test coverage gaps
     - Documentation gaps
     - Style inconsistencies
     - Performance concerns
     - Security issues

5. **Add Comments**

   **For GitHub PRs:** Create a pending review with all inline comments in a single API call
   - Use `gh api` to create a pending review with all comments at once:
     ```bash
     cat << 'EOF' | gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST --input -
     {
       "commit_id": "<head-commit-sha>",
       "body": "Code review summary",
       "comments": [
         {
           "path": "path/to/file.java",
           "line": 42,
           "body": "Review comment text"
         },
         {
           "path": "path/to/another/file.java",
           "line": 15,
           "body": "Another review comment"
         }
       ]
     }
     EOF
     ```
   - **Important:** Do NOT include `"event": "PENDING"` - omitting the event field creates a pending review by default. Including it causes an API error.
   - The review will be created in PENDING state with all comments attached
   - Keep comments concise but actionable

   **For Local Changes:** Add inline comments in source files
   - Add `// REVIEW:` comments directly in source files at relevant locations
   - Format:
     ```java
     // REVIEW: Brief description of the issue or suggestion
     // Consider: <suggested alternative if applicable>
     problematicCode();
     ```

6. **Finalize**

   **For GitHub PRs:**
   - Submit the review when ready:
     ```bash
     gh pr review <number> --comment  # or --approve / --request-changes
     ```

   **For Local Changes:**
   - Commit the review comments:
     ```bash
     git add -A
     git commit -m "Code review for branch <branch-name>

     Inline review comments added to source files.

     Key issues found:
     - <bullet list of key issues>"
     ```

## Checklist for Review

### Correctness
- [ ] Logic is correct
- [ ] Edge cases handled
- [ ] Error handling present
- [ ] No null pointer risks

### Consistency
- [ ] Naming matches codebase conventions
- [ ] Similar patterns to existing code
- [ ] Import style consistent
- [ ] Logging style consistent

### Testing
- [ ] Tests cover happy path
- [ ] Tests cover edge cases
- [ ] Tests cover error conditions
- [ ] No redundant assertions

### Documentation
- [ ] Public APIs documented
- [ ] Complex logic explained
- [ ] README updated if needed

### Performance & Security
- [ ] No obvious performance issues
- [ ] No security vulnerabilities
- [ ] Resources properly closed

## Output

**For GitHub PRs:**
- Pending GitHub review comments - Inline comments on the PR ready to submit

**For Local Changes:**
- Inline `// REVIEW:` comments in modified files
- Local commit with review comments
