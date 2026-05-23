import OpenAI from "openai";

export class EmbeddingProvider {
  private client: OpenAI;
  private readonly model: string;
  readonly dim: number;

  constructor(apiKey: string, model: string, dim: number) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts.map((t) => t.slice(0, 8000)),
    });
    return response.data.map((d) => d.embedding);
  }
}
