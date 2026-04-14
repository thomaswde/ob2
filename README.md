# Open Brain 2

A persistent memory substrate for personal AI agents. OB2 gives your agents deep, lasting familiarity with one person — across every domain of their life — without rebuilding context from scratch every session.

---

## What this is

Most AI agents are functionally amnesiac. Every session starts from zero. Thousands of micro-truths — preferences, constraints, ongoing projects, relationships, history — are shared and then evaporate. The agent is smart, but it doesn't *know* you.

OB2 is a memory layer you connect to any agent. It absorbs facts from conversation, organizes them in the background, and surfaces the right context at the right moment. The agent asks what's relevant; OB2 reasons about it and returns a grounded context bundle. Over time the agent gets richer, not just smarter.

It is not a knowledge base, a document store, or a wiki. It stores what a person *is*, *has*, *knows*, *prefers*, *has done*, and *is doing* — atomic facts with full metadata — organized into a navigable projection that any LLM can reason through.

---

## Why it works differently

Most retrieval approaches use vector similarity: embed the query, find nearby memories, return them. The problem is that semantic proximity is not the same as contextual utility. A query about running an errand might return a sports car (semantically close: vehicle + errand) when you actually needed the cargo van. The embeddings don't know which car has a trunk.

OB2 puts reasoning *before* lookup, not after:

**Gate 0** — Classify whether the query needs memory at all. Skip entirely for general knowledge questions.

**Gate 1** — Load a synthesized life-state narrative: active goals, standing constraints, recent changes, ongoing projects. This grounds every query with ambient context at zero per-turn cost.

**Gate 1.5** — Bridge atoms captured since the last consolidation run so nothing recent is invisible.

**Gate 2** — An oracle pass: given the query *and* the user's current life state, reason across the full entity index to identify relevant entities — including non-obvious lateral connections. A query about scheduling might surface financial, project, and family-constraint entities the user never mentioned.

**Gate 3** — Lexical fallback for weak-signal queries where Gate 2 confidence is low.

**Gate 4** — One-hop traversal over entity relationships. If Gate 2 surfaces an entity, follow its high-confidence links to gather the surrounding context automatically.

Each gate fires only when the one before it is insufficient. The result is context that's both cheap to retrieve and actually useful.

---

## Prerequisites

- Node.js 20+
- PostgreSQL 16 (Docker is the easiest path; a `docker-compose.yml` is included)
- An Anthropic API key (required for consolidation, query reasoning, and life-state synthesis)

---

## Installation

```bash
git clone <repo>
cd ob2
npm install
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY and OB2_API_TOKEN at minimum
```

Start Postgres and apply migrations:

```bash
docker compose up -d postgres
npm run db:migrate
```

Optionally load the included fixture corpus to verify the system end-to-end before adding real data:

```bash
npm run fixtures:load    # loads a fictional person corpus (Morgan Chen)
npm run ob -- consolidate
npm run ob -- query "what vehicles do I own"
```

---

## Wiring to your agent

OB2 exposes two interfaces for agent integration: an **HTTP API** and an **MCP proxy**. Both sit in front of the same memory pipeline.

### HTTP API

Start the API server:

```bash
npm run api:start
```

The server binds to `127.0.0.1:4318` by default. For remote agent access, put it behind a reverse proxy or tunnel — OB2 does not handle TLS or public routing.

**Auth:** All endpoints require a `Bearer` token matching `OB2_API_TOKEN` (single token) or one of the `OB2_API_CLIENT_TOKENS` entries (per-client tokens, useful when multiple agents connect to the same instance).

#### Endpoints

**`POST /query`** — The primary retrieval endpoint. Pass the agent's current query; receive a grounded context bundle.

```json
{
  "text": "what should I know before booking a spring trip?"
}
```

Response includes `lifeState`, recent unconsolidated atoms, matched entity summaries, and retrieval reasoning (gates fired, timings, confidence).

