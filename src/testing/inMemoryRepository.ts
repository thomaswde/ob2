import { TOP_LEVEL_CATEGORIES } from "../domain/constants.js";
import type { Repository } from "../domain/repository.js";
import type {
  CompleteConsolidationRunInput,
  ConsolidationRun,
  CorrectionAction,
  CreateConsolidationRunInput,
  CreateCorrectionActionInput,
  CreateEntityInput,
  CreateEntityLinkInput,
  CreateMemoryAtomInput,
  CreateReviewItemInput,
  Entity,
  EntityLink,
  EntityMatch,
  EntityWithCategory,
  ListEntitiesOptions,
  MemoryAtom,
  Notification,
  QueryAtomsOptions,
  RequestLog,
  ReviewItem,
  SystemState,
  UpdateMemoryAtomInput,
  UpdateSystemStateInput,
  CreateRequestLogInput,
  CreateNotificationInput,
} from "../domain/types.js";
import { makeId } from "../utils/crypto.js";
import { slugify } from "../utils/text.js";

function trigrams(value: string): Set<string> {
  const normalized = `  ${value.toLowerCase()}  `;
  const set = new Set<string>();
  for (let index = 0; index < normalized.length - 2; index += 1) {
    set.add(normalized.slice(index, index + 3));
  }
  return set;
}

function similarity(a: string, b: string): number {
  const source = a.trim().toLowerCase();
  const target = b.trim().toLowerCase();
  if (source === target) {
    return 1;
  }

  const sourceTokens = trigrams(source);
  const targetTokens = trigrams(target);
  let overlap = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) {
      overlap += 1;
    }
  }

  const union = new Set([...sourceTokens, ...targetTokens]).size;
  return overlap / Math.max(union, 1);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function lexicalScore(query: string, content: string): number {
  const phraseSimilarity = similarity(query, content);
  const queryTokens = tokenize(query);
  const contentTokens = tokenize(content);

  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return phraseSimilarity;
  }

  const exactOverlap =
    queryTokens.filter((token) => contentTokens.includes(token)).length / queryTokens.length;
  const fuzzyOverlap =
    queryTokens.reduce((sum, queryToken) => {
      let best = 0;
      for (const contentToken of contentTokens) {
        best = Math.max(best, similarity(queryToken, contentToken));
      }
      return sum + best;
    }, 0) / queryTokens.length;

  return Math.max(phraseSimilarity, exactOverlap, fuzzyOverlap);
}

function recencyScore(createdAt: Date): number {
  const ageInDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86_400_000);
  return 1 / (1 + ageInDays);
}

export class InMemoryRepository implements Repository {
  private readonly entities = new Map<string, Entity>();
  private readonly atoms = new Map<string, MemoryAtom>();
  private readonly entityLinks = new Map<string, EntityLink>();
  private readonly consolidationRuns = new Map<string, ConsolidationRun>();
  private readonly reviewItems = new Map<string, ReviewItem>();
  private readonly correctionActions = new Map<string, CorrectionAction>();
  private readonly requestLogs = new Map<string, RequestLog>();
  private readonly notifications = new Map<string, Notification>();
  private systemState: SystemState = {
    consolidationEnabled: true,
    consecutiveAbortedRuns: 0,
    updatedAt: new Date(),
  };

  private isAtomCurrentlyValid(atom: MemoryAtom): boolean {
    return !atom.invalidAt || atom.invalidAt.getTime() > Date.now();
  }

