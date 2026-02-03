import { describe, it, expect } from "vitest";
import { extractCommitMessage } from "./git.ts";

describe("extractCommitMessage", () => {
	describe("code block extraction", () => {
		it("extracts message from markdown code block", () => {
			const output = `Here's the commit message:

\`\`\`
feat(api): add user authentication endpoint

- Implement JWT token generation
- Add login/logout routes
- Include rate limiting
\`\`\`

This follows conventional commit format.`;
			
			const message = extractCommitMessage(output);
			expect(message).toContain("feat(api): add user authentication endpoint");
			expect(message).toContain("Implement JWT token generation");
		});

		it("extracts message from code block with language hint", () => {
			const output = `\`\`\`text
fix(parser): handle edge case in tokenizer
\`\`\``;
			
			const message = extractCommitMessage(output);
			expect(message).toBe("fix(parser): handle edge case in tokenizer");
		});

		it("handles code block with empty language hint", () => {
			const output = `\`\`\`
docs: update README with new examples
\`\`\``;
			
			const message = extractCommitMessage(output);
			expect(message).toBe("docs: update README with new examples");
		});
	});

	describe("conventional commit extraction", () => {
		it("extracts feat commit without code block", () => {
			const output = `Based on the changes, here's an appropriate commit message:

feat(auth): implement OAuth2 login flow

Added support for Google and GitHub OAuth providers.`;
			
			const message = extractCommitMessage(output);
			expect(message).toContain("feat(auth): implement OAuth2 login flow");
		});

		it("extracts fix commit", () => {
			const output = "The appropriate message is: fix(ui): resolve button alignment issue";
			const message = extractCommitMessage(output);
			expect(message).toContain("fix(ui): resolve button alignment issue");
		});

		it("extracts docs commit", () => {
			const output = "docs(api): add endpoint documentation\n\nDetailed description here.";
			const message = extractCommitMessage(output);
			expect(message).toContain("docs(api): add endpoint documentation");
		});

		it("extracts refactor commit", () => {
			const output = "refactor(core): simplify data processing pipeline";
			const message = extractCommitMessage(output);
			expect(message).toContain("refactor(core): simplify data processing pipeline");
		});

		it("extracts test commit", () => {
			const output = "test(utils): add unit tests for string helpers";
			const message = extractCommitMessage(output);
			expect(message).toContain("test(utils): add unit tests for string helpers");
		});

		it("extracts chore commit", () => {
			const output = "chore(deps): update dependencies to latest versions";
			const message = extractCommitMessage(output);
			expect(message).toContain("chore(deps): update dependencies to latest versions");
		});
	});

	describe("multi-line commit messages", () => {
		it("preserves body in conventional commit", () => {
			const output = `\`\`\`
feat(pipeline): add tiered review system

Implements a two-tier review process:
- Cheap tier uses Sonnet for initial review
- Expensive tier uses Opus for final QA

Closes #123
\`\`\``;
			
			const message = extractCommitMessage(output);
			expect(message).toContain("feat(pipeline): add tiered review system");
			expect(message).toContain("two-tier review process");
			expect(message).toContain("Closes #123");
		});
	});

	describe("fallback behavior", () => {
		it("returns trimmed output when no pattern matches", () => {
			const output = "  Simple commit message  ";
			const message = extractCommitMessage(output);
			expect(message).toBe("Simple commit message");
		});

		it("handles empty output", () => {
			const message = extractCommitMessage("");
			expect(message).toBe("");
		});

		it("handles whitespace-only output", () => {
			const message = extractCommitMessage("   \n\t  ");
			expect(message).toBe("");
		});
	});

	describe("preference for code blocks", () => {
		it("prefers code block over inline conventional commit", () => {
			const output = `feat(ignored): this should be ignored

\`\`\`
fix(actual): this is the real message
\`\`\`

feat(also-ignored): also ignored`;
			
			const message = extractCommitMessage(output);
			expect(message).toBe("fix(actual): this is the real message");
		});
	});
});
