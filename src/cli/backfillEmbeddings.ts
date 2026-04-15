import { PostgresRepository } from "../adapters/postgres/PostgresRepository.js";
import { closePool, getPool } from "../adapters/postgres/db.js";
import { runMigrations } from "../adapters/postgres/migrations.js";
import { EmbeddingService } from "../app/EmbeddingService.js";
import type { QueryResult } from "pg";

async function main(): Promise<void> {
  await runMigrations();

  const repository = new PostgresRepository(getPool());
  const embeddingService = new EmbeddingService();

  if (!embeddingService.isEnabled()) {
    console.error("Embedding service is disabled. Set OB2_EMBEDDING_API_KEY to enable.");
    process.exit(1);
  }

  const pool = getPool();
  const embeddingSupport = await pool.query<{ supported: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'memory_atom'
        AND column_name = 'embedding'
    ) AS supported
  `);
  if (!embeddingSupport.rows[0]?.supported) {
    console.error("Embedding storage is not available in this database.");
    process.exit(1);
  }

  let lastCreatedAt: Date | null = null;
  let lastId: string | null = null;
  const batchSize = 100;
  let processed = 0;

  while (true) {
    const result: QueryResult<{ id: string; content: string; created_at: Date }> = await pool.query(
      `
        SELECT id, content, created_at
        FROM memory_atom
        WHERE embedding IS NULL
          AND (
            $1::timestamptz IS NULL
            OR created_at > $1
            OR (created_at = $1 AND id > $2)
          )
        ORDER BY created_at ASC, id ASC
        LIMIT $3
      `,
      [lastCreatedAt, lastId, batchSize],
    );

    if (result.rows.length === 0) {
      break;
    }

    const texts = result.rows.map((row) => row.content);
    const embeddings = await embeddingService.embedBatch(texts);

    const rows = result.rows;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const embedding = embeddings[index];
      if (!row || !embedding) {
        continue;
      }

      await repository.storeAtomEmbedding(row.id, embedding);
      processed += 1;
    }

    const lastRow = rows[rows.length - 1] ?? null;
    lastCreatedAt = lastRow?.created_at ?? lastCreatedAt;
    lastId = lastRow?.id ?? lastId;

    console.log(`Processed ${processed} atoms...`);
  }

  console.log(`Done. Backfilled ${processed} atoms.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
