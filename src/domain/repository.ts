import type {
  CreateEntityInput,
  CreateMemoryAtomInput,
  Entity,
  EntityMatch,
  ListEntitiesOptions,
  MemoryAtom,
  QueryAtomsOptions,
} from "./types.js";

export interface Repository {
  createEntity(input: CreateEntityInput): Promise<Entity>;
  getMemoryAtomByFingerprint(sourceRef: string, contentFingerprint: string): Promise<MemoryAtom | null>;
  createMemoryAtom(input: CreateMemoryAtomInput): Promise<MemoryAtom>;
  listEntities(options?: ListEntitiesOptions): Promise<Entity[]>;
  getEntityByName(name: string): Promise<Entity | null>;
  getEntityBySlug(slug: string): Promise<Entity | null>;
  findEntityExact(name: string): Promise<Entity | null>;
  findEntityFuzzy(name: string, minimumSimilarity: number): Promise<EntityMatch | null>;
  queryAtoms(options: QueryAtomsOptions): Promise<MemoryAtom[]>;
  listAtomsForEntity(entityId: string): Promise<MemoryAtom[]>;
  countMemoryAtoms(): Promise<number>;
  deleteAllData(): Promise<void>;
  seedTopLevelCategories(): Promise<void>;
}
