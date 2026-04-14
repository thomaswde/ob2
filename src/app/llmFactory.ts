import Anthropic from "@anthropic-ai/sdk";
import { AnthropicAgentLanguageModel } from "../adapters/llm/AnthropicAgentLanguageModel.js";
import { AnthropicApiLanguageModel } from "../adapters/llm/AnthropicApiLanguageModel.js";
import { StubLanguageModel } from "../adapters/llm/StubLanguageModel.js";
import type { LanguageModel } from "../domain/languageModel.js";
import { getAnthropicApiKey, getLlmBackend, getLlmModel } from "../config/env.js";

const DEFAULT_API_TIMEOUT_MS = 30_000;
const DEFAULT_API_RETRIES = 2;

export function createLanguageModel(): LanguageModel {
  const backend = getLlmBackend();
  const model = getLlmModel(backend);

  if (backend === "stub") {
    return new StubLanguageModel();
  }

  if (backend === "anthropic-api") {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      throw new Error(
        "OB2_LLM_BACKEND=anthropic-api requires ANTHROPIC_API_KEY. Set it or switch to a different backend.",
      );
    }

    const client = new Anthropic({
      apiKey,
      maxRetries: DEFAULT_API_RETRIES,
      timeout: DEFAULT_API_TIMEOUT_MS,
    });
    return new AnthropicApiLanguageModel(client, model);
  }

  if (backend === "anthropic-agent") {
    return new AnthropicAgentLanguageModel(undefined, model);
  }

  throw new Error(`Unsupported LLM backend: ${backend}`);
}