**`POST /capture`** — Store a memory atom from conversation.

```json
{
  "content": "Prefers morning flights, always books an aisle seat",
  "entityHint": "Morgan Chen",
  "decayClass": "preference",
  "importance": 0.7,
  "confidence": 0.9,
  "sourceRef": "chat:2026-04-14:travel",
  "sourceAgent": "claude-sonnet-4-6"
}
```

`decayClass` is one of `profile`, `preference`, `relationship`, `decision`, `task`, or `ephemeral`. Higher importance and longer-lived decay classes receive higher retrieval weight over time.

**`GET /entity/:id`** — Fetch an entity record with its linked atoms and relationships.

**`POST /correction`** — Propose a correction to an existing atom. The correction is queued for the next consolidation run; if the target atom is locked by the user, it moves to manual review.

**`POST /consolidate`** — Trigger a consolidation run manually. Can also be driven by automation (see below).

**`GET /export`** — Write a portable snapshot to `exports/` containing a JSON database dump and a copy of the current projection.

### MCP

OB2 includes an MCP proxy that wraps the HTTP API as MCP tools, making it usable from any MCP-capable agent without additional integration code:

```bash
npm run mcp:start
```

The MCP server exposes tools: `capture`, `query`, `get_entity`, `propose_correction`, `consolidate`, and `export`. It communicates over stdin/stdout and requires the HTTP server to be running separately.

### What to tell your agent

For retrieval to be useful, the agent needs to know *when* to call OB2 and *what* to do with the result. A minimal system prompt stanza:

```
You have access to a personal memory system through the `query` and `capture` tools.

Call `query` at the start of any conversation that touches the user's personal context —
their life, work, projects, preferences, schedule, relationships, or ongoing situations.
Use the returned context to inform your responses without asking the user to repeat themselves.

Call `capture` when new durable facts emerge from conversation — things that change the
user's observable state, preferences, constraints, or future plans. Do not capture
general knowledge or transient conversational mechanics.
```

---

## Consolidation

Consolidation is the background process that turns raw captured atoms into a navigable memory projection. It:

- Clusters atoms by entity, detecting when multiple captures refer to the same person, project, or thing
- Detects contradictions and supersessions within entity clusters
- Synthesizes entity summary files (cited back to source atoms)
- Generates a compressed life-state narrative from cross-domain signals
- Rebuilds the master index

The projection lands in `memory/` as plain markdown: `index.md`, `life_state.md`, and per-entity files under `entities/`. It is human-readable and human-browsable — you can audit exactly what the system knows about any entity.

**Manual consolidation:**

```bash
npm run ob -- consolidate
```

**Scheduled automation** (recommended for ongoing use):

Set `OB2_AUTOMATION_ENABLED=1` and add a cron entry:

```
0 5 * * * cd /path/to/ob2 && npm run automation:scheduled
```

Consolidation also triggers automatically after capture once pending atom count exceeds `OB2_PENDING_CONSOLIDATION_THRESHOLD`.

A circuit breaker (`system_state.consolidation_enabled`) halts automated consolidation if a run aborts. Re-enable with:

```bash
npm run ob -- consolidate --force-enable
```

---

## CLI reference

```bash
# Database
npm run ob -- db migrate                  # Apply pending migrations, seed categories
npm run ob -- db reset --force            # Truncate and reseed (local dev only)

# Capture
npm run ob -- capture "fact" \
  --entity "Name" \
  --decay preference \
  --importance 0.8 \
  --confidence 0.9 \
  --source-ref "chat:session-id"

# Query
npm run ob -- query "what do you know about my car situation"

# Consolidation
npm run ob -- consolidate
npm run ob -- consolidate --force-enable  # Reset circuit breaker and run

# Corrections
npm run ob -- corrections list
npm run ob -- corrections propose "Updated content" \
  --target <atom-id> \
  --reason "Fact changed"

# Entities
npm run ob -- entity list
npm run ob -- entity show "Name"

# Projection
npm run project:rebuild                   # Deterministic rebuild (no LLM synthesis)

# Fixtures
npm run ob -- fixtures load fixtures/morgan.json

# Transports
npm run api:start
npm run mcp:start

# Export
npm run export:data
```

