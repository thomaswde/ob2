import type { EntitySelectionResult, LanguageModel } from "../../domain/languageModel.js";
import type { ExtractSchema, QueryClassifierDecision, QuerySchema } from "../../domain/types.js";

interface ClaudeMessageResponse {
  content: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: string;
      }
  >;
}

function extractText(response: ClaudeMessageResponse): string {
  return response.content
    .filter((item): item is { type: "text"; text: string } => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export class ClaudeSonnetLanguageModel implements LanguageModel {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com/v1/messages",
  ) {}

  private async invoke(system: string, user: string): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Anthropic request failed: ${response.status} ${message}`);
    }

    return extractText((await response.json()) as ClaudeMessageResponse);
  }

  private async invokeJson<T>(system: string, user: string): Promise<T> {
    const text = await this.invoke(system, `${user}\n\nRespond with JSON only.`);
    return JSON.parse(text) as T;
  }

  async classify(prompt: string, _schema: QuerySchema): Promise<QueryClassifierDecision> {
    return this.invokeJson<QueryClassifierDecision>(
      "Decide whether a user query needs personal/project memory. Return JSON: {\"needsMemory\": boolean, \"reason\": string}.",
      prompt,
    );
  }

  async summarize(prompt: string): Promise<string> {
    return this.invoke(
      "Summarize the provided material in a short plain-text response with no markdown.",
      prompt,
    );
  }

  async extract(prompt: string, _schema: ExtractSchema): Promise<EntitySelectionResult> {
    return this.invokeJson<EntitySelectionResult>(
      "Select relevant entity slugs from the provided markdown index. Return JSON: {\"slugs\": string[], \"confidence\": \"high\"|\"low\"}.",
      prompt,
    );
  }
}
