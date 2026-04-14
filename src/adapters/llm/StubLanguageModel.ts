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

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export type StubLanguageModelScenario = "success" | "supersession" | "contradiction" | "low-confidence";

export interface StubLanguageModelOptions {
  scenario?: StubLanguageModelScenario;
  classify?: (prompt: string, schema: QuerySchema) => QueryClassifierDecision;
  summarize?: (prompt: string) => string;
  extract?: (prompt: string, schema: ExtractSchema) => EntitySelectionResult;
  classifyConsolidation?: (
    input: ConsolidationClassificationInput,
  ) => ConsolidationClassificationResult;
  decideConsolidation?: (input: ConsolidationDecisionInput) => ConsolidationDecisionResult;
  synthesizeEntitySummary?: (
    input: EntitySummarySynthesisInput,
  ) => EntitySummarySynthesisResult;
  synthesizeLifeState?: (input: LifeStateSynthesisInput) => LifeStateSynthesisResult;
}

function summarizeContent(content: string, limit = 120): string {
  return content.replace(/\s+/g, " ").trim().slice(0, limit);
}

function buildSummaryClaims(input: EntitySummarySynthesisInput): EntitySummarySynthesisResult {
  const atoms = input.atoms.slice(0, 4);
  if (atoms.length === 0) {
    return {
      summary: input.existingSummary ?? `No source atoms were provided for ${input.entityName}.`,
      claims: [],
      confidence: "low",
    };
  }

  const claims = atoms.map((atom) => ({
    text: summarizeContent(atom.content),
    sourceAtomIds: [atom.id],
  }));

  return {
    summary: claims
      .map((claim) => `${claim.text} [source: ${claim.sourceAtomIds.join(", ")}]`)
      .join(" "),
    claims,
    confidence: "high",
  };
}

export class StubLanguageModel implements LanguageModel {
  constructor(private readonly options: StubLanguageModelOptions = {}) {}

  async classify(prompt: string, _schema: QuerySchema): Promise<QueryClassifierDecision> {
    const override = this.options.classify;
    if (override) {
      return override(prompt, _schema);
    }

    const lower = normalize(prompt);
    if (
      lower.includes("capital of france") ||
      lower.includes("who wrote hamlet") ||
      lower.includes("general knowledge")
    ) {
      return {
        needsMemory: false,
        reason: "The request looks like general knowledge rather than personal memory.",
      };
    }

    return {
      needsMemory: true,
      reason: "The request may depend on user-specific memory or project context.",
    };
  }

  async summarize(prompt: string): Promise<string> {
    return prompt.replace(/\s+/g, " ").trim().slice(0, 160);
  }

  async extract(prompt: string, _schema: ExtractSchema): Promise<EntitySelectionResult> {
    const override = this.options.extract;
    if (override) {
      return override(prompt, _schema);
    }

    const queryMatch = prompt.match(/Query:\s*(.+)\n/);
    const query = queryMatch?.[1] ?? prompt;
    const queryTokens = tokenize(query);
    const lines = prompt.split("\n").filter((line) => line.startsWith("- ["));
    const scored = lines
      .map((line) => {
        const match = line.match(/- \[(.+?)\]\(entities\/(.+?)\/(.+?)\.md(?:\?id=[^)]+)?\) — (.*)$/);
        if (!match) {
          return null;
        }

        const [, name, categorySlug, slug] = match;
        const haystack = `${name} ${categorySlug} ${slug}`;
        const tokens = tokenize(haystack);
        let score = 0;
        for (const token of queryTokens) {
          if (tokens.includes(token)) {
            score += 2;
          }
        }

        if (queryTokens.includes("vehicles") || queryTokens.includes("vehicle") || queryTokens.includes("own")) {
          if (categorySlug === "vehicles") {
            score += 3;
          }
        }

        if (queryTokens.includes("family") && categorySlug === "family") {
          score += 3;
        }

        if (queryTokens.includes("project") && categorySlug === "software-projects") {
          score += 3;
        }

        return { slug, score };
      })
      .filter((value): value is { slug: string; score: number } => value !== null)
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

    const selected = unique(scored.filter((item) => item.score >= 2).slice(0, 4).map((item) => item.slug));
    return {
      slugs: selected,
      confidence: selected.length > 0 ? "high" : "low",
    };
  }

  async classifyConsolidation(
    input: ConsolidationClassificationInput,
  ): Promise<ConsolidationClassificationResult> {
    const override = this.options.classifyConsolidation;
    if (override) {
      return override(input);
    }

    const confidence = this.options.scenario === "low-confidence" ? "low" : "high";
    const entitySlug = input.likelyEntitySlug ?? input.candidateEntities[0]?.slug ?? null;

    return {
      entitySlug,
      confidence,
      reason:
        confidence === "low"
          ? "The atom could not be confidently linked from the provided candidates."
          : `Linked to ${entitySlug ?? "no entity"} using the strongest available candidate.`,
      links: entitySlug
        ? [
            {
              entitySlug,
              relation: "member_of",
              confidence,
              reason: "Selected as the primary consolidation target.",
            },
          ]
        : [],
    };
  }

  async decideConsolidation(input: ConsolidationDecisionInput): Promise<ConsolidationDecisionResult> {
    const override = this.options.decideConsolidation;
    if (override) {
      return override(input);
    }

    if (this.options.scenario === "low-confidence") {
      return {
        supersedesAtomId: null,
        contradictionAtomIds: [],
        confidence: "low",
        reason: "The model could not make a reliable contradiction or supersession decision.",
      };
    }

    if (this.options.scenario === "contradiction") {
      return {
        supersedesAtomId: null,
        contradictionAtomIds: input.candidateAtoms.slice(0, 2).map((atom) => atom.id),
        confidence: "high",
        reason: "The atom directly conflicts with earlier evidence in the same cluster.",
      };
    }

    if (this.options.scenario === "supersession") {
      return {
        supersedesAtomId: input.candidateAtoms[0]?.id ?? null,
        contradictionAtomIds: [],
        confidence: "high",
        reason: "The atom clearly supersedes the prior statement in the same field.",
      };
    }

    return {
      supersedesAtomId: null,
      contradictionAtomIds: [],
      confidence: "high",
      reason: "No supersession or contradiction was detected.",
    };
  }

  async synthesizeEntitySummary(
    input: EntitySummarySynthesisInput,
  ): Promise<EntitySummarySynthesisResult> {
    const override = this.options.synthesizeEntitySummary;
    if (override) {
      return override(input);
    }

    const base = buildSummaryClaims(input);
    if (this.options.scenario === "low-confidence") {
      return {
        summary: input.existingSummary ?? base.summary,
        claims: base.claims,
        confidence: "low",
      };
    }

    if (this.options.scenario === "contradiction") {
      return {
        ...base,
        summary: `${base.summary} Conflicting evidence remains and should be reviewed.`,
      };
    }

    if (this.options.scenario === "supersession") {
      return {
        ...base,
        summary: `${base.summary} Later evidence appears to supersede older statements where relevant.`,
      };
    }

    return base;
  }

  async synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
    const override = this.options.synthesizeLifeState;
    if (override) {
      return override(input);
    }

    const categories = input.atomsByCategory.filter((group) => group.atoms.length > 0);
    if (categories.length === 0) {
      return {
        narrative: "",
        confidence: "low",
      };
    }

    const parts = categories.slice(0, 4).map((group) => {
      const atom = group.atoms[0];
      return `${group.categoryName}: ${summarizeContent(atom?.content ?? "", 60)}`;
    });

    return {
      narrative: parts.join(". "),
      confidence: "high",
    };
  }
}
