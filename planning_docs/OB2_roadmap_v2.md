# Open Brain 2 — Roadmap

**Companion to:** `architectural_thesis.md`, `implementation_recommendations.md`
**Status:** Draft v1, April 2026
**Audience:** Thomas (primary), any future implementation agent

---

## Preamble

This roadmap translates the architectural thesis into a phased build plan. It is opinionated where the thesis is abstract and deferential where the thesis is concrete. It assumes the current scaffolding in the repo is discarded and work begins from a clean slate against a self-hosted Postgres instance.

Five phases, each with entry state, work, exit criteria, and — critically — the specific failures that would trigger adding deferred complexity. The discipline the thesis demands (cheapest first, escalate on demand) only works if the escalation triggers are written down in advance, not invented retroactively to justify building something interesting.

**Core architectural commitments** (from prior discussion, restated here so they're load-bearing for the plan):

- Self-hosted Postgres as the system of record.
- Four-layer monolith: domain core → Postgres adapter → app services → transports. Strict inward dependencies.
- CLI and HTTP API are first-class transports. MCP is a thin shim over HTTP, added when needed.
- TypeScript/Node throughout. Raw SQL.
- The navigable markdown layer is a derived projection of the database.
- Agent working memory is handled by host frameworks. OB solves the deep-store problem.
- Consolidation is manual at first, then hybrid (5am local cron + configurable atom threshold).

---

## Phase 1 — Foundation

**Goal:** A real system that can capture and retrieve atoms against Postgres, with correct schema, honest entity linking, and a runnable CLI. The data model must be right because everything else depends on it. Scope is limited to the capture and storage path; consolidation, projection, and LLM integration come later.

### Entry state
- Current scaffolding nuked.
- Empty repo with TypeScript/Node toolchain.
- Local Postgres 16 instance reachable from the dev machine.

### Work

**Schema.** Single migration file, hand-written SQL:

- `decay_class` enum matching Open Brain v1's taxonomy: `profile`, `preference`, `relationship`, `decision`, `task`, `ephemeral`. This is the durability control the thesis assumes.
- `importance` and `confidence` as separate floats in [0,1].
- `parent_entity_id` (nullable, self-referential FK) on `entity` for category hierarchy.
- `entity.type` enum distinguishing `category` from concrete types (`person`, `vehicle`, `project`, `place`, `topic`, `other`).
- Seed ten top-level category entities: `work`, `family`, `household`, `vehicles`, `health`, `finance`, `software-projects`, `hobbies`, `travel`, `social`.
- `pg_trgm` extension for fuzzy entity matching at capture time.
- Indexes: `memory_atom(created_at DESC)`, `memory_atom(entity_id)`, `memory_atom(decay_class)`, `memory_atom(valid_at, invalid_at)`, trigram index on `entity.name`.
- `consolidation_run`, `correction_action`, `review_item`, `entity_link` tables as sketched in the v1 scaffolding spec.

**Domain core.** Pure TypeScript, zero I/O:
- Types and enums for all spec entities.
- `Repository` port (interface) defining every persistence operation the app layer needs.
- In-memory `Repository` implementation for unit tests.
- Validation helpers.

**Postgres adapter.** Implements `Repository` against real Postgres:
- Connection pool via `pg`.
- Parameterized SQL for every operation.
- Transactions wrapping any multi-statement write.
- Migration runner (hand-rolled, ~50 lines, or `node-pg-migrate` — equivalent).

**Capture path.** Real `captureMemory`:
- Validates input (ranges, required fields, timestamp parseability).
- Attempts entity linking: exact name match → trigram similarity ≥ 0.6 → falls back to null `entity_id` if no hint and no match. New entity creation is consolidation's job.
- Dedupes on `(source_ref, content_fingerprint)` — replayed captures return the existing atom ID.
- Writes atom with `consolidation_status = pending`. Returns atom ID.
- Target latency: under 100ms p95.

**Query path (stub).** `queryMemory` in Phase 1 is a direct trigram search over `memory_atom.content` scoped to currently-valid atoms (`invalid_at IS NULL OR invalid_at > now()`). This is a placeholder to unblock end-to-end testing of the capture path. The real gating cascade lands in Phase 2.

**CLI.** Thin, in-process:
- `ob capture <content> [--entity <hint>] [--decay <class>] [--importance <0-1>]`
- `ob query <text>`
- `ob entity list`, `ob entity show <name>`
- `ob db migrate`, `ob db reset`
- Roughly 150 lines of argument parsing.

**Test fixtures.** The fictional subject (working name: Morgan Chen, 42, software architect, Denver, partner Alex, two kids, peanut allergy, restoring a motorcycle — fill in organically as scenarios demand it) materialized as a `fixtures/morgan.json` file with 40–60 seed atoms spanning all ten categories. This is the test corpus reused for the life of the project.

### Exit criteria

- Clean migration from empty database to full Phase 1 schema.
- All ten category entities seeded on first migrate.
- Fixture loader populates Morgan's 40–60 atoms into a fresh DB.
- Capture is replay-safe: running the fixture loader twice produces the same row count.
- `ob capture` and `ob query` work end-to-end against real Postgres.
- Unit tests cover the `Repository` port (against in-memory impl) and validation logic.
- Integration test: capture 10 atoms, query for a substring, get the right atoms back.

### Scope boundary
Phase 1 ends at a working capture and storage path. The markdown projection, consolidation runner, LLM integration, vector search, HTTP/MCP transports, and active supersession logic all land in later phases. Columns that later phases will populate (`supersedes_id`, `consolidation_status`, etc.) exist in the schema; Phase 1 just doesn't drive them.

### Escalation triggers
None — this phase is foundational. Failures get fixed here.

---

## Phase 2 — Retrieval That Reasons

**Goal:** The gating cascade from the thesis, implemented honestly. `queryMemory` stops being a substring matcher and becomes the intelligent retrieval pipeline the thesis describes. This is also where the navigable markdown layer first appears, because Gate 2 requires it.

### Entry state
- Phase 1 complete.
- Morgan fixtures loaded.
- `queryMemory` is the trigram stub from Phase 1.

### Work

**Projection writer (minimal).** Because Gate 2 reads the navigable layer, the navigable layer has to exist. Phase 2 builds the *write path* for the projection as a simple mechanical rebuilder that walks the database and produces:

- `memory/index.md` — one line per non-category entity, capped at 200 lines. Format: `- [entity name](entities/<slug>.md) — one-line summary`. The one-line summary in Phase 2 is just a concatenation of the entity's highest-importance atoms truncated to 100 chars. Consolidation will make this smarter in Phase 3.
- `memory/life_state.md` — regenerated from atoms where `decay_class IN (profile, preference)` or `importance ≥ 0.8` and `invalid_at IS NULL`. Capped at ~2KB. Grouped by category.
- `memory/entities/<category>/<slug>.md` — one file per non-category entity with YAML frontmatter and a body that lists all linked atoms with `[source: <atom_id>]` citations. Organized under category subdirectories for human browsability.
- Atomic writes: stage to `memory.tmp/`, rename on success. Never leave a half-written tree.
- Triggered by `ob project rebuild`. Reads only; never modifies atoms.

This projection is mechanical — a direct dump of the database into markdown. Phase 3 replaces it with LLM-driven synthesis. The file layout and atomic-write discipline are established here.

**LLM interface.** Every component that needs an LLM goes through a `LanguageModel` interface with a small, boring surface:

```
interface LanguageModel {
  classify(prompt, schema): structured output
  summarize(prompt): text
  extract(prompt, schema): structured output
}
```

Implementations: `ClaudeSonnet` (via Anthropic API), `StubLLM` (deterministic, for tests). Every app-layer component that touches an LLM takes a `LanguageModel` in its constructor. Tests always pass `StubLLM`. This is the seam that lets you swap Sonnet for whatever comes next.

**Gating cascade in `queryMemory`.** The real thing:

- **Gate 0 — Classification.** Cheap LLM call (or heuristic for obvious cases) that decides whether the turn needs memory at all. Input: conversational context. Output: `{ needs_memory: bool, reason: string }`. Early return if false.
- **Gate 1 — Life state.** Read `memory/life_state.md` from disk. Cached in-process with file mtime invalidation. Always included when memory is engaged.
- **Gate 1.5 — Recency bridge.** SQL query: atoms where `created_at > (SELECT MAX(completed_at) FROM consolidation_run WHERE status = 'completed')`. Bounded to most recent 50. This closes the capture-to-consolidation gap without needing a scratchpad.
- **Gate 2 — Index-guided retrieval.** Load `memory/index.md`. LLM call: given the conversational context and the index, return a list of entity slugs to read. Read those entity summary files. Return their contents as context.
- **Gate 3 — Lexical fallback.** Only if Gate 2 returns empty or flags low confidence. Trigram search over `memory_atom.content`, scoped to currently-valid atoms, re-ranked by importance × recency. Vector search lands later if the escalation trigger fires.
- Instrument which gates fired, return in `reasoning.gates_used`. This is the raw material for deciding when to add Phase-2+ complexity.

**Query response shape.** `queryMemory` returns an assembled context bundle, target 500 tokens, hard cap 1000:

```
{
  life_state: string,
  recent: Atom[],
  entities: { slug, summary }[],
  fallback_atoms: Atom[] | null,
  reasoning: { gates_used: string[], classifier_decision: ... }
}
```

The calling agent gets one response with everything it needs. Intelligence lives in the tool, not the caller — that's the thesis principle that makes agent-agnosticism real.

### Exit criteria

- `ob project rebuild` produces a deterministic markdown tree from Morgan's fixtures. Running it twice produces byte-identical output.
- `queryMemory` executes the full gating cascade against a seeded database.
- Gate 0 correctly skips general-knowledge questions ("what's the capital of France") — verified by test.
- Gate 1.5 surfaces a just-captured atom before any consolidation has run — verified by test.
- Gate 2 returns the right entity for "what vehicles do I own" without hitting Gate 3.
- Gate 3 handles weak cues Gate 2 misses — verified by test.
- Scenario tests (see Phase 5) run against Phase 2, most fail, that's fine — they're the backlog for Phase 3.
- p95 query latency under 3 seconds including LLM calls.

### Escalation triggers (what would make us add things Phase 2 skipped)

- **Add pgvector and embedding-based retrieval at Gate 3** when: trigram fallback misses ≥30% of queries where the target atom exists but uses different vocabulary than the query. Measured by running the scenario suite monthly and tracking Gate 3 precision. Until that happens, lexical is good enough.
- **Add a re-ranking model at Gate 3** when: vector search is added AND returns the right atom in the top 20 but not the top 5 on ≥20% of queries.
- **Partition the index into categorical sub-indexes** when: `index.md` hits 150 lines (75% of hard cap) and shows signs of Gate 2 precision degrading — measured by the LLM returning increasingly noisy entity lists.

---

## Phase 3 — Consolidation That Does The Work

**Goal:** The four-phase dreaming cycle from the thesis, implemented as a real background process. This is where the projection stops being a mechanical dump and starts being an intelligent synthesis. This is also where supersession, contradiction detection, and the circuit breaker come online.

### Entry state
- Phase 2 complete.
- Projection layer exists but is dumb.
- Atoms accumulate with `consolidation_status = pending`.

### Work

**Four-phase runner** (`ob consolidate` and later, cron):

*Phase A — Orient.* Read the last `consolidation_run` row, query atoms where `consolidation_status = pending`, load current `index.md` and `life_state.md` into memory. Cheap — DB reads and file reads only.

*Phase B — Classify and link.* For each pending atom, an LLM call (via `LanguageModel`) decides:
- Which existing entity does this atom belong to? (Match against entities in the atom's likely category, not the full corpus.)
- Does this atom contradict any existing atom in that entity's cluster? (Check only the cluster, not the global store — this is the linearity requirement.)
- Does this atom supersede an existing atom? (If "I work at ExtraHop" arrives and "I work at NetApp" exists in the `work/employment` cluster, set `supersedes_id` and `invalid_at` on the old atom, leave the old atom in place.)
- What entity relationships are implied?

Writes: `memory_atom.entity_id`, `memory_atom.consolidation_status`, `entity_link` rows, supersession chains, `review_item` rows for contradictions. Never destructive.

*Phase C — Compile.* For each entity that received new atoms, regenerate its summary file via LLM synthesis. The LLM sees all linked atoms for that entity and produces a coherent narrative with `[source: <atom_id>]` citations on every claim. Rebuild `index.md` entries for changed entities only (rest unchanged). Regenerate `life_state.md` fully from the current high-importance active atoms.

*Phase D — Prune and audit.* Identify orphaned entities, near-duplicate entities (merge candidates → review_item, not auto-merged), stale summaries. Write `consolidation_run` row with counts. Atomic rename of `memory.tmp/` to `memory/`. Optional git commit.

**Circuit breaker.**
- If classification confidence < 0.5 on > 20% of atoms in a run: abort, log to `consolidation_run.status = aborted_low_confidence`, preserve the previous projection.
- If any phase throws > 5 errors: abort, log.
- Three consecutive aborted runs: auto-disable consolidation (flag in a simple `system_state` table). Manual re-enable required via `ob consolidate --force-enable`.

**Locked atoms.** When a user issues a correction that locks an atom (`locked = true`), the consolidation runner must never modify, supersede, or merge away that atom. Consolidation can *read* locked atoms to inform its reasoning about other atoms, but cannot touch them. Test explicitly.

**Correction flow.** `proposeCorrection` is implemented end-to-end: creates a `correction_action` row, consolidation picks it up in Phase B, applies it as a new atom with a supersession link rather than mutating the target. State machine: `proposed → under_review → applied | rejected`. For Phase 3, auto-apply if confidence is high and pattern is well-established (explicit supersession of a same-field atom); otherwise leave as `under_review` pending manual CLI action (`ob corrections list`, `ob corrections apply <id>`).

**Manual and hybrid triggers.**
- `ob consolidate` runs a cycle immediately. This is the only trigger in Phase 3.
- Automated trigger (5am local + atom count threshold) deferred to Phase 4 with the rest of the transport/ops surface.

### Exit criteria

- Running `ob consolidate` on a fresh fixture load produces a coherent `index.md`, `life_state.md`, and entity summary files — all with source citations on every claim.
- Re-running `ob consolidate` on an unchanged database is a no-op (produces the same projection, no new `consolidation_run` side effects beyond logging).
- Supersession test: capturing "I work at NetApp" then "I work at ExtraHop" in sequence and running consolidation results in the NetApp atom having `invalid_at` set and `supersedes_id` pointing to it from the ExtraHop atom. Query for "where do I work" returns ExtraHop only.
- Contradiction test: two directly-conflicting atoms with overlapping validity produce a `review_item` row, and consolidation does not silently pick one.
- Locked atom test: locking an atom and running consolidation leaves it untouched even if it contradicts newer atoms.
- Circuit breaker test: simulated LLM returning low-confidence on every classification triggers an aborted run and preserves the previous projection.
- Interrupted run test: killing the runner mid-Phase-C leaves the old projection intact (atomic rename not reached).
- Scenario suite (Phase 5) passes at least 8 of 12 scenarios.

### Scope boundary
Phase 3 lands the consolidation engine, supersession, contradiction detection, correction flow, and circuit breaker — all driven by manual `ob consolidate` invocation. HTTP/MCP transports, automated triggers, and multi-hop graph traversal come later.

### Escalation triggers
- **Add multi-hop graph traversal at a new Gate 4** when: scenario tests reveal cross-domain queries (the Missing Oracle class) that fail even with good life_state and index navigation. This is the single most likely Phase 4+ addition based on the thesis's emphasis on the oracle problem.
- **Move to a dedicated graph database** when: multi-hop traversals on actual corpus size take > 1 second consistently. Not before — Postgres recursive CTEs handle personal scale fine.
- **Add a separate verification LLM pass** when: consolidation produces merged summaries with uncited or hallucinated claims on > 5% of entities.

---

## Phase 4 — Transports and Integration

**Goal:** OB becomes reachable by every agent in your environment. Local CLI stays primary, HTTP API comes online, MCP is added as a thin shim, automated consolidation starts running on the 5am cron. This is the phase where OB transitions from "a thing you run manually" to "ambient infrastructure."

### Entry state
- Phase 3 complete.
- Core, Postgres adapter, app services, and CLI all work.
- Manual consolidation is trusted enough to automate.

### Work

**HTTP API.** Fastify or plain Node `http` (Fastify is fine — it's boring and fast):
- Six endpoints mapping 1:1 to the service contracts: `POST /capture`, `POST /query`, `GET /entity/:id`, `POST /correction`, `POST /consolidate`, `GET /export`.
- Bearer token auth. Token stored in environment, rotatable, one per client for now.
- Binds to localhost by default. External access via Cloudflare tunnel, configured separately.
- Request logging to a `request_log` table for observability — every call gets logged with client ID, duration, gate trace. This is the raw material for Phase 5 escalation decisions.
- OpenAPI spec generated or hand-written so clients have a schema.

**MCP server.** Thin wrapper:
- Exposes the same six operations as MCP tools.
- Translates MCP tool calls into HTTP API calls (localhost → localhost).
- Runs as a separate, optional process.
- Agent instruction stanza (from the recommendations doc, slightly revised) shipped as part of the MCP server's tool descriptions so any MCP-aware agent gets the usage guidance automatically.
- Purpose: serves weak/tiny models that benefit from the MCP envelope. Frontier models call the HTTP API directly.

**Automated consolidation.**
- Systemd timer (or launchd, or a cron entry — pick one) fires `ob consolidate` at 05:00 local time.
- Additional trigger: after any capture that brings `pending` atom count over a configurable threshold (default 50), enqueue a consolidation. Use a simple file-based lock to prevent concurrent runs.
- Circuit breaker state (from Phase 3) is honored by the automated trigger — auto-disabled means automated runs are skipped until manual re-enable.
- Failure notifications: when a run aborts, write to a `notifications` table. Phase 5 adds delivery; Phase 4 just records them.

**Cloudflare tunnel config.** Not code — ops work. Document the tunnel setup, auth, and the minimum set of routes exposed. Probably only `POST /query` and `POST /capture` need to be externally reachable; administrative operations stay local.

**Library embedding.** The domain core and app services should be importable as a Node library (`import { MemoryServices } from 'open-brain'`) so in-process agents running on the same machine skip the HTTP layer entirely. This is the fastest path and the one local agents should use when possible.

### Exit criteria

- HTTP API is reachable from localhost with bearer auth, returns correct responses for all six endpoints, and logs every request.
- MCP server runs, registers tools, and successfully proxies a capture and a query end-to-end from a test MCP client.
- Automated consolidation fires at 05:00 local in a test environment and completes successfully.
- Volume-triggered consolidation fires when pending count exceeds threshold and does not double-fire under concurrent captures.
- Cloudflare tunnel exposes the documented endpoints to an external test client; unexposed endpoints return 404 externally.
- At least one real agent (Claude via MCP, or a custom agent via HTTP) successfully uses OB end-to-end in a live conversation.

### Escalation triggers
- **Add rate limiting and quota enforcement** when: request volume exceeds 1000/day or any single client exhibits runaway behavior.
- **Split read and write endpoints onto separate ports or auth realms** when: you want to expose read access to a class of agents without granting capture.
- **Add a WebSocket or SSE subscription endpoint for live updates** when: you want agents to be notified of new consolidation runs rather than polling.

---

## Phase 5 — Hardening, Observability, and Scale Triggers

**Goal:** OB stops being a project and becomes infrastructure. This phase is where you stop *adding* and start *measuring* — the whole point of the thesis's "cheapest first, escalate on demand" discipline is that escalation requires data, and Phase 5 is where you finally have it. Scope is open-ended because this is the phase that lasts for years.

### Entry state
- Phases 1–4 complete.
- OB is running on your local server and reachable by all your agents.
- Several weeks or months of real usage data.

### Work

**Scenario suite as a living CI gate.** The 12 scenarios from the test corpus (plus any new ones you accumulate) run against every change. Pass rate is tracked over time. Regressions block merges. This is the single most important thing in this phase — without it, quality decays silently.

**Observability dashboard.** Not fancy. A single HTML page served by the HTTP API that shows:
- Capture rate (per day, per category, per source).
- Query rate and gate-firing distribution (% of queries answered by Gate 0, 1, 1.5, 2, 3).
- Consolidation run history, error rate, circuit breaker state.
- Pending atom backlog.
- Corpus size (atoms, entities, links, projection file count).
- Scenario suite pass rate trend.

This is the data you use to decide which escalation triggers to actually pull.

**The deferred complexity list — explicit, revisited quarterly.** Maintain a document (or issue tracker) with every "we'll add this when X fails" trigger from Phases 1–4, paired with current measurements. Each quarter, review it. Act on triggers that have fired; document why you're not acting on ones that have fired but aren't urgent.

**Import path from Open Brain v1.** Script that reads the v1 database (or exported JSON) and issues capture calls via the HTTP API or library. Runs once, populates OB v2 with your historical memories. As you noted, this doubles as an integration test for the capture path and a useful exercise of the oracle. Small corpus (~100 rows) means no batching concerns.

**Export and portability.** `ob export` produces a self-contained archive: SQL dump + full `memory/` tree + a README describing the schema version. This is the "data survives forever even if the code doesn't" guarantee from the thesis. Test that a fresh OB instance can import an export and produce byte-identical output.

**Documentation.** Three documents:
1. *Schema reference* — every table, every column, every enum value, with prose explaining why. The contract future-you (or a porting effort) will read.
2. *Operator's guide* — how to run, back up, restore, migrate, debug OB. Written for you six months from now when you've forgotten everything.
3. *Agent integration guide* — how to wire a new agent to OB via HTTP, MCP, or library, with example code. Minimizes friction for adding new clients.

**Likely additions — triggered by observed failures.** The things most likely to get built during Phase 5 in response to real data. Each is conditional on its trigger firing.

- **pgvector + embedding Gate 3.** Trigger: trigram fallback miss rate ≥ 30%.
- **Multi-hop graph traversal Gate 4.** Trigger: Missing Oracle scenarios failing despite good life_state and index navigation.
- **Re-ranking model at Gate 3.** Trigger: target atoms in top 20 but not top 5 on ≥ 20% of vector queries.
- **Index partitioning.** Trigger: `index.md` > 150 lines with measurable Gate 2 precision loss.
- **Dedicated graph database.** Trigger: multi-hop queries > 1 second at actual corpus size.
- **Verification LLM pass on consolidation output.** Trigger: uncited claims > 5% of entity summaries.
- **Web browsing UI for the navigable layer.** Trigger: you find yourself wanting to browse OB and `ls memory/` isn't enough. Any static site generator over the markdown tree works; Obsidian is the zero-effort answer.
- **Backup and restore automation.** Trigger: first time you have a scare about losing data. Should probably not wait for that.

### Exit criteria
There is no exit from Phase 5. This is the phase the project lives in.

Criteria for calling Phase 5 "initially complete" and stopping active build:
- Scenario suite passes 10+ of 12 consistently.
- Observability dashboard shows gate distribution roughly matching the thesis predictions (most queries exit by Gate 2, Gate 3 fires only on weak cues).
- OB has been running for a month with no data loss and no unrecovered circuit breaker trips.
- At least two agents (different frameworks or providers) use OB in regular conversation.
- v1 data is imported.
- Export/import round-trips cleanly.

---

## Cross-cutting concerns

**Testing philosophy.** Three layers, all mandatory:
1. *Unit tests* against the in-memory `Repository` for domain logic.
2. *Integration tests* against a real Postgres (Docker container spun up per test run) for the adapter and app services.
3. *Scenario tests* — the 12-scenario suite — exercising the full stack from capture through consolidation through query, with assertions on what the oracle surfaces.

Scenarios are the tests that actually matter. Unit and integration tests exist to localize failures when a scenario breaks.

**Determinism.** The projection writer and consolidation runner must produce byte-identical output for identical database state. This is non-negotiable — it's how golden-file tests work and how you know the system is trustworthy. Any non-determinism (hash map iteration order, timestamp fields, LLM output) must be controlled: sort explicitly, clamp timestamps in tests, stub LLMs in deterministic mode.

**Error handling.** Every app-layer operation returns a discriminated union of success or typed error, keeping exceptions inside module boundaries. Transport layers translate errors to HTTP status codes or CLI exit codes uniformly.

**Migration discipline.** Schema changes are additive whenever possible. Columns added with defaults. Renames done as add-new/migrate-data/drop-old across three releases. The schema is the contract with future-you; treat it with respect.

**Secret handling.** API keys and bearer tokens live in environment variables, loaded via a single config module. Standard practice, worth stating.

---

## Timeline (calendar estimate, not mandate)

- **Phase 1:** 1 week focused work.
- **Phase 2:** 1–1.5 weeks. LLM integration adds friction.
- **Phase 3:** 1.5–2 weeks. This is the hardest phase.
- **Phase 4:** 3–5 days.
- **Phase 5:** Forever, but initial hardening takes 1–2 weeks.

Total to "OB is running and useful": roughly 5–7 weeks of focused work, more likely 2–3 months of real calendar time assuming other demands on attention.

---

## Principles that apply to every phase

Restated from the thesis because they're the parts most likely to erode under implementation pressure:

- **Append over mutate.** Nothing gets deleted. Contradictions become review items. Supersession is additive.
- **Simple over clever.** Every time you reach for a graph database, a vector store, or a framework, check the escalation trigger. Build it when the trigger fires.
- **The intelligence lives inside the tool, not the calling agent.** `queryMemory` does the reasoning. Agents call one tool and get good context back.
- **The database is forever. Everything else is replaceable.** When in doubt, protect the schema and the data. Transports, languages, LLM providers, UIs — all transient.
- **Trust is the load-bearing property.** A retrieval failure is a bug; a trust failure is abandonment. Err toward letting the user audit, correct, and lock; err away from automation that silently modifies state.

---

*End of roadmap v1. Revise as reality pushes back.*
