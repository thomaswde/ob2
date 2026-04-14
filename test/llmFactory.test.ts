import { afterEach, describe, expect, it } from "vitest";
import { createLanguageModel } from "../src/app/llmFactory.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { AnthropicAgentLanguageModel } from "../src/adapters/llm/AnthropicAgentLanguageModel.js";
import { AnthropicApiLanguageModel } from "../src/adapters/llm/AnthropicApiLanguageModel.js";
import { getLlmBackend, getLlmModel } from "../src/config/env.js";

const envKeys = [
  "OB2_LLM_BACKEND",
  "OB2_LLM_MODEL",
  "OB2_USE_STUB_LLM",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
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

  it("fails fast when the API backend is missing an API key", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "anthropic-api";
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => createLanguageModel()).toThrow("OB2_LLM_BACKEND=anthropic-api requires ANTHROPIC_API_KEY");
  });

  it("uses the new model env var before legacy Anthropic model config", () => {
    snapshotEnv();
    process.env.OB2_LLM_MODEL = "claude-sonnet-4-5";
    process.env.ANTHROPIC_MODEL = "claude-legacy";

    expect(getLlmModel("anthropic-api")).toBe("claude-sonnet-4-5");
  });

  it("rejects invalid backend values", () => {
    snapshotEnv();
    process.env.OB2_LLM_BACKEND = "bad-backend";

    expect(() => getLlmBackend()).toThrow("OB2_LLM_BACKEND must be one of");
  });
});
