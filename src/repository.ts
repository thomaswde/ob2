import { CorrectionStatus, Entity, MemoryAtom, makeId, UUID } from './domain.js';

export interface CorrectionAction {
  id: UUID;
  target_id: UUID;
  target_type: string;
  action_type: string;
  proposed_content: string;
  status: CorrectionStatus;
  created_at: string;
}

export class InMemoryRepository {
  memory_atoms = new Map<UUID, MemoryAtom>();
  entities = new Map<UUID, Entity>();
  entity_by_slug = new Map<string, UUID>();
  corrections = new Map<UUID, CorrectionAction>();
  consolidation_runs: Array<Record<string, unknown>> = [];
  private dedupe = new Map<string, UUID>();

  captureMemory(atom: MemoryAtom): UUID {
    const key = `${atom.source_ref}::${atom.content.trim()}`;
    const existing = this.dedupe.get(key);
    if (existing) return existing;
    this.memory_atoms.set(atom.id, atom);
    this.dedupe.set(key, atom.id);
    return atom.id;
  }

  createOrGetEntity(name: string, type = 'generic'): UUID {
    const slug = name.trim().toLowerCase().replaceAll(' ', '-');
    const existing = this.entity_by_slug.get(slug);
    if (existing) return existing;
    const now = new Date().toISOString();
    const entity: Entity = { id: makeId(), name, type, created_at: now, updated_at: now };
    this.entities.set(entity.id, entity);
    this.entity_by_slug.set(slug, entity.id);
    return entity.id;
  }

  listRecentMemory(): MemoryAtom[] {
    return [...this.memory_atoms.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  markRetrieved(ids: UUID[]): void {
    const now = new Date().toISOString();
    ids.forEach((id) => {
      const atom = this.memory_atoms.get(id);
      if (!atom) return;
      atom.retrieval_count += 1;
      atom.last_retrieved_at = now;
    });
  }
}
