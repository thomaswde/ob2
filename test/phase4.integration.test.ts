import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

function encodeMcpMessage(message: unknown): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
}

function createMcpReader(stdout: NodeJS.ReadableStream): () => Promise<Record<string, unknown>> {
  let buffer = "";

  return async () => {
    while (true) {
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          break;
        }

        const headerBlock = buffer.slice(0, headerEnd);
        const match = headerBlock.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = "";
          break;
        }

        const contentLength = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLength) {
          break;
        }

        const payload = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);
        return JSON.parse(payload) as Record<string, unknown>;
      }

      const [chunk] = (await once(stdout, "data")) as [Buffer | string];
      buffer += chunk.toString();
    }
  };
}

async function readMcpResponse(
  readMessage: () => Promise<Record<string, unknown>>,
  id: number,
): Promise<Record<string, unknown>> {
  while (true) {
    const message = await readMessage();
    if (message.id === id) {
      return message;
    }
  }
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

  it("returns 400 for malformed JSON bodies and logs the failure", async () => {
    process.env.OB2_API_TOKEN = "phase4-test-token";
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-http-bad-json-");
    const services = buildServices(repository, rootDir, {
      enabled: false,
      pendingThreshold: 50,
      lockFilePath: path.join(rootDir, ".lock"),
    });
    const server = await startServer(services);

    try {
      const response = await fetch(`${server.baseUrl}/capture`, {
        method: "POST",
        headers: {
          authorization: "Bearer phase4-test-token",
          "content-type": "application/json",
        },
        body: "{",
      });

      expect(response.status).toBe(400);
      const json = (await response.json()) as { error: string };
      expect(json.error).toContain("valid JSON");

      const requestLogs = await repository.listRequestLogs();
      const badRequest = requestLogs.find((entry) => entry.route === "/capture");
      expect(badRequest?.statusCode).toBe(400);
      expect(String((badRequest?.metadata.error as string | undefined) ?? "")).toContain("valid JSON");
    } finally {
      await server.close();
    }
  });

  it("surfaces upstream HTTP failures as MCP tool errors", async () => {
    process.env.OB2_API_TOKEN = "phase4-test-token";
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-mcp-");
    const services = buildServices(repository, rootDir, {
      enabled: false,
      pendingThreshold: 50,
      lockFilePath: path.join(rootDir, ".lock"),
    });
    const server = await startServer(services);
    const address = new URL(server.baseUrl);
    const child = spawn("node", ["./node_modules/tsx/dist/cli.mjs", "src/cli/index.ts", "mcp", "serve"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OB2_API_TOKEN: "phase4-test-token",
        OB2_API_HOST: address.hostname,
        OB2_API_PORT: address.port,
      },
    });
    const readMessage = createMcpReader(child.stdout);

    try {
      child.stdin.write(
        encodeMcpMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        }),
      );
      await readMcpResponse(readMessage, 1);

      child.stdin.write(
        encodeMcpMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "query",
            arguments: {},
          },
        }),
      );

      const response = await readMcpResponse(readMessage, 2);
      expect(response.error).toBeDefined();
      expect(response.result).toBeUndefined();
      expect(String((response.error as { message?: string } | undefined)?.message ?? "")).toContain("text is required");
    } finally {
      child.stdin.end();
      child.kill("SIGTERM");
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

  it("keeps capture working when automation lock setup fails and records a failed automation", async () => {
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-automation-failed-capture-");
    await writeFile(path.join(rootDir, "locks"), "not-a-directory", "utf8");
    const services = buildServices(repository, rootDir, {
      enabled: true,
      pendingThreshold: 1,
      lockFilePath: path.join(rootDir, "locks", "automation.lock"),
    });

    const result = await services.capture({
      content: "Morgan Chen switched notebook vendors last week.",
      sourceRef: "phase4:auto:failed-capture",
      entityHint: "Morgan Chen",
      decayClass: "ephemeral",
      importance: 0.3,
    });

    expect(result.atom.content).toContain("Morgan Chen switched notebook vendors");
    expect(result.automation?.status).toBe("failed");
    const notifications = await repository.listNotifications();
    expect(notifications.some((notification) => notification.kind === "automated_consolidation_failed")).toBe(true);
  });

  it("reports lock setup failures for scheduled automation instead of skipping silently", async () => {
    const repository = await buildRepository();
    const rootDir = await makeRootDir("ob2-phase4-automation-failed-scheduled-");
    await writeFile(path.join(rootDir, "locks"), "not-a-directory", "utf8");
    const services = buildServices(repository, rootDir, {
      enabled: true,
      pendingThreshold: 1,
      lockFilePath: path.join(rootDir, "locks", "automation.lock"),
    });

    const result = await services.runScheduledAutomation();

    expect(result?.status).toBe("failed");
    expect(result?.reason).toContain("file already exists");
    const notifications = await repository.listNotifications();
    expect(notifications.some((notification) => notification.kind === "automated_consolidation_failed")).toBe(true);
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
