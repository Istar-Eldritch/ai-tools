# /review - Code Review for GitHub PRs

Review a GitHub pull request and add inline comments to the code.

## Target

PR URL or number: `$1`

If a full URL like `https://github.com/owner/repo/pull/123` is given, parse the owner, repo, and PR number from it. If just a number is given, use the current repository.

## Workflow

1. Fetch PR details

   Get the PR metadata, including the base branch:
   ```bash
   gh pr view <number> --repo <owner/repo> --json title,body,state,author,baseRefName,headRefName,files,commits,additions,deletions
   ```
   The `baseRefName` field tells you which branch the PR targets, so you don't need to guess or default to `main`.

   Then grab the full diff:
   ```bash
   gh pr diff <number> --repo <owner/repo>
   ```

2. Checkout the PR branch

   ```bash
   gh pr checkout <number> --repo <owner/repo>
   ```

3. Analyze the changes

   Read each modified and added file in full. Compare with existing code in the codebase for consistency. Look for:
   - correctness and logic errors
   - naming consistency with the rest of the codebase
   - missing error handling
   - test coverage gaps
   - documentation gaps
   - style inconsistencies
   - performance concerns
   - security issues

4. Add comments

   Create a pending review with all inline comments in a single API call:
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

   Don't include `"event": "PENDING"` in the payload. Omitting the event field creates a pending review by default, and including it actually causes an API error.

   The review will be created in pending state with all comments attached. Keep comments concise but actionable.

5. Finalize

   Submit the review when ready:
   ```bash
   gh pr review <number> --comment  # or --approve / --request-changes
   ```

## Review checklist

Things to watch for during the review:

Correctness
- logic is correct
- edge cases handled
- error handling present
- no null pointer risks

Consistency
- naming matches codebase conventions
- similar patterns to existing code
- import style consistent
- logging style consistent

Testing
- tests cover happy path
- tests cover edge cases
- tests cover error conditions
- no redundant assertions

Documentation
- public APIs documented
- complex logic explained
- README updated if needed

Performance and security
- no obvious performance issues
- no security vulnerabilities
- resources properly closed

## Output

Pending GitHub review with inline comments on the PR, ready to submit.
