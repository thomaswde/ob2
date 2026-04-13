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

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureMigrationTable(client);

    const appliedRows = await client.query<{ version: string }>(
      "SELECT version FROM schema_migration ORDER BY version ASC",
    );
    const applied = new Set(appliedRows.rows.map((row) => row.version));
    const executed: string[] = [];

    for (const file of listMigrationFiles()) {
      if (applied.has(file)) {
        continue;
      }
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (version) VALUES ($1)", [file]);
      executed.push(file);
    }

    await client.query("COMMIT");
    return executed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
