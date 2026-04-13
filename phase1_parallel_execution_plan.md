# Open Brain 2 — Phase 1 Parallel Implementation Plan

Based on `open_brain_phase1_handoff_spec.md`, this plan decomposes implementation into parallel subagent workstreams with explicit dependencies and integration gates.

## 1. Subagent Topology

Run six subagents in parallel after bootstrap:

1. **A0 — Platform Bootstrap Agent**
   - Repository scaffolding, language/runtime choice, baseline config, migrations framework, CI skeleton.
2. **A1 — Data Model & Persistence Agent**
   - PostgreSQL schema, enums, constraints, idempotent capture primitives, run-state tables.
3. **A2 — Service Contracts Agent**
   - CLI and application service layer implementing `captureMemory`, `queryMemory`, `readEntity`, `proposeCorrection`, `runConsolidation`, `export` contracts.
4. **A3 — Projection & Retrieval Agent**
   - Deterministic markdown projection generation and retrieval pipeline in mandatory order.
5. **A4 — Consolidation/Correction Agent**
   - Consolidation run engine, correction/review state machine, supersession logic, lock handling.
6. **A5 — Acceptance/Replay QA Agent**
   - Acceptance tests (Boxster/Wagoneer, Mustang cluster, Missing Oracle), replay/idempotency tests, failure-handling tests.

## 2. Execution Graph

### Stage 0 (Sequential Foundation)

- **A0** creates project skeleton and interfaces:
  - migration folder layout
  - service interface contracts
  - shared types/enums package
  - CLI command registry
- Deliverable: baseline branch that unblocks all agents.

### Stage 1 (Parallel Core Build)

Run in parallel:

- **A1**: full DB schema + migration scripts + repository layer.
- **A2**: service contract stubs + validation + deterministic I/O behavior.
- **A3**: projection generator and retrieval orchestrator skeleton following required ordering.
- **A4**: consolidation/correction engines with run-state recording.
- **A5**: test harness and fixtures generation.

Dependency notes:
- A2/A3/A4 consume shared types from A0 and database interfaces from A1.
- A5 consumes service interfaces from A2 and fixtures from A1.

### Stage 2 (Parallel Hardening)

Run in parallel after Stage 1 merge:

- **A1** hardens constraints/indexes and duplicate-safe capture keys.
- **A2** enforces contract edge-cases and idempotency semantics.
- **A3** finalizes deterministic artifact rendering and citation formatting.
- **A4** finalizes lock/supersede/review invariants and failure recovery.
- **A5** executes full acceptance matrix and replay/interruption scenarios.

### Stage 3 (Final Integration Gate)

Sequential merge gate:

1. schema compatibility check
2. service contract conformance check
3. retrieval-order enforcement check
4. deterministic projection diff check
5. acceptance tests green

## 3. Detailed Subagent Charters

## A0 — Platform Bootstrap Agent

**Goals**
- Establish baseline architecture for headless CLI system.
- Provide strict module boundaries to keep services deterministic.

**Tasks**
- Create modules: `db`, `services`, `projection`, `consolidation`, `cli`, `tests`.
- Define typed enums for all spec states.
- Add migration runner and seed utility.
- Add CI commands for lint/test.

**Exit Criteria**
- All other agents can run independently using stable interfaces.

## A1 — Data Model & Persistence Agent

**Goals**
- Implement spec tables and constraints exactly.
- Support append-first mutation and replay safety.

**Tasks**
- Create tables:
  - `memory_atom`
  - `entity`
  - `entity_link`
  - `correction_action`
  - `review_item`
  - `consolidation_run`
- Add FK constraints and non-null guards.
- Add indexes for retrieval and recent fetch flows.
- Add dedupe mechanism using stable `source_ref` and/or content fingerprint.
- Add repository methods for append-only writes.

**Exit Criteria**
- Migrations apply cleanly.
- Duplicate-safe capture semantics verified.

