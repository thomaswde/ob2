import { ClaudeSonnetLanguageModel } from "../adapters/llm/ClaudeSonnetLanguageModel.js";
import { StubLanguageModel } from "../adapters/llm/StubLanguageModel.js";
import type { LanguageModel } from "../domain/languageModel.js";
import { getAnthropicApiKey, getAnthropicModel, shouldUseStubLlm } from "../config/env.js";

export function createLanguageModel(): LanguageModel {
  if (shouldUseStubLlm()) {
    return new StubLanguageModel();
  }

  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("Phase 2 query requires ANTHROPIC_API_KEY. Set it or use the test-only stub override.");
  }

  return new ClaudeSonnetLanguageModel(apiKey, getAnthropicModel());
}
