import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConsolidationService } from "../src/app/ConsolidationService.js";
import { MemoryQueryService } from "../src/app/MemoryQueryService.js";
import { captureMemory } from "../src/app/captureMemory.js";
import { loadFixtures } from "../src/app/fixtures.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";
import { makeId } from "../src/utils/crypto.js";
import { slugify } from "../src/utils/text.js";

const fixturePath = path.resolve(process.cwd(), "fixtures", "morgan.json");
const cleanupRoots: string[] = [];

async function makeRootDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

async function buildSeededRepository(): Promise<InMemoryRepository> {
  const repository = new InMemoryRepository();
  await repository.seedTopLevelCategories();
  await loadFixtures(repository, fixturePath);
  return repository;
}

async function seedMinimalEmploymentRepository(): Promise<InMemoryRepository> {
  const repository = new InMemoryRepository();
  await repository.seedTopLevelCategories();

  const family = await repository.getEntityByName("family");
  await repository.createEntity({
    id: makeId(),
    name: "Morgan Chen",
    slug: slugify("Morgan Chen"),
    type: "person",
    parentEntityId: family?.id ?? null,
  });

  return repository;
}

describe("Phase 3 consolidation", () => {
  afterEach(async () => {
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("consolidates the fixture corpus into a synthesized projection with citations", async () => {
    const repository = await buildSeededRepository();
    const rootDir = await makeRootDir("ob2-phase3-");
    const service = new ConsolidationService(repository, new StubLanguageModel(), { rootDir });

    const result = await service.run();
    const index = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");
    const lifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");
    const morganFile = await readFile(path.join(rootDir, "memory", "entities", "family", "morgan-chen.md"), "utf8");

    expect(result.status).toBe("completed");
    expect(index).toContain("[Morgan Chen](entities/family/morgan-chen.md)");
    expect(lifeState).toContain("[source:");
    expect(morganFile).toContain("[source:");
    expect((await repository.listPendingAtoms()).length).toBe(0);
  });

  it("is effectively a no-op on an unchanged rerun", async () => {
    const repository = await buildSeededRepository();
    const rootDir = await makeRootDir("ob2-phase3-rerun-");
    const service = new ConsolidationService(repository, new StubLanguageModel(), { rootDir });

    await service.run();
    const firstIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");
    const second = await service.run();
    const secondIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");

    expect(second.status).toBe("completed");
    expect(second.atomCount).toBe(0);
    expect(firstIndex).toBe(secondIndex);
  });

  it("supersedes older employment facts and query retrieval surfaces only the active one", async () => {
    const repository = await seedMinimalEmploymentRepository();
    const rootDir = await makeRootDir("ob2-phase3-supersession-");

    await captureMemory(repository, {
      content: "Morgan Chen works as a software architect at NetApp.",
      sourceRef: "phase3:supersession:1",
      entityHint: "Morgan Chen",
      importance: 0.95,
      decayClass: "profile",
    });

    const service = new ConsolidationService(repository, new StubLanguageModel({ scenario: "success" }), { rootDir });
    await service.run();

    await captureMemory(repository, {
      content: "Morgan Chen works as a software architect at ExtraHop.",
      sourceRef: "phase3:supersession:2",
      entityHint: "Morgan Chen",
      importance: 0.95,
      decayClass: "profile",
    });

    await service.run();

    const morgan = await repository.getEntityByName("Morgan Chen");
    const allAtoms = await repository.listAtomsForEntity(morgan!.id);
    const netapp = allAtoms.find((atom) => atom.content.includes("NetApp"));
    const extrahop = allAtoms.find((atom) => atom.content.includes("ExtraHop"));
    const query = await new MemoryQueryService(repository, new StubLanguageModel(), rootDir).query("where do I work");

    expect(netapp?.invalidAt).toBeTruthy();
    expect(extrahop?.supersedesId).toBe(netapp?.id ?? null);
    expect(JSON.stringify(query)).toContain("ExtraHop");
    expect(JSON.stringify(query)).not.toContain("NetApp");
  });

  it("creates review items for contradictions without silently superseding", async () => {
    const repository = await seedMinimalEmploymentRepository();
    const rootDir = await makeRootDir("ob2-phase3-contradiction-");

    await captureMemory(repository, {
      content: "Morgan Chen lives in Denver, Colorado.",
      sourceRef: "phase3:contradiction:1",
      entityHint: "Morgan Chen",
      importance: 0.9,
      decayClass: "profile",
    });
    await captureMemory(repository, {
      content: "Morgan Chen lives in Seattle, Washington.",
      sourceRef: "phase3:contradiction:2",
      entityHint: "Morgan Chen",
      importance: 0.9,
      decayClass: "profile",
    });

    const service = new ConsolidationService(repository, new StubLanguageModel({ scenario: "contradiction" }), {
      rootDir,
    });
    await service.run();

    const reviewItems = await repository.listReviewItems("open");
    const morgan = await repository.getEntityByName("Morgan Chen");
    const atoms = await repository.listAtomsForEntity(morgan!.id);

    expect(reviewItems.some((item) => item.kind === "contradiction")).toBe(true);
    expect(atoms.filter((atom) => atom.invalidAt === null)).toHaveLength(2);
  });

  it("does not supersede locked atoms even when newer facts would normally replace them", async () => {
    const repository = await seedMinimalEmploymentRepository();
    const rootDir = await makeRootDir("ob2-phase3-locked-");
    const service = new ConsolidationService(repository, new StubLanguageModel({ scenario: "success" }), { rootDir });

    const oldAtom = await captureMemory(repository, {
      content: "Morgan Chen works as a software architect at NetApp.",
      sourceRef: "phase3:locked:1",
      entityHint: "Morgan Chen",
      importance: 0.95,
      decayClass: "profile",
    });
    await service.run();
    await repository.updateMemoryAtom({ id: oldAtom.id, locked: true });

    await captureMemory(repository, {
      content: "Morgan Chen works as a software architect at ExtraHop.",
      sourceRef: "phase3:locked:2",
      entityHint: "Morgan Chen",
      importance: 0.95,
      decayClass: "profile",
    });
    await service.run();

    const persistedOld = await repository.getMemoryAtomById(oldAtom.id);
    const reviewItems = await repository.listReviewItems("open");

    expect(persistedOld?.invalidAt).toBeNull();
    expect(reviewItems.some((item) => item.detail.includes("locked"))).toBe(true);
  });

  it("aborts low-confidence runs and preserves the previous projection", async () => {
    const repository = await buildSeededRepository();
    const rootDir = await makeRootDir("ob2-phase3-abort-");

    await new ConsolidationService(repository, new StubLanguageModel(), { rootDir }).run();
    const firstIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");

    await captureMemory(repository, {
      content: "Morgan Chen switched notebook vendors last week.",
      sourceRef: "phase3:abort:1",
      entityHint: "Morgan Chen",
      importance: 0.4,
      decayClass: "ephemeral",
    });

    const result = await new ConsolidationService(
      repository,
      new StubLanguageModel({ scenario: "low-confidence" }),
      { rootDir },
    ).run();
    const secondIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");

    expect(result.status).toBe("aborted_low_confidence");
    expect(firstIndex).toBe(secondIndex);
  });

  it("preserves the previous projection when compilation fails before the swap", async () => {
    const repository = await buildSeededRepository();
    const rootDir = await makeRootDir("ob2-phase3-interrupt-");

    await new ConsolidationService(repository, new StubLanguageModel(), { rootDir }).run();
    const firstIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");

    await captureMemory(repository, {
      content: "Morgan Chen prefers standing desks for long design sessions.",
      sourceRef: "phase3:interrupt:1",
      entityHint: "Morgan Chen",
      importance: 0.7,
      decayClass: "preference",
    });

    const service = new ConsolidationService(repository, new StubLanguageModel(), {
      rootDir,
      compilerHooks: {
        beforeSwap: async () => {
          throw new Error("simulated compile interruption");
        },
      },
    });

    await expect(service.run()).rejects.toThrow("simulated compile interruption");
    const secondIndex = await readFile(path.join(rootDir, "memory", "index.md"), "utf8");
    expect(firstIndex).toBe(secondIndex);
  });

  it("applies obvious corrections as superseding atoms during consolidation", async () => {
    const repository = await seedMinimalEmploymentRepository();
    const rootDir = await makeRootDir("ob2-phase3-correction-");
    const service = new ConsolidationService(repository, new StubLanguageModel({ scenario: "supersession" }), {
      rootDir,
    });

    const original = await captureMemory(repository, {
      content: "Morgan Chen works as a software architect at NetApp.",
      sourceRef: "phase3:correction:1",
      entityHint: "Morgan Chen",
      importance: 0.95,
      decayClass: "profile",
    });
    await service.run();
    await service.proposeCorrection(original.id, "Morgan Chen works as a software architect at ExtraHop.", "Employer changed.");

    const result = await service.run();
    const corrections = await repository.listCorrectionActions();
    const morgan = await repository.getEntityByName("Morgan Chen");
    const atoms = await repository.listAtomsForEntity(morgan!.id);

    expect(result.appliedCorrectionIds).toHaveLength(1);
    expect(corrections[0]?.status).toBe("applied");
    expect(atoms.some((atom) => atom.content.includes("ExtraHop"))).toBe(true);
    expect(atoms.find((atom) => atom.content.includes("NetApp"))?.invalidAt).toBeTruthy();
  });
});
