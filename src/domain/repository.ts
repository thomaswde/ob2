import type {
  CompleteConsolidationRunInput,
  ConsolidationRun,
  CorrectionAction,
  CreateNotificationInput,
  CreateRequestLogInput,
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
} from "./types.js";

export interface Repository {
  createEntity(input: CreateEntityInput): Promise<Entity>;
  getMemoryAtomByFingerprint(sourceRef: string, contentFingerprint: string): Promise<MemoryAtom | null>;
  getMemoryAtomById(id: string): Promise<MemoryAtom | null>;
  createMemoryAtom(input: CreateMemoryAtomInput): Promise<MemoryAtom>;
  updateMemoryAtom(input: UpdateMemoryAtomInput): Promise<MemoryAtom>;
  listEntities(options?: ListEntitiesOptions): Promise<Entity[]>;
  getEntityById(id: string): Promise<Entity | null>;
  getEntityByName(name: string): Promise<Entity | null>;
  getEntityBySlug(slug: string): Promise<Entity | null>;
  findEntityExact(name: string): Promise<Entity | null>;
  findEntityFuzzy(name: string, minimumSimilarity: number): Promise<EntityMatch | null>;
  queryAtoms(options: QueryAtomsOptions): Promise<MemoryAtom[]>;
  listNonCategoryEntitiesWithCategory(): Promise<EntityWithCategory[]>;
  listEntitiesByParent(parentEntityId: string): Promise<Entity[]>;
  listPendingAtoms(limit?: number): Promise<MemoryAtom[]>;
  listValidAtomsForEntity(entityId: string): Promise<MemoryAtom[]>;
  listLifeStateAtoms(limit?: number): Promise<MemoryAtom[]>;
  listRecentBridgeAtoms(since: Date | null, limit: number): Promise<MemoryAtom[]>;
  searchValidAtomsLexical(text: string, limit: number): Promise<MemoryAtom[]>;
  getLatestCompletedConsolidationAt(): Promise<Date | null>;
  listAllMemoryAtoms(): Promise<MemoryAtom[]>;
  listAtomsForEntity(entityId: string): Promise<MemoryAtom[]>;
  listEntityLinks(): Promise<EntityLink[]>;
  listEntityLinksForEntity(entityId: string): Promise<EntityLink[]>;
  createEntityLink(input: CreateEntityLinkInput): Promise<EntityLink>;
  createConsolidationRun(input: CreateConsolidationRunInput): Promise<ConsolidationRun>;
  completeConsolidationRun(input: CompleteConsolidationRunInput): Promise<ConsolidationRun>;
  listConsolidationRuns(limit?: number): Promise<ConsolidationRun[]>;
  createReviewItem(input: CreateReviewItemInput): Promise<ReviewItem>;
  listReviewItems(status?: ReviewItem["status"]): Promise<ReviewItem[]>;
  createCorrectionAction(input: CreateCorrectionActionInput): Promise<CorrectionAction>;
  listCorrectionActions(statuses?: CorrectionAction["status"][]): Promise<CorrectionAction[]>;
  updateCorrectionActionStatus(id: string, status: CorrectionAction["status"]): Promise<CorrectionAction>;
  getSystemState(): Promise<SystemState>;
  updateSystemState(input: UpdateSystemStateInput): Promise<SystemState>;
  countMemoryAtoms(): Promise<number>;
  countPendingAtoms(): Promise<number>;
  createRequestLog(input: CreateRequestLogInput): Promise<RequestLog>;
  listRequestLogs(limit?: number): Promise<RequestLog[]>;
  createNotification(input: CreateNotificationInput): Promise<Notification>;
  listNotifications(limit?: number): Promise<Notification[]>;
  deleteAllData(): Promise<void>;
  seedTopLevelCategories(): Promise<void>;
}
