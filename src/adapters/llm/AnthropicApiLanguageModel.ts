import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { AbstractAnthropicLanguageModel, type AnthropicInvokeOptions } from "./AbstractAnthropicLanguageModel.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const CACHEABLE_SYSTEM_PROMPT_CHARS = 256;

type AnthropicApiResponse = {
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: string;
      }
  >;
};

export type AnthropicApiClient = {
  messages: {
    create: (body: {
      model: string;
      max_tokens: number;
      system?: string | TextBlockParam[];
      messages: Array<{
        role: "user";
        content: string | TextBlockParam[];
      }>;
    }) => Promise<AnthropicApiResponse>;
  };
};

function buildSystem(system: string): string | TextBlockParam[] {
  if (system.trim().length < CACHEABLE_SYSTEM_PROMPT_CHARS) {
    return system;
  }

  return [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral", ttl: "5m" },
    },
  ];
}

function extractText(response: AnthropicApiResponse): string {
  return response.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function normalizeAnthropicApiError(error: unknown): Error {
  if (error instanceof AuthenticationError) {
    return new Error("Anthropic API authentication failed. Check ANTHROPIC_API_KEY for the anthropic-api backend.");
  }

  if (error instanceof RateLimitError) {
    return new Error("Anthropic API rate limit exceeded. Retry later or lower request volume.");
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new Error("Anthropic API request timed out.");
  }

  if (error instanceof APIConnectionError) {
    return new Error("Anthropic API connection failed.");
  }

  if (error instanceof APIError) {
    return new Error(`Anthropic API request failed: ${error.status ?? "unknown"} ${error.message}`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(`Anthropic API request failed: ${String(error)}`);
}

export class AnthropicApiLanguageModel extends AbstractAnthropicLanguageModel {
  constructor(
    private readonly client: AnthropicApiClient,
    private readonly model: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    super();
  }

  protected async invokeText({ system, user, maxTokens = 400 }: AnthropicInvokeOptions): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: buildSystem(system),
        messages: [
          {
            role: "user",
            content: user,
          },
        ],
      });

      return extractText(response);
    } catch (error) {
      throw normalizeAnthropicApiError(error);
    }
  }
}
