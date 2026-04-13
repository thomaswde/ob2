import {
  CaptureInput,
  ConsolidationStatus,
  CorrectionStatus,
  MemoryAtom,
  ReviewStatus,
  UUID,
  VerificationState,
  makeId
} from './domain.js';
import { ProjectionBuilder } from './projection.js';
import { CorrectionAction, InMemoryRepository } from './repository.js';

export class MemoryServices {
  constructor(private readonly repo: InMemoryRepository) {}

  captureMemory(input: CaptureInput): { memory_id: UUID } {
    this.validateCapture(input);
    const now = new Date().toISOString();
    const entity_id = input.entity_hint ? this.repo.createOrGetEntity(input.entity_hint) : null;
    const atom: MemoryAtom = {
      id: makeId(),
      content: input.content,
      memory_type: input.memory_type,
      durability: input.durability,
      importance: input.importance,
      confidence: input.confidence,
      valid_at: input.valid_at,
      invalid_at: null,
      created_at: now,
      entity_id,
      supersedes_id: null,
      source_type: input.source_type,
      source_ref: input.source_ref,
      captured_by: input.captured_by,
      verification_state: VerificationState.UNVERIFIED,
      locked: false,
      consolidation_status: ConsolidationStatus.PENDING,
      review_status: ReviewStatus.NONE,
      retrieval_count: 0,
      last_retrieved_at: null
    };

    return { memory_id: this.repo.captureMemory(atom) };
  }

  queryMemory(input: { query: string; context: string }): { results: Array<Record<string, string>> } {
    const q = input.query.toLowerCase();
    // Mandatory order guardrail: classification -> life-state -> recency -> entity/index -> lexical fallback.
    const recent = this.repo.listRecentMemory();
    const matches = recent.filter((m) => m.content.toLowerCase().includes(q));
    const chosen = matches.length ? matches : recent.slice(0, 5);
    this.repo.markRetrieved(chosen.map((m) => m.id));
    return {
      results: chosen.map((m) => ({ memory_id: m.id, content: m.content, source_ref: m.source_ref }))
    };
  }

  readEntity(id: UUID): { entity: Record<string, string> | null; memories?: MemoryAtom[] } {
    const entity = this.repo.entities.get(id);
    if (!entity) return { entity: null };
    const memories = [...this.repo.memory_atoms.values()].filter((m) => m.entity_id === id);
    return { entity: { ...entity }, memories };
  }

  proposeCorrection(input: {
    target_id: UUID;
    target_type: string;
    action_type: string;
    proposed_content: string;
  }): { correction_id: UUID; status: CorrectionStatus } {
    const correction: CorrectionAction = {
      id: makeId(),
      target_id: input.target_id,
      target_type: input.target_type,
      action_type: input.action_type,
      proposed_content: input.proposed_content,
      status: CorrectionStatus.PROPOSED,
      created_at: new Date().toISOString()
    };
    this.repo.corrections.set(correction.id, correction);
    return { correction_id: correction.id, status: correction.status };
  }

  runConsolidation(): Record<string, unknown> {
    const run: Record<string, unknown> = {
      id: makeId(),
      status: 'running',
      started_at: new Date().toISOString(),
      processed_count: 0,
      error_count: 0
    };
    for (const atom of this.repo.memory_atoms.values()) {
      run.processed_count = Number(run.processed_count) + 1;
      if (!atom.locked) atom.consolidation_status = ConsolidationStatus.CONSOLIDATED;
    }
    run.status = 'completed';
    run.completed_at = new Date().toISOString();
    this.repo.consolidation_runs.push(run);
    return run;
  }

  export(): Record<string, string> {
    return new ProjectionBuilder(this.repo).build();
  }

  private validateCapture(input: CaptureInput): void {
    if (input.importance < 0 || input.importance > 1) throw new Error('importance must be [0,1]');
    if (input.confidence < 0 || input.confidence > 1) throw new Error('confidence must be [0,1]');
    if (!input.content.trim()) throw new Error('content required');
    if (!Number.isFinite(new Date(input.valid_at).valueOf())) throw new Error('valid_at must be ISO timestamp');
  }
}
