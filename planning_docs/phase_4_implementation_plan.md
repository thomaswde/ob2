# Open Brain 2 Phase 4 Implementation Plan

**Date:** 2026-04-13  
**Companion docs:** `planning_docs/OB2_roadmap_v2.md`, `planning_docs/phase_3_implementation_plan.md`

## Readiness Confirmation

Phase 4 is ready to begin in this repository.

Evidence from the current codebase:

- Phase 3 functionality is implemented, not just planned:
  - `ConsolidationService` exists and supports manual consolidation, correction handling, circuit-breaker state, and force re-enable.
  - `ConsolidatedProjectionCompiler` and the Phase 3 test suite are present.
  - CLI commands already expose `consolidate` and `corrections`.
- Core layering is intact:
  - domain contract in `src/domain`
  - Postgres adapter in `src/adapters/postgres`
  - app services in `src/app`
  - CLI transport in `src/cli`
- Verification passed on 2026-04-13:
  - `npm run build` succeeded
  - `npm test` succeeded
  - all 33 tests passed, including `test/phase3.integration.test.ts`

That satisfies the roadmap's practical entry bar for Phase 4: the local system works, manual consolidation exists, and it is tested enough to automate cautiously.

## Current Gaps Against The Phase 4 Roadmap

### 1. There is no transport surface beyond the CLI

The repo currently has no HTTP server, no route handlers, no auth middleware, and no MCP server process. The app layer is in good shape for this, but no network transport exists yet.

### 2. The service contracts are implicit rather than packaged

The app services are importable by file path, but there is no deliberate library entrypoint such as `import { MemoryServices } from "open-brain"`. Phase 4 should formalize this so local in-process agents can skip HTTP cleanly.

### 3. Phase 4 observability tables are missing

The roadmap calls for:

- `request_log` for API observability
- `notifications` for aborted automated consolidations

Neither exists yet in the schema.

### 4. Environment config is not yet transport-aware

`src/config/env.ts` currently covers:

- `DATABASE_URL`
- Anthropic settings
- stub-LLM toggle

Phase 4 needs config for bearer auth, API bind host/port, client IDs, consolidation thresholds, and scheduler behavior.

### 5. Automation and locking around scheduled consolidation do not exist yet

Manual consolidation is implemented, but there is currently no:

- scheduler integration
- pending-count trigger
- file lock or cross-process guard
- notification write on automated failure

### 6. Export exists in the roadmap but not in runtime code

The Phase 4 transport plan includes `GET /export`, but there is no export service or CLI implementation yet. This is a dependency for the HTTP and MCP surface if we want the six endpoints to map honestly to real service contracts.

## Implementation Plan

### Workstream 1: Formalize the app-service facade and library entrypoint

Goal: make the existing services reusable from CLI, HTTP, MCP, and in-process callers without transport-specific wiring duplicated everywhere.

Tasks:

- add a small service container, likely `src/app/MemoryServices.ts`, that wires:
  - repository
  - language model
  - query service
  - consolidation service
  - capture and correction operations
- add a package entrypoint, likely `src/index.ts`, exporting the main service facade and core domain types
- update the CLI to consume the shared service facade rather than constructing dependencies ad hoc

Definition of done:

- one composition path is shared by CLI and future transports
- local agents can import the library cleanly
- transport layers stay thin

### Workstream 2: Add the Phase 4 schema and config surface

Goal: land the storage and config needed for HTTP observability and automated operations.

Tasks:

- add a migration for:
  - `request_log`
  - `notifications`
- define typed domain models and repository methods for:
  - writing request logs
  - writing and listing notifications
- extend `src/config/env.ts` with:
  - `OB2_API_TOKEN`
  - `OB2_API_HOST`
  - `OB2_API_PORT`
  - `OB2_PENDING_CONSOLIDATION_THRESHOLD`
  - `OB2_AUTOMATION_ENABLED`
  - optional per-client token metadata if we want lightweight client attribution now

Definition of done:

- the database supports Phase 4 observability data
- transport and scheduler code can load all required configuration from one place

### Workstream 3: Introduce the HTTP API

Goal: expose the existing app contracts over localhost with minimal operational complexity.

Recommended choice: Fastify. It matches the roadmap, keeps route definitions clean, and will make auth/logging hooks easier than raw `http`.

Tasks:

- add an HTTP server module, likely under `src/transports/http/`
- implement the six roadmap endpoints:
  - `POST /capture`
  - `POST /query`
  - `GET /entity/:id`
  - `POST /correction`
  - `POST /consolidate`
  - `GET /export`
- add bearer-token auth for all endpoints
- bind to localhost by default
- translate domain/app errors into stable HTTP status codes and JSON error bodies
- add OpenAPI output, either generated from route schemas or maintained by hand in a checked-in spec

Definition of done:

- localhost clients can call all six endpoints with bearer auth
- the API is a thin wrapper over app services rather than a second business-logic layer
- the contract is documented in OpenAPI

