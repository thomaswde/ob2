import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_QUERY_LIMIT,
  DEFAULT_RECENT_BRIDGE_LIMIT,
  QUERY_HARD_CAP_TOKENS,
  QUERY_TARGET_TOKENS,
} from "../domain/constants.js";
import type { LanguageModel } from "../domain/languageModel.js";
import type { Repository } from "../domain/repository.js";
import type {
  MemoryAtom,
  QueryEntityResult,
  QueryMemoryResult,
} from "../domain/types.js";

interface CachedFile {
  mtimeMs: number;
  content: string;
}

type StepTimer = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function trimStringToTokens(value: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseIndexEntries(indexContent: string): Map<string, { slug: string; summary: string; categorySlug: string }> {
  const result = new Map<string, { slug: string; summary: string; categorySlug: string }>();
  for (const line of indexContent.split("\n")) {
    const match = line.match(/- \[[^\]]+\]\(entities\/(.+?)\/(.+?)\.md\) — (.*)$/);
    if (!match) {
      continue;
    }

    const categorySlug = match[1];
    const slug = match[2];
    const summary = match[3];
    if (!categorySlug || !slug || !summary) {
      continue;
    }
    result.set(slug, { slug, summary, categorySlug });
  }
  return result;
}

export class MemoryQueryService {
  private readonly cache = new Map<string, CachedFile>();

  constructor(
    private readonly repository: Repository,
    private readonly languageModel: LanguageModel,
    private readonly rootDir = process.cwd(),
  ) {}

  private get memoryDir(): string {
    return path.join(this.rootDir, "memory");
  }

  private async readCached(filePath: string): Promise<string> {
    const fileStat = await stat(filePath);
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.content;
    }

    const content = await readFile(filePath, "utf8");
    this.cache.set(filePath, { mtimeMs: fileStat.mtimeMs, content });
    return content;
  }

  private buildEmptyResult(needsMemory: boolean, reason: string): QueryMemoryResult {
    return {
      lifeState: "",
      recent: [],
      entities: [],
      fallbackAtoms: null,
      reasoning: {
        gatesUsed: ["gate0"],
        classifierDecision: {
          needsMemory,
          reason,
        },
      },
    };
  }

  private trimResult(result: QueryMemoryResult): QueryMemoryResult {
    const clone: QueryMemoryResult = {
      ...result,
      recent: [...result.recent],
      entities: result.entities.map((entity) => ({ ...entity })),
      fallbackAtoms: result.fallbackAtoms ? [...result.fallbackAtoms] : null,
      reasoning: {
        ...result.reasoning,
        gatesUsed: [...result.reasoning.gatesUsed],
      },
    };

    const totalTokens = (): number => {
      const recentTokens = clone.recent.reduce((sum, atom) => sum + estimateTokens(atom.content), 0);
      const entityTokens = clone.entities.reduce(
        (sum, entity) => sum + estimateTokens(entity.summary) + estimateTokens(entity.content),
        0,
      );
      const fallbackTokens = (clone.fallbackAtoms ?? []).reduce((sum, atom) => sum + estimateTokens(atom.content), 0);
      return estimateTokens(clone.lifeState) + recentTokens + entityTokens + fallbackTokens;
    };

    while (totalTokens() > QUERY_HARD_CAP_TOKENS) {
      if (clone.recent.length > 0) {
        clone.recent.pop();
        continue;
      }

      if (clone.fallbackAtoms && clone.fallbackAtoms.length > 0) {
        clone.fallbackAtoms.pop();
        continue;
      }

      if (clone.entities.length > 0) {
        const lastEntity = clone.entities[clone.entities.length - 1];
        if (!lastEntity) {
          clone.entities.pop();
          continue;
        }
        if (estimateTokens(lastEntity.content) > 40) {
          lastEntity.content = trimStringToTokens(lastEntity.content, estimateTokens(lastEntity.content) - 40);
          continue;
        }
        clone.entities.pop();
        continue;
      }

      if (clone.lifeState.length > 0) {
        clone.lifeState = trimStringToTokens(clone.lifeState, Math.max(40, estimateTokens(clone.lifeState) - 80));
        continue;
      }

      break;
    }

    if (totalTokens() < QUERY_TARGET_TOKENS) {
      return clone;
    }

    return clone;
  }

  async query(text: string, fallbackLimit = DEFAULT_QUERY_LIMIT): Promise<QueryMemoryResult> {
    const gateTimingsMs: Record<string, number> = {};
    const queryStartedAt = Date.now();
    const timeStep: StepTimer = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await fn();
      } finally {
        gateTimingsMs[name] = Date.now() - startedAt;
      }
    };

    const classifierDecision = await timeStep("gate0", async () =>
      this.languageModel.classify(`Query: ${text}`, { type: "classification" }),
    );
    if (!classifierDecision.needsMemory) {
      const result = this.buildEmptyResult(false, classifierDecision.reason);
      result.reasoning.gateTimingsMs = gateTimingsMs;
      result.reasoning.totalDurationMs = Date.now() - queryStartedAt;
      return result;
    }

    const gatesUsed = ["gate0", "gate1", "gate1.5", "gate2"];
    const lifeState = await timeStep("gate1", async () => this.readCached(path.join(this.memoryDir, "life_state.md")));
    const indexContent = await this.readCached(path.join(this.memoryDir, "index.md"));
    const recent = await timeStep("gate1.5", async () => {
      const since = await this.repository.getLatestCompletedConsolidationAt();
      return this.repository.listRecentBridgeAtoms(since, DEFAULT_RECENT_BRIDGE_LIMIT);
    });
    const indexEntries = parseIndexEntries(indexContent);
    const gate2 = await timeStep("gate2", async () =>
      this.languageModel.extract(`Query: ${text}\nIndex:\n${indexContent}`, { type: "entity-selection" }),
    );
    const entities: QueryEntityResult[] = [];

    for (const slug of gate2.slugs) {
      const entry = indexEntries.get(slug);
      if (!entry) {
        continue;
      }
      const content = await this.readCached(path.join(this.memoryDir, "entities", entry.categorySlug, `${slug}.md`));
      entities.push({ slug, summary: entry.summary, content });
    }

    let fallbackAtoms: MemoryAtom[] | null = null;
    if (entities.length === 0 || gate2.confidence === "low") {
      gatesUsed.push("gate3");
      fallbackAtoms = await timeStep("gate3", async () => this.repository.searchValidAtomsLexical(text, fallbackLimit));
    }

    return this.trimResult({
      lifeState,
      recent,
      entities,
      fallbackAtoms,
      reasoning: {
        gatesUsed,
        classifierDecision,
        gate2Confidence: gate2.confidence,
        gateTimingsMs,
        totalDurationMs: Date.now() - queryStartedAt,
      },
    });
  }
}
