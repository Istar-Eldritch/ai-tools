import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingProvider } from "./embeddings.ts";

// Mock @huggingface/transformers to avoid downloading models in tests.
vi.mock("@huggingface/transformers", () => ({
	pipeline: vi.fn(),
}));

import { pipeline } from "@huggingface/transformers";

class FakeTensor {
	data: number[][];
	constructor(data: number[][]) {
		this.data = data;
	}
	tolist() {
		return this.data;
	}
}

function createMockPipeline(returnData: number[][]) {
	return vi.fn().mockResolvedValue(new FakeTensor(returnData));
}

describe("EmbeddingProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("init() loads the pipeline and marks isReady() === true", async () => {
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(
			createMockPipeline([[1, 0, 0]]),
		);
		const provider = new EmbeddingProvider("test-model", 3);
		await provider.init();
		expect(provider.isReady()).toBe(true);
		expect(pipeline).toHaveBeenCalledWith(
			"feature-extraction",
			"test-model",
			expect.objectContaining({ revision: "main" }),
		);
	});

	it("embed() returns the correct number of vectors matching input length", async () => {
		const mockExec = createMockPipeline([
			[1, 0, 0],
			[0, 1, 0],
		]);
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
		const provider = new EmbeddingProvider("test-model", 3);
		await provider.init();
		const result = await provider.embed(["hello", "world"]);
		expect(result.embeddings.length).toBe(2);
		expect(result.modelName).toBe("test-model");
		expect(result.dim).toBe(3);
	});

	it("each vector has length equal to dim", async () => {
		const mockExec = createMockPipeline([
			[1, 2, 3, 4],
			[5, 6, 7, 8],
		]);
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
		const provider = new EmbeddingProvider("test-model", 4);
		await provider.init();
		const result = await provider.embed(["a", "b"]);
		for (const vec of result.embeddings) {
			expect(vec.length).toBe(4);
		}
	});

	it("vectors are L2-normalized", async () => {
		// Return raw vectors that are NOT normalized.
		const raw = [
			[3, 4, 0], // norm = 5
			[1, 2, 2], // norm = 3
		];
		const mockExec = vi.fn().mockImplementation((_batch, opts) => {
			// Simulate normalization
			if (opts?.normalize) {
				return new FakeTensor(
					raw.map((vec) => {
						const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
						return vec.map((x) => x / norm);
					}),
				);
			}
			return new FakeTensor(raw);
		});
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
		const provider = new EmbeddingProvider("test-model", 3);
		await provider.init();
		const result = await provider.embed(["a", "b"]);
		for (const vec of result.embeddings) {
			const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
			expect(norm).toBeCloseTo(1, 5);
		}
	});

	it("batching splits work correctly when input exceeds batchSize", async () => {
		const mockExec = vi.fn().mockImplementation((batch) => {
			const vecs = Array.from({ length: batch.length }, () => [1, 0, 0]);
			return new FakeTensor(vecs);
		});
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
		const provider = new EmbeddingProvider("test-model", 3);
		await provider.init();
		const result = await provider.embed(["1", "2", "3", "4", "5"], 2);
		expect(result.embeddings.length).toBe(5);
		expect(mockExec).toHaveBeenCalledTimes(3); // 2 + 2 + 1
	});

	it("empty input array returns empty embeddings array", async () => {
		const mockExec = createMockPipeline([]);
		(pipeline as ReturnType<typeof vi.fn>).mockResolvedValue(mockExec);
		const provider = new EmbeddingProvider("test-model", 3);
		await provider.init();
		const result = await provider.embed([]);
		expect(result.embeddings).toEqual([]);
		expect(result.dim).toBe(3);
		expect(mockExec).not.toHaveBeenCalled();
	});
});
