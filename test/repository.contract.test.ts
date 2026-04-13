import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureMemory, queryMemory } from "../src/app/captureMemory.js";
import type { Repository } from "../src/domain/repository.js";
import { makeId } from "../src/utils/crypto.js";
import { slugify } from "../src/utils/text.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";
import {
  createPostgresRepository,
  hasDockerCompose,
  shutdownPostgresPool,
} from "../src/testing/postgresTestUtils.js";

async function runContract(name: string, makeRepository: () => Promise<Repository>): Promise<void> {
  describe(name, () => {
    let repository: Repository;

    beforeAll(async () => {
      repository = await makeRepository();
      await repository.seedTopLevelCategories();
      await repository.createEntity({
        id: makeId(),
        name: "Morgan Chen",
        slug: slugify("Morgan Chen"),
        type: "person",
        parentEntityId: null,
      });
    });

    it("captures atoms and replays safely", async () => {
      const input = {
        content: "Morgan prefers direct flights for family travel.",
        sourceRef: "contract:001",
        entityHint: "Morgan Chen",
        importance: 0.8,
        decayClass: "preference" as const,
      };

      const first = await captureMemory(repository, input);
      const second = await captureMemory(repository, input);

      expect(first.id).toBe(second.id);
      expect(await repository.countMemoryAtoms()).toBe(1);
    });

    it("supports exact and fuzzy entity linking", async () => {
      const exact = await captureMemory(repository, {
        content: "Morgan works from home on Wednesdays.",
        sourceRef: "contract:002",
        entityHint: "Morgan Chen",
        importance: 0.7,
        decayClass: "profile",
      });

      const fuzzy = await captureMemory(repository, {
        content: "Morgan keeps architecture notes in markdown.",
        sourceRef: "contract:003",
        entityHint: "Morgan Chenn",
        importance: 0.6,
        decayClass: "profile",
      });

      const none = await captureMemory(repository, {
        content: "Unknown entity should remain unlinked.",
        sourceRef: "contract:004",
        entityHint: "Mystery Person",
        importance: 0.2,
        decayClass: "ephemeral",
      });

      expect(exact.entityId).toBeTruthy();
      expect(fuzzy.entityId).toBe(exact.entityId);
      expect(none.entityId).toBeNull();
    });

    it("queries currently-valid atoms", async () => {
      await captureMemory(repository, {
        content: "Morgan is restoring a motorcycle.",
        sourceRef: "contract:005",
        entityHint: "Morgan Chen",
        importance: 0.9,
        decayClass: "profile",
      });

      const result = await queryMemory(repository, "motorcycle");
      expect(result.atoms.length).toBeGreaterThan(0);
      expect(result.atoms[0]?.content).toContain("motorcycle");
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