### Workstream 4: Add request logging and gate trace capture

Goal: preserve the data needed for later Phase 5 tuning decisions.

Tasks:

- log every HTTP request to `request_log` with at least:
  - request ID
  - route
  - client ID
  - status code
  - duration
  - timestamp
- for query requests, also persist the retrieval trace already computed by `MemoryQueryService`
- define a compact JSONB shape for per-request metadata instead of over-normalizing early

Definition of done:

- every API request is durably logged
- query requests retain enough gate-level detail to analyze retrieval behavior later

### Workstream 5: Implement export as a real app service

Goal: make `GET /export` honest and keep portability work aligned with the roadmap.

Tasks:

- add an export service that produces:
  - a SQL dump or structured database export artifact
  - the full `memory/` tree
  - a small manifest/README with schema version and export timestamp
- add a CLI command for local operator use, even if the roadmap introduces export mainly via HTTP
- make the HTTP endpoint stream or return a file path/archive descriptor rather than reconstructing export logic inline

Definition of done:

- export exists as a transport-independent service
- CLI and HTTP both use the same implementation

### Workstream 6: Add automated consolidation orchestration

Goal: promote the existing manual consolidation flow into safe background automation.

Tasks:

- add a consolidation orchestrator that can be called after capture and by a scheduler
- implement pending-count threshold logic using repository-backed counts
- add a file-based lock so concurrent triggers collapse into one run
- honor `system_state.consolidation_enabled`
- on automated abort/failure, write a row to `notifications`
- keep manual `ob consolidate` behavior intact and explicit

Definition of done:

- threshold-triggered consolidation runs at most once for overlapping triggers
- disabled circuit-breaker state suppresses automated runs
- failures are recorded for operators to inspect

### Workstream 7: Ship the scheduler and operator docs

Goal: make the 05:00 local run real without burying critical operational assumptions in code.

Tasks:

- choose one first-class scheduler target for this repo:
  - recommend cron on Linux/dev environments for the first implementation
- add a checked-in setup script or documented cron entry that invokes the CLI
- document:
  - required env vars
  - expected working directory
  - log location
  - lock-file behavior
  - re-enable flow after circuit-breaker disablement
- add Cloudflare tunnel documentation for the externally exposed subset of routes

Definition of done:

- a local operator can enable the daily run without reverse-engineering the app
- the deployment posture is documented clearly enough for future-you

### Workstream 8: Add the MCP shim as a separate optional process

Goal: expose the same six operations for MCP-aware agents while keeping HTTP as the real integration surface.

Tasks:

- add an MCP server process under `src/transports/mcp/`
- have each MCP tool call the localhost HTTP API rather than the app layer directly
- include the intended tool guidance in tool descriptions
- keep the MCP process optional and independently runnable

Definition of done:

- an MCP client can capture and query end-to-end through the shim
- transport behavior stays aligned because MCP proxies HTTP rather than reimplementing business rules

### Workstream 9: Build the Phase 4 verification suite

Goal: codify the roadmap exit criteria before transport work sprawls.

Tasks:

- add HTTP integration tests for:
  - auth rejection
  - successful capture/query/entity/correction/consolidate/export flows
  - request-log writes
- add automation tests for:
  - threshold-triggered consolidation
  - lock-file suppression of duplicate runs
  - notification writes on automated abort
- add MCP smoke coverage for:
  - server startup
  - one capture
  - one query

Definition of done:

- the roadmap exit criteria have executable coverage
- automation risks are tested, not inferred

## Recommended Delivery Order

1. Shared app-service facade and package entrypoint
2. Phase 4 migration plus config expansion
3. Export service
4. HTTP API with auth and request logging
5. Automated consolidation orchestration
6. Scheduler docs/setup
7. MCP shim
8. End-to-end verification polish

This order keeps the real dependency chain intact: shared contracts first, then schema/config, then HTTP, then automation, then MCP as a thin wrapper over the stable HTTP layer.

## Risks To Watch

- `GET /export` is the most likely scope trap because the roadmap defines it before Phase 5 portability work is fully fleshed out. Keep the first version intentionally simple and transport-neutral.
- Request logging can become an accidental second analytics system if overdesigned. A single append-only table with JSONB metadata is enough for Phase 4.
- Automated consolidation should never bypass the Phase 3 circuit breaker or projection atomicity guarantees. Reuse the existing service, do not fork the logic.
- MCP should remain a proxy layer. If it grows its own business logic, Phase 4 will create two integration surfaces that drift.

## Exit Criteria For This Repo

Phase 4 should be considered complete here when:

- the HTTP API is available on localhost with bearer auth
- every route writes a request log entry
- export exists as a real service behind CLI and HTTP
- automated consolidation can run on a timer and on pending-count threshold with a concurrency guard
- automated failures write notifications
- an MCP client can proxy at least capture and query through the HTTP API
- the new transport and automation coverage passes in CI alongside the existing Phase 1-3 suite

