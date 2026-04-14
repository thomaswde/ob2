import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StubLanguageModelScenario } from "../src/adapters/llm/StubLanguageModel.js";
import { loadFixtures } from "../src/app/fixtures.js";
import { MemoryServices } from "../src/app/MemoryServices.js";
import { createHttpApiServer } from "../src/transports/http/server.js";
import { StubLanguageModel } from "../src/adapters/llm/StubLanguageModel.js";
import { InMemoryRepository } from "../src/testing/inMemoryRepository.js";
import type { AutomationServiceOptions } from "../src/app/AutomationService.js";

const fixturePath = path.resolve(process.cwd(), "fixtures", "morgan.json");
const cleanupRoots: string[] = [];

async function makeRootDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

async function buildRepository(): Promise<InMemoryRepository> {
  const repository = new InMemoryRepository();
  await repository.seedTopLevelCategories();
  await loadFixtures(repository, fixturePath);
  return repository;
}

function buildServices(
  repository: InMemoryRepository,
  rootDir: string,
  automation: AutomationServiceOptions,
  scenario: StubLanguageModelScenario = "success",
): MemoryServices {
  return new MemoryServices(repository, new StubLanguageModel({ scenario }), {
    rootDir,
    automation,
  });
}

async function startServer(services: MemoryServices): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createHttpApiServer(services);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("Phase 4 transports and automation", () => {
  afterEach(async () => {
    delete process.env.OB2_API_TOKEN;
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("serves the HTTP API with bearer auth, request logging, and export", async () => {
    process.env.OB2_API_TOKEN = "phase4-test-token";
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-http-");
    const services = buildServices(
      repository,
      rootDir,
      {
        enabled: false,
        pendingThreshold: 50,
        lockFilePath: path.join(rootDir, ".lock"),
      },
      "success",
    );

    await services.consolidate();
    const server = await startServer(services);

    try {
      const unauthorized = await fetch(`${server.baseUrl}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "where do I work" }),
      });
      expect(unauthorized.status).toBe(401);

      const queryResponse = await fetch(`${server.baseUrl}/query`, {
        method: "POST",
        headers: {
          authorization: "Bearer phase4-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "where do I work" }),
      });
      expect(queryResponse.status).toBe(200);
      const queryJson = (await queryResponse.json()) as { reasoning: { gatesUsed: string[] } };
      expect(queryJson.reasoning.gatesUsed.length).toBeGreaterThan(0);

      const exportResponse = await fetch(`${server.baseUrl}/export`, {
        headers: {
          authorization: "Bearer phase4-test-token",
        },
      });
      expect(exportResponse.status).toBe(200);
      const exportJson = (await exportResponse.json()) as { outputPath: string };
      const manifest = JSON.parse(await readFile(path.join(exportJson.outputPath, "manifest.json"), "utf8")) as {
        entityCount: number;
      };
      expect(manifest.entityCount).toBeGreaterThan(0);

      const requestLogs = await repository.listRequestLogs();
      expect(requestLogs.length).toBeGreaterThanOrEqual(3);
      expect(requestLogs.some((entry) => entry.route === "/query" && entry.clientId === "default")).toBe(true);
      expect(
        requestLogs.some(
          (entry) =>
            entry.route === "/query" &&
            Array.isArray((entry.metadata.reasoning as { gatesUsed?: string[] } | undefined)?.gatesUsed),
        ),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("automatically consolidates after capture when the threshold is reached", async () => {
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-automation-ok-");
    const services = buildServices(repository, rootDir, {
      enabled: true,
      pendingThreshold: 1,
      lockFilePath: path.join(rootDir, ".lock"),
    });

    const result = await services.capture({
      content: "Morgan Chen prefers red-eye flights only when absolutely necessary.",
      sourceRef: "phase4:auto:1",
      entityHint: "Morgan Chen",
      decayClass: "preference",
      importance: 0.55,
    });

    expect(result.automation?.status).toBe("completed");
    expect(await repository.countPendingAtoms()).toBe(0);
  });

  it("records notifications when automated consolidation aborts", async () => {
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-automation-abort-");
    const services = buildServices(
      repository,
      rootDir,
      {
        enabled: true,
        pendingThreshold: 1,
        lockFilePath: path.join(rootDir, ".lock"),
      },
      "low-confidence",
    );

    const result = await services.capture({
      content: "Morgan Chen switched notebook vendors last week.",
      sourceRef: "phase4:auto:abort",
      entityHint: "Morgan Chen",
      decayClass: "ephemeral",
      importance: 0.3,
    });

    expect(result.automation?.status).toBe("aborted");
    const notifications = await repository.listNotifications();
    expect(notifications.some((notification) => notification.kind === "automated_consolidation_aborted")).toBe(true);
  });

  it("skips duplicate automated runs when the lock file already exists", async () => {
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-lock-");
    const lockFilePath = path.join(rootDir, ".lock");
    const services = buildServices(repository, rootDir, {
      enabled: true,
      pendingThreshold: 1,
      lockFilePath,
    });
    const handle = await open(lockFilePath, "w");

    try {
      const result = await services.runScheduledAutomation();
      expect(result?.status).toBe("skipped");
      expect(result?.reason).toContain("already in progress");
    } finally {
      await handle.close();
      await rm(lockFilePath, { force: true });
    }
  });
});
