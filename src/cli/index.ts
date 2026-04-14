import { ConsolidationService } from "../app/ConsolidationService.js";
import path from "node:path";
import { ProjectionRebuilder } from "../app/ProjectionRebuilder.js";
import { createLanguageModel } from "../app/llmFactory.js";
import { createRuntimeMemoryServices } from "../app/runtimeServices.js";
import { loadFixtures } from "../app/fixtures.js";
import { PostgresRepository } from "../adapters/postgres/PostgresRepository.js";
import { closePool, getPool } from "../adapters/postgres/db.js";
import { runMigrations } from "../adapters/postgres/migrations.js";
import { startHttpApiServer } from "../transports/http/server.js";
import { startMcpProxyServer } from "../transports/mcp/server.js";
import type { CaptureMemoryInput, DecayClass } from "../domain/types.js";
import {
  formatAutomationResult,
  formatAtom,
  formatConsolidationResult,
  formatCorrectionAction,
  formatEntity,
  formatExportResult,
  formatQueryResult,
} from "./format.js";

function getRepository(): PostgresRepository {
  return new PostgresRepository(getPool());
}

function readOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function collectPositionalContent(args: string[], flags: string[]): string {
  const content: string[] = [];

  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === undefined) {
      continue;
    }
    if (!flags.includes(token)) {
      content.push(token);
      continue;
    }

    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      i += 1;
    }
  }

  return content.join(" ").trim();
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

  const services = createRuntimeMemoryServices(process.cwd());
  const result = await services.capture(input);
  console.log(formatAtom(result.atom));
  if (result.automation) {
    console.log("");
    console.log(formatAutomationResult(result.automation));
  }
}

async function handleQuery(args: string[]): Promise<void> {
  const text = args[0];
  if (!text) {
    throw new Error("query requires search text");
  }

  const services = createRuntimeMemoryServices(process.cwd());
  const result = await services.query(text);
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

async function handleConsolidate(args: string[]): Promise<void> {
  const services = createRuntimeMemoryServices(process.cwd());

  if (hasFlag(args, "--force-enable")) {
    await services.forceEnableConsolidation();
    console.log("Consolidation has been re-enabled.");
    return;
  }

  const result = await services.consolidate();
  console.log(formatConsolidationResult(result));
}

async function handleCorrections(args: string[]): Promise<void> {
  const subcommand = args[0];
  const repository = getRepository();
  const service = new ConsolidationService(repository, createLanguageModel());

  if (subcommand === "list") {
    const corrections = await repository.listCorrectionActions();
    for (const correction of corrections) {
      console.log(formatCorrectionAction(correction));
      console.log("");
    }
    return;
  }

  if (subcommand === "apply") {
    const id = args[1];
    if (!id) {
      throw new Error("corrections apply requires an id");
    }
    await service.applyCorrection(id);
    console.log(`Applied correction ${id}.`);
    return;
  }

  if (subcommand === "propose") {
    const targetAtomId = readOption(args, "--target") ?? null;
    const reason = readOption(args, "--reason") ?? null;
    const content = collectPositionalContent(args, ["--target", "--reason"]);
    if (!content) {
      throw new Error("corrections propose requires correction content");
    }
    const correction = await service.proposeCorrection(targetAtomId, content, reason ?? undefined);
    console.log(formatCorrectionAction(correction));
    return;
  }

  throw new Error(`Unknown corrections command: ${subcommand ?? "none"}`);
}

async function handleExport(): Promise<void> {
  const services = createRuntimeMemoryServices(process.cwd());
  const result = await services.exportData();
  console.log(formatExportResult(result));
}

async function handleAutomation(args: string[]): Promise<void> {
  const subcommand = args[0];
  const services = createRuntimeMemoryServices(process.cwd());

  if (subcommand === "scheduled") {
    const result = await services.runScheduledAutomation();
    console.log(formatAutomationResult(result));
    return;
  }

  throw new Error(`Unknown automation command: ${subcommand ?? "none"}`);
}

async function handleApi(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "serve") {
    throw new Error(`Unknown api command: ${subcommand ?? "none"}`);
  }

  const services = createRuntimeMemoryServices(process.cwd());
  const server = await startHttpApiServer(services);
  const address = server.address();
  if (typeof address === "object" && address) {
    console.log(`HTTP API listening on http://${address.address}:${address.port}`);
  } else {
    console.log("HTTP API listening.");
  }
  await new Promise<void>(() => {
    // Keep the CLI process alive until interrupted.
  });
}

async function handleMcp(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "serve") {
    throw new Error(`Unknown mcp command: ${subcommand ?? "none"}`);
  }

  await startMcpProxyServer();
  await new Promise<void>(() => {
    // Keep the MCP shim alive until interrupted.
  });
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
    if (command === "consolidate") {
      await handleConsolidate(rest);
      return;
    }
    if (command === "corrections") {
      await handleCorrections(rest);
      return;
    }
    if (command === "fixtures") {
      await handleFixtures(rest);
      return;
    }
    if (command === "export") {
      await handleExport();
      return;
    }
    if (command === "automation") {
      await handleAutomation(rest);
      return;
    }
    if (command === "api") {
      await handleApi(rest);
      return;
    }
    if (command === "mcp") {
      await handleMcp(rest);
      return;
    }

    console.log("Usage: ob <db|capture|query|entity|project|consolidate|corrections|fixtures|export|automation|api|mcp> ...");
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
