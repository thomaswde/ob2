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
  size: number;
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

interface IndexEntry {
  slug: string;
  summary: string;
  categorySlug: string;
  entityId: string | null;
}

function parseIndexEntries(indexContent: string): Map<string, IndexEntry> {
  const result = new Map<string, IndexEntry>();
  for (const line of indexContent.split("\n")) {
    const match = line.match(/- \[[^\]]+\]\(entities\/(.+?)\/(.+?)\.md(?:\?id=([^)]+))?\) — (.*)$/);
    if (!match) {
      continue;
    }

    const categorySlug = match[1] ?? "";
    const slug = match[2] ?? "";
    const entityId = match[3] ?? null;
    const summary = match[4] ?? "";
    if (!categorySlug || !slug) {
      continue;
    }
    result.set(slug, { slug, summary, categorySlug, entityId });
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
    const cached = this.cache.get(filePath);
    try {
      const fileStat = await stat(filePath);
      if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
        return cached.content;
      }

      const content = await readFile(filePath, "utf8");
      this.cache.set(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, content });
      return content;
    } catch (error) {
      if (cached && this.isMissingFileError(error)) {
        return cached.content;
      }
      if (this.isMissingFileError(error)) {
        return "";
      }
      throw error;
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
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

  private async loadEntityResult(entry: IndexEntry): Promise<QueryEntityResult> {
    const content = await this.readCached(path.join(this.memoryDir, "entities", entry.categorySlug, `${entry.slug}.md`));
    return {
      slug: entry.slug,
      summary: entry.summary,
      content,
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
        gate4LinkedSlugs: result.reasoning.gate4LinkedSlugs ? [...result.reasoning.gate4LinkedSlugs] : undefined,
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

      if (clone.lifeState.length > 0) {
        clone.lifeState = trimStringToTokens(clone.lifeState, Math.max(40, estimateTokens(clone.lifeState) - 80));
        continue;
      }

      if (clone.entities.length > 0) {
        const entityToTrim = [...clone.entities]
          .sort(
            (a, b) =>
              estimateTokens(b.content) + estimateTokens(b.summary) - (estimateTokens(a.content) + estimateTokens(a.summary)),
          )[0];
        if (!entityToTrim) {
          clone.entities.pop();
          continue;
        }
        if (estimateTokens(entityToTrim.content) > 20) {
          entityToTrim.content = trimStringToTokens(entityToTrim.content, estimateTokens(entityToTrim.content) - 20);
          continue;
        }
        if (estimateTokens(entityToTrim.summary) > 10) {
          entityToTrim.summary = trimStringToTokens(entityToTrim.summary, estimateTokens(entityToTrim.summary) - 10);
          continue;
        }
        clone.entities.pop();
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
      this.languageModel.extract(
        `Query: ${text}\n\nUser current state:\n${lifeState}\n\nEntity index:\n${indexContent}`,
        { type: "entity-selection" },
      ),
    );
    const entities: QueryEntityResult[] = [];
    const seenSlugs = new Set<string>();

    for (const slug of new Set(gate2.slugs)) {
      const entry = indexEntries.get(slug);
      if (!entry) {
        continue;
      }
      seenSlugs.add(slug);
      entities.push(await this.loadEntityResult(entry));
    }

    const gate4LinkedSlugs: string[] = [];
    if (gate2.confidence === "high" && entities.length > 0) {
      const linkedEntries = await timeStep("gate4", async () => {
        const linked: IndexEntry[] = [];
        const entryByEntityId = new Map(
          [...indexEntries.values()]
            .filter((entry) => entry.entityId)
            .map((entry) => [entry.entityId as string, entry]),
        );

        for (const slug of [...seenSlugs]) {
          const entry = indexEntries.get(slug);
          if (!entry) {
            continue;
          }

          const entity =
            (entry.entityId ? await this.repository.getEntityById(entry.entityId) : null) ??
            (await this.repository.getEntityBySlug(entry.slug));
          if (!entity) {
            continue;
          }

          const links = await this.repository.listEntityLinksForEntity(entity.id);
          for (const link of links) {
            if ((link.confidence ?? 0) < 0.75) {
              continue;
            }

            const relatedEntityId = link.entityId === entity.id ? link.relatedEntityId : link.entityId;
            const relatedEntry = entryByEntityId.get(relatedEntityId);
            if (!relatedEntry || seenSlugs.has(relatedEntry.slug)) {
              continue;
            }

            seenSlugs.add(relatedEntry.slug);
            gate4LinkedSlugs.push(relatedEntry.slug);
            linked.push(relatedEntry);

            if (gate4LinkedSlugs.length >= 3) {
              return linked;
            }
          }
        }

        return linked;
      });

      if (linkedEntries.length > 0) {
        gatesUsed.push("gate4");
        for (const entry of linkedEntries) {
          entities.push(await this.loadEntityResult(entry));
        }
      }
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
        gate4LinkedSlugs: gate4LinkedSlugs.length > 0 ? gate4LinkedSlugs : undefined,
        gateTimingsMs,
        totalDurationMs: Date.now() - queryStartedAt,
      },
    });
  }
}
