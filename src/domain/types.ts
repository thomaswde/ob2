export const DECAY_CLASSES = [
  "profile",
  "preference",
  "relationship",
  "decision",
  "task",
  "ephemeral",
] as const;

export type DecayClass = (typeof DECAY_CLASSES)[number];

export const ENTITY_TYPES = [
  "category",
  "person",
  "vehicle",
  "project",
  "place",
  "topic",
  "other",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type ConsolidationStatus = "pending" | "processed" | "rejected";
export type RunStatus = "pending" | "completed" | "aborted" | "aborted_low_confidence";
export type CorrectionStatus = "proposed" | "under_review" | "applied" | "rejected";
export type ReviewStatus = "open" | "resolved";
export type ReviewItemKind = "contradiction" | "duplicate_candidate" | "orphan_entity" | "stale_summary" | "correction" | "other";

export interface Entity {
  id: string;
  name: string;
  slug: string;
  type: EntityType;
  parentEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryAtom {
  id: string;
  content: string;
  contentFingerprint: string;
  entityId: string | null;
  sourceRef: string;
  sourceAgent: string | null;
  importance: number;
  confidence: number;
  decayClass: DecayClass;
  validAt: Date | null;
  invalidAt: Date | null;
  locked: boolean;
  supersedesId: string | null;
  verificationState: string;
  consolidationStatus: ConsolidationStatus;
  retrievalCount: number;
  lastRetrievedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CaptureMemoryInput {
  content: string;
  sourceRef: string;
  sourceAgent?: string | null;
  entityHint?: string | null;
  importance: number;
  confidence?: number;
  decayClass: DecayClass;
  validAt?: string | Date | null;
  invalidAt?: string | Date | null;
  metadata?: Record<string, unknown>;
}

export interface EntityWithCategory extends Entity {
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
}

export interface QueryEntityResult {
  slug: string;
  summary: string;
  content: string;
}

export interface QueryClassifierDecision {
  needsMemory: boolean;
  reason: string;
}

export interface QueryReasoning {
  gatesUsed: string[];
  classifierDecision: QueryClassifierDecision;
  gate2Confidence?: "high" | "low";
  gate4LinkedSlugs?: string[];
  gateTimingsMs?: Record<string, number>;
  totalDurationMs?: number;
}

export interface QueryMemoryResult {
  lifeState: string;
  recent: MemoryAtom[];
  entities: QueryEntityResult[];
  fallbackAtoms: MemoryAtom[] | null;
  reasoning: QueryReasoning;
}

export interface ListEntitiesOptions {
  type?: EntityType;
}

export interface QueryAtomsOptions {
  text: string;
  limit?: number;
}

export interface EntityMatch {
  entity: Entity;
  similarity: number;
}

export interface QuerySchema {
  type: "classification";
}

export interface ExtractSchema {
  type: "entity-selection";
}

export interface CreateMemoryAtomInput {
  id: string;
  content: string;
  contentFingerprint: string;
  entityId: string | null;
  sourceRef: string;
  sourceAgent: string | null;
  importance: number;
  confidence: number;
  decayClass: DecayClass;
  validAt: Date | null;
  invalidAt: Date | null;
  locked?: boolean;
  metadata: Record<string, unknown>;
  supersedesId?: string | null;
  verificationState?: string;
  consolidationStatus?: ConsolidationStatus;
  retrievalCount?: number;
  lastRetrievedAt?: Date | null;
}

export interface UpdateMemoryAtomInput {
  id: string;
  content?: string;
  contentFingerprint?: string;
  entityId?: string | null;
  sourceRef?: string;
  sourceAgent?: string | null;
  importance?: number;
  confidence?: number;
  decayClass?: DecayClass;
  validAt?: Date | null;
  invalidAt?: Date | null;
  locked?: boolean;
  supersedesId?: string | null;
  verificationState?: string;
  consolidationStatus?: ConsolidationStatus;
  retrievalCount?: number;
  lastRetrievedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface CreateEntityInput {
  id: string;
  name: string;
  slug: string;
  type: EntityType;
  parentEntityId: string | null;
}

export interface ConsolidationRun {
  id: string;
  status: RunStatus;
  startedAt: Date;
  completedAt: Date | null;
  atomCount: number;
  processedAtomCount: number;
  lowConfidenceAtomCount: number;
  errorCount: number;
  notes: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateConsolidationRunInput {
  id: string;
  status: RunStatus;
  startedAt?: Date;
  completedAt?: Date | null;
  atomCount?: number;
  processedAtomCount?: number;
  lowConfidenceAtomCount?: number;
  errorCount?: number;
  notes?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CompleteConsolidationRunInput {
  id: string;
  status: Exclude<RunStatus, "pending">;
  atomCount: number;
  processedAtomCount?: number;
  lowConfidenceAtomCount?: number;
  errorCount: number;
  notes?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReviewItem {
  id: string;
  atomId: string | null;
  entityId: string | null;
  kind: ReviewItemKind;
  status: ReviewStatus;
  detail: string;
  confidence: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewItemInput {
  id: string;
  atomId?: string | null;
  entityId?: string | null;
  kind: ReviewItemKind;
  status?: ReviewStatus;
  detail: string;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface CorrectionAction {
  id: string;
  targetAtomId: string | null;
  proposedContent: string;
  reason: string | null;
  status: CorrectionStatus;
  confidence: number | null;
  appliedAtomId: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface CreateCorrectionActionInput {
  id: string;
  targetAtomId?: string | null;
  proposedContent: string;
  reason?: string | null;
  status?: CorrectionStatus;
  confidence?: number | null;
  appliedAtomId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EntityLink {
  id: string;
  entityId: string;
  relatedEntityId: string;
  relationshipType: string;
  confidence: number | null;
  evidenceAtomId: string | null;
  createdAt: Date;
}

export interface CreateEntityLinkInput {
  id: string;
  entityId: string;
  relatedEntityId: string;
  relationshipType: string;
  confidence?: number | null;
  evidenceAtomId?: string | null;
}

export interface SystemState {
  consolidationEnabled: boolean;
  consecutiveAbortedRuns: number;
  updatedAt: Date;
}

export interface UpdateSystemStateInput {
  consolidationEnabled?: boolean;
  consecutiveAbortedRuns?: number;
}

export interface RequestLog {
  id: string;
  clientId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateRequestLogInput {
  id: string;
  clientId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  kind: string;
  detail: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateNotificationInput {
  id: string;
  kind: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface EntityDetail {
  entity: Entity;
  atoms: MemoryAtom[];
  links: EntityLink[];
}

export interface ExportManifest {
  generatedAt: string;
  schemaVersion: string;
  entityCount: number;
  atomCount: number;
  entityLinkCount: number;
  consolidationRunCount: number;
  correctionActionCount: number;
  reviewItemCount: number;
}

export interface ExportResult {
  outputPath: string;
  manifest: ExportManifest;
}

export interface AutomationTriggerResult {
  attempted: boolean;
  triggered: boolean;
  reason: string;
  status: "skipped" | "started" | "completed" | "aborted" | "failed";
  runId: string | null;
}