---

## Configuration

All configuration is read from environment variables. Copy `.env.example` to `.env` to get started.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `ANTHROPIC_MODEL` | No | `claude-3-5-sonnet-latest` | Model used for all LLM calls |
| `OB2_API_TOKEN` | Yes (for API) | — | Bearer token for HTTP API auth |
| `OB2_API_CLIENT_TOKENS` | No | — | Per-client tokens: `id:token,id:token` |
| `OB2_API_HOST` | No | `127.0.0.1` | API bind address |
| `OB2_API_PORT` | No | `4318` | API port |
| `OB2_AUTOMATION_ENABLED` | No | `0` | Enable post-capture and scheduled automation |
| `OB2_PENDING_CONSOLIDATION_THRESHOLD` | No | `50` | Atom count that triggers automatic consolidation |
| `OB2_AUTOMATION_LOCK_FILE` | No | `.ob2-consolidate.lock` | File lock path for concurrent consolidation prevention |
| `OB2_USE_STUB_LLM` | No | `0` | Use deterministic stub LLM (for testing) |

---

## Data model

The atomic unit is the `memory_atom` — a single fact with:

- **content** — the fact as a clear standalone statement
- **decayClass** — expected lifespan: `profile`, `preference`, `relationship`, `decision`, `task`, or `ephemeral`
- **importance** / **confidence** — [0, 1] scores used for retrieval weighting
- **validAt** / **invalidAt** — temporal validity window
- **sourceRef** / **sourceAgent** — where the fact came from
- **supersededBy** — chain to the atom that replaced this one (if any)
- **consolidationStatus** — `pending`, `processed`, or `skipped`

Atoms belong to entities (people, vehicles, projects, places, topics). Entities are organized into categories. Typed `entity_link` records connect related entities and are traversed by Gate 4 during retrieval.

The `memory/` projection is generated from the database and can be regenerated at any time. It is not the source of truth — the database is. If the projection drifts, consolidation rebuilds it.

---

## Architecture

```
src/
  domain/       Core types, Repository interface, LanguageModel interface, validation
  app/          Application services: capture, query, consolidation, projection, automation
  adapters/
    postgres/   Repository implementation, migrations, connection pool
    llm/        Anthropic API client, deterministic test stub
  transports/
    http/       HTTP API server
    mcp/        MCP proxy over HTTP
  cli/          CLI entry point and command router
  testing/      In-memory repository, Postgres test helpers, query benchmark
sql/
  migrations/   Versioned SQL migrations
memory/         Generated projection (git-ignored in production use)
fixtures/       Seed data
```

The domain layer owns all contracts. Adapters implement them. Application services depend only on domain interfaces — not on Postgres or Anthropic directly. This makes the LLM swappable (the stub is used for all tests), the database swappable (an in-memory implementation covers unit and fast integration tests), and the transport layer independent from business logic.

---

## Development

```bash
npm run check       # TypeScript type check
npm test            # Run all tests
npm run build       # Compile to dist/
```

Postgres-backed integration tests require Docker. If Docker is unavailable they skip automatically; the pure TypeScript validation and in-memory repository tests always run.

```bash
npm run benchmark:query   # Query pipeline performance measurements
```

---

## Current state

OB2 is at v0.1.0 — the first version intended for real use. The pipeline is complete and tested. It has not yet accumulated months of production history, so treat it as stable architecture with early-adopter roughness.

Known gaps that will be addressed:

- Import round-trip verification (export works; verified re-import is not yet tested)
- No built-in rate limiting on the HTTP API (handle at reverse proxy)
- `entity show` CLI resolves by exact name only
