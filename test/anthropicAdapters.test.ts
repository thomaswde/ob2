import { AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicAgentLanguageModel } from "../src/adapters/llm/AnthropicAgentLanguageModel.js";
import { AnthropicApiLanguageModel } from "../src/adapters/llm/AnthropicApiLanguageModel.js";

function makeAgentResult(result: {
  subtype?: "success" | "error_during_execution";
  text?: string;
  structuredOutput?: unknown;
  errors?: string[];
}) {
  return {
    type: "result" as const,
    subtype: result.subtype ?? "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: result.subtype === "error_during_execution",
    num_turns: 1,
    result: result.text ?? "",
    stop_reason: "completed",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    structured_output: result.structuredOutput,
    errors: result.errors ?? [],
    uuid: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
  };
}

function makeAgentHandle(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    },
    close: vi.fn(),
  };
}

describe("AnthropicApiLanguageModel", () => {
  it("parses structured JSON responses", async () => {
    const model = new AnthropicApiLanguageModel(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: '{"needsMemory":true,"reason":"Project context matters."}' }],
          }),
        },
      },
      "claude-test",
    );

    await expect(model.classify("Query: what is the current roadmap?", { type: "classification" })).resolves.toEqual({
      needsMemory: true,
      reason: "Project context matters.",
    });
  });

  it("normalizes Anthropic authentication and rate-limit errors", async () => {
    const authModel = new AnthropicApiLanguageModel(
      {
        messages: {
          create: vi.fn().mockRejectedValue(new AuthenticationError(401, {}, "invalid key", new Headers())),
        },
      },
      "claude-test",
    );

    const rateLimitModel = new AnthropicApiLanguageModel(
      {
        messages: {
          create: vi.fn().mockRejectedValue(new RateLimitError(429, {}, "slow down", new Headers())),
        },
      },
      "claude-test",
    );

    await expect(authModel.summarize("hello")).rejects.toThrow("Anthropic API authentication failed");
    await expect(rateLimitModel.summarize("hello")).rejects.toThrow("Anthropic API rate limit exceeded");
  });

  it("rejects malformed JSON responses", async () => {
    const model = new AnthropicApiLanguageModel(
      {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "definitely not json" }],
          }),
        },
      },
      "claude-test",
    );

    await expect(model.classify("Query: roadmap", { type: "classification" })).rejects.toThrow(
      "Anthropic classify returned malformed JSON",
    );
  });
});

describe("AnthropicAgentLanguageModel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses structured output and disables tools for one-shot prompts", async () => {
    const queryFn = vi.fn().mockImplementation(({ prompt, options }) => {
      expect(prompt).toBe("Query: what changed?");
      expect(options.model).toBe("claude-agent-test");
      expect(options.permissionMode).toBe("plan");
      expect(options.tools).toEqual([]);
      expect(options.settingSources).toEqual([]);
      expect(options.settings.forceLoginMethod).toBe("claudeai");
      expect(options.outputFormat).toBeDefined();

      return makeAgentHandle([
        makeAgentResult({
          structuredOutput: {
            needsMemory: true,
            reason: "Memory is required.",
          },
        }),
      ]);
    });

    const model = new AnthropicAgentLanguageModel(queryFn as never, "claude-agent-test", process.cwd(), 500);

    await expect(model.classify("Query: what changed?", { type: "classification" })).resolves.toEqual({
      needsMemory: true,
      reason: "Memory is required.",
    });
  });

  it("falls back to parsing the text result when structured output is absent", async () => {
    const queryFn = vi.fn().mockReturnValue(
      makeAgentHandle([
        makeAgentResult({
          text: '{"narrative":"Morgan is focused on work and family.","confidence":"high"}',
        }),
      ]),
    );

    const model = new AnthropicAgentLanguageModel(queryFn as never, "claude-agent-test", process.cwd(), 500);

    await expect(
      model.synthesizeLifeState({
        atomsByCategory: [],
      }),
    ).resolves.toEqual({
      narrative: "Morgan is focused on work and family.",
      confidence: "high",
    });
  });

  it("surfaces a clear login error when Claude subscription auth is unavailable", async () => {
    const queryFn = vi.fn().mockImplementation(() => {
      throw new Error("Please login via claudeai OAuth before continuing.");
    });

    const model = new AnthropicAgentLanguageModel(queryFn as never, "claude-agent-test");

    await expect(model.summarize("hello")).rejects.toThrow("Anthropic agent authentication is unavailable");
  });
});
