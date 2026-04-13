import { describe, expect, it } from 'vitest';
import { Durability, MemoryType, SourceType } from '../src/domain.js';
import { InMemoryRepository } from '../src/repository.js';
import { MemoryServices } from '../src/services.js';

const makeSvc = () => new MemoryServices(new InMemoryRepository());

function capture(svc: MemoryServices, content: string, sourceRef: string, entityHint?: string): string {
  return svc.captureMemory({
    content,
    memory_type: MemoryType.FACT,
    durability: Durability.LONG_TERM,
    importance: 0.8,
    confidence: 0.9,
    valid_at: new Date().toISOString(),
    entity_hint: entityHint,
    source_type: SourceType.USER,
    source_ref: sourceRef,
    captured_by: 'test'
  }).memory_id;
}

describe('Phase 1 acceptance/replay', () => {
  it('Boxster/Wagoneer routing behavior', () => {
    const svc = makeSvc();
    capture(svc, 'I own a Porsche Boxster', 's1', 'Porsche Boxster');
    capture(svc, 'Family SUV is a Jeep Wagoneer', 's2', 'Jeep Wagoneer');
    const out = svc.queryMemory({ query: 'Wagoneer', context: 'routing' });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].content).toContain('Wagoneer');
  });

  it('Mustang cluster aggregation query', () => {
    const svc = makeSvc();
    capture(svc, 'I test drove a Mustang GT', 'm1', 'Ford Mustang');
    capture(svc, 'Mustang insurance quote arrived', 'm2', 'Ford Mustang');
    capture(svc, 'Mustang maintenance is due', 'm3', 'Ford Mustang');
    expect(svc.queryMemory({ query: 'Mustang', context: 'cluster' }).results).toHaveLength(3);
  });

  it('Missing Oracle scoped retrieval shape', () => {
    const svc = makeSvc();
    capture(svc, 'Road trip next month', 'o1');
    const out = svc.queryMemory({ query: 'oracle', context: 'missing' });
    expect(out.results).toHaveLength(1);
  });

  it('idempotent capture replay', () => {
    const svc = makeSvc();
    const a = capture(svc, 'Same memory', 'dup');
    const b = capture(svc, 'Same memory', 'dup');
    expect(a).toBe(b);
  });

  it('consolidation rerun safety + locked protection', () => {
    const repo = new InMemoryRepository();
    const svc = new MemoryServices(repo);
    capture(svc, 'Locked memory', 'l1');
    const atom = [...repo.memory_atoms.values()][0];
    atom.locked = true;
    const r1 = svc.runConsolidation();
    const r2 = svc.runConsolidation();
    expect(r1.processed_count).toBe(1);
    expect(r2.processed_count).toBe(1);
    expect(atom.locked).toBe(true);
  });

  it('deterministic projection output', () => {
    const svc = makeSvc();
    capture(svc, 'Alpha', 'a1', 'Entity A');
    capture(svc, 'Beta', 'a2', 'Entity A');
    const p1 = svc.export();
    const p2 = svc.export();
    expect(p1).toEqual(p2);
    expect(p1['index.md']).toBeTruthy();
    expect(p1['life_state.md']).toBeTruthy();
    expect(p1['entities/entity-a.md']).toBeTruthy();
  });
});
