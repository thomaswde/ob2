import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectionRebuilder } from "../src/app/ProjectionRebuilder.js";
import { MemoryQueryService } from "../src/app/MemoryQueryService.js";
import { captureMemory } from "../src/app/captureMemory.js";
import { loadFixtures } from "../src/app/fixtures.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { QUERY_HARD_CAP_TOKENS } from "../src/domain/constants.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";
import { makeId } from "../src/utils/crypto.js";
import { slugify } from "../src/utils/text.js";

function bundleChars(result: Awaited<ReturnType<MemoryQueryService["query"]>>): number {
  const entityChars = result.entities.reduce((sum, entity) => sum + entity.summary.length + entity.content.length, 0);
  const recentChars = result.recent.reduce((sum, atom) => sum + atom.content.length, 0);
  const fallbackChars = (result.fallbackAtoms ?? []).reduce((sum, atom) => sum + atom.content.length, 0);
  return result.lifeState.length + entityChars + recentChars + fallbackChars;
}

describe("Phase 2 services", () => {
  const repository = new InMemoryRepository();
  const fixturePath = path.resolve(process.cwd(), "fixtures", "morgan.json");
  let rootDir: string;
  let queryService: MemoryQueryService;

  beforeAll(async () => {
    await repository.seedTopLevelCategories();
    await loadFixtures(repository, fixturePath);
    rootDir = await mkdtemp(path.join(os.tmpdir(), "ob2-phase2-"));
    await new ProjectionRebuilder(repository, rootDir).rebuild();
    queryService = new MemoryQueryService(repository, new StubLanguageModel(), rootDir);
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rebuilds a deterministic markdown projection", async () => {
    const firstIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");
    const firstLifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");

    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const secondIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");
    const secondLifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");
    const bmwFile = await readFile(path.join(rootDir, "memory", "entities", "vehicles", "bmw-r75-5.md"), "utf8");

    expect(firstIndex).toBe(secondIndex);
    expect(firstLifeState).toBe(secondLifeState);
    expect(firstIndex).toContain("[BMW R75/5](entities/vehicles/bmw-r75-5.md?id=");
    expect(bmwFile).toContain("[source:");
  });

  it("skips retrieval for general knowledge queries", async () => {
    const result = await queryService.query("what's the capital of France");
    expect(result.reasoning.classifierDecision.needsMemory).toBe(false);
    expect(result.entities).toHaveLength(0);
    expect(result.recent).toHaveLength(0);
  });

  it("retrieves entities even when the projected summary is empty", async () => {
    const work = await repository.getEntityByName("work");
    expect(work).toBeTruthy();

    await repository.createEntity({
      id: makeId(),
      name: "Empty Archive",
      slug: slugify("Empty Archive"),
      type: "other",
      parentEntityId: work!.id,
    });
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await queryService.query("tell me about Empty Archive");
    expect(result.entities.some((entity) => entity.slug === "empty-archive")).toBe(true);
  });

  it("surfaces just-captured atoms through the recency bridge", async () => {
    await captureMemory(repository, {
      content: "Morgan prefers aisle seats for work travel.",
      sourceRef: "phase2:recent",
      entityHint: "Morgan Chen",
      importance: 0.77,
      decayClass: "preference",
    });
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await queryService.query("what travel preferences do I have");
    expect(result.recent.some((atom) => atom.content.includes("aisle seats"))).toBe(true);
  });

  it("answers vehicle queries from Gate 2 without falling back to Gate 3", async () => {
    const result = await queryService.query("what vehicles do I own");

    expect(result.entities.some((entity) => entity.slug === "bmw-r75-5")).toBe(true);
    expect(result.entities.some((entity) => entity.slug === "subaru-outback")).toBe(true);
    expect(result.reasoning.gatesUsed.includes("gate3")).toBe(false);
    expect(result.reasoning.gate2Confidence).toBe("high");
  });

  it("passes life state context into Gate 2 selection", async () => {
    let capturedPrompt = "";
    const promptAwareService = new MemoryQueryService(
      repository,
      new StubLanguageModel({
        extract: (prompt) => {
          capturedPrompt = prompt;
          return {
            slugs: ["morgan-chen"],
            confidence: "high",
          };
        },
      }),
      rootDir,
    );

    await promptAwareService.query("let's plan my spring schedule");

    const expectedLifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");
    expect(capturedPrompt).toContain("User current state:");
    expect(capturedPrompt).toContain(expectedLifeState.trim());
  });

  it("traverses high-confidence entity links through Gate 4", async () => {
    const morgan = await repository.getEntityByName("Morgan Chen");
    const extrahop = await repository.getEntityByName("ExtraHop");
    expect(morgan).toBeTruthy();
    expect(extrahop).toBeTruthy();

    await repository.createEntityLink({
      id: makeId(),
      entityId: morgan!.id,
      relatedEntityId: extrahop!.id,
      relationshipType: "related_to",
      confidence: 0.95,
    });
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await new MemoryQueryService(
      repository,
      new StubLanguageModel({
        extract: () => ({
          slugs: ["morgan-chen"],
          confidence: "high",
        }),
      }),
      rootDir,
    ).query("where do I work");

    expect(result.reasoning.gatesUsed).toContain("gate4");
    expect(result.reasoning.gate4LinkedSlugs).toContain("extrahop");
    expect(result.entities.some((entity) => entity.slug === "extrahop")).toBe(true);
  });

  it("caps Gate 4 traversal at three linked entities", async () => {
    const family = await repository.getEntityByName("family");
    const morgan = await repository.getEntityByName("Morgan Chen");
    expect(family).toBeTruthy();
    expect(morgan).toBeTruthy();

    const linkedSlugs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const name = `Linked Person ${index}`;
      const entity = await repository.createEntity({
        id: makeId(),
        name,
        slug: slugify(name),
        type: "person",
        parentEntityId: family!.id,
      });
      linkedSlugs.push(entity.slug);
      await captureMemory(repository, {
        content: `${name} helps with spring schedule planning.`,
        sourceRef: `phase2:gate4:${index}`,
        entityHint: name,
        importance: 0.7,
        decayClass: "profile",
      });
      await repository.createEntityLink({
        id: makeId(),
        entityId: morgan!.id,
        relatedEntityId: entity.id,
        relationshipType: "related_to",
        confidence: 0.95,
      });
    }
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await new MemoryQueryService(
      repository,
      new StubLanguageModel({
        extract: () => ({
          slugs: ["morgan-chen"],
          confidence: "high",
        }),
      }),
      rootDir,
    ).query("help me reason about Morgan");

    expect(result.reasoning.gate4LinkedSlugs).toHaveLength(3);
    expect(new Set(result.reasoning.gate4LinkedSlugs).size).toBe(3);
    expect(result.entities.filter((entity) => linkedSlugs.includes(entity.slug)).length).toBeGreaterThan(0);
  });

  it("does not fire Gate 4 when Gate 2 confidence is low", async () => {
    const morgan = await repository.getEntityByName("Morgan Chen");
    const extrahop = await repository.getEntityByName("ExtraHop");
    expect(morgan).toBeTruthy();
    expect(extrahop).toBeTruthy();

    await repository.createEntityLink({
      id: makeId(),
      entityId: morgan!.id,
      relatedEntityId: extrahop!.id,
      relationshipType: "related_to",
      confidence: 0.95,
    });
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await new MemoryQueryService(
      repository,
      new StubLanguageModel({
        extract: () => ({
          slugs: ["morgan-chen"],
          confidence: "low",
        }),
      }),
      rootDir,
    ).query("ambiguous work question");

    expect(result.reasoning.gatesUsed).not.toContain("gate4");
    expect(result.reasoning.gate4LinkedSlugs).toBeUndefined();
  });

  it("uses Gate 3 trigram-style fallback for weaker lexical cues", async () => {
    const result = await queryService.query("motorcycle restoration");

    expect(result.entities).toHaveLength(0);
    expect(result.reasoning.gatesUsed.includes("gate3")).toBe(true);
    expect(result.fallbackAtoms?.some((atom) => atom.content.includes("BMW R75/5 motorcycle"))).toBe(true);
  });

  it("deduplicates repeated gate 2 entity selections", async () => {
    const duplicateSelectionService = new MemoryQueryService(
      repository,
      new StubLanguageModel({
        extract: () => ({
          slugs: ["bmw-r75-5", "bmw-r75-5"],
          confidence: "high",
        }),
      }),
      rootDir,
    );

    const result = await duplicateSelectionService.query("what vehicles do I own");

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.slug).toBe("bmw-r75-5");
  });

  it("trims oversized query bundles to stay within the hard cap", async () => {
    for (let index = 0; index < 15; index += 1) {
      await captureMemory(repository, {
        content: `Recent note ${index}: Morgan should remember this intentionally verbose travel preference detail about aisle seats, backup plans, family pacing, and airport recovery windows.`,
        sourceRef: `phase2:trim:${index}`,
        entityHint: "Morgan Chen",
        importance: 0.81,
        decayClass: "preference",
      });
    }
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const result = await queryService.query("what should you remember about me");

    expect(bundleChars(result)).toBeLessThanOrEqual(QUERY_HARD_CAP_TOKENS * 4);
    expect(result.reasoning.totalDurationMs).toBeTypeOf("number");
    expect(result.reasoning.gateTimingsMs?.gate0).toBeTypeOf("number");
  });

  it("falls back to cached life state content if the file disappears between queries", async () => {
    const first = await queryService.query("what should you remember about me");
    const memoryPath = path.join(rootDir, "memory", "life_state.md");

    await rm(memoryPath, { force: true });

    const second = await queryService.query("what should you remember about me");
    expect(second.lifeState).toBe(first.lifeState);
  });

  it("normalizes multiline atom content in the projection markdown", async () => {
    await captureMemory(repository, {
      content: "Morgan's note:\nsecond line of detail",
      sourceRef: "phase2:multiline",
      entityHint: "Morgan Chen",
      importance: 0.9,
      decayClass: "preference",
    });
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const morganFile = await readFile(path.join(rootDir, "memory", "entities", "family", "morgan-chen.md"), "utf8");
    const lifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");

    expect(morganFile).toContain("Morgan's note: second line of detail");
    expect(morganFile).not.toContain("Morgan's note:\nsecond line of detail");
    expect(lifeState).toContain("Morgan's note: second line of detail");
  });

  it("invalidates cached life state reads when the file mtime changes", async () => {
    const memoryPath = path.join(rootDir, "memory", "life_state.md");
    const first = await queryService.query("what should you remember about me");
    expect(first.lifeState).not.toContain("OVERRIDDEN");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(memoryPath, "OVERRIDDEN\n", "utf8");

    const second = await queryService.query("what should you remember about me");
    expect(second.lifeState).toContain("OVERRIDDEN");
  });

  it("groups life state atoms by category even when the entity is outside the index cap", async () => {
    const overflowRepository = new InMemoryRepository();
    await overflowRepository.seedTopLevelCategories();
    const work = await overflowRepository.getEntityByName("work");
    expect(work).toBeTruthy();

    for (let index = 0; index < 205; index += 1) {
      const name = `Work Entity ${index.toString().padStart(3, "0")}`;
      await overflowRepository.createEntity({
        id: makeId(),
        name,
        slug: slugify(name),
        type: "other",
        parentEntityId: work!.id,
      });
    }

    await captureMemory(overflowRepository, {
      content: "Work Entity 204 carries a high-priority planning note.",
      sourceRef: "phase2:overflow",
      entityHint: "Work Entity 204",
      importance: 0.95,
      decayClass: "profile",
    });

    const overflowRoot = await mkdtemp(path.join(os.tmpdir(), "ob2-phase2-overflow-"));
    try {
      await new ProjectionRebuilder(overflowRepository, overflowRoot).rebuild();
      const lifeState = await readFile(path.join(overflowRoot, "memory", "life_state.md"), "utf8");
      expect(lifeState).toContain("## work");
      expect(lifeState).toContain("Work Entity 204 carries a high-priority planning note.");
    } finally {
      await rm(overflowRoot, { recursive: true, force: true });
    }
  });
});
