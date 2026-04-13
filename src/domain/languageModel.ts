import type { ExtractSchema, QueryClassifierDecision, QuerySchema } from "./types.js";

export interface EntitySelectionResult {
  slugs: string[];
  confidence: "high" | "low";
}

export interface LanguageModel {
  classify(prompt: string, schema: QuerySchema): Promise<QueryClassifierDecision>;
  summarize(prompt: string): Promise<string>;
  extract(prompt: string, schema: ExtractSchema): Promise<EntitySelectionResult>;
}
