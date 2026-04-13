# Open Brain 2 Phase 1 Build Results

**Date:** 2026-04-13  
**Status:** Implemented in repo  
**Companion docs:** `architectural_thesis.md`, `OB2_roadmap_v2.md`

## Summary

Phase 1 was implemented as a clean-slate TypeScript/Node monolith with a Postgres-first storage layer, handwritten SQL migrations, a thin CLI, and a reusable fictional test corpus. The repo now proves the core capture-and-store path end to end in code, with the query path intentionally remaining a temporary lexical stub.

## What Was Built

### Repo foundation

- TypeScript/Node project scaffolding with `build`, `check`, `test`, and CLI scripts
- Four-layer structure:
  - domain core
  - app services
  - adapters
  - CLI transport
- Docker Compose configuration for local Postgres 16
- Lightweight `.env` loading for `DATABASE_URL`

### Database and schema

- Handwritten migration at `sql/migrations/001_initial.sql`
- `pg_trgm` enabled for fuzzy entity matching
- Core tables created:
  - `entity`
  - `memory_atom`
  - `entity_link`
  - `consolidation_run`
  - `correction_action`
  - `review_item`
  - `schema_migration`
- Enums created for:
  - `entity_type`
  - `decay_class`
  - `consolidation_status`
  - `run_status`
  - `correction_status`
- Indexes added for atom time lookup, entity lookup, decay class, validity windows, and trigram search
- Top-level category seeding implemented for:
  - work
  - family
  - household
  - vehicles
  - health
  - finance
  - software-projects
  - hobbies
  - travel
  - social

### Domain and app logic

- Core domain types and repository contract implemented
- Validation logic added for:
  - required content and source reference
  - importance and confidence ranges
  - decay class validity
  - timestamp parsing and validity ordering
- `captureMemory` implemented with:
  - replay-safe dedupe on `source_ref` and content fingerprint
  - exact entity match
  - fuzzy trigram entity match at `>= 0.6`
  - null entity fallback when no match is found
  - writes with `consolidation_status = pending`
- `queryMemory` implemented as the intentional Phase 1 lexical placeholder

### Adapters and transport

- Real Postgres repository using parameterized SQL and transaction boundaries for writes
- In-memory repository for fast contract-style tests
- Tiny migration runner added
- CLI commands implemented:
  - `ob db migrate`
  - `ob db reset --force`
  - `ob capture ...`
  - `ob query ...`
  - `ob entity list`
  - `ob entity show <name>`
  - `ob fixtures load <path>`

### Fixtures and tests

- Fictional fixture corpus added in `fixtures/morgan.json`
- Corpus currently contains 46 atoms across multiple domains
- Test coverage added for:
  - validation behavior
  - repository contract behavior
  - replay-safe capture
  - exact/fuzzy/null entity linking
  - fixture loading
  - CLI smoke flow
- Postgres-backed tests are implemented to run when Docker is available locally

## Verification Completed

The following commands were run successfully during implementation:

- `npm install`
- `docker compose up -d postgres`
- `npm run check`
- `npm test`
- `npm run build`

Observed test result in this environment:

- in-memory and pure TypeScript tests passed
- Postgres-backed repository, fixture integration, and CLI smoke suites ran against local Dockerized Postgres and passed
- `npm test` completed with 4 test files passed and 13 tests passed total

## Gaps Between Plan and What Happened

- Docker-backed local verification was completed after the initial implementation pass, confirming the Postgres-dependent suites now run successfully in a local Docker environment.
- The roadmap’s p95 latency target was not benchmarked in this implementation pass.
- Phase 1 did not add separate instrumentation beyond the test suite and straightforward CLI outputs.

## Scope Kept Intentionally Out

The following remain deferred exactly as planned:

- consolidation workflows
- markdown projection and navigable layer generation
- HTTP API
- MCP transport
- reasoning-based retrieval gates
- vector search
- automatic new-entity creation during capture
- supersession and contradiction processing logic

## Recommended Next Move

Proceed to Phase 2 on top of the current foundation rather than reworking Phase 1. The main starting points are:

- keep the schema and repository contract stable
- add the derived markdown projection
- introduce the first real retrieval cascade
- preserve the Morgan fixture corpus as the regression baseline
