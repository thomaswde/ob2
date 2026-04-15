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

export interface LlmInvokeOptions {
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

export abstract class AbstractJsonLanguageModel implements LanguageModel {
  protected abstract providerLabel: string;

  protected abstract invokeText(options: LlmInvokeOptions): Promise<string>;

  protected async invokeJson<T>(options: LlmInvokeOptions, operation: string): Promise<T> {
    const text = await this.invokeText({
      ...options,
      user: `${options.user}\n\nRespond with JSON only.`,
    });
    return parseJsonResponse<T>(text, `${this.providerLabel} ${operation}`);
  }

  async classify(prompt: string, _schema: QuerySchema): Promise<QueryClassifierDecision> {
    return this.invokeJson<QueryClassifierDecision>(
      {
        system:
          'Decide whether a user query needs personal/project memory. Return JSON: {"needsMemory": boolean, "reason": string}.',
        user: prompt,
      },
      "classify",
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
slugs must be the exact entity slug strings from the index links, such as "northstar-api" or "bluebird". Do not return category paths, file paths, or markdown links.
confidence is "low" if the query is ambiguous or the index lacks sufficient context.`,
        user: prompt,
      },
      "extract",
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
      "classifyConsolidation",
    );
  }

  async decideConsolidation(input: ConsolidationDecisionInput): Promise<ConsolidationDecisionResult> {
    return this.invokeJson<ConsolidationDecisionResult>(
      {
        system:
          "You are deciding whether a new atom contradicts or supersedes existing atoms in the same entity cluster. Return JSON with keys: supersedesAtomId (string|null), contradictionAtomIds (string[]), confidence ('high'|'low'), reason (string). Only mark supersession when the new atom clearly replaces an older one; only mark contradiction when the atoms cannot both be true.",
        user: JSON.stringify(input, null, 2),
      },
      "decideConsolidation",
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
      "synthesizeEntitySummary",
    );
  }

  async synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
    return this.invokeJson<LifeStateSynthesisResult>(
      {
        system:
          'You are synthesizing a compressed life-state summary for a personal AI memory system. This summary is loaded into context on EVERY query, so it must stay small and contain only information that changes how the AI should behave right now.\n\nInclude ONLY:\n- Active projects and tasks (what the user is currently working on or must accomplish soon)\n- Standing hard constraints (health restrictions, fixed commitments, financial rules the user has stated)\n- Recent significant life changes (new job, moved house, injury, major decision made in the last few weeks)\n- Current goals the user is actively pursuing\n\nDo NOT include:\n- Stable biographical facts (age, location, occupation) — these belong in entity summaries\n- Style preferences and personality traits (prefers aisle seats, likes TypeScript) — these belong in entity summaries\n- Historical facts that are not currently actionable\n- Anything that would be the same answer next month as today\n\nOutput must fit in 200 words or fewer. Be terse. Use bullet points grouped by domain. Return JSON: {"narrative": string, "confidence": "high"|"low"}.',
        user: JSON.stringify(input, null, 2),
        maxTokens: 600,
      },
      "synthesizeLifeState",
    );
  }
}
