import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectionRebuilder } from "../app/ProjectionRebuilder.js";
import { MemoryQueryService } from "../app/MemoryQueryService.js";
import { loadFixtures } from "../app/fixtures.js";
import { StubLanguageModel } from "../adapters/llm/StubLanguageModel.js";
import { InMemoryRepository } from "./inMemoryRepository.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function main(): Promise<void> {
  const repository = new InMemoryRepository();
  const fixturePath = path.resolve(process.cwd(), "fixtures", "morgan.json");
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ob2-query-bench-"));
  const queries = [
    "what vehicles do I own",
    "what should you remember about me",
    "motorcycle restoration",
    "what travel preferences do I have",
    "what projects am I leading",
    "what family constraints should I remember",
    "what's the capital of France",
  ];

  try {
    await repository.seedTopLevelCategories();
    await loadFixtures(repository, fixturePath);
    await new ProjectionRebuilder(repository, rootDir).rebuild();

    const service = new MemoryQueryService(repository, new StubLanguageModel(), rootDir);
    const durations: number[] = [];

    for (const query of queries) {
      const startedAt = Date.now();
      const result = await service.query(query);
      const durationMs = Date.now() - startedAt;
      durations.push(durationMs);
      console.log(`${query}\t${durationMs}ms\t${result.reasoning.gatesUsed.join(",")}`);
    }

    const averageMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
    console.log("");
    console.log(`avg_ms\t${averageMs}`);
    console.log(`p95_ms\t${percentile(durations, 95)}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
