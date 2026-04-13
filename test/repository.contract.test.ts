import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectionRebuilder } from "../src/app/ProjectionRebuilder.js";
import { MemoryQueryService } from "../src/app/MemoryQueryService.js";
import { captureMemory } from "../src/app/captureMemory.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import type { Repository } from "../src/domain/repository.js";
import { makeId } from "../src/utils/crypto.js";
import { slugify } from "../src/utils/text.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";
import {
  createPostgresRepository,
  hasDockerCompose,
  shutdownPostgresPool,
} from "../src/testing/postgresTestUtils.js";

async function seedRepository(repository: Repository): Promise<void> {
  await repository.seedTopLevelCategories();

  const vehicles = await repository.getEntityByName("vehicles");
  const family = await repository.getEntityByName("family");
  const softwareProjects = await repository.getEntityByName("software-projects");
  const work = await repository.getEntityByName("work");

  await repository.createEntity({
    id: makeId(),
    name: "Morgan Chen",
    slug: slugify("Morgan Chen"),
    type: "person",
    parentEntityId: family?.id ?? null,
  });

  await repository.createEntity({
    id: makeId(),
    name: "BMW R75/5",
    slug: slugify("BMW R75/5"),
    type: "vehicle",
    parentEntityId: vehicles?.id ?? null,
  });

  await repository.createEntity({
    id: makeId(),
    name: "Subaru Outback",
    slug: slugify("Subaru Outback"),
    type: "vehicle",
    parentEntityId: vehicles?.id ?? null,
  });

  await repository.createEntity({
    id: makeId(),
    name: "Northstar API",
    slug: slugify("Northstar API"),
    type: "project",
    parentEntityId: softwareProjects?.id ?? null,
  });

  await repository.createEntity({
    id: makeId(),
    name: "ExtraHop",
    slug: slugify("ExtraHop"),
    type: "other",
    parentEntityId: work?.id ?? null,
  });

  await captureMemory(repository, {
    content: "Morgan Chen works as a software architect at ExtraHop.",
    sourceRef: "contract:001",
    entityHint: "Morgan Chen",
    importance: 0.95,
    decayClass: "profile",
  });

  await captureMemory(repository, {
    content: "Morgan is restoring a 1972 BMW R75/5 motorcycle.",
    sourceRef: "contract:002",
    entityHint: "BMW R75/5",
    importance: 0.92,
    decayClass: "profile",
  });

  await captureMemory(repository, {
    content: "The BMW R75/5 needs a carburetor rebuild before summer riding season.",
    sourceRef: "contract:003",
    entityHint: "BMW R75/5",
    importance: 0.83,
    decayClass: "task",
  });

  await captureMemory(repository, {
    content: "Morgan uses the Subaru Outback for ski trips and kid logistics.",
    sourceRef: "contract:004",
    entityHint: "Subaru Outback",
    importance: 0.84,
    decayClass: "profile",
  });

  await captureMemory(repository, {
    content: "Morgan prefers direct flights whenever family travel is involved.",
    sourceRef: "contract:005",
    entityHint: "Morgan Chen",
    importance: 0.79,
    decayClass: "preference",
  });

  await captureMemory(repository, {
    content: "Northstar API must ship audit logging before any public beta.",
    sourceRef: "contract:006",
    entityHint: "Northstar API",
    importance: 0.93,
    decayClass: "decision",
  });
}

async function runContract(name: string, makeRepository: () => Promise<Repository>): Promise<void> {
  describe(name, () => {
    let repository: Repository;
    let rootDir: string;
    let queryService: MemoryQueryService;

    beforeAll(async () => {
      repository = await makeRepository();
      await seedRepository(repository);
      rootDir = await mkdtemp(path.join(os.tmpdir(), "ob2-contract-"));
      await new ProjectionRebuilder(repository, rootDir).rebuild();
      queryService = new MemoryQueryService(repository, new StubLanguageModel(), rootDir);
    });

    it("captures atoms and replays safely", async () => {
      const input = {
        content: "Morgan prefers direct flights for family travel.",
        sourceRef: "contract:dedupe",
        entityHint: "Morgan Chen",
        importance: 0.8,
        decayClass: "preference" as const,
      };

      const first = await captureMemory(repository, input);
      const second = await captureMemory(repository, input);

      expect(first.id).toBe(second.id);
      expect(await repository.countMemoryAtoms()).toBeGreaterThanOrEqual(6);
    });

    it("supports exact and fuzzy entity linking", async () => {
      const exact = await captureMemory(repository, {
        content: "Morgan works from home on Wednesdays.",
        sourceRef: "contract:fuzzy:1",
        entityHint: "Morgan Chen",
        importance: 0.7,
        decayClass: "profile",
      });

      const fuzzy = await captureMemory(repository, {
        content: "Morgan keeps architecture notes in markdown.",
        sourceRef: "contract:fuzzy:2",
        entityHint: "Morgan Chenn",
        importance: 0.6,
        decayClass: "profile",
      });

      expect(exact.entityId).toBeTruthy();
      expect(fuzzy.entityId).toBe(exact.entityId);
    });

    it("returns Phase 2 repository reads in deterministic order", async () => {
      const entities = await repository.listNonCategoryEntitiesWithCategory();
      const vehicles = entities.filter((entity) => entity.categorySlug === "vehicles");
      expect(vehicles.map((entity) => entity.slug)).toEqual(["bmw-r75-5", "subaru-outback"]);

      const bmw = entities.find((entity) => entity.slug === "bmw-r75-5");
      expect(bmw).toBeTruthy();
      const atoms = await repository.listValidAtomsForEntity(bmw!.id);
      expect(atoms[0]?.importance).toBeGreaterThanOrEqual(atoms[1]?.importance ?? 0);

      const lifeStateAtoms = await repository.listLifeStateAtoms();
      expect(lifeStateAtoms.some((atom) => atom.decayClass === "preference")).toBe(true);
    });

    it("returns entity-guided retrieval for vehicle questions", async () => {
      const result = await queryService.query("what vehicles do I own");
      expect(result.entities.some((entity) => entity.slug === "bmw-r75-5")).toBe(true);
      expect(result.reasoning.gatesUsed.includes("gate3")).toBe(false);
    });

    it("falls back lexically when Gate 2 has low confidence", async () => {
      const result = await queryService.query("carburetor");
      expect(result.entities).toHaveLength(0);
      expect(result.fallbackAtoms?.some((atom) => atom.content.includes("carburetor rebuild"))).toBe(true);
      expect(result.reasoning.gatesUsed.includes("gate3")).toBe(true);
    });

    afterAll(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });
  });
}

await runContract("InMemoryRepository contract", async () => new InMemoryRepository());

if (await hasDockerCompose()) {
  await runContract("PostgresRepository contract", createPostgresRepository);
} else {
  describe.skip("PostgresRepository contract", () => {
    it("requires docker compose for local Postgres verification", () => {});
  });
}

afterAll(async () => {
  await shutdownPostgresPool();
});
