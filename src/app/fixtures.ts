import { readFile } from "node:fs/promises";
import type { Repository } from "../domain/repository.js";
import type { CaptureMemoryInput, EntityType } from "../domain/types.js";
import { captureMemory } from "./captureMemory.js";
import { makeId } from "../utils/crypto.js";
import { slugify } from "../utils/text.js";

interface FixtureEntity {
  name: string;
  type: EntityType;
  parent?: string;
}

interface FixtureAtom {
  content: string;
  entityHint?: string;
  sourceRef: string;
  sourceAgent?: string;
  importance: number;
  confidence?: number;
  decayClass: CaptureMemoryInput["decayClass"];
  validAt?: string | null;
  invalidAt?: string | null;
  metadata?: Record<string, unknown>;
}

interface FixtureDocument {
  entities: FixtureEntity[];
  atoms: FixtureAtom[];
}

export async function loadFixtures(repository: Repository, fixturePath: string): Promise<{ atomsLoaded: number }> {
  const raw = await readFile(fixturePath, "utf8");
  const document = JSON.parse(raw) as FixtureDocument;

  for (const entity of document.entities) {
    const parentEntity = entity.parent ? await repository.getEntityByName(entity.parent) : null;
    await repository.createEntity({
      id: makeId(),
      name: entity.name,
      slug: slugify(entity.name),
      type: entity.type,
      parentEntityId: parentEntity?.id ?? null,
    });
  }

  let atomsLoaded = 0;
  for (const atom of document.atoms) {
    await captureMemory(repository, atom);
    atomsLoaded += 1;
  }

  return { atomsLoaded };
}
