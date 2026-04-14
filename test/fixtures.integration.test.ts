import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProjectionRebuilder } from "../src/app/ProjectionRebuilder.js";
import { captureMemory } from "../src/app/captureMemory.js";
import { loadFixtures } from "../src/app/fixtures.js";
import {
  createPostgresRepository,
  hasDockerCompose,
  shutdownPostgresPool,
} from "../src/testing/postgresTestUtils.js";
import { makeFingerprint, makeId } from "../src/utils/crypto.js";
import { slugify } from "../src/utils/text.js";

const postgresDescribe = (await hasDockerCompose()) ? describe : describe.skip;
const cleanupRoots: string[] = [];

async function makeRootDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

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

  it("deduplicates concurrent entity, atom, and link writes", async () => {
    const entityName = "Concurrent Persistence Entity";
    const relatedName = "Concurrent Related Entity";
    const entityInput = {
      name: entityName,
      slug: slugify(entityName),
      type: "other" as const,
      parentEntityId: null,
    };
    const [createdA, createdB] = await Promise.all([
      repository.createEntity({ id: makeId(), ...entityInput }),
      repository.createEntity({ id: makeId(), ...entityInput }),
    ]);
    expect(createdA.id).toBe(createdB.id);
    expect((await repository.listEntities({ type: "other" })).filter((entity) => entity.name === entityName)).toHaveLength(1);

    const atomContent = "Concurrent persistence atom";
    const atomFingerprint = makeFingerprint(atomContent);
    const atomInput = {
      content: atomContent,
      contentFingerprint: atomFingerprint,
      entityId: createdA.id,
      sourceRef: "fixtures:concurrency:atom",
      sourceAgent: null,
      importance: 0.82,
      confidence: 0.9,
      decayClass: "profile" as const,
      validAt: null,
      invalidAt: null,
      metadata: {},
    };
    const [atomA, atomB] = await Promise.all([
      repository.createMemoryAtom({ id: makeId(), ...atomInput }),
      repository.createMemoryAtom({ id: makeId(), ...atomInput }),
    ]);
    expect(atomA.id).toBe(atomB.id);
    expect(
      (await repository.listAllMemoryAtoms()).filter(
        (atom) => atom.sourceRef === atomInput.sourceRef && atom.contentFingerprint === atomFingerprint,
      ),
    ).toHaveLength(1);

    const related = await repository.createEntity({
      id: makeId(),
      name: relatedName,
      slug: slugify(relatedName),
      type: "other",
      parentEntityId: null,
    });
    const [linkA, linkB] = await Promise.all([
      repository.createEntityLink({
        id: makeId(),
        entityId: createdA.id,
        relatedEntityId: related.id,
        relationshipType: "related_to",
        confidence: 0.8,
        evidenceAtomId: atomA.id,
      }),
      repository.createEntityLink({
        id: makeId(),
        entityId: createdA.id,
        relatedEntityId: related.id,
        relationshipType: "related_to",
        confidence: 0.8,
        evidenceAtomId: atomA.id,
      }),
    ]);
    expect(linkA.id).toBe(linkB.id);
    expect(
      (await repository.listEntityLinksForEntity(createdA.id)).filter(
        (link) => link.relatedEntityId === related.id && link.relationshipType === "related_to",
      ),
    ).toHaveLength(1);
  });

  it("hides future-dated atoms from projection and lexical reads", async () => {
    const rootDir = await makeRootDir("ob2-postgres-validat-");
    try {
      const morgan = await repository.getEntityByName("Morgan Chen");
      expect(morgan).toBeTruthy();

      const futureContent = "Omega Launch is scheduled tomorrow at 9am";
      await captureMemory(repository, {
        content: futureContent,
        sourceRef: "fixtures:future-validat",
        entityHint: "Morgan Chen",
        importance: 0.9,
        decayClass: "profile",
        validAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await new ProjectionRebuilder(repository, rootDir).rebuild();

      const morganFile = await readFile(path.join(rootDir, "memory", "entities", "family", "morgan-chen.md"), "utf8");
      const lifeState = await readFile(path.join(rootDir, "memory", "life_state.md"), "utf8");
      const validAtoms = await repository.listValidAtomsForEntity(morgan!.id);
      const lexicalMatches = await repository.queryAtoms({ text: "Omega Launch", limit: 10 });

      expect(morganFile).not.toContain(futureContent);
      expect(lifeState).not.toContain(futureContent);
      expect(validAtoms.some((atom) => atom.content === futureContent)).toBe(false);
      expect(lexicalMatches).toHaveLength(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

afterAll(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await shutdownPostgresPool();
});
