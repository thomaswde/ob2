import { afterEach, describe, expect, it } from "vitest";
import { createLanguageModel } from "../src/app/llmFactory.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { AnthropicAgentLanguageModel } from "../src/adapters/llm/AnthropicAgentLanguageModel.js";
import { AnthropicApiLanguageModel } from "../src/adapters/llm/AnthropicApiLanguageModel.js";
import { GeminiApiLanguageModel } from "../src/adapters/llm/GeminiApiLanguageModel.js";
import {
  getGeminiApiKey,
  getGeminiLocation,
  getGeminiProject,
  getGeminiThinkingBudget,
  getLlmBackend,
  getLlmModel,
} from "../src/config/env.js";

const envKeys = [
  "OB2_LLM_BACKEND",
  "OB2_LLM_MODEL",
  "OB2_USE_STUB_LLM",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OB2_GEMINI_API_KEY",
  "OB2_GEMINI_PROJECT",
  "OB2_GEMINI_LOCATION",
  "OB2_GEMINI_THINKING_BUDGET",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GEMINI_MODEL",
  "NODE_ENV",
  "VITEST",
] as const;

const originalEnv = new Map<string, string | undefined>();

function snapshotEnv(): void {
  originalEnv.clear();
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key]);
  }
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("LLM backend selection", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("prefers the explicit stub backend", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "stub";

    expect(getLlmBackend()).toBe("stub");
    expect(createLanguageModel()).toBeInstanceOf(StubLanguageModel);
  });

  it("supports the deprecated stub env flag", () => {
    snapshotEnv();
    delete process.env.OB2_LLM_BACKEND;
    process.env.OB2_USE_STUB_LLM = "1";

    expect(getLlmBackend()).toBe("stub");
    expect(createLanguageModel()).toBeInstanceOf(StubLanguageModel);
  });

  it("infers the Anthropic API backend from an API key for compatibility", () => {
    snapshotEnv();
    delete process.env.OB2_LLM_BACKEND;
    delete process.env.OB2_USE_STUB_LLM;
    process.env.ANTHROPIC_API_KEY = "test-key";

    expect(getLlmBackend()).toBe("anthropic-api");
    expect(createLanguageModel()).toBeInstanceOf(AnthropicApiLanguageModel);
  });

  it("creates the Anthropic agent backend when explicitly requested", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "anthropic-agent";

    expect(createLanguageModel()).toBeInstanceOf(AnthropicAgentLanguageModel);
  });

  it("infers the Gemini backend from a configured project", () => {
    snapshotEnv();
    delete process.env.OB2_LLM_BACKEND;
    delete process.env.OB2_USE_STUB_LLM;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OB2_GEMINI_PROJECT = "projects/1094394278776";

    expect(getLlmBackend()).toBe("gemini-api");
    expect(getGeminiProject()).toBe("1094394278776");
    expect(getGeminiLocation()).toBe("global");
    expect(createLanguageModel()).toBeInstanceOf(GeminiApiLanguageModel);
  });

  it("infers the Gemini backend from an API key", () => {
    snapshotEnv();
    delete process.env.OB2_LLM_BACKEND;
    delete process.env.OB2_USE_STUB_LLM;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OB2_GEMINI_PROJECT;
    process.env.GEMINI_API_KEY = "gemini-test-key";

    expect(getLlmBackend()).toBe("gemini-api");
    expect(getGeminiApiKey()).toBe("gemini-test-key");
    expect(createLanguageModel()).toBeInstanceOf(GeminiApiLanguageModel);
  });

  it("fails fast when the API backend is missing an API key", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "anthropic-api";
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => createLanguageModel()).toThrow("OB2_LLM_BACKEND=anthropic-api requires ANTHROPIC_API_KEY");
  });

  it("fails fast when the Gemini backend is missing both key and project", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "gemini-api";
    delete process.env.OB2_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OB2_GEMINI_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    expect(() => createLanguageModel()).toThrow("OB2_LLM_BACKEND=gemini-api requires either a Gemini API key");
  });

  it("uses the new model env var before legacy Anthropic model config", () => {
    snapshotEnv();
    process.env.OB2_LLM_MODEL = "claude-sonnet-4-5";
    process.env.ANTHROPIC_MODEL = "claude-legacy";

    expect(getLlmModel("anthropic-api")).toBe("claude-sonnet-4-5");
  });

  it("normalizes project resources and embedded locations for Gemini", () => {
    snapshotEnv();
    process.env.OB2_GEMINI_PROJECT = "projects/1094394278776/locations/us-central1";
    process.env.GEMINI_MODEL = "gemini-2.5-pro";

    expect(getGeminiProject()).toBe("1094394278776");
    expect(getGeminiLocation()).toBe("us-central1");
    expect(getLlmModel("gemini-api")).toBe("gemini-2.5-pro");
  });

  it("parses an explicit Gemini thinking budget", () => {
    snapshotEnv();
    process.env.OB2_GEMINI_THINKING_BUDGET = "512";

    expect(getGeminiThinkingBudget()).toBe(512);
  });

  it("rejects invalid backend values", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "bad-backend";

    expect(() => getLlmBackend()).toThrow("OB2_LLM_BACKEND must be one of");
  });
});
