import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  ensureDockerPostgres,
  hasDockerCompose,
  shutdownPostgresPool,
} from "../src/testing/postgresTestUtils.js";

const execFileAsync = promisify(execFile);

async function runCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "node",
    ["./node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env },
    },
  );
  return stdout.trim();
}

const postgresDescribe = (await hasDockerCompose()) ? describe : describe.skip;

postgresDescribe("CLI smoke test", () => {
  it("runs migrate, load, capture, query, and entity inspection", async () => {
    await ensureDockerPostgres();
    await runCli(["db", "migrate"]);
    await runCli(["db", "reset", "--force"]);
    await runCli(["fixtures", "load", path.join("fixtures", "morgan.json")]);
    const captureOutput = await runCli([
      "capture",
      "Morgan prefers aisle seats for work travel.",
      "--entity",
      "Morgan Chen",
      "--decay",
      "preference",
      "--importance",
      "0.66",
      "--source-ref",
      "cli:test:001",
    ]);
    const queryOutput = await runCli(["query", "aisle seats"]);
    const entityOutput = await runCli(["entity", "show", "Morgan Chen"]);

    expect(captureOutput).toContain("Morgan prefers aisle seats for work travel.");
    expect(queryOutput).toContain("aisle seats");
    expect(entityOutput).toContain("Morgan Chen");
  });
});

afterAll(async () => {
  await shutdownPostgresPool();
});
