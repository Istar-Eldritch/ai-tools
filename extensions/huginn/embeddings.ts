import {
	pipeline,
	type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import type { EmbeddingResult } from "./types.ts";

export class EmbeddingProvider {
	private embedder: FeatureExtractionPipeline | null = null;
	readonly modelName: string;
	readonly dim: number;

	constructor(modelName: string, dim: number) {
		this.modelName = modelName;
		this.dim = dim;
	}

	async init(signal?: AbortSignal): Promise<void> {
		if (this.embedder) return;
		this.embedder = (await pipeline("feature-extraction", this.modelName, {
			revision: "main",
		})) as unknown as FeatureExtractionPipeline;
		if (signal?.aborted) {
			throw new Error("Embedding initialization aborted");
		}
	}

	async embed(
		texts: string[],
		batchSize = 32,
		signal?: AbortSignal,
	): Promise<EmbeddingResult> {
		if (!this.embedder) {
			throw new Error("EmbeddingProvider not initialized. Call init() first.");
		}
		if (texts.length === 0) {
			return { embeddings: [], modelName: this.modelName, dim: this.dim };
		}

		const allEmbeddings: number[][] = [];
		for (let i = 0; i < texts.length; i += batchSize) {
			if (signal?.aborted) {
				throw new Error("Embedding batch aborted");
			}
			const batch = texts.slice(i, i + batchSize);
			const outputs = await this.embedder(batch, {
				pooling: "mean",
				normalize: true,
			});
			const tensorData = outputs.tolist ? outputs.tolist() : outputs;
			for (const vec of tensorData as number[][]) {
				allEmbeddings.push(vec);
			}
		}

		return {
			embeddings: allEmbeddings,
			modelName: this.modelName,
			dim: this.dim,
		};
	}

	isReady(): boolean {
		return this.embedder !== null;
	}
}
