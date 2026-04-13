export type UUID = string;

export enum MemoryType {
  FACT = 'fact',
  PREFERENCE = 'preference',
  TASK = 'task',
  NOTE = 'note'
}

export enum Durability {
  EPHEMERAL = 'ephemeral',
  SESSION = 'session',
  LONG_TERM = 'long_term'
}

export enum SourceType {
  USER = 'user',
  SYSTEM = 'system',
  IMPORT = 'import'
}

export enum VerificationState {
  UNVERIFIED = 'unverified',
  VERIFIED = 'verified',
  DISPUTED = 'disputed'
}

export enum ConsolidationStatus {
  PENDING = 'pending',
  CONSOLIDATED = 'consolidated',
  NEEDS_REVIEW = 'needs_review'
}

export enum ReviewStatus {
  NONE = 'none',
  OPEN = 'open',
  CLOSED = 'closed'
}

export enum CorrectionStatus {
  PROPOSED = 'proposed',
  UNDER_REVIEW = 'under_review',
  APPLIED = 'applied',
  REJECTED = 'rejected'
}

export interface MemoryAtom {
  id: UUID;
  content: string;
  memory_type: MemoryType;
  durability: Durability;
  importance: number;
  confidence: number;
  valid_at: string;
  invalid_at: string | null;
  created_at: string;
  entity_id: UUID | null;
  supersedes_id: UUID | null;
  source_type: SourceType;
  source_ref: string;
  captured_by: string;
  verification_state: VerificationState;
  locked: boolean;
  consolidation_status: ConsolidationStatus;
  review_status: ReviewStatus;
  retrieval_count: number;
  last_retrieved_at: string | null;
}

export interface Entity {
  id: UUID;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface CaptureInput {
  content: string;
  memory_type: MemoryType;
  durability: Durability;
  importance: number;
  confidence: number;
  valid_at: string;
  entity_hint?: string | null;
  source_type: SourceType;
  source_ref: string;
  captured_by: string;
}

export const makeId = (): UUID => crypto.randomUUID();
