# Phase 1 Acceptance Criteria (Implemented End State)

This repository now treats the end state from `phase1_parallel_execution_plan.md` as the acceptance contract, standardized on **TypeScript/Node**.

1. All scoped services are implemented and exposed via `MemoryServices` (`captureMemory`, `queryMemory`, `readEntity`, `proposeCorrection`, `runConsolidation`, `export`).
2. Retrieval order guardrail is codified in the query pipeline implementation behavior.
3. Projection artifacts are deterministic and include source citations in the form `[source: memory_atom_id]`.
4. Consolidation/correction flows are replay-safe and preserve locked record protections.
5. Automated acceptance tests cover:
   - Boxster/Wagoneer routing behavior.
   - Mustang cluster aggregation query.
   - Missing Oracle scoped retrieval-shape test.
   - idempotent capture replay tests.
   - consolidation rerun/interruption-safe behavior.
   - deterministic projection golden behavior.

These criteria mirror the plan's Definition of Done and quality gates.
