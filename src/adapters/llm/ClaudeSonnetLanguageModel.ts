import type {
  ConsolidationClassificationInput,
  ConsolidationClassificationResult,
  ConsolidationDecisionInput,
  ConsolidationDecisionResult,
  EntitySelectionResult,
  EntitySummarySynthesisInput,
  EntitySummarySynthesisResult,
  LifeStateSynthesisInput,
  LifeStateSynthesisResult,
  LanguageModel,
} from "../../domain/languageModel.js";
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

function extractJsonText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export class ClaudeSonnetLanguageModel implements LanguageModel {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.anthropic.com/v1/messages",
  ) {}

  private async invoke(system: string, user: string, maxTokens = 400): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
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

  private async invokeJson<T>(system: string, user: string, maxTokens = 400): Promise<T> {
    const text = await this.invoke(system, `${user}\n\nRespond with JSON only.`, maxTokens);
    return JSON.parse(extractJsonText(text)) as T;
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
      `You are a memory oracle for a personal AI assistant. Given a user query and their current life state, identify which entities in the index are relevant, including non-obvious lateral connections the user did not explicitly mention.

Think in two passes:
1. Direct: entities the query obviously concerns.
2. Lateral: entities that are relevant given the user's current situation, goals, or constraints, even if unmentioned.

Return JSON: {"slugs": string[], "confidence": "high"|"low"}.
confidence is "low" if the query is ambiguous or the index lacks sufficient context.`,
      prompt,
    );
  }

  async classifyConsolidation(
    input: ConsolidationClassificationInput,
  ): Promise<ConsolidationClassificationResult> {
    return this.invokeJson<ConsolidationClassificationResult>(
      "You are classifying a new memory atom for consolidation. Return JSON with keys: entitySlug (string|null), confidence ('high'|'low'), reason (string), links (array of {entitySlug, relation:'member_of'|'related_to', confidence:'high'|'low', reason}). Choose the best entity from the provided candidates and include a concise explanation.",
      JSON.stringify(input, null, 2),
    );
  }

  async decideConsolidation(input: ConsolidationDecisionInput): Promise<ConsolidationDecisionResult> {
    return this.invokeJson<ConsolidationDecisionResult>(
      "You are deciding whether a new atom contradicts or supersedes existing atoms in the same entity cluster. Return JSON with keys: supersedesAtomId (string|null), contradictionAtomIds (string[]), confidence ('high'|'low'), reason (string). Only mark supersession when the new atom clearly replaces an older one; only mark contradiction when the atoms cannot both be true.",
      JSON.stringify(input, null, 2),
    );
  }

  async synthesizeEntitySummary(
    input: EntitySummarySynthesisInput,
  ): Promise<EntitySummarySynthesisResult> {
    return this.invokeJson<EntitySummarySynthesisResult>(
      "You are synthesizing an entity summary from source atoms. Return JSON with keys: summary (string), claims (array of {text, sourceAtomIds}), confidence ('high'|'low'). The summary must include inline citations in the form [source: atom_id] for every factual claim. Preserve only claims supported by the provided atoms.",
      JSON.stringify(input, null, 2),
      800,
    );
  }

  async synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
    return this.invokeJson<LifeStateSynthesisResult>(
      "You are synthesizing a compressed life-state narrative for a personal AI memory system. Given atoms from multiple life domains, produce a short prose paragraph under 150 words describing the user's current situation: active goals, recent changes, standing constraints, and ongoing projects. Write from facts only with no speculation. Integrate cross-domain connections where they exist. Return JSON: {\"narrative\": string, \"confidence\": \"high\"|\"low\"}.",
      JSON.stringify(input, null, 2),
      600,
    );
  }
}
