import type { Pool, PoolClient, QueryResultRow } from "pg";
import { TOP_LEVEL_CATEGORIES } from "../../domain/constants.js";
import type { Repository } from "../../domain/repository.js";
import type {
  CompleteConsolidationRunInput,
  ConsolidationRun,
  CorrectionAction,
  CreateConsolidationRunInput,
  CreateCorrectionActionInput,
  CreateEntityInput,
  CreateEntityLinkInput,
  CreateMemoryAtomInput,
  CreateReviewItemInput,
  Entity,
  EntityLink,
  EntityMatch,
  EntityWithCategory,
  ListEntitiesOptions,
  MemoryAtom,
  Notification,
  QueryAtomsOptions,
  RequestLog,
  ReviewItem,
  SystemState,
  UpdateMemoryAtomInput,
  UpdateSystemStateInput,
  CreateRequestLogInput,
  CreateNotificationInput,
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
  locked: boolean;
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

type ConsolidationRunRow = QueryResultRow & {
  id: string;
  status: ConsolidationRun["status"];
  started_at: Date;
  completed_at: Date | null;
  atom_count: number;
  processed_atom_count: number;
  low_confidence_atom_count: number;
  error_count: number;
  notes: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

type CorrectionActionRow = QueryResultRow & {
  id: string;
  target_atom_id: string | null;
  proposed_content: string;
  reason: string | null;
  status: CorrectionAction["status"];
  confidence: number | null;
  applied_atom_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type ReviewItemRow = QueryResultRow & {
  id: string;
  atom_id: string | null;
  entity_id: string | null;
  kind: ReviewItem["kind"];
  status: ReviewItem["status"];
  detail: string;
  confidence: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type EntityLinkRow = QueryResultRow & {
  id: string;
  entity_id: string;
  related_entity_id: string;
  relationship_type: string;
  confidence: number | null;
  evidence_atom_id: string | null;
  created_at: Date;
};

type SystemStateRow = QueryResultRow & {
  singleton: boolean;
  consolidation_enabled: boolean;
  consecutive_aborted_runs: number;
  updated_at: Date;
};

type RequestLogRow = QueryResultRow & {
  id: string;
  client_id: string;
  method: string;
  route: string;
  status_code: number;
  duration_ms: number;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type NotificationRow = QueryResultRow & {
  id: string;
  kind: string;
  detail: string;
  metadata: Record<string, unknown>;
  created_at: Date;
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
    locked: row.locked,
    supersedesId: row.supersedes_id,
    verificationState: row.verification_state,
    consolidationStatus: row.consolidation_status,
    retrievalCount: Number(row.retrieval_count),
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

function mapConsolidationRun(row: ConsolidationRunRow): ConsolidationRun {
  return {
    id: row.id,
    status: row.status,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    atomCount: Number(row.atom_count),
    processedAtomCount: Number(row.processed_atom_count),
    lowConfidenceAtomCount: Number(row.low_confidence_atom_count),
    errorCount: Number(row.error_count),
    notes: row.notes,
    errorMessage: row.error_message,
    metadata: row.metadata,
  };
}

function mapCorrectionAction(row: CorrectionActionRow): CorrectionAction {
  return {
    id: row.id,
    targetAtomId: row.target_atom_id,
    proposedContent: row.proposed_content,
    reason: row.reason,
    status: row.status,
    confidence: row.confidence === null ? null : Number(row.confidence),
    appliedAtomId: row.applied_atom_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata,
  };
}

function mapReviewItem(row: ReviewItemRow): ReviewItem {
  return {
    id: row.id,
    atomId: row.atom_id,
    entityId: row.entity_id,
    kind: row.kind,
    status: row.status,
    detail: row.detail,
    confidence: row.confidence === null ? null : Number(row.confidence),
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapEntityLink(row: EntityLinkRow): EntityLink {
  return {
    id: row.id,
    entityId: row.entity_id,
    relatedEntityId: row.related_entity_id,
    relationshipType: row.relationship_type,
    confidence: row.confidence === null ? null : Number(row.confidence),
    evidenceAtomId: row.evidence_atom_id,
    createdAt: new Date(row.created_at),
  };
}

function mapSystemState(row: SystemStateRow): SystemState {
  return {
    consolidationEnabled: row.consolidation_enabled,
    consecutiveAbortedRuns: Number(row.consecutive_aborted_runs),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRequestLog(row: RequestLogRow): RequestLog {
  return {
    id: row.id,
    clientId: row.client_id,
    method: row.method,
    route: row.route,
    statusCode: Number(row.status_code),
    durationMs: Number(row.duration_ms),
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
  };
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    detail: row.detail,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
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

  async getEntityById(id: string): Promise<Entity | null> {
    const result = await this.pool.query<EntityRow>("SELECT * FROM entity WHERE id = $1 LIMIT 1", [id]);
    return result.rows[0] ? mapEntity(result.rows[0]) : null;
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

  async getMemoryAtomById(id: string): Promise<MemoryAtom | null> {
    const result = await this.pool.query<AtomRow>("SELECT * FROM memory_atom WHERE id = $1 LIMIT 1", [id]);
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
              locked,
              supersedes_id,
              verification_state,
              consolidation_status,
              retrieval_count,
              last_retrieved_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
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
            input.locked ?? false,
            input.supersedesId ?? null,
            input.verificationState ?? "unverified",
            input.consolidationStatus ?? "pending",
            input.retrievalCount ?? 0,
            input.lastRetrievedAt ?? null,
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

  async updateMemoryAtom(input: UpdateMemoryAtomInput): Promise<MemoryAtom> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown): void => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if (input.content !== undefined) add("content", input.content);
    if (input.contentFingerprint !== undefined) add("content_fingerprint", input.contentFingerprint);
    if (input.entityId !== undefined) add("entity_id", input.entityId);
    if (input.sourceRef !== undefined) add("source_ref", input.sourceRef);
    if (input.sourceAgent !== undefined) add("source_agent", input.sourceAgent);
    if (input.importance !== undefined) add("importance", input.importance);
    if (input.confidence !== undefined) add("confidence", input.confidence);
    if (input.decayClass !== undefined) add("decay_class", input.decayClass);
    if (input.validAt !== undefined) add("valid_at", input.validAt);
    if (input.invalidAt !== undefined) add("invalid_at", input.invalidAt);
    if (input.locked !== undefined) add("locked", input.locked);
    if (input.supersedesId !== undefined) add("supersedes_id", input.supersedesId);
    if (input.verificationState !== undefined) add("verification_state", input.verificationState);
    if (input.consolidationStatus !== undefined) add("consolidation_status", input.consolidationStatus);
    if (input.retrievalCount !== undefined) add("retrieval_count", input.retrievalCount);
    if (input.lastRetrievedAt !== undefined) add("last_retrieved_at", input.lastRetrievedAt);
    if (input.metadata !== undefined) add("metadata", JSON.stringify(input.metadata));

    if (fields.length === 0) {
      const existing = await this.getMemoryAtomById(input.id);
      if (!existing) {
        throw new Error(`Memory atom not found: ${input.id}`);
      }
      return existing;
    }

    values.push(input.id);
    const result = await this.pool.query<AtomRow>(
      `
        UPDATE memory_atom
        SET ${fields.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING *
      `,
      values,
    );
    return mapAtom(requireRow(result.rows[0], "Failed to update memory atom"));
  }

  async listEntities(options: ListEntitiesOptions = {}): Promise<Entity[]> {
    const values: unknown[] = [];
    let where = "";
    if (options.type) {
      values.push(options.type);
      where = "WHERE type = $1";
    }

    const result = await this.pool.query<EntityRow>(`SELECT * FROM entity ${where} ORDER BY name ASC`, values);
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
    const result = await this.pool.query<EntityRow>("SELECT * FROM entity WHERE slug = $1 LIMIT 1", [slug]);
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

  async listEntitiesByParent(parentEntityId: string): Promise<Entity[]> {
    const result = await this.pool.query<EntityRow>(
      "SELECT * FROM entity WHERE parent_entity_id = $1 ORDER BY name ASC",
      [parentEntityId],
    );
    return result.rows.map(mapEntity);
  }

  async listPendingAtoms(limit = 100): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      `
        SELECT *
        FROM memory_atom
        WHERE consolidation_status = 'pending'
        ORDER BY created_at ASC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map(mapAtom);
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
        WITH ranked_atoms AS (
          SELECT
            *,
            GREATEST(
              similarity(lower(content), lower($1)),
              word_similarity(lower(content), lower($1))
            ) AS lexical_score,
            (1 / (1 + (EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0))) AS recency_score
          FROM memory_atom
          WHERE invalid_at IS NULL OR invalid_at > NOW()
        )
        SELECT *
        FROM ranked_atoms
        WHERE lexical_score >= 0.1
        ORDER BY
          ((lexical_score * 0.7) + (importance * 0.2) + (recency_score * 0.1)) DESC,
          importance DESC,
          created_at DESC
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

  async listAllMemoryAtoms(): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>("SELECT * FROM memory_atom ORDER BY created_at ASC");
    return result.rows.map(mapAtom);
  }

  async listAtomsForEntity(entityId: string): Promise<MemoryAtom[]> {
    const result = await this.pool.query<AtomRow>(
      "SELECT * FROM memory_atom WHERE entity_id = $1 ORDER BY created_at DESC",
      [entityId],
    );
    return result.rows.map(mapAtom);
  }

  async listEntityLinks(): Promise<EntityLink[]> {
    const result = await this.pool.query<EntityLinkRow>("SELECT * FROM entity_link ORDER BY created_at ASC");
    return result.rows.map(mapEntityLink);
  }

  async listEntityLinksForEntity(entityId: string): Promise<EntityLink[]> {
    const result = await this.pool.query<EntityLinkRow>(
      `
        SELECT *
        FROM entity_link
        WHERE entity_id = $1 OR related_entity_id = $1
        ORDER BY created_at DESC
      `,
      [entityId],
    );
    return result.rows.map(mapEntityLink);
  }

  async createEntityLink(input: CreateEntityLinkInput): Promise<EntityLink> {
    const existing = await this.pool.query<EntityLinkRow>(
      `
        SELECT *
        FROM entity_link
        WHERE entity_id = $1 AND related_entity_id = $2 AND relationship_type = $3
        LIMIT 1
      `,
      [input.entityId, input.relatedEntityId, input.relationshipType],
    );
    if (existing.rows[0]) {
      return mapEntityLink(existing.rows[0]);
    }

    const result = await this.pool.query<EntityLinkRow>(
      `
        INSERT INTO entity_link (
          id,
          entity_id,
          related_entity_id,
          relationship_type,
          confidence,
          evidence_atom_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        input.id,
        input.entityId,
        input.relatedEntityId,
        input.relationshipType,
        input.confidence ?? null,
        input.evidenceAtomId ?? null,
      ],
    );
    return mapEntityLink(requireRow(result.rows[0], "Failed to create entity link"));
  }

  async createConsolidationRun(input: CreateConsolidationRunInput): Promise<ConsolidationRun> {
    const result = await this.pool.query<ConsolidationRunRow>(
      `
        INSERT INTO consolidation_run (
          id,
          status,
          started_at,
          completed_at,
          atom_count,
          processed_atom_count,
          low_confidence_atom_count,
          error_count,
          notes,
          error_message,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        RETURNING *
      `,
      [
        input.id,
        input.status,
        input.startedAt ?? new Date(),
        input.completedAt ?? null,
        input.atomCount ?? 0,
        input.processedAtomCount ?? 0,
        input.lowConfidenceAtomCount ?? 0,
        input.errorCount ?? 0,
        input.notes ?? null,
        input.errorMessage ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapConsolidationRun(requireRow(result.rows[0], "Failed to create consolidation run"));
  }

  async completeConsolidationRun(input: CompleteConsolidationRunInput): Promise<ConsolidationRun> {
    const result = await this.pool.query<ConsolidationRunRow>(
      `
        UPDATE consolidation_run
        SET
          status = $2,
          completed_at = NOW(),
          atom_count = $3,
          processed_atom_count = $4,
          low_confidence_atom_count = $5,
          error_count = $6,
          notes = $7,
          error_message = $8,
          metadata = $9::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [
        input.id,
        input.status,
        input.atomCount,
        input.processedAtomCount ?? input.atomCount,
        input.lowConfidenceAtomCount ?? 0,
        input.errorCount,
        input.notes ?? null,
        input.errorMessage ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapConsolidationRun(requireRow(result.rows[0], "Failed to complete consolidation run"));
  }

  async listConsolidationRuns(limit = 20): Promise<ConsolidationRun[]> {
    const result = await this.pool.query<ConsolidationRunRow>(
      `
        SELECT *
        FROM consolidation_run
        ORDER BY started_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map(mapConsolidationRun);
  }

  async createReviewItem(input: CreateReviewItemInput): Promise<ReviewItem> {
    const result = await this.pool.query<ReviewItemRow>(
      `
        INSERT INTO review_item (
          id,
          atom_id,
          entity_id,
          kind,
          status,
          detail,
          confidence,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `,
      [
        input.id,
        input.atomId ?? null,
        input.entityId ?? null,
        input.kind,
        input.status ?? "open",
        input.detail,
        input.confidence ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapReviewItem(requireRow(result.rows[0], "Failed to create review item"));
  }

  async listReviewItems(status?: ReviewItem["status"]): Promise<ReviewItem[]> {
    const values: unknown[] = [];
    let where = "";
    if (status) {
      values.push(status);
      where = "WHERE status = $1";
    }

    const result = await this.pool.query<ReviewItemRow>(
      `SELECT * FROM review_item ${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows.map(mapReviewItem);
  }

  async createCorrectionAction(input: CreateCorrectionActionInput): Promise<CorrectionAction> {
    const result = await this.pool.query<CorrectionActionRow>(
      `
        INSERT INTO correction_action (
          id,
          target_atom_id,
          proposed_content,
          reason,
          status,
          confidence,
          applied_atom_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `,
      [
        input.id,
        input.targetAtomId ?? null,
        input.proposedContent,
        input.reason ?? null,
        input.status ?? "proposed",
        input.confidence ?? null,
        input.appliedAtomId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapCorrectionAction(requireRow(result.rows[0], "Failed to create correction action"));
  }

  async listCorrectionActions(statuses?: CorrectionAction["status"][]): Promise<CorrectionAction[]> {
    const values: unknown[] = [];
    let where = "";
    if (statuses && statuses.length > 0) {
      values.push(statuses);
      where = "WHERE status = ANY($1::correction_status[])";
    }

    const result = await this.pool.query<CorrectionActionRow>(
      `SELECT * FROM correction_action ${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows.map(mapCorrectionAction);
  }

  async updateCorrectionActionStatus(id: string, status: CorrectionAction["status"]): Promise<CorrectionAction> {
    const result = await this.pool.query<CorrectionActionRow>(
      `
        UPDATE correction_action
        SET status = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id, status],
    );
    return mapCorrectionAction(requireRow(result.rows[0], "Failed to update correction action"));
  }

  async getSystemState(): Promise<SystemState> {
    const result = await this.pool.query<SystemStateRow>("SELECT * FROM system_state WHERE singleton = TRUE LIMIT 1");
    return result.rows[0]
      ? mapSystemState(result.rows[0])
      : {
          consolidationEnabled: true,
          consecutiveAbortedRuns: 0,
          updatedAt: new Date(),
        };
  }

  async updateSystemState(input: UpdateSystemStateInput): Promise<SystemState> {
    const current = await this.getSystemState();
    const next: SystemState = {
      consolidationEnabled:
        input.consolidationEnabled === undefined ? current.consolidationEnabled : input.consolidationEnabled,
      consecutiveAbortedRuns:
        input.consecutiveAbortedRuns === undefined ? current.consecutiveAbortedRuns : input.consecutiveAbortedRuns,
      updatedAt: current.updatedAt,
    };
    const result = await this.pool.query<SystemStateRow>(
      `
        INSERT INTO system_state (singleton, consolidation_enabled, consecutive_aborted_runs)
        VALUES (
          TRUE,
          $1,
          $2
        )
        ON CONFLICT (singleton)
        DO UPDATE SET
          consolidation_enabled = EXCLUDED.consolidation_enabled,
          consecutive_aborted_runs = EXCLUDED.consecutive_aborted_runs,
          updated_at = NOW()
        RETURNING *
      `,
      [next.consolidationEnabled, next.consecutiveAbortedRuns],
    );
    return mapSystemState(requireRow(result.rows[0], "Failed to update system state"));
  }

  async countMemoryAtoms(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM memory_atom");
    return Number(requireRow(result.rows[0], "Failed to count memory atoms").count);
  }

  async countPendingAtoms(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM memory_atom WHERE consolidation_status = 'pending'",
    );
    return Number(requireRow(result.rows[0], "Failed to count pending atoms").count);
  }

  async createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
    const result = await this.pool.query<RequestLogRow>(
      `
        INSERT INTO request_log (
          id,
          client_id,
          method,
          route,
          status_code,
          duration_ms,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [
        input.id,
        input.clientId,
        input.method,
        input.route,
        input.statusCode,
        input.durationMs,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapRequestLog(requireRow(result.rows[0], "Failed to create request log"));
  }

  async listRequestLogs(limit = 100): Promise<RequestLog[]> {
    const result = await this.pool.query<RequestLogRow>(
      "SELECT * FROM request_log ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return result.rows.map(mapRequestLog);
  }

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const result = await this.pool.query<NotificationRow>(
      `
        INSERT INTO notification (
          id,
          kind,
          detail,
          metadata
        )
        VALUES ($1, $2, $3, $4::jsonb)
        RETURNING *
      `,
      [input.id, input.kind, input.detail, JSON.stringify(input.metadata ?? {})],
    );
    return mapNotification(requireRow(result.rows[0], "Failed to create notification"));
  }

  async listNotifications(limit = 100): Promise<Notification[]> {
    const result = await this.pool.query<NotificationRow>(
      "SELECT * FROM notification ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return result.rows.map(mapNotification);
  }

  async deleteAllData(): Promise<void> {
    await this.pool.query(
      "TRUNCATE TABLE request_log, notification, review_item, correction_action, consolidation_run, entity_link, memory_atom, entity, system_state RESTART IDENTITY CASCADE",
    );
    await this.pool.query(
      "INSERT INTO system_state (singleton, consolidation_enabled, consecutive_aborted_runs) VALUES (TRUE, TRUE, 0) ON CONFLICT (singleton) DO NOTHING",
    );
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
