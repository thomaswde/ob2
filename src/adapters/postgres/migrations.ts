import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPool } from "./db.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "sql", "migrations");

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasPgvectorSupport(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ supported: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_available_extensions
      WHERE name = 'vector'
    ) AS supported
  `);
  return result.rows[0]?.supported ?? false;
}

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ob2_schema_migrations'))");
    await ensureMigrationTable(client);
    const pgvectorSupported = await hasPgvectorSupport(client);

    const appliedRows = await client.query<{ version: string }>(
      "SELECT version FROM schema_migration ORDER BY version ASC",
    );
    const applied = new Set(appliedRows.rows.map((row) => row.version));
    const executed: string[] = [];

    for (const file of listMigrationFiles()) {
      if (applied.has(file)) {
        continue;
      }
      if (!pgvectorSupported && /embeddings?/i.test(file)) {
        continue;
      }
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const concurrentIndexMigration = /CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql);

      if (concurrentIndexMigration && inTransaction) {
        await client.query("COMMIT");
        inTransaction = false;
      }

      if (!concurrentIndexMigration && !inTransaction) {
        await client.query("BEGIN");
        inTransaction = true;
      }

      await client.query(sql);
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
      executed.push(file);

      if (concurrentIndexMigration && inTransaction) {
        await client.query("COMMIT");
        inTransaction = false;
      }
    }

    if (inTransaction) {
      await client.query("COMMIT");
      inTransaction = false;
    }
    return executed;
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ob2_schema_migrations'))");
    client.release();
  }
}
