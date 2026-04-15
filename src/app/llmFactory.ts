import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { AnthropicAgentLanguageModel } from "../adapters/llm/AnthropicAgentLanguageModel.js";
import { AnthropicApiLanguageModel } from "../adapters/llm/AnthropicApiLanguageModel.js";
import { GeminiApiLanguageModel } from "../adapters/llm/GeminiApiLanguageModel.js";
import { StubLanguageModel } from "../adapters/llm/StubLanguageModel.js";
import type { LanguageModel } from "../domain/languageModel.js";
import {
  getAnthropicApiKey,
  getGeminiApiKey,
  getGeminiLocation,
  getGeminiProject,
  getGeminiThinkingBudget,
  getLlmBackend,
  getLlmModel,
} from "../config/env.js";

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

  if (backend === "gemini-api") {
    const apiKey = getGeminiApiKey();
    const project = getGeminiProject();

    if (!apiKey && !project) {
      throw new Error(
        "OB2_LLM_BACKEND=gemini-api requires either a Gemini API key (OB2_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY) or a Vertex project (OB2_GEMINI_PROJECT or GOOGLE_CLOUD_PROJECT).",
      );
    }

    const client = apiKey
      ? new GoogleGenAI({
          apiKey,
          apiVersion: "v1alpha",
        })
      : new GoogleGenAI({
          vertexai: true,
          project: project!,
          location: getGeminiLocation(),
          apiVersion: "v1",
        });
    return new GeminiApiLanguageModel(client, model, undefined, getGeminiThinkingBudget());
  }

  throw new Error(`Unsupported LLM backend: ${backend}`);
}
