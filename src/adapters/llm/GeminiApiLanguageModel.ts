import { ApiError } from "@google/genai";
import { AbstractJsonLanguageModel, parseJsonResponse, type LlmInvokeOptions } from "./AbstractJsonLanguageModel.js";

const DEFAULT_TIMEOUT_MS = 30_000;

type GeminiApiResponse = {
  text?: string;
};

type GeminiGenerationConfig = {
  abortSignal?: AbortSignal;
  systemInstruction: string;
  maxOutputTokens: number;
  responseMimeType?: string;
  responseJsonSchema?: unknown;
  thinkingConfig?: {
    thinkingBudget?: number;
  };
};

export type GeminiApiClient = {
  models: {
    generateContent: (body: {
      model: string;
      contents: string;
      config: GeminiGenerationConfig;
    }) => Promise<GeminiApiResponse>;
  };
};

function getGeminiResponseSchema(operation: string): unknown | undefined {
  switch (operation) {
    case "classify":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          needsMemory: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["needsMemory", "reason"],
      };
    case "extract":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          slugs: {
            type: "array",
            items: { type: "string" },
          },
          confidence: {
            type: "string",
            enum: ["high", "low"],
          },
        },
        required: ["slugs", "confidence"],
      };
    case "classifyConsolidation":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          entitySlug: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          confidence: { type: "string", enum: ["high", "low"] },
          reason: { type: "string" },
          links: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                entitySlug: { type: "string" },
                relation: { type: "string", enum: ["member_of", "related_to"] },
                confidence: { type: "string", enum: ["high", "low"] },
                reason: { type: "string" },
              },
              required: ["entitySlug", "relation", "confidence", "reason"],
            },
          },
        },
        required: ["entitySlug", "confidence", "reason", "links"],
      };
    case "decideConsolidation":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          supersedesAtomId: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          contradictionAtomIds: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: "string", enum: ["high", "low"] },
          reason: { type: "string" },
        },
        required: ["supersedesAtomId", "contradictionAtomIds", "confidence", "reason"],
      };
    case "synthesizeEntitySummary":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          claims: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: { type: "string" },
                sourceAtomIds: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["text", "sourceAtomIds"],
            },
          },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: ["summary", "claims", "confidence"],
      };
    case "synthesizeLifeState":
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          narrative: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: ["narrative", "confidence"],
      };
    default:
      return undefined;
  }
}

function normalizeGeminiApiError(error: unknown): Error {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return new Error(
        "Gemini API authentication failed. Check your Google Cloud application-default credentials and Vertex AI access.",
      );
    }

    if (error.status === 429) {
      return new Error("Gemini API rate limit exceeded. Retry later or lower request volume.");
    }

    return new Error(`Gemini API request failed: ${error.status ?? "unknown"} ${error.message}`);
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("Gemini API request timed out.");
    }

    return error;
  }

  return new Error(`Gemini API request failed: ${String(error)}`);
}

export class GeminiApiLanguageModel extends AbstractJsonLanguageModel {
  protected override providerLabel = "Gemini";

  constructor(
    private readonly client: GeminiApiClient,
    private readonly model: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly thinkingBudget: number | null = null,
  ) {
    super();
  }

  protected async invokeText({ system, user, maxTokens = 400 }: LlmInvokeOptions): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          abortSignal: controller.signal,
          systemInstruction: system,
          maxOutputTokens: maxTokens,
          responseMimeType: "text/plain",
          thinkingConfig: this.thinkingBudget === null ? undefined : { thinkingBudget: this.thinkingBudget },
        },
      });

      return response.text?.trim() ?? "";
    } catch (error) {
      throw normalizeGeminiApiError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  protected override async invokeJson<T>(options: LlmInvokeOptions, operation: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: `${options.user}\n\nRespond with JSON only.`,
        config: {
          abortSignal: controller.signal,
          systemInstruction: options.system,
          maxOutputTokens: Math.max(options.maxTokens ?? 400, 1024),
          responseMimeType: "application/json",
          responseJsonSchema: getGeminiResponseSchema(operation),
          thinkingConfig: this.thinkingBudget === null ? { thinkingBudget: 0 } : { thinkingBudget: this.thinkingBudget },
        },
      });

      return parseJsonResponse<T>(response.text ?? "", `${this.providerLabel} ${operation}`);
    } catch (error) {
      throw normalizeGeminiApiError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
