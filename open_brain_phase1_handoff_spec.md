# Open Brain 2 — Phase 1 Implementation Handoff Specification

## 0. Purpose

This document defines the **implementation contract** for Phase 1 of Open Brain 2.

It translates the architectural thesis into:
- concrete schema
- strict service contracts
- deterministic behaviors
- operational safety guarantees

This is not a design document.  
This is the **ground truth spec** for the implementation agent.

---

## 1. System Boundaries

### Phase 1 Scope

- Headless memory substrate
- CLI interface only
- PostgreSQL-backed structured store
- Markdown projection layer
- Background consolidation process

### Explicit Non-Goals (Phase 1)

- No vector DB (pgvector optional later)
- No graph DB
- No web UI
- No advanced oracle/planner layer
- No distributed systems complexity

---

## 2. Data Model

### 2.1 Design Principles

- **Minimal but sufficient**
- Separate:
  - Core records
  - Derived artifact metadata
  - Process state
- No presentation concerns in core records
- Append-first mutation model

---

### 2.2 Core Records

#### `memory_atom`

Represents a single atomic memory.

```ts
memory_atom {
  id: uuid (pk)
  content: text

  memory_type: enum
  durability: enum
  importance: float
  confidence: float

  valid_at: timestamp
  invalid_at: timestamp | null

  created_at: timestamp

  entity_id: uuid | null

  supersedes_id: uuid | null

  source_type: enum
  source_ref: text
  captured_by: text

  verification_state: enum
  locked: boolean

  consolidation_status: enum
  review_status: enum

  retrieval_count: int
  last_retrieved_at: timestamp | null
}
```

#### `entity`

```ts
entity {
  id: uuid (pk)
  name: text
  type: enum

  created_at: timestamp
  updated_at: timestamp
}
```

#### `entity_link`

```ts
entity_link {
  id: uuid (pk)
  from_entity_id: uuid
  to_entity_id: uuid
  relation_type: enum
  weight: float
}
```

### 2.3 Correction & Review

#### `correction_action`

```ts
correction_action {
  id: uuid (pk)

  target_id: uuid
  target_type: enum

  action_type: enum
  proposed_content: text

  status: enum
  created_at: timestamp
}
```

#### `review_item`

```ts
review_item {
  id: uuid (pk)

  related_atom_id: uuid | null
  related_entity_id: uuid | null

  type: enum
  description: text

  status: enum
  created_at: timestamp
}
```

### 2.4 Process State

#### `consolidation_run`

```ts
consolidation_run {
  id: uuid (pk)

  status: enum
  started_at: timestamp
  completed_at: timestamp | null

  processed_count: int
  error_count: int
}
```

---

## 3. Service Contracts (Primitive I/O)

All services must be **pure, deterministic, and idempotent where applicable**.

### 3.1 `captureMemory(input)`

#### Input

```json
{
  "content": "string",
  "memory_type": "enum",
  "durability": "enum",
  "importance": number,
  "confidence": number,
  "valid_at": "timestamp",
  "entity_hint": "string | null",
  "source_type": "enum",
  "source_ref": "string",
  "captured_by": "string"
}
```

#### Output

```json
{
  "memory_id": "uuid"
}
```

#### Rules

- No overwrites
- Always append
- Optional entity association (best-effort)

### 3.2 `queryMemory(input)`

#### Input

```json
{
  "query": "string",
  "context": "string"
}
```

#### Output

```json
{
  "life_state": "string",
  "recent_memories": [],
  "entities": [],
  "memory_atoms": [],
  "reasoning": {
    "gates_used": []
  }
}
```

### 3.3 `readEntity(id)`

#### Output

```json
{
  "entity": {},
  "linked_memories": [],
  "summary_path": "string"
}
```

### 3.4 `proposeCorrection(input)`

#### Input

```json
{
  "target_id": "uuid",
  "target_type": "memory_atom | entity",
  "action_type": "update | invalidate | supersede",
  "proposed_content": "string"
}
```

### 3.5 `runConsolidation()`

