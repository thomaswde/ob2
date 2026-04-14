# OB2 QA Review 2026-04-14: Escalation Backlog

## 1. Ingress Size Limits

- Priority: High
- Risk: the HTTP API and MCP proxy accept arbitrary body sizes, which can turn malformed or hostile traffic into memory pressure and noisy failure modes.
- User or operational impact: degraded stability under pressure testing, harder-to-predict latency, and avoidable resource exhaustion.
- Recommended remediation: add request-body size caps, explicit `413` behavior, and tests that cover oversized JSON bodies and MCP frames.

## 2. Startup Auth Config Strictness

- Priority: Medium
- Risk: malformed entries in `OB2_API_CLIENT_TOKENS` are currently ignored instead of rejected, which can hide operator mistakes.
- User or operational impact: clients may silently fail auth after a bad deploy, and the configured token set may not match operator intent.
- Recommended remediation: decide on fail-fast startup validation for malformed token pairs and add coverage for mixed valid/invalid configuration.

## 3. Multi-Process Migration Stress Coverage

- Priority: Medium
- Risk: migrations now use an advisory lock, but the repo does not yet prove the behavior under real concurrent process startup.
- User or operational impact: lower confidence in first deploys or rolling restarts when multiple instances initialize simultaneously.
- Recommended remediation: add an integration test or harness that starts multiple migration runners against the same database and verifies serialized execution.

## 4. Valid-Time Semantics Outside Query/Projection

- Priority: Medium
- Risk: query/projection reads now hide future-dated atoms, but adjacent surfaces such as entity-detail reads and consolidation clustering still use broader semantics.
- User or operational impact: operators may see different answers depending on which surface they use, and future-dated facts may still influence workflows unexpectedly.
- Recommended remediation: make a deliberate product decision on where `valid_at` should apply, then align repository read methods and tests accordingly.

## 5. Import/Export Round-Trip Assurance

- Priority: Medium
- Risk: export succeeds today, but there is no import path or round-trip verification proving recoverability.
- User or operational impact: backup confidence is limited before live deployment.
- Recommended remediation: add an import workflow or at least a round-trip validation harness once the import contract is defined.

## 6. Real LLM Failure-Mode Hardening

- Priority: Medium
- Risk: test coverage is strong with the stub model, but real-provider failure modes such as timeouts, transient upstream errors, and malformed payloads are not exercised.
- User or operational impact: live pressure testing may surface retry gaps, poor error messages, or unexpected failure cascades.
- Recommended remediation: add adapter-level timeout/retry policy, provider-error normalization, and tests around upstream failure handling.