## A2 — Service Contracts Agent

**Goals**
- Implement primitive I/O exactly as defined.
- Keep services deterministic and idempotent where applicable.

**Tasks**
- Implement:
  - `captureMemory(input)`
  - `queryMemory(input)`
  - `readEntity(id)`
  - `proposeCorrection(input)`
  - `runConsolidation()`
  - `export()`
- Add strict input validation and typed outputs.
- Ensure no in-place overwrite behavior.
- Add CLI commands mapped 1:1 with service contracts.

**Exit Criteria**
- Contract tests pass for all six services.

## A3 — Projection & Retrieval Agent

**Goals**
- Build deterministic markdown projection layer.
- Enforce mandatory retrieval order.

**Tasks**
- Generate:
  - `/index.md`
  - `/life_state.md`
  - `/entities/{entity_slug}.md`
- Implement citation format: `[source: memory_atom_id]`.
- Implement slug stability strategy.
- Implement retrieval pipeline in strict order:
  1) classification
  2) life-state load
  3) recency fetch
  4) index/entity selection
  5) lexical fallback
- Add guardrail test to assert raw-atom search is never first.

**Exit Criteria**
- Projection rebuilds deterministically from DB snapshots.

## A4 — Consolidation/Correction Agent

**Goals**
- Implement safe background consolidation and correction state flows.

**Tasks**
- Implement `consolidation_run` lifecycle and counters.
- Enforce invariants:
  - no destructive writes
  - supersede over overwrite
  - locked record protection
  - contradiction → `review_item`
- Implement correction states:
  - `proposed -> under_review -> applied | rejected`
- Ensure interrupted runs preserve last known good projection.

**Exit Criteria**
- Consolidation rerun-safe and interruption-safe.

## A5 — Acceptance/Replay QA Agent

**Goals**
- Encode spec acceptance tests and replay guarantees as automated tests.

**Tasks**
- Build fixtures for Boxster/Wagoneer routing behavior.
- Build Mustang cluster aggregation query test.
- Build Missing Oracle scoped retrieval-shape test.
- Add idempotent capture replay tests.
- Add consolidation rerun/interruption tests.
- Add deterministic projection golden-file tests.

**Exit Criteria**
- Full suite green in CI with reproducible outputs.

## 4. Cross-Agent Interfaces

Define shared contracts early and freeze before Stage 1 parallel work:

- `DomainEnums`
- `RepositoryPorts`
- `ServiceIO`
- `ProjectionArtifacts`
- `ConsolidationEvents`
- `TestFixtureSchema`

All agents must consume these interfaces instead of duplicating local models.

## 5. Merge Strategy

- Each agent works on branch `phase1/<agent-name>`.
- Rebase daily against integration branch `phase1/integration`.
- Merge order for minimum conflicts:
  1. A0
  2. A1
  3. A2 + A3 + A4 (can merge in any order after A1)
  4. A5 last (test stabilization)

## 6. Quality Gates (Must Pass)

1. **Schema Gate**: all migrations clean from empty DB.
2. **Contract Gate**: all six service contracts conform exactly.
3. **Retrieval Gate**: mandatory retrieval order asserted.
4. **Projection Gate**: deterministic rebuild with no drift.
5. **Safety Gate**: locked/supersede/review invariants preserved.
6. **Replay Gate**: capture and consolidation reruns produce stable state.
7. **Acceptance Gate**: three named spec scenarios pass.

## 7. Suggested Timeline (Parallelized)

- Day 1: A0 complete; interface freeze.
- Days 2–3: Stage 1 parallel build (A1–A5).
- Day 4: Stage 2 hardening and defect burn-down.
- Day 5: Stage 3 integration gates and release candidate.

## 8. Definition of Done

Phase 1 is complete when:
- all scoped services are implemented,
- retrieval order is enforced,
- projection artifacts are deterministic and cited,
- consolidation/correction behavior is safe and replayable,
- all acceptance tests pass.
