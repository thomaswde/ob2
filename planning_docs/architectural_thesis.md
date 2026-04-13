# Persistent Associative Memory for AI Agents
## Architectural Thesis

---

### What This Is

This document defines the architectural tenets, design principles, and engineering guidance for building a persistent associative memory system — a substrate that gives AI agents deep, lasting contextual familiarity with one person across every domain of their life.

This is not a knowledge base, a document store, or a wiki. It is memory — broad, deep, associative, and growing continuously from years of daily interaction. The system should simulate the contextual depth of a longtime personal assistant or childhood friend: someone who knows your vehicles, your family context, your unfinished projects, your professional preferences, your health constraints, and the thousand small facts that make every interaction richer because they don't need to be restated.

### The Problem Being Solved

A user interacts with AI agents 3–10 times daily across personal, professional, and domestic domains. Today, approximately 75% of the contextual grounding for each conversation must be manually reconstructed at runtime. Thousands of micro-truths — preferences, constraints, facts, relationships, states, histories — are shared and then evaporate. The agents start functionally amnesiac every session.

The goal is a memory substrate where context accumulates organically so that every future interaction is richer than the last. The system absorbs information through natural conversation, organizes it autonomously, and surfaces the right context at the right moment without being asked.

---

## Part I: Design Principles

### 1. Memory, Not Knowledge Management

