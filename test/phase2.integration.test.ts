import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectionRebuilder } from "../src/app/ProjectionRebuilder.js";
import { MemoryQueryService } from "../src/app/MemoryQueryService.js";
import { captureMemory } from "../src/app/captureMemory.js";
import { loadFixtures } from "../src/app/fixtures.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";

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
    expect(firstIndex).toContain("[BMW R75/5](entities/vehicles/bmw-r75-5.md)");
    expect(bmwFile).toContain("[source:");
  });

  it("skips retrieval for general knowledge queries", async () => {
    const result = await queryService.query("what's the capital of France");
    expect(result.reasoning.classifierDecision.needsMemory).toBe(false);
    expect(result.entities).toHaveLength(0);
    expect(result.recent).toHaveLength(0);
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

  it("invalidates cached life state reads when the file mtime changes", async () => {
    const memoryPath = path.join(rootDir, "memory", "life_state.md");
    const first = await queryService.query("what should you remember about me");
    expect(first.lifeState).not.toContain("OVERRIDDEN");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(memoryPath, "OVERRIDDEN\n", "utf8");

    const second = await queryService.query("what should you remember about me");
    expect(second.lifeState).toContain("OVERRIDDEN");
  });
});
