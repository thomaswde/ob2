import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closePool, getPool } from "../adapters/postgres/db.js";
import { runMigrations } from "../adapters/postgres/migrations.js";
import { PostgresRepository } from "../adapters/postgres/PostgresRepository.js";

const execFileAsync = promisify(execFile);

export async function hasDockerCompose(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["compose", "version"], {
      cwd: process.cwd(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function ensureDockerPostgres(): Promise<void> {
  if (!(await hasDockerCompose())) {
    throw new Error("docker compose is not available");
  }
  await execFileAsync("docker", ["compose", "up", "-d", "postgres"], {
    cwd: process.cwd(),
  });
}

export async function createPostgresRepository(): Promise<PostgresRepository> {
  await ensureDockerPostgres();
  await runMigrations();
  const repository = new PostgresRepository(getPool());
  await repository.deleteAllData();
  await repository.seedTopLevelCategories();
  return repository;
}

export async function shutdownPostgresPool(): Promise<void> {
  await closePool();
}
