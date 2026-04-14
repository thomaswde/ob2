# OB2 QA Review 2026-04-14: Per-Domain Findings

## 1. Domain Contracts and Validation

- Reviewed scope: `src/domain/**`, especially capture validation and contract boundaries.
- High: capture validation accepted malformed runtime inputs too easily. Empty timestamp strings were treated as missing, non-string required fields could be coerced, and non-plain `metadata` values could slip through.
- Fixes applied: tightened `validateCaptureMemoryInput()` to enforce string types, reject empty timestamp strings, validate timestamp inputs more strictly, and require plain-object metadata.
- Tests added: extended `test/validation.test.ts` for empty timestamps, non-string fields, and invalid metadata shapes.
- Residual concerns: none material after boundary hardening.

## 2. Persistence and Migrations

- Reviewed scope: `src/adapters/postgres/**`, `sql/migrations/**`, `test/fixtures.integration.test.ts`.
- High: repository idempotency checks for entities, atoms, and links were race-prone under concurrent duplicate writes.
- High: `system_state` updates used read-modify-write semantics that could lose concurrent updates.
- Medium: projection and lexical-read paths ignored `valid_at`, so future-dated atoms could appear before they were active.
- Medium: migrations were not serialized across concurrent startup runners.
- Fixes applied: replay-safe `ON CONFLICT DO NOTHING` persistence with fallback reads, atomic `system_state` upsert behavior, active-window filtering for query/projection reads, and advisory-lock serialization during migrations.
- Tests added: concurrent dedupe and future-dated-atom regression coverage in `test/fixtures.integration.test.ts`.
- Residual concerns: no dedicated multi-process migration stress test yet; `listAtomsForEntity` and consolidation clustering still use broader validity semantics by design.

## 3. Capture, Retrieval, and Projection

- Reviewed scope: `src/app/captureMemory.ts`, `src/app/MemoryQueryService.ts`, `src/app/ProjectionRebuilder.ts`, `src/app/queryMemory.ts`, `test/phase2.integration.test.ts`.
- High: query reads could fail when `life_state.md` or `index.md` disappeared during a projection swap or before the first rebuild.
- High: Gate 2 dropped entities with empty summaries, making valid entities unreachable from index-guided retrieval.
- Medium: multiline atom content could break projected markdown formatting.
- Medium: duplicate entity slugs from model output could duplicate entities in the query bundle.
- Fixes applied: cache fallback on `ENOENT` with stronger cache keys, empty-summary index parsing support, projection content normalization, deterministic category ordering, and Gate 2 slug deduplication.
- Tests added: regression coverage for missing-file cache fallback, empty-summary retrieval, duplicate slugs, and multiline projection output.
- Residual concerns: none material after the targeted fixes.

## 4. Consolidation and Correction Workflow

- Reviewed scope: `src/app/ConsolidationService.ts`, `src/app/ConsolidatedProjectionCompiler.ts`, `test/phase3.integration.test.ts`.
- High: unexpected failures after mutation but before run finalization could leave consolidation runs stuck in `pending` with stale circuit-breaker state.
- High: correction application was not replay-safe if the process crashed after creating a replacement atom but before marking the correction applied.
- Fixes applied: best-effort failure finalization to `aborted`, plus replay detection and repair for partially applied corrections.
- Tests added: regression coverage for aborted-run finalization and correction rerun idempotency.
- Residual concerns: none material after the targeted fixes.

## 5. Transports and Auth Surface

- Reviewed scope: `src/cli/**`, `src/transports/http/**`, `src/transports/mcp/**`, `test/cli.smoke.test.ts`, transport-facing `test/phase4.integration.test.ts`.
- High: malformed JSON and non-object HTTP request bodies were falling into the generic `500` path instead of returning `400`.
- High: the MCP proxy treated upstream HTTP failures as successful tool results.
- Medium: `corrections propose` could strip literal user content when it matched option values.
- Fixes applied: explicit `400` handling for malformed request bodies and validation failures, MCP upstream error propagation plus bad-frame hardening, and safer CLI correction-content parsing.
- Tests added: malformed JSON logging/status regression coverage, MCP upstream error coverage, and CLI content-preservation coverage.
- Residual concerns: request-body size limits are still missing; `/healthz` remains intentionally unauthenticated and unlogged.

## 6. Runtime, Config, LLM, and Automation

- Reviewed scope: `src/config/env.ts`, `src/app/runtimeServices.ts`, `src/app/MemoryServices.ts`, `src/app/AutomationService.ts`, `src/app/ExportService.ts`, `src/app/llmFactory.ts`, `src/adapters/llm/**`, runtime-facing `test/phase4.integration.test.ts`.
- High: invalid numeric env values for API port and pending-threshold could drift into unsafe startup/runtime behavior.
- High: automation lock acquisition treated any error as contention, which could silently skip automation after real filesystem/setup failures.
- Medium: runtime service construction eagerly read automation config even when automation was disabled.
- Fixes applied: strict numeric env validation, lock handling that only treats `EEXIST` as contention while failing closed on other errors, and lazy automation config reads when automation is off.
- Tests added: new `test/runtime.config.test.ts` and expanded automation/runtime assertions in `test/phase4.integration.test.ts`.
- Residual concerns: malformed `OB2_API_CLIENT_TOKENS` pairs are still ignored rather than rejected.

## 7. Test Suite and Coverage Gaps

- Reviewed scope: all `test/**`, `src/testing/**`, and the cross-domain coverage picture after subagent fixes landed.
- Findings:
  - The suite is now materially stronger on malformed input, projection swap races, correction replay, transport failure mapping, automation config validation, and persistence concurrency semantics.
  - The highest remaining blind spots are broader than a targeted QA patch and were intentionally left as follow-up work.
- No direct code changes were needed from the coordinator beyond integrating the new domain-level regression coverage.
- Residual concerns promoted to backlog:
  - no request-body size or backpressure tests on HTTP/MCP ingress
  - no dedicated concurrent-process stress test for migration startup
  - no coverage for malformed `OB2_API_CLIENT_TOKENS` being rejected at startup
  - no round-trip import/export verification yet
  - no explicit resilience tests for real-LLM network timeouts, retries, or partial upstream failures

## Validation

- Passed: `npm run check`
- Passed: `npm test`
- Passed: `npm run build`
