export interface ChunkerOptions {
	chunkSize: number;
	chunkOverlap: number;
	minChunkSize: number;
}

/**
 * Lightweight pure-JS chunker for conversation text.
 * Splits on code fences, markdown headings, and paragraph boundaries.
 */
export function chunkText(text: string, options: ChunkerOptions): string[] {
	const { chunkSize, chunkOverlap, minChunkSize } = options;
	const trimmed = text.trim();
	if (!trimmed) return [];

	const segments = splitIntoSegments(trimmed);
	return combineSegments(segments, chunkSize, chunkOverlap, minChunkSize);
}

/**
 * Split text into atomic segments: code fences, headings, and paragraphs.
 */
function splitIntoSegments(text: string): string[] {
	const lines = text.split("\n");
	const segments: string[] = [];
	let buffer: string[] = [];
	let inFence = false;
	let fenceOpener = "";

	function flushNonFence() {
		if (buffer.length === 0) return;
		const block = buffer.join("\n");
		buffer = [];

		const paragraphs = block
			.split(/\n\s*\n/)
			.filter((p) => p.trim().length > 0);
		for (const para of paragraphs) {
			const trimmed = para.trim();
			const headingMatch = trimmed.match(/^(#{1,6}[ \t]+.+)/);
			if (headingMatch && headingMatch.index === 0) {
				segments.push(headingMatch[1]);
				const rest = trimmed.slice(headingMatch[1].length).trim();
				if (rest.length > 0) segments.push(rest);
			} else {
				segments.push(trimmed);
			}
		}
	}

	function flushFence() {
		if (buffer.length === 0) return;
		segments.push(buffer.join("\n"));
		buffer = [];
		inFence = false;
		fenceOpener = "";
	}

	for (const line of lines) {
		const fenceMatch = line.match(/^(```+|~~~+)/);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (!inFence) {
				flushNonFence();
				inFence = true;
				fenceOpener = marker;
				buffer.push(line);
			} else if (
				marker.length >= fenceOpener.length &&
				marker.startsWith(fenceOpener[0])
			) {
				// Closing fence
				buffer.push(line);
				flushFence();
			} else {
				// Nested fence marker (doesn't close)
				buffer.push(line);
			}
		} else {
			buffer.push(line);
		}
	}

	if (inFence) {
		flushFence();
	} else {
		flushNonFence();
	}

	return segments;
}

function combineSegments(
	segments: string[],
	chunkSize: number,
	chunkOverlap: number,
	minChunkSize: number,
): string[] {
	const chunks: string[] = [];
	let current = "";

	for (const segment of segments) {
		if (segment.length > chunkSize) {
			if (current.trim().length >= minChunkSize) {
				chunks.push(current.trim());
			}
			const subChunks = splitOversize(segment, chunkSize, chunkOverlap);
			for (const sub of subChunks) {
				if (sub.trim().length >= minChunkSize) {
					chunks.push(sub.trim());
				}
			}
			current = "";
			continue;
		}

		const separator = current.length > 0 ? "\n\n" : "";
		if (current.length + separator.length + segment.length <= chunkSize) {
			current = current ? current + separator + segment : segment;
		} else {
			if (current.trim().length >= minChunkSize) {
				chunks.push(current.trim());
			}
			if (chunkOverlap > 0 && current.length > chunkOverlap) {
				current = current.slice(-chunkOverlap) + "\n\n" + segment;
			} else {
				current = segment;
			}
		}
	}

	if (current.trim().length >= minChunkSize) {
		chunks.push(current.trim());
	}

	return chunks;
}

function splitOversize(
	text: string,
	chunkSize: number,
	chunkOverlap: number,
): string[] {
	const chunks: string[] = [];
	let i = 0;
	while (i < text.length) {
		const end = Math.min(i + chunkSize, text.length);
		chunks.push(text.slice(i, end));
		const nextStart = end - chunkOverlap;
		if (nextStart <= i) {
			i = end;
		} else {
			i = nextStart;
		}
	}
	return chunks;
}

export interface CodeChunk {
	content: string;
	startLine: number;
	endLine: number;
}

/** Map file extensions to tree-sitter language configuration. */
const LANG_CONFIG: Record<
	string,
	{ module: string; exportName?: string; query: string }
> = {
	".ts": {
		module: "tree-sitter-typescript",
		exportName: "typescript",
		query:
			"(function_declaration) @f (class_declaration) @c (interface_declaration) @i (type_alias_declaration) @t",
	},
	".tsx": {
		module: "tree-sitter-typescript",
		exportName: "tsx",
		query:
			"(function_declaration) @f (class_declaration) @c (interface_declaration) @i (type_alias_declaration) @t",
	},
	".js": {
		module: "tree-sitter-javascript",
		query:
			"(function_declaration) @f (class_declaration) @c (method_definition) @m",
	},
	".jsx": {
		module: "tree-sitter-javascript",
		query:
			"(function_declaration) @f (class_declaration) @c (method_definition) @m",
	},
	".mjs": {
		module: "tree-sitter-javascript",
		query:
			"(function_declaration) @f (class_declaration) @c (method_definition) @m",
	},
	".cjs": {
		module: "tree-sitter-javascript",
		query:
			"(function_declaration) @f (class_declaration) @c (method_definition) @m",
	},
	".py": {
		module: "tree-sitter-python",
		query: "(function_definition) @f (class_definition) @c",
	},
	".rs": {
		module: "tree-sitter-rust",
		query:
			"(function_item) @f (impl_item) @i (struct_item) @s (enum_item) @e (trait_item) @t",
	},
	".java": {
		module: "tree-sitter-java",
		query:
			"(class_declaration) @c (method_declaration) @m (interface_declaration) @i (enum_declaration) @e",
	},
};

/** Detect language config from file path. */
function detectLanguageConfig(
	filePath: string,
): { module: string; exportName?: string; query: string } | undefined {
	const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
	return LANG_CONFIG[ext];
}

/**
 * Chunk source code using tree-sitter when available, falling back to
 * lightweight JS chunking with approximate line numbers.
 */
export async function chunkCode(
	sourceCode: string,
	filePath: string,
	options: ChunkerOptions,
): Promise<CodeChunk[]> {
	try {
		return await chunkCodeWithTreeSitter(sourceCode, filePath, options);
	} catch {
		return chunkCodeFallback(sourceCode, options);
	}
}

async function chunkCodeWithTreeSitter(
	sourceCode: string,
	filePath: string,
	options: ChunkerOptions,
): Promise<CodeChunk[]> {
	const langConfig = detectLanguageConfig(filePath);
	if (!langConfig) {
		return chunkCodeFallback(sourceCode, options);
	}

	// Dynamic import so tree-sitter failures are caught gracefully.
	// biome-ignore lint/suspicious/noExplicitAny: dynamic tree-sitter imports
	const ParserMod: any = await import("tree-sitter");
	const Parser = ParserMod.default ?? ParserMod.Parser ?? ParserMod;
	// biome-ignore lint/suspicious/noExplicitAny: dynamic language imports
	const LangMod: any = await import(langConfig.module);
	const lang = langConfig.exportName
		? LangMod[langConfig.exportName]
		: (LangMod.default ?? LangMod);
	if (!lang) {
		return chunkCodeFallback(sourceCode, options);
	}

	const parser = new Parser();
	parser.setLanguage(lang);
	const tree = parser.parse(sourceCode);

	const QueryCls = ParserMod.Query ?? Parser.Query;
	const query = new QueryCls(lang, langConfig.query);
	const captures = query.captures(tree.rootNode) as Array<{
		name: string;
		// biome-ignore lint/suspicious/noExplicitAny: tree-sitter node shape
		node: any;
	}>;

	const nodes = captures.map((c) => ({
		startLine: c.node.startPosition.row + 1,
		endLine: c.node.endPosition.row + 1,
		text: c.node.text as string,
	}));

	// Deduplicate overlapping nodes (keep the outermost / largest for nested captures)
	nodes.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
	const deduped: typeof nodes = [];
	for (const node of nodes) {
		const last = deduped[deduped.length - 1];
		if (
			last &&
			node.startLine >= last.startLine &&
			node.endLine <= last.endLine
		) {
			continue; // nested inside previous node; skip
		}
		deduped.push(node);
	}

	const { chunkSize, chunkOverlap, minChunkSize } = options;
	const result: CodeChunk[] = [];
	for (const node of deduped) {
		if (node.text.length > chunkSize) {
			const parts = splitOversize(node.text, chunkSize, chunkOverlap);
			let lineCursor = node.startLine;
			for (const part of parts) {
				const linesInPart = (part.match(/\n/g) || []).length;
				if (part.trim().length >= minChunkSize) {
					result.push({
						content: part.trim(),
						startLine: lineCursor,
						endLine: lineCursor + linesInPart,
					});
				}
				lineCursor += linesInPart;
			}
		} else if (node.text.trim().length >= minChunkSize) {
			result.push({
				content: node.text.trim(),
				startLine: node.startLine,
				endLine: node.endLine,
			});
		}
	}

	// If no AST nodes were captured, fall back so the file is not silently skipped.
	if (result.length === 0) {
		return chunkCodeFallback(sourceCode, options);
	}
	return result;
}

function chunkCodeFallback(
	sourceCode: string,
	options: ChunkerOptions,
): CodeChunk[] {
	const chunks = chunkText(sourceCode, options);
	const result: CodeChunk[] = [];
	let lineCursor = 1;
	for (const chunk of chunks) {
		const linesInChunk = (chunk.match(/\n/g) || []).length;
		result.push({
			content: chunk,
			startLine: lineCursor,
			endLine: lineCursor + linesInChunk,
		});
		lineCursor += linesInChunk;
	}
	return result;
}
