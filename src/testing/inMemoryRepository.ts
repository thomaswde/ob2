import { TOP_LEVEL_CATEGORIES } from "../domain/constants.js";
import type { Repository } from "../domain/repository.js";
import type {
  CreateEntityInput,
  CreateMemoryAtomInput,
  Entity,
  EntityMatch,
  EntityWithCategory,
  ListEntitiesOptions,
  MemoryAtom,
  QueryAtomsOptions,
} from "../domain/types.js";
import { makeId } from "../utils/crypto.js";
import { slugify } from "../utils/text.js";

function trigrams(value: string): Set<string> {
  const normalized = `  ${value.toLowerCase()}  `;
  const set = new Set<string>();
  for (let index = 0; index < normalized.length - 2; index += 1) {
    set.add(normalized.slice(index, index + 3));
  }
  return set;
}

function similarity(a: string, b: string): number {
  const source = a.trim().toLowerCase();
  const target = b.trim().toLowerCase();
  if (source === target) {
    return 1;
  }

  const sourceTokens = trigrams(source);
  const targetTokens = trigrams(target);
  let overlap = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) {
      overlap += 1;
    }
  }

  const union = new Set([...sourceTokens, ...targetTokens]).size;
  return overlap / Math.max(union, 1);
}

export class InMemoryRepository implements Repository {
  private readonly entities = new Map<string, Entity>();
  private readonly atoms = new Map<string, MemoryAtom>();

  private isAtomCurrentlyValid(atom: MemoryAtom): boolean {
    return !atom.invalidAt || atom.invalidAt.getTime() > Date.now();
  }

  private sortAtoms(a: MemoryAtom, b: MemoryAtom): number {
    if (b.importance !== a.importance) {
      return b.importance - a.importance;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  }

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const existing = await this.getEntityByName(input.name);
    if (existing) {
      return existing;
    }
    const now = new Date();
    const entity: Entity = {
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  async getMemoryAtomByFingerprint(sourceRef: string, contentFingerprint: string): Promise<MemoryAtom | null> {
    for (const atom of this.atoms.values()) {
      if (atom.sourceRef === sourceRef && atom.contentFingerprint === contentFingerprint) {
        return atom;
      }
    }
    return null;
  }

  async createMemoryAtom(input: CreateMemoryAtomInput): Promise<MemoryAtom> {
    const now = new Date();
    const atom: MemoryAtom = {
      ...input,
      supersedesId: null,
      verificationState: "unverified",
      consolidationStatus: "pending",
      retrievalCount: 0,
      lastRetrievedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.atoms.set(atom.id, atom);
    return atom;
  }

  async listEntities(options: ListEntitiesOptions = {}): Promise<Entity[]> {
    return [...this.entities.values()]
      .filter((entity) => (options.type ? entity.type === options.type : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getEntityByName(name: string): Promise<Entity | null> {
    const normalized = name.trim().toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.name.toLowerCase() === normalized) {
        return entity;
      }
    }
    return null;
  }

  async getEntityBySlug(slug: string): Promise<Entity | null> {
    for (const entity of this.entities.values()) {
      if (entity.slug === slug) {
        return entity;
      }
    }
    return null;
  }

  async findEntityExact(name: string): Promise<Entity | null> {
    return this.getEntityByName(name);
  }

  async findEntityFuzzy(name: string, minimumSimilarity: number): Promise<EntityMatch | null> {
    let bestMatch: EntityMatch | null = null;
    for (const entity of this.entities.values()) {
      const score = similarity(entity.name, name);
      if (score >= minimumSimilarity && (!bestMatch || score > bestMatch.similarity)) {
        bestMatch = { entity, similarity: score };
      }
    }
    return bestMatch;
  }

  async queryAtoms(options: QueryAtomsOptions): Promise<MemoryAtom[]> {
    return this.searchValidAtomsLexical(options.text, options.limit ?? 10);
  }

  async listNonCategoryEntitiesWithCategory(): Promise<EntityWithCategory[]> {
    return [...this.entities.values()]
      .filter((entity) => entity.type !== "category")
      .map((entity) => {
        const category = entity.parentEntityId ? this.entities.get(entity.parentEntityId) ?? null : null;
        return {
          ...entity,
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? null,
          categorySlug: category?.slug ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listValidAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => atom.entityId === entityId && this.isAtomCurrentlyValid(atom))
      .sort((a, b) => this.sortAtoms(a, b));
  }

  async listLifeStateAtoms(limit = 100): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => this.isAtomCurrentlyValid(atom))
      .filter((atom) => atom.decayClass === "profile" || atom.decayClass === "preference" || atom.importance >= 0.8)
      .sort((a, b) => this.sortAtoms(a, b))
      .slice(0, limit);
  }

  async listRecentBridgeAtoms(since: Date | null, limit: number): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => this.isAtomCurrentlyValid(atom))
      .filter((atom) => (since ? atom.createdAt.getTime() > since.getTime() : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async searchValidAtomsLexical(text: string, limit: number): Promise<MemoryAtom[]> {
    const needle = text.trim().toLowerCase();
    const matches = [...this.atoms.values()].filter((atom) => {
      return this.isAtomCurrentlyValid(atom) && atom.content.toLowerCase().includes(needle);
    });

    return matches
      .sort((a, b) => this.sortAtoms(a, b))
      .slice(0, limit);
  }

  async getLatestCompletedConsolidationAt(): Promise<Date | null> {
    return null;
  }

  async listAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    return [...this.atoms.values()]
      .filter((atom) => atom.entityId === entityId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async countMemoryAtoms(): Promise<number> {
    return this.atoms.size;
  }

  async deleteAllData(): Promise<void> {
    this.atoms.clear();
    this.entities.clear();
  }

  async seedTopLevelCategories(): Promise<void> {
    const now = new Date();
    for (const name of TOP_LEVEL_CATEGORIES) {
      if (await this.getEntityByName(name)) {
        continue;
      }
      const entity: Entity = {
        id: makeId(),
        name,
        slug: slugify(name),
        type: "category",
        parentEntityId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.entities.set(entity.id, entity);
    }
  }
}
