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

export interface AnthropicInvokeOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

export function extractJsonText(value: string): string {
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

export function parseJsonResponse<T>(value: string, context: string): T {
  try {
    return JSON.parse(extractJsonText(value)) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${context} returned malformed JSON: ${detail}`);
  }
}

export abstract class AbstractAnthropicLanguageModel implements LanguageModel {
  protected abstract invokeText(options: AnthropicInvokeOptions): Promise<string>;

  protected async invokeJson<T>(options: AnthropicInvokeOptions, context: string): Promise<T> {
    const text = await this.invokeText({
      ...options,
      user: `${options.user}\n\nRespond with JSON only.`,
    });
    return parseJsonResponse<T>(text, context);
  }

  async classify(prompt: string, _schema: QuerySchema): Promise<QueryClassifierDecision> {
    return this.invokeJson<QueryClassifierDecision>(
      {
        system:
          'Decide whether a user query needs personal/project memory. Return JSON: {"needsMemory": boolean, "reason": string}.',
        user: prompt,
      },
      "Anthropic classify",
    );
  }

  async summarize(prompt: string): Promise<string> {
    return this.invokeText({
      system: "Summarize the provided material in a short plain-text response with no markdown.",
      user: prompt,
    });
  }

  async extract(prompt: string, _schema: ExtractSchema): Promise<EntitySelectionResult> {
    return this.invokeJson<EntitySelectionResult>(
      {
        system: `You are a memory oracle for a personal AI assistant. Given a user query and their current life state, identify which entities in the index are relevant, including non-obvious lateral connections the user did not explicitly mention.

Think in two passes:
1. Direct: entities the query obviously concerns.
2. Lateral: entities that are relevant given the user's current situation, goals, or constraints, even if unmentioned.

Return JSON: {"slugs": string[], "confidence": "high"|"low"}.
confidence is "low" if the query is ambiguous or the index lacks sufficient context.`,
        user: prompt,
      },
      "Anthropic extract",
    );
  }

  async classifyConsolidation(
    input: ConsolidationClassificationInput,
  ): Promise<ConsolidationClassificationResult> {
    return this.invokeJson<ConsolidationClassificationResult>(
      {
        system:
          "You are classifying a new memory atom for consolidation. Return JSON with keys: entitySlug (string|null), confidence ('high'|'low'), reason (string), links (array of {entitySlug, relation:'member_of'|'related_to', confidence:'high'|'low', reason}). Choose the best entity from the provided candidates and include a concise explanation.",
        user: JSON.stringify(input, null, 2),
      },
      "Anthropic classifyConsolidation",
    );
  }

  async decideConsolidation(input: ConsolidationDecisionInput): Promise<ConsolidationDecisionResult> {
    return this.invokeJson<ConsolidationDecisionResult>(
      {
        system:
          "You are deciding whether a new atom contradicts or supersedes existing atoms in the same entity cluster. Return JSON with keys: supersedesAtomId (string|null), contradictionAtomIds (string[]), confidence ('high'|'low'), reason (string). Only mark supersession when the new atom clearly replaces an older one; only mark contradiction when the atoms cannot both be true.",
        user: JSON.stringify(input, null, 2),
      },
      "Anthropic decideConsolidation",
    );
  }

  async synthesizeEntitySummary(
    input: EntitySummarySynthesisInput,
  ): Promise<EntitySummarySynthesisResult> {
    return this.invokeJson<EntitySummarySynthesisResult>(
      {
        system:
          "You are synthesizing an entity summary from source atoms. Return JSON with keys: summary (string), claims (array of {text, sourceAtomIds}), confidence ('high'|'low'). The summary must include inline citations in the form [source: atom_id] for every factual claim. Preserve only claims supported by the provided atoms.",
        user: JSON.stringify(input, null, 2),
        maxTokens: 800,
      },
      "Anthropic synthesizeEntitySummary",
    );
  }

  async synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
    return this.invokeJson<LifeStateSynthesisResult>(
      {
        system:
          'You are synthesizing a compressed life-state narrative for a personal AI memory system. Given atoms from multiple life domains, produce a short prose paragraph under 150 words describing the user\'s current situation: active goals, recent changes, standing constraints, and ongoing projects. Write from facts only with no speculation. Integrate cross-domain connections where they exist. Return JSON: {"narrative": string, "confidence": "high"|"low"}.',
        user: JSON.stringify(input, null, 2),
        maxTokens: 600,
      },
      "Anthropic synthesizeLifeState",
    );
  }
}
