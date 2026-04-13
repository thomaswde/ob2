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

export interface QueryMemoryResult {
  atoms: MemoryAtom[];
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
