# Open Brain 2

Open Brain 2 is a Postgres-backed personal memory substrate for AI agents. Phase 1 establishes the storage foundation: atomic memory capture, replay-safe ingest, honest entity linking against an entity catalog, a thin CLI, and a reusable fictional fixture corpus for regression testing.

This repo intentionally stops short of consolidation, markdown projection, HTTP, MCP, and LLM-driven retrieval. Those are planned for later phases in [planning_docs/OB2_roadmap_v2.md](/home/vincent/workspace/ob2/planning_docs/OB2_roadmap_v2.md).

## Phase 1 scope

Phase 1 delivers:

- A clean TypeScript/Node codebase with four layers: domain core, app services, adapters, and CLI transport.
- A handwritten Postgres migration that creates the Phase 1 schema and seeds ten top-level memory categories.
- A `captureMemory` flow that validates input, resolves entities by exact match then fuzzy match, dedupes on `(source_ref, content_fingerprint)`, and writes atoms with `consolidation_status = pending`.
- A temporary `queryMemory` stub that does direct lexical lookup over currently-valid atoms.
- A fictional Morgan Chen fixture corpus spanning family, work, vehicles, health, travel, finance, and hobbies.
- Unit and integration-oriented tests, with Postgres-backed suites designed to run when Docker is available locally.

Phase 1 explicitly does not deliver:

- Consolidation or supersession workflows
- The markdown navigable layer
- HTTP or MCP transports
- LLM classification or reasoning-driven retrieval
- Automatic new-entity creation during capture

## Architecture

The code is organized as a small monolith:

- [src/domain](/home/vincent/workspace/ob2/src/domain): core types, repository interface, constants, validation rules
- [src/app](/home/vincent/workspace/ob2/src/app): application services such as capture, query, and fixture loading
- [src/adapters/postgres](/home/vincent/workspace/ob2/src/adapters/postgres): Postgres connection management, migrations, repository implementation
- [src/testing](/home/vincent/workspace/ob2/src/testing): in-memory repository and Postgres test helpers
- [src/cli](/home/vincent/workspace/ob2/src/cli): user-facing command-line transport
- [sql/migrations](/home/vincent/workspace/ob2/sql/migrations): handwritten SQL migrations
- [fixtures](/home/vincent/workspace/ob2/fixtures): reusable seed data

The domain layer owns the contract. Adapters implement the contract. The CLI goes through app services rather than reaching into persistence directly.

## Data model summary

The initial migration creates:

- `entity`: categories and named entities such as people, projects, places, and vehicles
- `memory_atom`: the atomic unit of memory with content, source, confidence, importance, durability, validity windows, and consolidation placeholders
- `entity_link`: reserved for typed relationships between entities
- `consolidation_run`, `correction_action`, `review_item`: schema placeholders for later phases
- `schema_migration`: migration bookkeeping table

Enums currently in use:

- `entity_type`: `category`, `person`, `vehicle`, `project`, `place`, `topic`, `other`
- `decay_class`: `profile`, `preference`, `relationship`, `decision`, `task`, `ephemeral`
- `consolidation_status`, `run_status`, `correction_status` for later-phase workflows

The database also enables `pg_trgm` so entity matching can fall back to trigram similarity during capture.

## Prerequisites

- Node.js 20+
- npm
- Docker with `docker compose` for local Postgres-backed development and full integration verification

Local Postgres defaults:

- database: `ob2`
- user: `ob2`
- password: `ob2`
- port: `54329`

Connection configuration is read from `DATABASE_URL`, with `.env` support via a lightweight built-in loader. Start by copying [.env.example](/home/vincent/workspace/ob2/.env.example) to `.env`.

## Quick start

1. `cp .env.example .env`
2. `npm install`
3. `docker compose up -d postgres`
4. `npm run db:migrate`
5. `npm run fixtures:load`
6. `npm run ob -- entity list`
7. `npm run ob -- query motorcycle`

If you want a clean local database after experimenting:

1. `npm run ob -- db reset --force`
2. `npm run fixtures:load`

## CLI reference

### Database

- `npm run ob -- db migrate`
  Applies any pending SQL migrations and seeds the ten top-level category entities.

- `npm run ob -- db reset --force`
  Truncates application tables, then reseeds the top-level categories. This is intended for local development only.

### Capture and query

- `npm run ob -- capture "Morgan prefers morning flights" --entity "Morgan Chen" --decay preference --importance 0.7`
  Captures a new atom. Optional flags:
  `--entity`, `--decay`, `--importance`, `--confidence`, `--source-ref`, `--source-agent`, `--valid-at`, `--invalid-at`

- `npm run ob -- query motorcycle`
  Runs the Phase 1 lexical query stub over currently-valid atoms.

### Entity inspection

- `npm run ob -- entity list`
  Lists all known entities with type and slug.

- `npm run ob -- entity show "Morgan Chen"`
  Shows the entity record and any linked atoms.

### Fixtures

- `npm run ob -- fixtures load fixtures/morgan.json`
  Loads the fictional Morgan Chen corpus. The loader is replay-safe because capture dedupes on `source_ref` plus content fingerprint.

## Development notes

### Entity linking behavior

Capture currently resolves entities in this order:

1. Exact name match
2. Fuzzy trigram similarity match at `>= 0.6`
3. No match, which stores the atom with `entity_id = null`

Phase 1 does not create new entities from loose hints. That work is intentionally deferred so consolidation can own entity creation and clustering later.

### Query behavior

`queryMemory` is a Phase 1 scaffolding path. It does a direct lexical search over `memory_atom.content` and filters out atoms whose `invalid_at` has already passed. It is present to prove end-to-end storage and retrieval plumbing, not as the long-term retrieval architecture.

### Fixtures

The fixture corpus lives in [fixtures/morgan.json](/home/vincent/workspace/ob2/fixtures/morgan.json). It includes:

- top-level personal profile facts
- family and schedule constraints
- vehicle ownership and maintenance
- work projects and engineering preferences
- travel, finance, health, and social context

This dataset is meant to stay useful in later phases, so it favors realistic cross-domain context over minimal setup.

## Testing

Available commands:

- `npm run check`
- `npm test`
- `npm run build`

Test layout:

- [test/validation.test.ts](/home/vincent/workspace/ob2/test/validation.test.ts): capture validation rules
- [test/repository.contract.test.ts](/home/vincent/workspace/ob2/test/repository.contract.test.ts): shared repository behavior against in-memory and Postgres implementations
- [test/fixtures.integration.test.ts](/home/vincent/workspace/ob2/test/fixtures.integration.test.ts): migration and fixture loading checks
- [test/cli.smoke.test.ts](/home/vincent/workspace/ob2/test/cli.smoke.test.ts): end-to-end CLI flow

Important: the Postgres-backed tests are designed to run when `docker compose` is available. In environments without Docker, those suites skip automatically so the pure TypeScript validation and in-memory tests can still run.

## Known limitations

- The README documents the intended Docker-backed local workflow, but this particular implementation session ran in an environment without Docker or Postgres binaries, so the Postgres integration path could not be executed here.
- `entity show` looks up entities by exact name.
- Query results are not yet ranked by importance, recency, or contextual utility beyond a simple created-at sort.
- Schema tables for consolidation and correction exist, but no runtime flows populate them yet.

## Next steps

The next major milestone is Phase 2: introduce the derived markdown projection, life-state artifact, and the first real retrieval cascade. The implementation plan for that work should build on the storage and fixture foundation delivered here rather than replacing it.
