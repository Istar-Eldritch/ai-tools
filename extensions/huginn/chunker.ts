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
