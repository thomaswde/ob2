# Open Brain 2 Phase 3 Implementation Plan

**Date:** 2026-04-13
**Branch:** `codex/phase-3-implementation-plan-2026-04-13`
**Companion docs:** `planning_docs/OB2_roadmap_v2.md`, `planning_docs/phase_2_implementation_plan.md`

## Review Outcome

This repo is in a solid Phase 2 state and is a reasonable base for Phase 3.

Already present:

- Phase 1 storage foundation, migrations, fixture loading, and replay-safe capture
- deterministic projection rebuild via `ProjectionRebuilder`
- `LanguageModel` seam with Anthropic and stub implementations
- Phase 2 retrieval cascade in `MemoryQueryService`
- CLI support for capture, query, projection rebuild, fixtures, and DB maintenance
- integration-style tests covering projection determinism and retrieval gates

Not yet present:

- consolidation runner or run lifecycle management
- LLM-driven classification/linking/supersession logic
- synthesis-driven entity summaries and life-state compilation
- correction proposal/application flow
- circuit breaker, system disable flag, or locked-atom handling
- CLI surface for consolidation and correction review

Phase 3 here should therefore be treated as a real implementation phase, not a cleanup pass.

## Current Gaps Against The Roadmap

### 1. The repository contract is too narrow for consolidation

`Repository` currently supports capture, lookup, projection reads, and lexical query support. Phase 3 needs new persistence operations for:

- listing pending atoms and changed entities
- creating and updating consolidation runs
- updating atom consolidation state, `entity_id`, `supersedes_id`, and `invalid_at`
- reading and writing `review_item`, `correction_action`, and `entity_link`
- honoring locked atoms and reading system-wide consolidation state

This is the biggest architectural prerequisite because almost all Phase 3 logic belongs in app services, not in raw CLI code.

### 2. The projection layer needs to split into mechanical and synthesized modes

`ProjectionRebuilder` currently owns deterministic markdown generation directly from repository reads. Phase 3 needs:

- reuse of its atomic directory-swap behavior
- replacement of simple summary generation with LLM-backed synthesis for changed entities
- partial index updates for changed entities, while still supporting a full rebuild fallback
- a life-state compiler that regenerates from current active atoms after consolidation

The current class is a good foundation, but it should become lower-level projection-writing infrastructure rather than the only projection strategy.

### 3. The LLM seam is missing the structured outputs Phase 3 needs

The current `LanguageModel` interface supports:

- `classify`
- `summarize`
- `extract`

Phase 3 needs at least three more structured tasks:

- atom consolidation classification/linking against candidate entities
- contradiction/supersession assessment within an entity cluster
- entity-summary synthesis with explicit `[source: <atom_id>]` citations

The cleanest path is to keep the small interface shape but broaden the schema types rather than let app services prompt raw strings ad hoc.

### 4. Correction and review workflows are schema-only today

The SQL schema already has `correction_action` and `review_item`, but there is no domain model, repository support, app service, or CLI path that uses them. Phase 3 needs these to become real workflows, not placeholders.

### 5. Tests do not yet cover the Phase 3 failure modes

The current suite proves Phase 2 behavior well, but Phase 3’s value depends on controlled failure handling:

- low-confidence run abort
- atomic projection preservation during interrupted compile
- contradiction detection producing review items
- locked atoms remaining immutable
- idempotent no-op consolidation reruns

Those need dedicated test scaffolding before the runner is considered trustworthy.

## Implementation Plan

### Workstream 1: Expand the domain model and repository contract

Goal: make the Phase 3 workflows expressible in the app layer without smuggling SQL concerns upward.

Tasks:

- extend `src/domain/types.ts` with:
  - consolidation run records
  - correction action records
  - review item records
  - system state records
  - typed LLM classification/synthesis payloads
- expand `src/domain/repository.ts` to support:
  - listing pending atoms
  - listing atoms by entity cluster, including active and superseded atoms
  - updating atom consolidation fields
  - creating and completing consolidation runs
  - recording review items and correction actions
  - querying and toggling consolidation enablement
- implement the new contract in:
  - `src/adapters/postgres/PostgresRepository.ts`
  - `src/testing/inMemoryRepository.ts`

Definition of done:

- every Phase 3 write path is representable as a repository method
- app services do not need raw SQL knowledge
- in-memory and Postgres repositories stay behaviorally aligned

### Workstream 2: Add the missing schema support for Phase 3 control flow

Goal: make the database match the roadmap’s runtime requirements.

Tasks:

- add a new migration for:
  - `memory_atom.locked BOOLEAN NOT NULL DEFAULT false`
  - `system_state` table for consolidation disablement and consecutive abort tracking
  - any missing fields needed on `consolidation_run`, `correction_action`, or `review_item` to record confidence/error details cleanly
- keep the migration additive and backward-compatible with the existing Phase 2 schema

Definition of done:

- the schema supports locked atoms, circuit breaker state, and richer run auditing
- a fresh migrate produces the complete Phase 3 storage surface

### Workstream 3: Broaden the `LanguageModel` seam for consolidation

Goal: keep LLM-dependent logic testable and deterministic.

Tasks:

- extend `src/domain/languageModel.ts` with typed structured tasks for:
  - consolidation classification/linking
  - contradiction/supersession decisions
  - entity summary synthesis
  - life-state synthesis if needed
- update:
  - `src/adapters/llm/StubLanguageModel.ts`
  - `src/adapters/llm/ClaudeSonnetLanguageModel.ts`