  private sortAtoms(a: MemoryAtom, b: MemoryAtom): number {
    if (b.importance !== a.importance) {
      return b.importance - a.importance;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  }

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const existing = await this.getEntityByName(input.name);
    if (existing) {
      return existing;
    }
    const now = new Date();
    const entity: Entity = {
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  async getMemoryAtomByFingerprint(sourceRef: string, contentFingerprint: string): Promise<MemoryAtom | null> {
    for (const atom of this.atoms.values()) {
      if (atom.sourceRef === sourceRef && atom.contentFingerprint === contentFingerprint) {
        return atom;
      }
    }
    return null;
  }

  async getMemoryAtomById(id: string): Promise<MemoryAtom | null> {
    return this.atoms.get(id) ?? null;
  }

  async createMemoryAtom(input: CreateMemoryAtomInput): Promise<MemoryAtom> {
    const now = new Date();
    const atom: MemoryAtom = {
      ...input,
      locked: input.locked ?? false,
      supersedesId: input.supersedesId ?? null,
      verificationState: input.verificationState ?? "unverified",
      consolidationStatus: input.consolidationStatus ?? "pending",
      retrievalCount: input.retrievalCount ?? 0,
      lastRetrievedAt: input.lastRetrievedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.atoms.set(atom.id, atom);
    return atom;
  }

  async updateMemoryAtom(input: UpdateMemoryAtomInput): Promise<MemoryAtom> {
    const existing = this.atoms.get(input.id);
    if (!existing) {
      throw new Error(`Atom not found: ${input.id}`);
    }

    const updated: MemoryAtom = {
      ...existing,
      content: input.content === undefined ? existing.content : input.content,
      contentFingerprint:
        input.contentFingerprint === undefined ? existing.contentFingerprint : input.contentFingerprint,
      entityId: input.entityId === undefined ? existing.entityId : input.entityId,
      sourceRef: input.sourceRef === undefined ? existing.sourceRef : input.sourceRef,
      sourceAgent: input.sourceAgent === undefined ? existing.sourceAgent : input.sourceAgent,
      importance: input.importance === undefined ? existing.importance : input.importance,
      confidence: input.confidence === undefined ? existing.confidence : input.confidence,
      decayClass: input.decayClass === undefined ? existing.decayClass : input.decayClass,
      validAt: input.validAt === undefined ? existing.validAt : input.validAt,
      invalidAt: input.invalidAt === undefined ? existing.invalidAt : input.invalidAt,
      locked: input.locked === undefined ? existing.locked : input.locked,
      supersedesId: input.supersedesId === undefined ? existing.supersedesId : input.supersedesId,
      verificationState: input.verificationState === undefined ? existing.verificationState : input.verificationState,
      consolidationStatus:
        input.consolidationStatus === undefined ? existing.consolidationStatus : input.consolidationStatus,
      retrievalCount: input.retrievalCount === undefined ? existing.retrievalCount : input.retrievalCount,
      lastRetrievedAt: input.lastRetrievedAt === undefined ? existing.lastRetrievedAt : input.lastRetrievedAt,
      metadata: input.metadata === undefined ? existing.metadata : input.metadata,
      updatedAt: new Date(),
    };

    this.atoms.set(updated.id, updated);
    return updated;
  }

  async listEntities(options: ListEntitiesOptions = {}): Promise<Entity[]> {
    return [...this.entities.values()]
      .filter((entity) => (options.type ? entity.type === options.type : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getEntityById(id: string): Promise<Entity | null> {
    return this.entities.get(id) ?? null;
  }

  async getEntityByName(name: string): Promise<Entity | null> {
    const normalized = name.trim().toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.name.toLowerCase() === normalized) {
        return entity;
      }
    }
    return null;
  }

  async getEntityBySlug(slug: string): Promise<Entity | null> {
    for (const entity of this.entities.values()) {
      if (entity.slug === slug) {
        return entity;
      }
    }
    return null;
  }

  async findEntityExact(name: string): Promise<Entity | null> {
    return this.getEntityByName(name);
  }

  async findEntityFuzzy(name: string, minimumSimilarity: number): Promise<EntityMatch | null> {
    let bestMatch: EntityMatch | null = null;
    for (const entity of this.entities.values()) {
      const score = similarity(entity.name, name);
      if (score >= minimumSimilarity && (!bestMatch || score > bestMatch.similarity)) {
        bestMatch = { entity, similarity: score };
      }
    }
    return bestMatch;
  }

  async queryAtoms(options: QueryAtomsOptions): Promise<MemoryAtom[]> {
    return this.searchValidAtomsLexical(options.text, options.limit ?? 10);
  }

  async listNonCategoryEntitiesWithCategory(): Promise<EntityWithCategory[]> {
    return [...this.entities.values()]
      .filter((entity) => entity.type !== "category")
      .map((entity) => {
        const category = entity.parentEntityId ? this.entities.get(entity.parentEntityId) ?? null : null;
        return {
          ...entity,
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? null,
          categorySlug: category?.slug ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listEntitiesByParent(parentEntityId: string): Promise<Entity[]> {
    return [...this.entities.values()]
      .filter((entity) => entity.parentEntityId === parentEntityId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listPendingAtoms(limit = Number.MAX_SAFE_INTEGER): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => atom.consolidationStatus === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async listValidAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => atom.entityId === entityId && this.isAtomCurrentlyValid(atom))
      .sort((a, b) => this.sortAtoms(a, b));
  }

  async storeAtomEmbedding(_atomId: string, _embedding: number[]): Promise<void> {}

  async searchValidAtomsSemantic(_embedding: number[], _limit: number): Promise<MemoryAtom[]> {
    return [];
  }

  async listValidAtomsWithEmbeddingsForEntities(
    _entityIds: string[],
  ): Promise<Array<MemoryAtom & { embedding: number[] }>> {
    return [];
  }

  async listLifeStateAtoms(limit = 100): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => this.isAtomCurrentlyValid(atom))
      .filter((atom) => atom.decayClass === "profile" || atom.decayClass === "preference" || atom.importance >= 0.8)
      .sort((a, b) => this.sortAtoms(a, b))
      .slice(0, limit);
  }

  async listRecentBridgeAtoms(since: Date | null, limit: number): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => this.isAtomCurrentlyValid(atom))
      .filter((atom) => (since ? atom.createdAt.getTime() > since.getTime() : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async searchValidAtomsLexical(text: string, limit: number): Promise<MemoryAtom[]> {
    const matches = [...this.atoms.values()]
      .filter((atom) => this.isAtomCurrentlyValid(atom))
      .map((atom) => ({
        atom,
        lexical: lexicalScore(text, atom.content),
        recency: recencyScore(atom.createdAt),
      }))
      .filter((item) => item.lexical >= 0.1);

    return matches
      .sort((a, b) => {
        const scoreA = a.lexical * 0.7 + a.atom.importance * 0.2 + a.recency * 0.1;
        const scoreB = b.lexical * 0.7 + b.atom.importance * 0.2 + b.recency * 0.1;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return this.sortAtoms(a.atom, b.atom);
      })
      .map((item) => item.atom)
      .slice(0, limit);
  }

  async getLatestCompletedConsolidationAt(): Promise<Date | null> {
    const latest = [...this.consolidationRuns.values()]
      .filter((run) => run.status === "completed" && run.completedAt)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
    return latest?.completedAt ?? null;
  }

  async listAllMemoryAtoms(): Promise<MemoryAtom[]> {
    return [...this.atoms.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => atom.entityId === entityId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listEntityLinks(): Promise<EntityLink[]> {
    return [...this.entityLinks.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listEntityLinksForEntity(entityId: string): Promise<EntityLink[]> {
    return [...this.entityLinks.values()]
      .filter((link) => link.entityId === entityId || link.relatedEntityId === entityId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createEntityLink(input: CreateEntityLinkInput): Promise<EntityLink> {
    const existing = [...this.entityLinks.values()].find(
      (link) =>
        link.entityId === input.entityId &&
        link.relatedEntityId === input.relatedEntityId &&
        link.relationshipType === input.relationshipType,
    );
    if (existing) {
      return existing;
    }

    const link: EntityLink = {
      ...input,
      confidence: input.confidence ?? null,
      evidenceAtomId: input.evidenceAtomId ?? null,
      createdAt: new Date(),
    };
    this.entityLinks.set(link.id, link);
    return link;
  }

  async createConsolidationRun(input: CreateConsolidationRunInput): Promise<ConsolidationRun> {
    const startedAt = input.startedAt ?? new Date();
    const run: ConsolidationRun = {
      id: input.id,
      status: input.status,
      startedAt,
      completedAt: input.completedAt ?? (input.status === "pending" ? null : new Date()),
      atomCount: input.atomCount ?? 0,
      processedAtomCount: input.processedAtomCount ?? 0,
      lowConfidenceAtomCount: input.lowConfidenceAtomCount ?? 0,
      errorCount: input.errorCount ?? 0,
      notes: input.notes ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? {},
    };
    this.consolidationRuns.set(run.id, run);
    return run;
  }

  async completeConsolidationRun(input: CompleteConsolidationRunInput): Promise<ConsolidationRun> {
    const existing = this.consolidationRuns.get(input.id);
    if (!existing) {
      throw new Error(`Consolidation run not found: ${input.id}`);
    }

    const updated: ConsolidationRun = {
      ...existing,
      status: input.status,
      completedAt: new Date(),
      atomCount: input.atomCount,
      processedAtomCount: input.processedAtomCount ?? input.atomCount,
      lowConfidenceAtomCount: input.lowConfidenceAtomCount ?? 0,
      errorCount: input.errorCount,
      notes: input.notes ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? existing.metadata,
    };
    this.consolidationRuns.set(updated.id, updated);
    return updated;
  }

  async listConsolidationRuns(limit = 20): Promise<ConsolidationRun[]> {
    return [...this.consolidationRuns.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async createReviewItem(input: CreateReviewItemInput): Promise<ReviewItem> {
    const now = new Date();
    const item: ReviewItem = {
      id: input.id,
      atomId: input.atomId ?? null,
      entityId: input.entityId ?? null,
      kind: input.kind,
      status: input.status ?? "open",
      detail: input.detail,
      confidence: input.confidence ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.reviewItems.set(item.id, item);
    return item;
  }

  async listReviewItems(status?: ReviewItem["status"]): Promise<ReviewItem[]> {
    return [...this.reviewItems.values()]
      .filter((item) => (status ? item.status === status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createCorrectionAction(input: CreateCorrectionActionInput): Promise<CorrectionAction> {
    const now = new Date();
    const action: CorrectionAction = {
      id: input.id,
      targetAtomId: input.targetAtomId ?? null,
      proposedContent: input.proposedContent,
      reason: input.reason ?? null,
      status: input.status ?? "proposed",
      confidence: input.confidence ?? null,
      appliedAtomId: input.appliedAtomId ?? null,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };
    this.correctionActions.set(action.id, action);
    return action;
  }

  async listCorrectionActions(statuses?: CorrectionAction["status"][]): Promise<CorrectionAction[]> {
    return [...this.correctionActions.values()]
      .filter((action) => (statuses && statuses.length > 0 ? statuses.includes(action.status) : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateCorrectionActionStatus(id: string, status: CorrectionAction["status"]): Promise<CorrectionAction> {
    const existing = this.correctionActions.get(id);
    if (!existing) {
      throw new Error(`Correction action not found: ${id}`);
    }
    const updated: CorrectionAction = {
      ...existing,
      status,
      updatedAt: new Date(),
    };
    this.correctionActions.set(id, updated);
    return updated;
  }

  async getSystemState(): Promise<SystemState> {
    return this.systemState;
  }

  async updateSystemState(input: UpdateSystemStateInput): Promise<SystemState> {
    this.systemState = {
      consolidationEnabled:
        input.consolidationEnabled === undefined ? this.systemState.consolidationEnabled : input.consolidationEnabled,
      consecutiveAbortedRuns:
        input.consecutiveAbortedRuns === undefined
          ? this.systemState.consecutiveAbortedRuns
          : input.consecutiveAbortedRuns,
      updatedAt: new Date(),
    };
    return this.systemState;
  }

  async countMemoryAtoms(): Promise<number> {
    return this.atoms.size;
  }

  async countPendingAtoms(): Promise<number> {
    let count = 0;
    for (const atom of this.atoms.values()) {
      if (atom.consolidationStatus === "pending") {
        count += 1;
      }
    }
    return count;
  }

  async createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
    const log: RequestLog = {
      id: input.id,
      clientId: input.clientId,
      method: input.method,
      route: input.route,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.requestLogs.set(log.id, log);
    return log;
  }

  async listRequestLogs(limit = 100): Promise<RequestLog[]> {
    return [...this.requestLogs.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const notification: Notification = {
      id: input.id,
      kind: input.kind,
      detail: input.detail,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async listNotifications(limit = 100): Promise<Notification[]> {
    return [...this.notifications.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async deleteAllData(): Promise<void> {
    this.atoms.clear();
    this.entities.clear();
    this.entityLinks.clear();
    this.consolidationRuns.clear();
    this.reviewItems.clear();
    this.correctionActions.clear();
    this.requestLogs.clear();
    this.notifications.clear();
    this.systemState = {
      consolidationEnabled: true,
      consecutiveAbortedRuns: 0,
      updatedAt: new Date(),
    };
  }

  async seedTopLevelCategories(): Promise<void> {
    const now = new Date();
    for (const name of TOP_LEVEL_CATEGORIES) {
      if (await this.getEntityByName(name)) {
        continue;
      }
      const entity: Entity = {
        id: makeId(),
        name,
        slug: slugify(name),
        type: "category",
        parentEntityId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.entities.set(entity.id, entity);
    }
  }
}
