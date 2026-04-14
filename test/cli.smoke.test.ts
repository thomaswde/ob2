import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      env: { ...process.env, OB2_USE_STUB_LLM: "1" },
    },
  );
  return stdout.trim();
}

const postgresDescribe = (await hasDockerCompose()) ? describe : describe.skip;

postgresDescribe("CLI smoke test", () => {
  beforeAll(async () => {
    await ensureDockerPostgres();
    await runCli(["db", "migrate"]);
  });

  it("runs migrate, load, rebuild, capture, query, and entity inspection", async () => {
    await runCli(["db", "reset", "--force"]);
    await runCli(["fixtures", "load", path.join("fixtures", "morgan.json")]);
    const rebuildOutput = await runCli(["project", "rebuild"]);
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
    await runCli(["project", "rebuild"]);
    const queryOutput = await runCli(["query", "aisle seats"]);
    const entityOutput = await runCli(["entity", "show", "work"]);

    expect(rebuildOutput).toContain("Projection rebuilt");
    expect(captureOutput).toContain("Morgan prefers aisle seats for work travel.");
    expect(queryOutput).toContain("needsMemory: yes");
    expect(queryOutput).toContain("Morgan Chen lives in Denver, Colorado.");
    expect(entityOutput).toContain("name: work");
  }, 20000);

  it("preserves correction content that matches flag values", async () => {
    await runCli(["db", "reset", "--force"]);
    await runCli(["fixtures", "load", path.join("fixtures", "morgan.json")]);

    const correctionOutput = await runCli([
      "corrections",
      "propose",
      "--reason",
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111111",
      "should",
      "stay",
      "in",
      "content",
    ]);

    expect(correctionOutput).toContain("targetAtomId: none");
    expect(correctionOutput).toContain("proposedContent: 11111111-1111-4111-8111-111111111111 should stay in content");
  }, 20000);
});

afterAll(async () => {
  await shutdownPostgresPool();
});
