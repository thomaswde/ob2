import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { GeminiApiLanguageModel } from "../src/adapters/llm/GeminiApiLanguageModel.js";

describe("GeminiApiLanguageModel", () => {
  it("parses structured JSON responses", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"needsMemory":true,"reason":"Project context matters."}',
    });

    const model = new GeminiApiLanguageModel(
      {
        models: {
          generateContent,
        },
      },
      "gemini-test",
    );

    await expect(model.classify("Query: what is the current roadmap?", { type: "classification" })).resolves.toEqual({
      needsMemory: true,
      reason: "Project context matters.",
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseJsonSchema: expect.objectContaining({
            type: "object",
            required: expect.arrayContaining(["needsMemory", "reason"]),
          }),
          thinkingConfig: {
            thinkingBudget: 0,
          },
        }),
      }),
    );
  });

  it("passes through an explicit Gemini thinking budget", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"needsMemory":true,"reason":"Project context matters."}',
    });

    const model = new GeminiApiLanguageModel(
      {
        models: {
          generateContent,
        },
      },
      "gemini-test",
      undefined,
      512,
    );

    await model.classify("Query: what is the current roadmap?", { type: "classification" });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: {
            thinkingBudget: 512,
          },
        }),
      }),
    );
  });

  it("normalizes Gemini authentication and rate-limit errors", async () => {
    const authModel = new GeminiApiLanguageModel(
      {
        models: {
          generateContent: vi
            .fn()
            .mockRejectedValue(new ApiError({ message: "forbidden", status: 403 })),
        },
      },
      "gemini-test",
    );

    const rateLimitModel = new GeminiApiLanguageModel(
      {
        models: {
          generateContent: vi
            .fn()
            .mockRejectedValue(new ApiError({ message: "slow down", status: 429 })),
        },
      },
      "gemini-test",
    );

    await expect(authModel.summarize("hello")).rejects.toThrow("Gemini API authentication failed");
    await expect(rateLimitModel.summarize("hello")).rejects.toThrow("Gemini API rate limit exceeded");
  });

  it("rejects malformed JSON responses", async () => {
    const model = new GeminiApiLanguageModel(
      {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: "definitely not json",
          }),
        },
      },
      "gemini-test",
    );

    await expect(model.classify("Query: roadmap", { type: "classification" })).rejects.toThrow(
      "Gemini classify returned malformed JSON",
    );
  });
});
