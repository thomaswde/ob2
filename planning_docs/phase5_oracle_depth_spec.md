# Phase 5 Spec: Oracle Depth

**Date:** 2026-04-14  
**Branch context:** `codex/phase-4-transports-2026-04-14`  
**Status:** Ready for implementation

---

## Background

A ground-truth audit against the architectural thesis identified three gaps where the implementation has the correct shape but insufficient depth. All three touch the same theme: the system retrieves by routing, not by reasoning. The infrastructure is sound — the gaps are in prompts, a missing gate, and concatenation where synthesis should be.

The three issues are independent and can be addressed in any order.

---

## Gap 1 — Gate 2 oracle prompt is a router, not a reasoner

### What exists

`MemoryQueryService.ts:203-215`

```ts
const gate2 = await timeStep("gate2", async () =>
  this.languageModel.extract(`Query: ${text}\nIndex:\n${indexContent}`, { type: "entity-selection" }),
);
```

`ClaudeSonnetLanguageModel.ts:99-104`

```ts
async extract(prompt: string, _schema: ExtractSchema): Promise<EntitySelectionResult> {
  return this.invokeJson<EntitySelectionResult>(
    "Select relevant entity slugs from the provided markdown index. Return JSON: {\"slugs\": string[], \"confidence\": \"high\"|\"low\"}.",
    prompt,
  );
}
```

### The problem

The system prompt asks the LLM to "select relevant entity slugs." That's passive relevance matching. The LLM reads the query, pattern-matches against entity names and 100-char summaries, and returns what looks topically close.

It does not:
- Reason about what the user's *actual need* is versus what they literally said
- Surface entities that are functionally relevant but not semantically adjacent ("I need to haul something" → cargo capacity → Grand Wagoneer, not the Boxster)
- Cross domains proactively (spring schedule planning → surfaces financial, temporal, project, and family-constraint entities without being asked about any of them)
- Use the user's current macro-state (life_state) to inform which lateral connections matter right now

### The fix

**Two changes, both in `ClaudeSonnetLanguageModel.ts` and `MemoryQueryService.ts`:**

**1. Pass life_state context into Gate 2.**

In `MemoryQueryService.ts`, change the Gate 2 call to include the already-loaded `lifeState` string in the prompt:

```ts
const gate2 = await timeStep("gate2", async () =>
  this.languageModel.extract(
    `Query: ${text}\n\nUser current state:\n${lifeState}\n\nEntity index:\n${indexContent}`,
    { type: "entity-selection" },
  ),
);
```

`lifeState` is already loaded at Gate 1 — this is a free addition.

**2. Replace the system prompt with oracle-mode reasoning instructions.**

In `ClaudeSonnetLanguageModel.ts`, replace the `extract()` system prompt:

```ts
// Before
"Select relevant entity slugs from the provided markdown index. Return JSON: {\"slugs\": string[], \"confidence\": \"high\"|\"low\"}."

// After
`You are a memory oracle for a personal AI assistant. Given a user query and their current life state, identify which entities in the index are relevant — including non-obvious lateral connections the user did not explicitly mention.

Think in two passes:
1. Direct: entities the query obviously concerns.
2. Lateral: entities that are relevant given the user's current situation, goals, or constraints — even if unmentioned. For example, a query about scheduling might implicate financial state, ongoing projects, or family constraints that affect available time or budget.

Return JSON: {"slugs": string[], "confidence": "high"|"low"}.
confidence is "low" if the query is ambiguous or the index lacks sufficient context.`
```

**Acceptance criteria:**
- A query like "let's plan my spring schedule" against the morgan.json fixture corpus returns slugs for entities across at least two domains (e.g., travel, finance, family, vehicles) — not just calendar/scheduling entities.
- A query like "I need to haul some lumber" returns a vehicle entity with cargo capability, not a sports car.
- The `StubLanguageModel` does not need changes (it already accepts any prompt and returns pre-computed responses). Add a new stub scenario if needed for the multi-domain test case.
- Existing Gate 2 tests in `phase2.integration.test.ts` continue to pass.

---

## Gap 2 — Gate 4 (multi-hop traversal) is unimplemented

### What exists

`entity_link` records are created during consolidation in `ConsolidationService.ts`. The repository has `listEntityLinksForEntity(entityId)` (defined in `repository.ts:52`). The retrieval pipeline stops at Gate 3. Gate 4 does not exist.

### The problem

Entity links are write-only from the query path's perspective. The connective tissue is stored but never traversed. The architectural thesis defines Gate 4 as:

> "For queries requiring lateral connection across entities (the Missing Oracle scenario), the system traverses relationships in the structured store — following entity links, category membership, temporal adjacency — to gather the full relevant context before synthesis."

Without Gate 4, a query that correctly reaches one entity cannot propagate to related entities that would together form a complete picture.

