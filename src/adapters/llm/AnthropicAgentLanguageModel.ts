import {
  query,
  type JsonSchemaOutputFormat,
  type SDKResultError,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  AbstractAnthropicLanguageModel,
  parseJsonResponse,
  type AnthropicInvokeOptions,
} from "./AbstractAnthropicLanguageModel.js";

const DEFAULT_AGENT_TIMEOUT_MS = 45_000;
const DEFAULT_AGENT_MAX_TURNS = 3;

export type AnthropicAgentQuery = typeof query;

type AgentQueryOptions = {
  cwd: string;
  model: string;
  systemPrompt: string;
  maxTurns: number;
  permissionMode: "plan";
  tools: [];
  settingSources: [];
  outputFormat?: JsonSchemaOutputFormat;
  settings: {
    forceLoginMethod: "claudeai";
  };
};

function extractAgentResultError(result: SDKResultError, fallback: string): Error {
  if (result.subtype === "error_max_turns") {
    return new Error(
      "Anthropic agent backend hit the maximum turn limit before producing a final result. Increase the agent turn budget or use the API backend for cheaper, more direct one-shot calls.",
    );
  }

  return new Error(result.errors.join("; ") || fallback);
}

function normalizeAnthropicAgentError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/login|oauth|auth|claudeai/i.test(message)) {
    return new Error(
      "Anthropic agent authentication is unavailable. Sign in to Claude Code with a Claude Pro/Max account for the anthropic-agent backend.",
    );
  }

  return new Error(`Anthropic agent backend failed: ${message}`);
}

export class AnthropicAgentLanguageModel extends AbstractAnthropicLanguageModel {
  constructor(
    private readonly queryFn: AnthropicAgentQuery = query,
    private readonly model: string,
    private readonly cwd = process.cwd(),
    private readonly timeoutMs = DEFAULT_AGENT_TIMEOUT_MS,
    private readonly maxTurns = DEFAULT_AGENT_MAX_TURNS,
  ) {
    super();
  }

  private async runQuery(
    prompt: string,
    systemPrompt: string,
    outputFormat?: JsonSchemaOutputFormat,
  ): Promise<SDKResultMessage> {
    let handle;
    try {
      handle = this.queryFn({
        prompt,
        options: {
          cwd: this.cwd,
          model: this.model,
          maxTurns: this.maxTurns,
          permissionMode: "plan",
          tools: [],
          settingSources: [],
          systemPrompt,
          outputFormat,
          settings: {
            forceLoginMethod: "claudeai",
          },
        } satisfies AgentQueryOptions,
      });
    } catch (error) {
      throw normalizeAnthropicAgentError(error);
    }

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        handle.close();
        reject(new Error("Anthropic agent request timed out."));
      }, this.timeoutMs);
    });

    const resultPromise = (async () => {
      let result: SDKResultMessage | null = null;
      for await (const message of handle) {
        if (message.type === "result") {
          result = message;
        }
      }

      if (!result) {
        throw new Error("Anthropic agent backend returned no result.");
      }

      return result;
    })();

    try {
      return await Promise.race([resultPromise, timeoutPromise]);
    } catch (error) {
      throw normalizeAnthropicAgentError(error);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      handle.close();
    }
  }

  protected async invokeText({ system, user }: AnthropicInvokeOptions): Promise<string> {
    const result = await this.runQuery(user, system);
    if (result.subtype !== "success") {
      throw extractAgentResultError(result, "Anthropic agent request failed.");
    }

    return result.result.trim();
  }

  protected override async invokeJson<T>(options: AnthropicInvokeOptions, context: string): Promise<T> {
    const result = await this.runQuery(options.user, options.system, {
      type: "json_schema",
      schema: {
        type: "object",
        additionalProperties: true,
      },
    });

    if (result.subtype !== "success") {
      throw extractAgentResultError(result, `${context} failed.`);
    }

    if (result.structured_output !== undefined) {
      return result.structured_output as T;
    }

    return parseJsonResponse<T>(result.result, context);
  }
}