The system stores what a person *is*, *has*, *knows*, *prefers*, *has done*, and *is doing* — not documents about those things. The atomic unit is closer to a fact, a preference, or a state than to a page or an article. These atoms cluster naturally into richer structures (a vehicle's full history, a project's evolving state, a person's relationship context), but the atom is the foundation.

This distinction matters because it determines the ingress model: memory primarily enters through conversation, not through deliberate document deposits. The system must be optimized for continuous small-form capture with occasional larger imports, not for batch document processing.

*Source: User requirement analysis. The original research framed this as a "wiki compiler" problem and was rejected for missing the actual use pattern.*

### 2. Two-Layer Architecture

The system requires two distinct layers serving different purposes:

**A structured store** acts as the system of record. It holds atomic memories with full metadata: temporal validity, confidence, importance, decay classification, supersession chains, source attribution, verification state, retrieval history. This layer handles lifecycle management, structured queries, and the bookkeeping that makes memory trustworthy over time. Relational databases are purpose-built for this work; reimplementing it in file metadata is engineering cost with no architectural benefit.

**A compiled navigable layer** serves as the retrieval and browsing surface. It is generated from the structured store by a consolidation process and maintained over time. It provides entity summaries, a master index, category hierarchies, and cross-references — the surfaces that both LLMs and humans can reason through. If this layer is corrupted or stale, it can be regenerated from the structured store. It is a view, not a source of truth.

Neither layer alone is sufficient. The structured store provides reliability and queryability but is opaque to LLMs and humans browsing casually. The navigable layer provides readability and reasoning-friendly structure but cannot handle lifecycle operations, temporal queries, or metadata management. The architecture requires both.

*Sources: Comparative analysis of UCFS (Gemini research, pure-markdown advocacy) vs. hybrid architecture (Grok research, database + graph + markdown). The pure-markdown approach underestimates the reimplementation cost of operations that structured stores provide natively. The hybrid approach overcomplicates by proposing three storage layers where two suffice.*

### 3. Retrieval Must Reason, Not Just Match

Embedding-based vector similarity is a mathematical proxy for semantic relatedness. It is not a proxy for contextual utility. When a user mentions hauling something for an errand, vector search returns a Porsche Boxster (semantically close: vehicle + errand) and misses a Grand Wagoneer (contextually correct: vehicle + cargo capacity). The embeddings are equidistant because they capture distributional semantics, not functional logic about the physical world.

**This is not an edge case. It is the structural failure mode of any retrieval system that substitutes proximity for reasoning.**

The architecture must place a reasoning step between the conversational cue and the data lookup. This layer — variously called the "oracle," "librarian," or "agentic planner" in the literature — inspects the full conversational context, identifies what categories of memory are relevant (obvious and non-obvious), expands the query to capture lateral connections, and directs retrieval with intent rather than hoping similarity will suffice.

Vector search remains a useful tool within this pipeline — it handles fuzzy, weak-cue queries where the user doesn't know exactly what they're looking for. But it operates as one instrument in a pipeline governed by reasoning, not as the pipeline itself.

*Sources: "The Boxster/Wagoneer Problem" (user scenario). Synergizing RAG and Reasoning (arXiv 2504.15909). Anthropic Contextual Retrieval research showing hybrid retrieval reduces failure rates by up to 67%. Agentic RAG planner patterns from GraphRAG literature. Grok research on Agentic Oracle layer.*

### 4. Cheapest First, Escalate on Demand

Not every conversational turn needs deep retrieval. "Sounds good, let's go with that" does not require a graph traversal. "What's the periodic table symbol for iron?" is general knowledge, not personal memory. The system must gate retrieval cost by escalating through progressively more expensive mechanisms only when cheaper ones are insufficient.

This principle applies at every level: retrieval cost per turn, consolidation cost per cycle, and infrastructure complexity over time. No retrieval overlay (embeddings, graph, reasoning trees) should be introduced based on speculation. Each must be justified by a specific, demonstrated failure that simpler mechanisms cannot resolve.

*Source: Claude Code's 7-layer memory architecture, reverse-engineered by Troy Hua, demonstrates this pattern in production — each layer is designed so its existence prevents the next more expensive layer from firing. The staging discipline from the original Grok wiki-compiler research (advance only when a specific benchmark task fails) applies here equally.*

### 5. Ingress and Consolidation Are Separate Concerns

Memory enters the system and memory is organized within the system on fundamentally different timescales and with different quality requirements.

**Ingress** happens during conversation. It must be fast, cheap, and low-friction. The agent making the deposit has the best ground-truth understanding of the memory's importance, confidence, durability, and contextual meaning. This is the moment to score and classify — not later, in a batch process that has lost the conversational context. Ingress writes atomic memories to the structured store with metadata attached.

**Consolidation** happens in the background. It reviews accumulated atomics, clusters related facts into entity profiles, updates the navigable layer (index, summaries, cross-references), detects contradictions, resolves supersessions, and prunes genuine noise. This is expensive, reflective work that should not be in the critical path of conversation.

These must be architecturally distinct — different triggers, different cost profiles, different failure modes, different circuit breakers. Coupling them creates a system that is either too slow at capture or too hasty at organization.

*Sources: Claude Code's session memory vs. dreaming distinction (Troy Hua analysis). NEXO Brain's NREM/REM consolidation cycle (Gemini research). Mem0's extraction/consolidation pipeline (Grok research).*

### 6. Connective Tissue Is Not Optional

Atomic memories without lateral relationships produce synthetic amnesia: the system possesses the data but cannot reconstruct the narrative. Fifty separate mentions of a car restoration project across two years of conversation must coalesce into a coherent cluster. The Mustang must be linked to a "vehicles" grouping alongside the Boxster and the Wagoneer. A child's therapy schedule must be connected to travel planning constraints.

The connective mechanism — whether explicit graph edges, hierarchical categorization, entity clustering, or some hybrid — must be a first-class architectural concern, not a future enhancement. Without it, retrieval cannot traverse from one relevant fact to adjacent relevant facts, and the system fails to simulate the associative quality of human memory.

The mechanism should be appropriate to the scale. At personal scale (thousands to tens of thousands of memories), a relational database with typed relationship records and recursive queries can emulate graph traversal without requiring dedicated graph infrastructure. The trigger to invest in dedicated graph technology is a demonstrated performance failure on multi-hop traversals, not an architectural preference.

*Sources: Mem0 Graph Memory documentation. A-Mem agentic memory architecture (arXiv 2502.12110). "The Mustang Cluster Problem" (user scenario). GraphRAG literature on typed entity relationships.*

### 7. The Oracle Problem Is the Hardest Problem

The most computationally complex challenge is what the research calls "contextual blindness" or the "Missing Oracle" scenario. When a user says "let's plan my spring schedule," the relevant memories span financial (signing bonus), temporal (cancelled trip), project (Mustang restoration), familial (therapy schedule), and behavioral (preference for batching home projects) domains. No single search query — vector, keyword, or otherwise — bridges all of these categories.

The system must maintain some representation of the user's current macro-state: active goals, recent life changes, standing constraints, ongoing projects. This compressed life-state context grounds every interaction so the agent begins from awareness rather than ignorance. The research independently converged on this concept from multiple angles — UCFS's `life_state.md`, Claude Code's `CLAUDE.md` as foundational context, the Grok research's "oracle" planner.

The specific implementation of this macro-state (a maintained file, a dynamically composed context block, a structured summary regenerated by consolidation) is an engineering decision. The architectural requirements are: it exists, it is regenerated by the consolidation process (not constructed at query time), it is available to every agent interaction as grounding context before any query-specific retrieval occurs, and it is size-constrained to remain a cheap, cacheable preamble rather than a context-window burden.

*Sources: UCFS life_state.md concept (Gemini research). Claude Code CLAUDE.md as persistent foundational context (Troy Hua analysis). Agentic RAG planner patterns. "The Missing Oracle" (user scenario).*

### 8. Durability Is a First-Class Attribute

Not all memories are created equal. "Thomas is 5'10"" is a permanent biographical fact. "Thomas has a broken toe" is a transient condition. "Thomas needs to troubleshoot a toy battery" is ephemeral noise that holds near-zero future retrieval value.

The capturing agent must classify durability at ingress — it is the entity with the richest contextual understanding of whether a fact is permanent, durable, temporary, or throwaway. This classification drives downstream behavior: consolidation priority, index inclusion, retrieval weighting, and eventual pruning.

Crucially, low-durability memories should not be deleted — they should *sink*. A toy battery troubleshooting session from 2021 should never surface in 2029 unless the user is literally discussing dead toy batteries. The memory exists in the store but is effectively invisible to normal retrieval, discoverable only under direct topical relevance. This mirrors human memory: we don't delete the trivial, we simply stop retrieving it unless cued.

*Sources: Open Brain decay_class system (profile, preference, relationship, decision, task, ephemeral). NEXO Brain's Ebbinghaus-inspired adaptive decay (Gemini research). User requirement: "it should never surface into context unless I'm literally talking about troubleshooting a toy."*

### 9. Agent Agnosticism Is a Hard Requirement

The memory substrate must be model-agnostic and provider-agnostic. The user should be able to connect any agent — Claude, Grok, Gemini, a local model, a future model that doesn't exist yet — and have that agent immediately inherit the full depth of accumulated context. Switching models mid-conversation, changing providers next year, or running multiple agents simultaneously against the same memory must all be supported without migration friction.

This means the memory interface must be a protocol, not an integration. MCP (Model Context Protocol) is the current best implementation of this pattern, but the architecture should not be deeply coupled to MCP's specific transport or schema conventions. The memory is accessed through tool calls that any agent framework can implement: query memory, capture memory, read entity, propose update. The substrate doesn't care who's asking.

*Sources: MCP specification (modelcontextprotocol.io). User requirement: "the specific agent couldn't matter less — that's the beauty of a shared memory substrate." UCFS MCP integration concept (Gemini research).*

### 10. Human Navigability Is a Trust Requirement

If the user cannot browse, search, audit, and correct their own memory, they will not trust it. Trust erosion is the primary long-term risk to system adoption — more dangerous than any retrieval failure, because a retrieval failure is a bug while a trust failure means the system gets abandoned.

The human interface does not need to be elaborate. It needs to be reliable: search that finds what you're looking for, browsable structure that lets you explore by topic, and the ability to correct or lock memories the system got wrong. The compiled navigable layer (entity summaries, category hierarchies, master index) can serve double duty as both the LLM's retrieval surface and the human's browsing surface — this is the most efficient path if the format is human-readable.

The user must have the ability to lock specific memories or sections against autonomous modification. If the user hand-corrects a fact and the next consolidation cycle overwrites it, trust collapses within a week.

*Sources: UCFS human_locked frontmatter concept (original wiki-compiler research). User requirement: "nothing worse than knowing that tidbit is somewhere in this filesystem and I literally can't find it."*

### 11. Circuit Breakers on Every Autonomous Process

Every process that runs without human supervision — consolidation, the oracle retrieval layer, automatic ingress scoring — must have failure detection and automatic shutdown thresholds. Consolidation that hallucinates merges should stop and flag for review, not continue corrupting data. An oracle that consistently fails to find useful context should degrade gracefully to simpler retrieval, not burn tokens on fruitless reasoning.

The safety net for consolidation errors is version control (git or equivalent), but this is a recovery mechanism, not a substitute for failure prevention. The system should not require the user to regularly audit and revert.

*Source: Claude Code circuit breaker patterns — autocompact 3-strike limit, dream lock with stale PID detection, sequential execution wrappers (Troy Hua analysis). UCFS Git-based recovery (Gemini research).*

### 12. Portability Over Everything

The system is designed for decades of use. Over that horizon, every infrastructure component — the database, the LLM provider, the agent framework, the hosting platform — will change at least once. The data must survive all of these transitions.

This means: the structured store must be exportable to a standard format (JSON, CSV, SQL dump). The navigable layer is inherently portable if it's maintained as plain-text files. The schema must be documented well enough that a future system can ingest the data without access to the original codebase. No proprietary formats, no vendor-locked storage, no data that exists only as opaque embeddings without a corresponding human-readable representation.

Embeddings are derived artifacts. They can be regenerated from source text with any future embedding model. The text content and metadata are the durable record.

*Sources: MIF (Memory Interchange Format) portability standard concepts (Gemini research). User requirement: "as long as it's extractable it can be massaged into a new schema somehow." User requirement: "a project I use and build on and get value from for many many years."*

---

## Part II: Architectural Guidance

### The Retrieval Pipeline

Retrieval follows a gated cascade from cheapest to most expensive:

**Gate 0 — Classification.** Is this turn a general knowledge question, a task prompt with provided context, or a simple conversational continuation? If so, skip memory retrieval entirely. Most turns should exit here.

**Gate 1 — Life-state grounding.** A compressed macro-state representation (active goals, recent changes, standing constraints, current projects) is available to the agent at all times. This is maintained by the consolidation process, not constructed at query time. It provides ambient awareness without per-turn cost.

**Gate 1.5 — Recency bridge.** Before consulting the compiled navigable layer, the pipeline queries the structured store for memories captured since the last consolidation run. This ensures that facts deposited minutes ago are immediately available for retrieval without waiting for background consolidation. This is a simple timestamp-filtered query against the structured store, not a full retrieval operation. It closes the read-after-write gap inherent in any system with asynchronous compilation.

**Gate 2 — Index-guided retrieval.** The master index (a constrained, one-line-per-entry summary of the navigable layer) is loaded and reasoned through. The agent identifies which entity summaries, topic clusters, or category branches are relevant and reads them selectively. This is the primary retrieval mechanism at personal scale and handles the vast majority of queries correctly.

**Gate 3 — Expanded retrieval.** For queries where index navigation is insufficient — weak cues, ambiguous topics, cross-domain connections — the oracle layer performs query expansion, identifies non-obvious retrieval targets, executes vector search as a fuzzy supplement, and re-ranks results by contextual utility rather than similarity score. This gate handles the Boxster/Wagoneer class of problems.

**Gate 4 — Multi-hop traversal.** For queries requiring lateral connection across entities (the Missing Oracle scenario), the system traverses relationships in the structured store — following entity links, category membership, temporal adjacency — to gather the full relevant context before synthesis.

The pipeline should be instrumented. Track which gates fire, how often, and whether the retrieved context was actually used. This data drives future optimization and identifies when to invest in more sophisticated mechanisms.

*Sources: Claude Code layered defense architecture (Troy Hua). IGR mechanism (Gemini research, coleam00/claude-memory-compiler). Agentic Oracle planner (Grok research). Anthropic Contextual Retrieval hybrid pipeline.*

### The Consolidation Cycle

Consolidation runs as a background process, separate from conversation. Its responsibilities:

**Entity clustering.** Identify when multiple atomic memories refer to the same entity (person, vehicle, project, place) and establish/maintain relationships. This is the mechanism that turns 50 scattered Mustang mentions into a coherent cluster. Critically, consolidation operations must be scoped to entity clusters — a new Mustang fact is evaluated against the existing Mustang cluster, not against the entire corpus. This keeps consolidation cost linear in the number of new memories per cycle rather than quadratic in total corpus size.

**Summary maintenance.** Generate and update entity summary documents in the navigable layer — rich, citation-grounded profiles that consolidate what the system knows about each significant entity or topic. These summaries must cite their source atomics; uncited claims in summaries are a data integrity failure.

**Index maintenance.** Rebuild or update the master index to reflect new entities, changed states, and evolved relationships. The index has hard size constraints (the Karpathy principle: an LLM can navigate millions of items if the index is well-curated, but only if the index fits in a context window). When the index approaches its size limit, it should partition into categorical sub-indexes with a root navigator.

**Contradiction detection.** When new information conflicts with existing memories, flag the contradiction explicitly rather than silently resolving it. The consolidation process does not have the conversational context to judge which version is correct. Contradictions surface as review items for the user or for the next conversational interaction to resolve.

**Pruning.** Remove genuine noise — duplicates, fully superseded chains where the historical record adds no value, ephemeral memories past their useful lifespan. Pruning is the most dangerous consolidation operation and should be the most conservative. When uncertain, keep.

**Safety invariant for all consolidation writes:** Merges and updates produced by consolidation are provisional until verified — either by user confirmation, by citation-checking against source atomics, or by surviving a subsequent consolidation cycle without contradiction. User-corrected memories must be marked as locked against autonomous re-merge. A consolidation cycle that cannot verify its proposed changes should leave the existing state intact rather than committing uncertain modifications.

The consolidation process should follow a disciplined protocol: orient (understand current state), gather (identify new signal), consolidate (update structured store and navigable layer), prune (remove noise and update index). At each phase, the operative instruction is restraint: don't exhaustively process everything, focus on what has changed since last consolidation. Don't merge aggressively — a missed merge is recoverable, a hallucinated merge destroys trust.

*Sources: Claude Code dreaming four-phase protocol (Troy Hua). NEXO Brain NREM/REM consolidation cycle (Gemini research). AgentCore ADD/UPDATE/NO-OP classification framework (AWS). Mem0 extraction/consolidation pipeline (Grok research).*

### The Structured Store

The system of record holds atomic memories with metadata sufficient for lifecycle management:

**Content** — the memory itself, as a clear standalone statement.  
**Temporal validity** — when the fact became true, when it stopped being true (if applicable).  
**Confidence** — how certain the capturing agent was about this information.  
**Importance** — how significant this fact is to understanding the user's life, work, or needs.  
**Durability classification** — the expected lifespan category of this memory.  
**Supersession** — what this memory replaces, and what (if anything) has replaced it.  
**Source attribution** — which agent, which conversation, when.  
**Verification state** — whether the user has confirmed this memory's accuracy.  
**Retrieval history** — how often and how recently this memory has been accessed.  
**Entity relationships** — typed links to other memories or entity groupings.  
**Embeddings** — vector representations for fuzzy retrieval, stored as derived artifacts alongside the source text.

Entity relationships at personal scale can be modeled as typed records in the same relational store (entity_id, relationship_type, related_entity_id) rather than requiring dedicated graph infrastructure. The trigger for dedicated graph technology is a measured performance failure on multi-hop traversals at actual corpus scale — not anticipated future need.

### The Navigable Layer

The compiled surface generated from the structured store. Its format should be human-readable plain text (markdown is the current best candidate: LLM-native, human-readable, git-friendly, tooling-rich). It consists of:

**A master index** — one line per entity or topic, summarizing what the system knows. Size-constrained. This is the primary artifact the LLM reads at retrieval time.  
**Entity summaries** — richer profiles synthesized from atomic memories, with citations back to source. These are what the LLM reads when it drills down from the index.  
**Category structure** — hierarchical organization by domain (vehicles, family, work, health, projects, etc.) for human browsing and for the LLM's category-level reasoning.  
**Cross-references** — links between related entities and topics, enabling lateral navigation.

This layer is regenerable. If it drifts or corrupts, the consolidation process rebuilds it from the structured store. It is not the source of truth — it is the most useful *view* of the truth.

**The navigable layer is read-only for humans.** Users browse and search it freely, but corrections and edits route through the structured store — either via the agent interface ("this fact is wrong, the Mustang has a 289, not a 302") or a lightweight correction interface that writes to the store. The next consolidation cycle regenerates the affected summaries. This eliminates the bidirectional sync problem between a relational database and human-editable files: the navigable layer is always a one-way projection from the store, never a co-equal source of truth that must be reverse-parsed into structured mutations.

### The Memory Interface

The system is accessed through a tool interface (currently MCP) that any agent can connect to. The interface exposes operations, not implementation:

**Query** — given conversational context, return relevant memories. This is the entry point for the full retrieval pipeline.  
**Capture** — store a new atomic memory with metadata. This is the fast-path ingress used during conversation.  
**Read** — access a specific entity summary, memory, or section of the index. Used for directed lookup.  
**Propose update** — suggest a modification to an existing memory. Updates from agents land as proposals, not direct writes, unless confidence is very high and the pattern is well-established (e.g., supersession of a clearly outdated fact).  
**Browse** — navigate the category structure and index. Used by both humans and agents for exploration.

The interface should be thin. The intelligence lives in the retrieval pipeline and the consolidation process, not in the tool definitions. A tool call that returns well-selected context is more valuable than a sophisticated API with poor selection logic behind it.

A companion system prompt or skill stanza instructs connected agents on *when* to use the memory interface: any conversational topic that touches the user's personal context, state, history, preferences, or ongoing projects should trigger a query. General knowledge questions and pure task prompts with self-contained context should not. Agents should capture durable facts that emerge from conversation — things that alter the user's observable state, preferences, constraints, or future availability — without capturing transient conversational mechanics.

---

## Part III: Scale, Limits, and Failure Signals

### Personal Scale Calibration

This system serves one person. The corpus will grow from hundreds of memories to potentially tens of thousands over years. It will not reach hundreds of thousands of memories because human lives, while rich, generate a bounded amount of durable context. The architecture should be calibrated for this scale — simple mechanisms that work reliably at 10K memories are preferable to powerful mechanisms designed for 10M that introduce operational complexity.

Andrej Karpathy's observation applies directly: curated, well-organized content can hold millions of unique items and remain LLM-navigable if the curation is maintained. At personal scale, the curation is the bottleneck, not the storage or retrieval infrastructure.

*Source: Karpathy LLM Knowledge Base architecture (VentureBeat, MindStudio coverage). UCFS scaling analysis (Gemini research).*

### Failure Signals and Escalation Triggers

Each architectural component has a measurable failure mode that signals when to add complexity:

**Index-guided retrieval failing** (relevant memories missed despite being in the index) → the index has grown too large or too sparse. Partition into sub-indexes or add embedding-based pre-filtering.

**Weak-cue queries consistently missing** (user asks about something the system knows but can't find via index) → add or improve the vector search layer as a fuzzy retrieval supplement.

**Multi-hop traversals too slow** (crossing entity relationships takes unacceptable time) → evaluate dedicated graph infrastructure to replace relational joins.

**Consolidation producing bad merges** (user discovers hallucinated combinations or lost nuance) → tighten consolidation prompts, add citation verification, reduce merge aggressiveness, increase human review surface.

**Oracle over-retrieving** (context window bloated with marginally relevant memories) → add token budgets and a reflection step where the oracle self-critiques its selections before injection.

Do not add any overlay or mechanism preemptively. Each must be justified by a specific, observed failure at actual operating scale.

### Cost Profile

At personal scale with current frontier model pricing, the system's ongoing cost should be modest:

**Per-turn retrieval:** Index load + selective reads. Primarily input tokens, heavily cacheable. The life-state context and master index are stable across turns and benefit from prompt caching.

**Per-turn ingress:** Metadata extraction and scoring during capture. One lightweight LLM call per captured memory.

**Consolidation:** The most expensive operation, but infrequent (daily or triggered by change volume). Token cost scales with the number of new memories to process, not the total corpus size.

**Infrastructure:** A single relational database instance and file storage. No dedicated vector database, graph database, or search engine required at personal scale.

The estimated run rate at 10 interactions per day should be in the low tens of dollars per month, dominated by LLM API costs for retrieval reasoning and consolidation.

---

## Appendix: Reference Scenarios

These three scenarios were used throughout the research process to evaluate architectural decisions. Any implementation should be validated against all three.

**Scenario 1: The Boxster/Wagoneer Problem** (retrieval reasoning). User mentions needing to haul something. The system must surface the Grand Wagoneer (cargo capacity) rather than the Porsche Boxster (semantic proximity to "vehicle + errand"). Tests whether retrieval can reason about functional utility rather than matching on similarity.

**Scenario 2: The Mustang Cluster Problem** (connective tissue). User asks "what do you know about my Mustang?" after mentioning it across 50 separate conversations over 2 years. The system must return a comprehensive, coherent narrative — not 2-3 random fragments. Tests whether the consolidation mechanism produces usable entity profiles from scattered atomics.

**Scenario 3: The Missing Oracle Problem** (contextual breadth). User says "let's plan my spring schedule." The system must proactively surface a cancelled trip (freed time), a signing bonus (freed budget), an unfinished car project (opportunity), and a child's therapy schedule (constraint) — without being asked about any of them. Tests whether the system can reason across domains and identify non-obvious relevance.

---

## Appendix: Research Sources

This thesis synthesizes findings from three independent research streams:

**Stream 1 (Gemini):** Proposed the Unified Cognitive File-System (UCFS) — a pure-markdown, Git-versioned architecture with Index-Guided Retrieval, bi-temporal YAML frontmatter, W3C PROV graph edges, and a nightly "sleep cycle" consolidation process. Primary contributions to this thesis: the IGR mechanism, the life_state.md oracle concept, the consolidation cycle structure, and the sleep-cycle metaphor. Cited papers: Continuum Memory Architectures (arXiv 2601.09913), PageIndex/RT-RAG vectorless retrieval, Anthropic Contextual Retrieval, A-Mem, MIF standard, NEXO Brain, AgentCore.

**Stream 2 (Grok):** Proposed Index-Guided Graph Memory with Agentic Oracle Layer — a hybrid architecture combining Karpathy-style markdown, Mem0-style extraction, GraphRAG-style entity graphs, and Claude-inspired memory hints. Primary contributions: the hybrid retrieval pipeline (graph + vector + re-ranker), the oracle/planner layer concept, pragmatic integration with existing infrastructure, and phased implementation guidance. Sources: Claude Code March 2026 leak analysis, Karpathy LLM-native KB, Mem0 production pipeline, GraphRAG papers, X community discussions.

**Stream 3 (Troy Hua / Claude Code analysis):** Reverse-engineering of Claude Code's 7-layer memory architecture. Primary contributions: cheapest-first gating cascade, session memory vs. dreaming architectural split, MEMORY.md index pattern with hard size constraints, four-phase consolidation protocol, circuit breaker patterns, and the principle that each layer should prevent the next more expensive layer from firing.

**Prior art (Open Brain v1):** The user's existing memory system provided the proven schema foundation: decay classes, importance/confidence scoring, supersession chains, temporal validity, verification state, retrieval tracking, and source attribution. These concepts are validated through actual use and are incorporated as requirements throughout this thesis.