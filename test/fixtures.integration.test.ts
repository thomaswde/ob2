import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFixtures } from "../src/app/fixtures.js";
import {
  createPostgresRepository,
  hasDockerCompose,
  shutdownPostgresPool,
} from "../src/testing/postgresTestUtils.js";

const postgresDescribe = (await hasDockerCompose()) ? describe : describe.skip;

postgresDescribe("fixtures and migrations", () => {
  let repository: Awaited<ReturnType<typeof createPostgresRepository>>;

  beforeAll(async () => {
    repository = await createPostgresRepository();
  });

  it("seeds top-level categories on migrate", async () => {
    const entities = await repository.listEntities({ type: "category" });
    expect(entities).toHaveLength(10);
  });

  it("loads the Morgan fixture corpus replay-safely", async () => {
    const fixturePath = path.resolve(process.cwd(), "fixtures", "morgan.json");
    await loadFixtures(repository, fixturePath);
    const once = await repository.countMemoryAtoms();
    await loadFixtures(repository, fixturePath);
    const twice = await repository.countMemoryAtoms();
    expect(once).toBeGreaterThanOrEqual(40);
    expect(once).toBe(twice);
  });

  it("shows the expected atoms on query after fixture load", async () => {
    const results = await repository.queryAtoms({ text: "Northstar API", limit: 10 });
    expect(results.some((atom) => atom.content.includes("Northstar API"))).toBe(true);
  });
});

afterAll(async () => {
  await shutdownPostgresPool();
});
