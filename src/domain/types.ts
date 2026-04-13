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
  metadata: Record<string, unknown>;
}

export interface CreateEntityInput {
  id: string;
  name: string;
  slug: string;
  type: EntityType;
  parentEntityId: string | null;
}
