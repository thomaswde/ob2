import OpenAI from "openai";
import {
  getEmbeddingApiKey,
  getEmbeddingBaseUrl,
  getEmbeddingDimensions,
  getEmbeddingModel,
  isEmbeddingEnabled,
} from "../config/env.js";

export class EmbeddingService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = getEmbeddingApiKey();
      if (!apiKey) {
        throw new Error("OB2_EMBEDDING_API_KEY is not set");
      }

      this.client = new OpenAI({
        apiKey,
        baseURL: getEmbeddingBaseUrl(),
      });
    }

    return this.client;
  }

  isEnabled(): boolean {
    return isEmbeddingEnabled();
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const response = await this.getClient().embeddings.create({
      model: getEmbeddingModel(),
      input: text,
      dimensions: getEmbeddingDimensions(),
    });
    return response.data[0]?.embedding ?? null;
  }

  async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (!this.isEnabled() || texts.length === 0) {
      return texts.map(() => null);
    }

    const response = await this.getClient().embeddings.create({
      model: getEmbeddingModel(),
      input: texts,
      dimensions: getEmbeddingDimensions(),
    });
    return response.data.map((item) => item.embedding);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    magA += valueA ** 2;
    magB += valueB ** 2;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