- make the stub configurable so tests can simulate:
  - normal successful runs
  - contradictions
  - supersession
  - low-confidence failures

Definition of done:

- Phase 3 services can be fully tested against deterministic LLM outputs
- the production model implementation remains behind the same interface

### Workstream 4: Implement the consolidation runner as an app service

Goal: land the four-phase consolidation cycle in the application layer.

Tasks:

- add a new app service, likely `src/app/ConsolidationService.ts`, that runs:
  - Phase A: orient
  - Phase B: classify and link
  - Phase C: compile
  - Phase D: prune and audit
- ensure Phase B logic:
  - limits candidate matching to likely-category entities
  - never mutates locked atoms
  - writes supersession chains non-destructively
  - creates review items instead of silently resolving contradictions
- ensure Phase D:
  - records run counts and notes
  - surfaces duplicate/orphan candidates as review items
  - only swaps in the new projection tree on successful completion

Definition of done:

- a single app service owns the full consolidation workflow
- the workflow is restartable and auditable
- unchanged reruns are effectively no-ops apart from run logging

### Workstream 5: Refactor projection generation for synthesized output

Goal: preserve the existing atomic projection behavior while upgrading content quality.

Tasks:

- refactor `ProjectionRebuilder` into reusable projection-writing helpers or a lower-level writer
- add a synthesis-oriented compiler that:
  - rewrites changed entity files with coherent narratives and source citations
  - updates `index.md` entries for changed entities
  - regenerates `life_state.md` from current active atoms
- keep a full rebuild code path available for recovery/testing

Definition of done:

- entity summaries are no longer simple concatenations
- projection writes are still atomic and deterministic given the same synthesized inputs
- interrupted runs preserve the prior `memory/` tree

### Workstream 6: Implement correction and review workflows

Goal: make correction handling operational in Phase 3, not merely modeled in SQL.

Tasks:

- add `proposeCorrection` app logic
- model the state machine:
  - `proposed`
  - `under_review`
  - `applied`
  - `rejected`
- implement auto-apply for obvious high-confidence same-field supersession patterns
- implement manual review paths for ambiguous corrections

Definition of done:

- corrections enter the system as durable rows
- consolidation can pick them up and apply them as new atoms
- ambiguous corrections remain reviewable rather than silently applied

### Workstream 7: Extend the CLI for Phase 3 operations

Goal: expose the new workflows through the existing transport.

Tasks:

- add CLI commands for:
  - `ob consolidate`
  - `ob consolidate --force-enable`
  - `ob corrections list`
  - `ob corrections apply <id>`
  - optionally `ob corrections propose ...` if we want a direct local operator path now
- update formatting helpers in `src/cli/format.ts` for runs, review items, and corrections

Definition of done:

- a user can run and inspect the full Phase 3 workflow from the CLI
- the CLI remains thin and delegates business logic to app services

### Workstream 8: Build the Phase 3 test suite before declaring it done

Goal: lock the roadmap exit criteria into executable tests.

Tasks:

- add service-level or integration-style tests for:
  - successful first consolidation of the Morgan fixtures
  - idempotent rerun on unchanged data
  - supersession of employment facts
  - contradiction review item creation
  - locked atom preservation
  - circuit breaker abort on low confidence
  - interrupted compile preserving the previous projection
- keep using the in-memory repository plus stub LLM for fast deterministic coverage
- add Postgres-backed verification where behavior depends on SQL semantics

Definition of done:

- the Phase 3 roadmap exit criteria are represented directly in tests
- consolidation failures are deliberate and observable, not silent

## Recommended Execution Order

1. Expand types, repository contracts, and schema support
2. Broaden the `LanguageModel` seam and configurable stub
3. Implement the consolidation service phases A and B
4. Refactor projection writing and land phases C and D
5. Add correction workflows and CLI commands
6. Finish the failure-mode and idempotency test matrix
7. Refresh README and operational docs once behavior is stable

This order keeps the core workflow and persistence seams ahead of transport polish and documentation.

## Files Likely To Change

- `sql/migrations/*`
- `src/domain/types.ts`
- `src/domain/repository.ts`
- `src/domain/languageModel.ts`
- `src/adapters/postgres/PostgresRepository.ts`
- `src/adapters/llm/StubLanguageModel.ts`
- `src/adapters/llm/ClaudeSonnetLanguageModel.ts`
- `src/testing/inMemoryRepository.ts`
- `src/app/ProjectionRebuilder.ts`
- new Phase 3 app services under `src/app/`
- `src/cli/index.ts`
- `src/cli/format.ts`
- new and updated tests under `test/`

## Risks To Manage

- Phase 3 touches every layer except the transport boundary, so contract drift between in-memory and Postgres implementations is the main delivery risk.
- Citation integrity is easy to weaken during LLM synthesis; tests should validate that every narrative claim line includes `[source: <atom_id>]`.
- Circuit-breaker behavior needs to fail closed. Preserving the old projection is more important than partially finishing a run.
- Correction auto-apply logic should start narrow. It is safer to route ambiguous cases into `under_review` than to overfit early heuristics.

## Recommendation

Proceed with Phase 3 as a multi-step implementation on this branch, starting with contract and schema expansion rather than the runner itself. The repo already has the right architectural seams for this, but the consolidation engine will only stay maintainable if we preserve the current layering and make the new structured LLM outputs and repository operations explicit first.
