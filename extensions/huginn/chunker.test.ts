import { describe, it, expect } from "vitest";
import { chunkText, type ChunkerOptions } from "./chunker.ts";

const defaults: ChunkerOptions = {
	chunkSize: 512,
	chunkOverlap: 64,
	minChunkSize: 32,
};

describe("chunkText", () => {
	it("returns empty array for empty string", () => {
		expect(chunkText("", defaults)).toEqual([]);
	});

	it("returns empty array for whitespace-only string", () => {
		expect(chunkText("   \n\t  ", defaults)).toEqual([]);
	});

	it("returns a single chunk for short text", () => {
		const text = "Hello world. This is a short paragraph.";
		const chunks = chunkText(text, defaults);
		expect(chunks.length).toBe(1);
		expect(chunks[0]).toBe(text);
	});

	it("splits on paragraph boundaries", () => {
		const para1 = "A".repeat(300);
		const para2 = "B".repeat(300);
		const para3 = "C".repeat(300);
		const text = `${para1}\n\n${para2}\n\n${para3}`;
		const chunks = chunkText(text, defaults);
		// Each paragraph is ~300 chars; combined they exceed 512, so should split
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		// Verify no paragraph boundary was torn apart within a chunk
		for (const chunk of chunks) {
			expect(chunk).not.toContain("A".repeat(100) + "\n\n" + "B".repeat(100));
		}
	});

	it("splits on markdown headings", () => {
		const text = `# Heading 1\n\nSome content here.\n\n## Heading 2\n\nMore content follows.`;
		const chunks = chunkText(text, {
			chunkSize: 512,
			chunkOverlap: 0,
			minChunkSize: 1,
		});
		const all = chunks.join("\n---\n");
		expect(all).toContain("# Heading 1");
		expect(all).toContain("## Heading 2");
	});

	it("preserves code fences as atomic segments", () => {
		const text = `Some intro.\n\n\`\`\`typescript\nconst x = 1;\nconst y = 2;\n\`\`\`\n\nSome outro.`;
		const chunks = chunkText(text, defaults);
		const all = chunks.join("\n---\n");
		expect(all).toContain("```typescript");
		expect(all).toContain("const x = 1;");
		expect(all).toContain("```");
	});

	it("splits oversize segments into sub-chunks", () => {
		const text = "word ".repeat(2000); // ~10000 chars
		const chunks = chunkText(text, {
			chunkSize: 500,
			chunkOverlap: 50,
			minChunkSize: 1,
		});
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(500);
		}
	});

	it("respects minChunkSize", () => {
		const text = "short";
		const chunks = chunkText(text, {
			chunkSize: 512,
			chunkOverlap: 0,
			minChunkSize: 32,
		});
		expect(chunks.length).toBe(0);
	});

	it("uses chunkOverlap between combined segments", () => {
		const p1 = "A".repeat(400);
		const p2 = "B".repeat(400);
		const text = `${p1}\n\n${p2}`;
		const chunks = chunkText(text, {
			chunkSize: 500,
			chunkOverlap: 100,
			minChunkSize: 1,
		});
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		if (chunks.length > 1) {
			// Second chunk should start with overlap from first
			const overlap = p1.slice(-100);
			expect(chunks[1]?.startsWith(overlap)).toBe(true);
		}
	});

	it("handles a mix of fences, headings, and paragraphs", () => {
		const text = `Intro paragraph.\n\n# Section A\n\n\`\`\`js\nconsole.log(1);\n\`\`\`\n\nMiddle paragraph.\n\n## Subsection\n\nFinal paragraph.`;
		const chunks = chunkText(text, {
			chunkSize: 400,
			chunkOverlap: 20,
			minChunkSize: 1,
		});
		const all = chunks.join("\n");
		expect(all).toContain("# Section A");
		expect(all).toContain("console.log(1);");
		expect(all).toContain("## Subsection");
		expect(all).toContain("Final paragraph");
	});
});
