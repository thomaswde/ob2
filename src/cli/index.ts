import path from "node:path";
import { ProjectionRebuilder } from "../app/ProjectionRebuilder.js";
import { captureMemory } from "../app/captureMemory.js";
import { createLanguageModel } from "../app/llmFactory.js";
import { MemoryQueryService } from "../app/MemoryQueryService.js";
import { loadFixtures } from "../app/fixtures.js";
import { PostgresRepository } from "../adapters/postgres/PostgresRepository.js";
import { closePool, getPool } from "../adapters/postgres/db.js";
import { runMigrations } from "../adapters/postgres/migrations.js";
import type { CaptureMemoryInput, DecayClass } from "../domain/types.js";
import { formatAtom, formatEntity, formatQueryResult } from "./format.js";

function getRepository(): PostgresRepository {
  return new PostgresRepository(getPool());
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function handleDb(args: string[]): Promise<void> {
  const subcommand = args[0];
  const repository = getRepository();

  if (subcommand === "migrate") {
    const executed = await runMigrations();
    await repository.seedTopLevelCategories();
    console.log(executed.length > 0 ? `Applied migrations: ${executed.join(", ")}` : "No migrations needed.");
    console.log("Top-level categories are ready.");
    return;
  }

  if (subcommand === "reset") {
    if (!hasFlag(args, "--force")) {
      throw new Error("db reset requires --force");
    }
    await repository.deleteAllData();
    await repository.seedTopLevelCategories();
    console.log("Database reset complete.");
    return;
  }

  throw new Error(`Unknown db command: ${subcommand ?? "none"}`);
}

async function handleCapture(args: string[]): Promise<void> {
  const content = args[0];
  if (!content) {
    throw new Error("capture requires content");
  }

  const repository = getRepository();
  const now = new Date().toISOString();
  const input: CaptureMemoryInput = {
    content,
    entityHint: readOption(args, "--entity"),
    decayClass: (readOption(args, "--decay") as DecayClass | undefined) ?? "profile",
    importance: Number(readOption(args, "--importance") ?? "0.5"),
    confidence: readOption(args, "--confidence") ? Number(readOption(args, "--confidence")) : undefined,
    sourceRef: readOption(args, "--source-ref") ?? `cli:${now}`,
    sourceAgent: readOption(args, "--source-agent") ?? "ob-cli",
    validAt: readOption(args, "--valid-at"),
    invalidAt: readOption(args, "--invalid-at"),
  };

  const atom = await captureMemory(repository, input);
  console.log(formatAtom(atom));
}

async function handleQuery(args: string[]): Promise<void> {
  const text = args[0];
  if (!text) {
    throw new Error("query requires search text");
  }

  const repository = getRepository();
  const languageModel = createLanguageModel();
  const result = await new MemoryQueryService(repository, languageModel).query(text);
  console.log(formatQueryResult(result));
}

async function handleProject(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "rebuild") {
    throw new Error(`Unknown project command: ${subcommand ?? "none"}`);
  }

  const repository = getRepository();
  const result = await new ProjectionRebuilder(repository).rebuild();
  console.log(`Projection rebuilt at ${result.outputPath} (${result.filesWritten} files).`);
}

async function handleEntity(args: string[]): Promise<void> {
  const subcommand = args[0];
  const repository = getRepository();

  if (subcommand === "list") {
    const entities = await repository.listEntities();
    for (const entity of entities) {
      console.log(`${entity.name}\t${entity.type}\t${entity.slug}`);
    }
    return;
  }

  if (subcommand === "show") {
    const name = args.slice(1).join(" ").trim();
    if (!name) {
      throw new Error("entity show requires a name");
    }

    const entity = await repository.getEntityByName(name);
    if (!entity) {
      throw new Error(`Entity not found: ${name}`);
    }

    console.log(formatEntity(entity));
    const atoms = await repository.listAtomsForEntity(entity.id);
    if (atoms.length > 0) {
      console.log("");
      console.log("atoms:");
      for (const atom of atoms) {
        console.log(`- ${atom.content}`);
      }
    }
    return;
  }

  throw new Error(`Unknown entity command: ${subcommand ?? "none"}`);
}

async function handleFixtures(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "load") {
    throw new Error(`Unknown fixtures command: ${subcommand ?? "none"}`);
  }

  const fixturePath = args[1];
  if (!fixturePath) {
    throw new Error("fixtures load requires a file path");
  }

  const repository = getRepository();
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const result = await loadFixtures(repository, absolutePath);
  console.log(`Loaded ${result.atomsLoaded} atoms from ${fixturePath}.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  try {
    if (command === "db") {
      await handleDb(rest);
      return;
    }
    if (command === "capture") {
      await handleCapture(rest);
      return;
    }
    if (command === "query") {
      await handleQuery(rest);
      return;
    }
    if (command === "entity") {
      await handleEntity(rest);
      return;
    }
    if (command === "project") {
      await handleProject(rest);
      return;
    }
    if (command === "fixtures") {
      await handleFixtures(rest);
      return;
    }

    console.log("Usage: ob <db|capture|query|entity|project|fixtures> ...");
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
