import type { EntitySelectionResult, LanguageModel } from "../../domain/languageModel.js";
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

export class StubLanguageModel implements LanguageModel {
  async classify(prompt: string, _schema: QuerySchema): Promise<QueryClassifierDecision> {
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
    const queryMatch = prompt.match(/Query:\s*(.+)\n/);
    const query = queryMatch?.[1] ?? prompt;
    const queryTokens = tokenize(query);
    const lines = prompt.split("\n").filter((line) => line.startsWith("- ["));
    const scored = lines
      .map((line) => {
        const match = line.match(/- \[(.+?)\]\(entities\/(.+?)\/(.+?)\.md\) — (.*)$/);
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
}