### The fix

Add Gate 4 to `MemoryQueryService.ts` as a one-hop traversal after Gate 2 entity files are loaded.

**Logic:**

```
For each entity slug returned by Gate 2:
  1. Look up entity.id from the index entry (requires index to carry entity_id, or a repository lookup)
  2. Call repository.listEntityLinksForEntity(entity.id)
  3. For each link where link.confidence == "high":
     a. Look up the linked entity slug from the index
     b. If slug not already in the Gate 2 result set, load the entity file
     c. Add to results with source marker "gate4"
  4. Cap at 3 linked entities total to prevent context bloat
```

**New types needed** — add to `QueryMemoryResult.reasoning`:

```ts
gate4LinkedSlugs?: string[];  // slugs surfaced by traversal, not Gate 2
```

**Gate 4 fires when:** Gate 2 confidence is "high" AND the Gate 2 result has at least one entity AND `entity_link` records exist for those entities.

Gate 4 does **not** fire when Gate 2 was low-confidence (fallback already went to Gate 3 lexical). Gate 3 and Gate 4 are alternatives, not sequential.

**`gatesUsed` value:** `"gate4"` appended alongside `"gate2"` (not instead of it).

**Repository access:** `listEntityLinksForEntity` is already on the Repository interface. No schema changes needed.

**Index needs entity_id:** Currently `parseIndexEntries()` in `MemoryQueryService.ts:37-54` parses `categorySlug` and `slug` from the index markdown but not `entity_id`. To do repository lookups by entity id from a slug, either:
- Add a `getEntityBySlug(slug)` call per entity (already on Repository interface at `repository.ts:37`), or
- Encode `entity_id` in the index.md line format during projection compilation (preferred: avoids per-entity DB round trips at query time)

Preferred approach: update `ConsolidatedProjectionCompiler.ts:134` to embed entity_id in the index line as a query param or suffix, and update `parseIndexEntries()` to extract it. Example format:

```md
- [Morgan Chen](entities/family/morgan-chen.md?id=uuid-here) — Senior engineer at ExtraHop…
```

Or simpler, a separate field after the summary:

```md
- [Morgan Chen](entities/family/morgan-chen.md) — Senior engineer at ExtraHop… <!-- id:uuid-here -->
```

Choose the format that parses cleanly with a simple regex. The embedded id avoids a DB round-trip per entity during Gate 4 traversal.

**Acceptance criteria:**
- A test corpus with at least two linked entities (A → B via entity_link) demonstrates that querying for A also returns B's entity file in the result.
- `gatesUsed` includes `"gate4"` in this case.
- `gate4LinkedSlugs` is populated in reasoning.
- Cap of 3 linked entities is enforced.
- Gate 4 does not fire when Gate 2 confidence is low.
- All existing phase2 integration tests continue to pass.

---

## Gap 3 — `life_state.md` is concatenated, not synthesized

### What exists

`ConsolidatedProjectionCompiler.ts:25-51` — `buildLifeState()`:

```ts
function buildLifeState(groups: Map<string, MemoryAtom[]>): string {
  const sections: string[] = [];
  for (const [category, atoms] of [...groups.entries()].sort(...)) {
    sections.push(`## ${category}`);
    for (const atom of atoms) {
      sections.push(`- ${atom.content} [source: ${atom.id}]`);
    }
    sections.push("");
  }
  // ... byte-limit truncation
}
```

This is a mechanical list of atoms tagged `decay_class = "task"` or otherwise classified as life_state, grouped by category, then truncated to 2048 bytes.

### The problem

The architectural thesis requires life_state.md to be a "compressed macro-state representation" — an intelligible cross-domain narrative about the user's current situation that grounds every agent interaction. The thesis specifies:

> "active goals, recent life changes, standing constraints, ongoing projects"
> "ambient awareness without per-turn cost"

What's produced by concatenation: a categorized bullet list of whatever atoms got tagged as life_state. There's no synthesis across categories, no narrative about how constraints interact, no signal about what matters *right now* versus background state.

Example: if Morgan has atoms tagged life_state across work (signing bonus incoming), travel (Canada trip cancelled), family (Noah's Thursday therapy), and vehicles (Mustang restoration stalled), the current output is four category sections with bullet points. A synthesized output would read:

> "Morgan is 8 months into a senior role at ExtraHop with deferred compensation clearing Q2. The cancelled Canada trip frees March bandwidth; Noah's Thursday therapy is a standing weekly constraint. The Mustang restoration is stalled pending spring garage access."

That's a 50-token paragraph versus a 150-token bullet list — and the paragraph is what the oracle reasoning in Gate 2 can actually use.

### The fix

**Add a new method to `LanguageModel`** in `src/domain/languageModel.ts`:

```ts
export interface LifeStateSynthesisInput {
  atomsByCategory: Array<{
    categoryName: string;
    atoms: EntitySummarySourceAtom[];
  }>;
}

