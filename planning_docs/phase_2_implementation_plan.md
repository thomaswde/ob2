# Open Brain 2 Phase 2 Implementation Plan

**Date:** 2026-04-13  
**Branch:** `codex/phase-2-implementation-plan-2026-04-13`  
**Companion docs:** `planning_docs/OB2_roadmap_v2.md`, `planning_docs/phase_1_build_results.md`

## Review Outcome

This repo is not at the Phase 2 entry state described in the roadmap. A substantial Phase 2 slice is already implemented:

- `ProjectionRebuilder` exists and writes a deterministic `memory/` tree
- `LanguageModel` injection exists with Claude Sonnet and stub implementations
- `MemoryQueryService` already runs Gate 0, Gate 1, Gate 1.5, Gate 2, and Gate 3
- CLI support exists for `ob project rebuild` and `ob query`
- the current test suite passes end to end: `21/21` tests green on this branch

That means Phase 2 work here should be treated as **gap-closing and hardening**, not a fresh implementation.

## Current State vs. Roadmap

### Already aligned

- Mechanical projection rebuild with atomic temp-directory swap
- Life-state file and per-entity markdown files with source citations
- Query response bundle with gate instrumentation
- Recency bridge based on latest completed consolidation timestamp
- Gate 0 memory classification through the LLM seam
- Gate 2 entity selection through the markdown index
- Gate 3 lexical fallback
- deterministic stubbed tests for retrieval behavior

### Gaps still worth addressing

1. Gate 3 does not yet match the roadmap closely enough.
   The roadmap calls for trigram search over valid atoms with importance and recency re-ranking. The current Postgres implementation uses `ILIKE '%query%'`, and the in-memory repository uses plain substring matching.

2. Exit-criteria coverage is incomplete.
   Existing tests cover deterministic projection, Gate 0, recency bridging, and file-cache invalidation, but they do not explicitly prove:
   - Gate 2 answers a known entity query without using Gate 3
   - Gate 3 rescues a weak-vocabulary query that Gate 2 misses
   - the returned bundle stays within the intended token envelope across larger result sets

3. Projection behavior should be hardened for non-happy-path corpus growth.
   The current life-state grouping uses only entities already loaded for the index build. That is fine for the fixture corpus, but it can mis-group atoms as `uncategorized` if the entity is outside the index cap or absent from the current projection set.

4. Documentation is behind the code.
   The README still contains language that implies markdown projection and reasoning retrieval are not yet delivered, even though both now exist in the repo.

5. Performance targets are unverified.
   The roadmap sets a p95 query target under 3 seconds including LLM calls, but there is no benchmark or lightweight timing harness yet.

## Implementation Plan

### Workstream 1: Align Gate 3 with the roadmap

Goal: make lexical fallback behave like the intended Phase 2 design, not a temporary substring search.

Tasks:

- Update `PostgresRepository.searchValidAtomsLexical()` to use trigram similarity on `memory_atom.content`
- rank fallback results by a composite of lexical score, importance, and recency
- keep validity filtering in place
- update the in-memory repository to approximate the same ranking behavior so tests exercise the same semantics

Definition of done:

- weak-vocabulary fallback queries return relevant atoms even when exact substring matching would fail
- repository behavior remains deterministic in tests

### Workstream 2: Close the missing Phase 2 tests

Goal: make the roadmap exit criteria executable.

Tasks:

- add a test proving Gate 2 answers `what vehicles do I own` from entity files without firing Gate 3
- add a test proving Gate 3 handles a weaker lexical cue than Gate 2 can resolve
- add a test that verifies result trimming keeps assembled context under the hard cap
- keep the existing recency-bridge and general-knowledge tests as the base regression suite

Definition of done:

- `test/phase2.integration.test.ts` covers each gate’s intended responsibility clearly
- failures point to a specific regression instead of a general “query broke” symptom

### Workstream 3: Harden projection edge cases

Goal: preserve deterministic, browsable output as the corpus grows.

Tasks:

- decouple life-state grouping from the limited index entity list
- verify stable sort order for entity files and life-state sections
- confirm the 200-entry index cap remains deterministic when the corpus exceeds the limit

Definition of done:

- projection output remains byte-stable across rebuilds
- category grouping does not silently degrade when more entities are added

### Workstream 4: Refresh docs and operator guidance

Goal: make the repo documentation match the implementation.

Tasks:

- update `README.md` Phase 2 status language
- add a short “what is finished vs. what is still Phase 3” section
- record this review outcome so future work does not re-plan already completed features

Definition of done:

- a new contributor can read the README and understand the repo’s real current milestone

### Workstream 5: Add lightweight performance visibility

Goal: verify the roadmap target instead of assuming it.

Tasks:

- add simple timing instrumentation around `MemoryQueryService.query()`
- expose per-gate timings in test/debug mode or log output
- add one repeatable local benchmark script or test helper against the Morgan fixtures

Definition of done:

- we can measure whether the current Phase 2 pipeline is comfortably inside the 3-second budget
- later Phase 3 regressions have a baseline to compare against

## Recommended Execution Order

1. Align Gate 3 retrieval semantics
2. Add the missing gate-specific tests
3. Harden projection grouping and determinism edge cases
4. Refresh README and planning docs
5. Add lightweight timing and a repeatable benchmark pass

This order keeps correctness ahead of docs and observability, while still leaving Phase 2 with a cleaner handoff into Phase 3.

## Files Likely To Change

- `src/adapters/postgres/PostgresRepository.ts`
- `src/testing/inMemoryRepository.ts`
- `src/app/MemoryQueryService.ts`
- `src/app/ProjectionRebuilder.ts`
- `test/phase2.integration.test.ts`
- `README.md`

## Acceptance Checklist

- `npm test` stays green
- Gate 2 and Gate 3 responsibilities are explicitly covered by tests
- lexical fallback uses similarity-based matching instead of exact substring-only matching
- projection rebuild remains deterministic
- docs describe the repo as Phase 2-in-progress or Phase 2-hardened, not Phase 1 plus aspirations

## Recommendation

Proceed with a short Phase 2 hardening pass on this branch rather than starting another greenfield implementation. The architecture is already in place; the highest-value work now is making retrieval behavior, tests, and docs match the roadmap precisely enough that Phase 3 can build on a trustworthy base.
