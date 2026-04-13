import type { Pool, PoolClient, QueryResultRow } from "pg";
import { TOP_LEVEL_CATEGORIES } from "../../domain/constants.js";
import type { Repository } from "../../domain/repository.js";
import type {
  CreateEntityInput,
  CreateMemoryAtomInput,
  Entity,
  EntityMatch,
  EntityWithCategory,
  ListEntitiesOptions,
  MemoryAtom,
  QueryAtomsOptions,
} from "../../domain/types.js";
import { makeId } from "../../utils/crypto.js";
import { slugify } from "../../utils/text.js";

type EntityRow = QueryResultRow & {
  id: string;
  name: string;
  slug: string;
  type: Entity["type"];
  parent_entity_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AtomRow = QueryResultRow & {
  id: string;
  content: string;
  content_fingerprint: string;
  entity_id: string | null;
  source_ref: string;
  source_agent: string | null;
  importance: number;
  confidence: number;
  decay_class: MemoryAtom["decayClass"];
  valid_at: Date | null;
  invalid_at: Date | null;
  supersedes_id: string | null;
  verification_state: string;
  consolidation_status: MemoryAtom["consolidationStatus"];
  retrieval_count: number;
  last_retrieved_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type EntityWithCategoryRow = EntityRow & {
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
};

function mapEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    parentEntityId: row.parent_entity_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapAtom(row: AtomRow): MemoryAtom {
  return {
    id: row.id,
    content: row.content,
    contentFingerprint: row.content_fingerprint,
    entityId: row.entity_id,
    sourceRef: row.source_ref,
    sourceAgent: row.source_agent,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    decayClass: row.decay_class,
    validAt: row.valid_at ? new Date(row.valid_at) : null,
    invalidAt: row.invalid_at ? new Date(row.invalid_at) : null,
    supersedesId: row.supersedes_id,
    verificationState: row.verification_state,
    consolidationStatus: row.consolidation_status,
    retrievalCount: row.retrieval_count,
    lastRetrievedAt: row.last_retrieved_at ? new Date(row.last_retrieved_at) : null,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapEntityWithCategory(row: EntityWithCategoryRow): EntityWithCategory {
  return {
    ...mapEntity(row),
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async createEntity(input: CreateEntityInput): Promise<Entity> {
    const existing = await this.getEntityByName(input.name);
    if (existing) {
      return existing;
    }

    const result = await this.pool.query<EntityRow>(
      `
        INSERT INTO entity (id, name, slug, type, parent_entity_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.id, input.name, input.slug, input.type, input.parentEntityId],
    );

    return mapEntity(requireRow(result.rows[0], "Failed to create entity"));
  }

  async getMemoryAtomByFingerprint(sourceRef: string, contentFingerprint: string): Promise<MemoryAtom | null> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE source_ref = $1 AND content_fingerprint = $2
        LIMIT 1
      `,
      [sourceRef, contentFingerprint],
    );
    return result.rows[0] ? mapAtom(result.rows[0]) : null;
  }

  async createMemoryAtom(input: CreateMemoryAtomInput): Promise<MemoryAtom> {
    return this.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await client.query<AtomRow>(
          `
            INSERT INTO memory_atom (
              id,
              content,
              content_fingerprint,
              entity_id,
              source_ref,
              source_agent,
              importance,
              confidence,
              decay_class,
              valid_at,
              invalid_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
            RETURNING *
          `,
          [
            input.id,
            input.content,
            input.contentFingerprint,
            input.entityId,
            input.sourceRef,
            input.sourceAgent,
            input.importance,
            input.confidence,
            input.decayClass,
            input.validAt,
            input.invalidAt,
            JSON.stringify(input.metadata),
          ],
        );
        await client.query("COMMIT");
        return mapAtom(requireRow(result.rows[0], "Failed to create memory atom"));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async listEntities(options: ListEntitiesOptions = {}): Promise<Entity[]> {
    const values: unknown[] = [];
    let where = "";
    if (options.type) {
      values.push(options.type);
      where = "WHERE type = $1";
    }

    const result = await this.pool.query<EntityRow>(
      `SELECT * FROM entity ${where} ORDER BY name ASC`,
      values,
    );
    return result.rows.map(mapEntity);
  }

  async getEntityByName(name: string): Promise<Entity | null> {
    const result = await this.pool.query<EntityRow>(
      "SELECT * FROM entity WHERE lower(name) = lower($1) LIMIT 1",
      [name],
    );
    return result.rows[0] ? mapEntity(result.rows[0]) : null;
  }

  async getEntityBySlug(slug: string): Promise<Entity | null> {
    const result = await this.pool.query<EntityRow>(
      "SELECT * FROM entity WHERE slug = $1 LIMIT 1",
      [slug],
    );
    return result.rows[0] ? mapEntity(result.rows[0]) : null;
  }

  async findEntityExact(name: string): Promise<Entity | null> {
    return this.getEntityByName(name);
  }

  async findEntityFuzzy(name: string, minimumSimilarity: number): Promise<EntityMatch | null> {
    const result = await this.pool.query<
      EntityRow & {
        similarity: number;
      }
    >(
      `
        SELECT *, similarity(name, $1) AS similarity
        FROM entity
        WHERE similarity(name, $1) >= $2
        ORDER BY similarity DESC, name ASC
        LIMIT 1
      `,
      [name, minimumSimilarity],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      entity: mapEntity(result.rows[0]),
      similarity: Number(result.rows[0].similarity),
    };
  }

  async queryAtoms(options: QueryAtomsOptions): Promise<MemoryAtom[]> {
    return this.searchValidAtomsLexical(options.text, options.limit ?? 10);
  }

  async listNonCategoryEntitiesWithCategory(): Promise<EntityWithCategory[]> {
    const result = await this.pool.query<EntityWithCategoryRow>(
      `
        SELECT
          entity.*,
          category.id AS category_id,
          category.name AS category_name,
          category.slug AS category_slug
        FROM entity
        LEFT JOIN entity AS category
          ON category.id = entity.parent_entity_id
        WHERE entity.type <> 'category'
        ORDER BY entity.name ASC
      `,
    );
    return result.rows.map(mapEntityWithCategory);
  }

  async listValidAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE
          entity_id = $1
          AND (invalid_at IS NULL OR invalid_at > NOW())
        ORDER BY importance DESC, created_at DESC
      `,
      [entityId],
    );
    return result.rows.map(mapAtom);
  }

  async listLifeStateAtoms(limit = 100): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE
          invalid_at IS NULL
          AND (decay_class IN ('profile', 'preference') OR importance >= 0.8)
        ORDER BY importance DESC, created_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map(mapAtom);
  }

  async listRecentBridgeAtoms(since: Date | null, limit: number): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE
          (invalid_at IS NULL OR invalid_at > NOW())
          AND ($1::timestamptz IS NULL OR created_at > $1)
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [since, limit],
    );
    return result.rows.map(mapAtom);
  }

  async searchValidAtomsLexical(text: string, limit: number): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE
          content ILIKE '%' || $1 || '%'
          AND (invalid_at IS NULL OR invalid_at > NOW())
        ORDER BY importance DESC, created_at DESC
        LIMIT $2
      `,
      [text, limit],
    );
    return result.rows.map(mapAtom);
  }

  async getLatestCompletedConsolidationAt(): Promise<Date | null> {
    const result = await this.pool.query<{ completed_at: Date | null }>(
      `
        SELECT completed_at
        FROM consolidation_run
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1
      `,
    );
    return result.rows[0]?.completed_at ? new Date(result.rows[0].completed_at) : null;
  }

  async listAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      "SELECT * FROM memory_atom WHERE entity_id = $1 ORDER BY created_at DESC",
      [entityId],
    );
    return result.rows.map(mapAtom);
  }

  async countMemoryAtoms(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM memory_atom");
    return Number(requireRow(result.rows[0], "Failed to count memory atoms").count);
  }

  async deleteAllData(): Promise<void> {
    await this.pool.query("TRUNCATE TABLE review_item, correction_action, consolidation_run, entity_link, memory_atom, entity RESTART IDENTITY CASCADE");
  }

  async seedTopLevelCategories(): Promise<void> {
    for (const name of TOP_LEVEL_CATEGORIES) {
      await this.createEntity({
        id: makeId(),
        name,
        slug: slugify(name),
        type: "category",
        parentEntityId: null,
      });
    }
  }
}