export interface LifeStateSynthesisResult {
  narrative: string;  // prose paragraph, max ~200 words
  confidence: "high" | "low";
}

// Add to LanguageModel interface:
synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult>;
```

**Implement in `ClaudeSonnetLanguageModel.ts`:**

```ts
async synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
  return this.invokeJson<LifeStateSynthesisResult>(
    `You are synthesizing a compressed life-state narrative for a personal AI memory system. Given atoms from multiple life domains, produce a short prose paragraph (under 150 words) describing the user's current situation: active goals, recent changes, standing constraints, and ongoing projects. Write from facts only — no speculation. Integrate cross-domain connections where they exist (e.g., a financial event that affects a project, a schedule constraint that limits travel). Return JSON: {"narrative": string, "confidence": "high"|"low"}.`,
    JSON.stringify(input, null, 2),
    600,
  );
}
```

**Add stub implementation in `StubLanguageModel.ts`:**

```ts
async synthesizeLifeState(_input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult> {
  return {
    narrative: "User is actively working on software projects with standing family constraints on Thursdays. Recent travel cancellation frees spring bandwidth. Financial milestone expected Q2.",
    confidence: "high",
  };
}
```

**Wire into `ConsolidatedProjectionCompiler.ts`:**

Replace the `buildLifeState()` call in `compile()`:

```ts
// Before (line ~151):
await writeFile(path.join(this.tempDir, "life_state.md"), `${buildLifeState(lifeStateGroups)}\n`, "utf8");

// After:
const lifeStateInput: LifeStateSynthesisInput = {
  atomsByCategory: [...lifeStateGroups.entries()].map(([categoryName, atoms]) => ({
    categoryName,
    atoms: formatSourceAtoms(atoms),
  })),
};
const lifeStateSynthesis = await this.languageModel.synthesizeLifeState(lifeStateInput);
const lifeStateContent = lifeStateSynthesis.confidence === "high"
  ? lifeStateSynthesis.narrative
  : buildLifeState(lifeStateGroups);  // fallback to concatenation if low confidence
await writeFile(path.join(this.tempDir, "life_state.md"), `${lifeStateContent}\n`, "utf8");
```

The fallback to `buildLifeState()` (concatenation) when confidence is low preserves the existing behavior as a safe degraded mode. Keep `buildLifeState()` in the file for this purpose.

**Remove the byte-limit truncation loop from `buildLifeState()`** — the LLM synthesis enforces the 150-word limit natively. Keep the truncation only in the fallback path.

**Acceptance criteria:**
- After a consolidation run against morgan.json fixture, `memory/life_state.md` contains a prose paragraph with cross-domain integration, not a categorized bullet list.
- If `synthesizeLifeState()` returns `confidence: "low"`, the file falls back to concatenated bullets (existing behavior).
- The stub LLM produces a non-empty narrative for consolidation tests.
- All phase3 integration tests pass (they use the stub LLM, so the output changes but the test structure should accommodate it — update assertions that check for bullet-list format if any exist).

---

## Implementation Notes

### Order of work

The three gaps are independent. Suggested order by effort/impact ratio:

1. **Gap 1 (Gate 2 prompt)** — smallest change, largest oracle impact. Two file edits: one prompt string, one prompt assembly change.
2. **Gap 3 (life_state synthesis)** — medium effort. New LLM method + stub + compiler wiring. Directly improves the quality of Gate 1 context that Gap 1 will reason over.
3. **Gap 2 (Gate 4 traversal)** — most structural. Requires index format change, new gate logic, repository traversal, and new reasoning fields.

Doing 1 and 3 before 2 means Gate 4, when built, immediately benefits from the richer life_state context at Gate 1.

### Do not add

- Vector embeddings or pgvector — not yet justified by scale failure
- Graph database — entity_link in Postgres is sufficient for one-hop traversal
- New transport endpoints — these are internal pipeline changes
- New configuration knobs — keep the existing automation/threshold config surface

### Test strategy

Each gap has an acceptance criterion above. The existing test infrastructure (stub LLM, in-memory repository, morgan.json fixture) can cover all three without touching Postgres or the Anthropic API.

For Gap 2 Gate 4: the morgan.json fixture should have entity_link records to test against. If the fixture doesn't produce them from consolidation (requires a real consolidation run), add a repository seeding helper in the test that inserts a direct entity_link between two morgan entities (e.g., Morgan Chen → ExtraHop as `member_of`).

For Gap 1: assert that the Gate 2 LLM prompt passed to `extract()` contains the `lifeState` string. The prompt assembly change is testable by inspecting the call arguments to the stub.

For Gap 3: assert that after compilation with a stub LLM, `memory/life_state.md` content matches the stub's narrative output, not a bullet list format.
