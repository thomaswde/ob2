# OB2 QA Review 2026-04-14: Integrated Summary

## Fixed In Pass

- Tightened runtime validation at the domain boundary so malformed capture input fails closed instead of being coerced into persisted state.
- Removed several concurrency hazards in Postgres persistence: duplicate write races, lost `system_state` updates, and migration startup races.
- Prevented future-dated atoms from leaking into projection/query read paths before they become active.
- Hardened retrieval around projection swaps and sparse index data by handling missing projection files safely, supporting empty entity summaries, and deduplicating entity selection.
- Made consolidation more crash-safe by ensuring unexpected failures finalize runs as `aborted` and by making correction replay idempotent after partial failure.
- Fixed transport correctness issues so malformed HTTP bodies return `400`, MCP propagates upstream HTTP errors properly, and CLI correction content is preserved exactly.
- Hardened runtime/env behavior so invalid numeric config fails clearly and automation lock setup errors fail closed instead of silently skipping work.
- Expanded regression coverage across validation, persistence, retrieval, consolidation, transport, runtime config, and CLI flows.

## Deferred But Important

- Add request-body size limits and corresponding ingress/load tests for the HTTP API and MCP proxy.
- Decide whether malformed `OB2_API_CLIENT_TOKENS` should hard-fail at startup instead of being partially ignored.
- Add a dedicated multi-process migration stress test to validate advisory-lock behavior under real startup contention.
- Decide whether `valid_at` filtering should also apply to `listAtomsForEntity` and consolidation clustering, since those semantics are currently broader by design.
- Add import/export round-trip verification once the import surface exists.
- Add resilience coverage for real-LLM upstream failures such as timeouts, retries, and malformed provider responses.

## Watch During Live Pressure Test

- Monitor request-log volume and payload shape because ingress is now better validated, but there are still no body-size guardrails.
- Watch automation notifications for unexpected lock/setup failures or repeated aborted runs.
- Watch consolidation outcomes for any lingering edge cases around correction replay and aborted-run recovery.
- Watch query behavior immediately after rebuilds to confirm the cache/projection swap fixes behave cleanly under repeated live writes.
- Watch Postgres startup and deployment logs for serialized migration behavior if multiple instances start together.

## Final Validation

- `npm run check`
- `npm test`
- `npm run build`

All three passed on the integrated QA worktree.