#### Output

```json
{
  "run_id": "uuid",
  "status": "completed | failed"
}
```

### 3.6 `export()`

Returns full dataset as JSON or SQL dump.

---

## 4. Retrieval Flow Contract (Phase 1)

**MANDATORY ORDER**

1. **Classification**
   - Skip memory if not needed

2. **Life-State Load**
   - Always include life-state context when memory retrieval is engaged

3. **Recency Fetch**
   - Query recent `memory_atom` records not yet reflected in the latest projection

4. **Index / Entity Selection**
   - Use `index.md` and entity summaries as the primary retrieval surface

5. **Lexical Fallback**
   - Search `memory_atom.content` only after the prior stages

### Critical Rule

**Never search raw atoms first.**

The implementation may keep retrieval simple in Phase 1, but it must preserve this architectural shape.

---

## 5. Projection Layer (Markdown)

### 5.1 Required Outputs

```text
/index.md
/life_state.md
/entities/{entity_slug}.md
```

### 5.2 Rules

- Fully generated
- Never human-edited as source of truth
- Deterministic rebuild from database state

### 5.3 Citation / Trace Rules

Every material claim in generated summaries must trace back to source memory atoms.

Minimum format:

```text
[source: memory_atom_id]
```

### 5.4 Naming / Slug Rules

- `entity_slug` = lowercase-kebab-case
- Slug should remain stable once created
- If display names change, preserve canonical slug where possible

---

## 6. Consolidation Invariants

- No destructive writes
- Append-first model
- Supersede rather than overwrite
- Locked records cannot be modified by automation
- Contradictions create `review_item`
- Cluster-scoped updates only
- All summaries must be source-cited
- Life-state artifact must be maintained as part of consolidation

---

## 7. Correction / Review State Machine

### States

```text
proposed → under_review → applied | rejected
```

### Rules

- Corrections never directly mutate existing atoms in place
- Corrections may create:
  - a new `memory_atom`
  - a supersession relationship
  - a review item
- Locked atoms and locked outcomes must override later autonomous consolidation decisions
- When ambiguity remains, prefer review over automatic application

---

## 8. Idempotency & Replay Rules

### 8.1 Capture

- Duplicate-safe using stable source reference and/or content fingerprinting
- Replayed capture events must not create duplicate atoms unless explicitly intended

### 8.2 Consolidation

- Safe to rerun
- Must not duplicate summaries, links, or review items from already-processed changes
- Must not corrupt existing trusted state when rerun after interruption

### 8.3 Projection

- Fully rebuildable from database state
- Deterministic output for the same logical input state

### 8.4 Failure Handling

- Partial runs must not commit invalid or half-applied projection state
- Failed runs should preserve last known good projection
- Consolidation run state must make interrupted or failed execution visible

---

## 9. Acceptance Tests

### 9.1 Boxster / Wagoneer

**Input:** hauling task  
**Expected:** cargo-capable vehicle is surfaced instead of a semantically related but functionally wrong vehicle

### 9.2 Mustang Cluster

**Input:** “What do you know about my Mustang?”  
**Expected:** coherent aggregated entity summary rather than scattered fragments

### 9.3 Missing Oracle (Phase 1 Scoped)

**Input:** spring planning scenario  
**Expected:** at minimum:
- life-state context is present
- relevant recent items are surfaced
- relevant entity-linked items are surfaced

Phase 1 is not required to solve full cross-domain oracle reasoning, but it must preserve the retrieval shape that enables that later.

---

## 10. Phase 1 Exit Criteria

- End-to-end capture works
- Retrieval follows the required order
- Life-state artifact exists and is maintained
- Entity summaries are generated
- Index is navigable
- Corrections are safe and traceable
- Projection is deterministic
- System is replay-safe
- Acceptance tests pass

---

## 11. Final Principle

If behavior is ambiguous, prefer:

- append over mutate
- preserve over delete
- explicit over implicit
- simple over clever

Trust > completeness  
Determinism > optimization  
Structure > heuristics
