import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getApiClientTokens, getApiHost, getApiPort } from "../../config/env.js";
import { makeId } from "../../utils/crypto.js";
import type { CaptureMemoryInput, DecayClass } from "../../domain/types.js";
import type { MemoryServices } from "../../app/MemoryServices.js";

interface AuthResult {
  ok: boolean;
  clientId: string | null;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function parseAuth(request: IncomingMessage): AuthResult {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, clientId: null };
  }

  const token = header.slice("Bearer ".length).trim();
  const configured = getApiClientTokens();
  for (const [clientId, clientToken] of configured.entries()) {
    if (token === clientToken) {
      return { ok: true, clientId };
    }
  }

  return { ok: false, clientId: null };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function normalizeCaptureInput(body: Record<string, unknown>): CaptureMemoryInput {
  const now = new Date().toISOString();
  return {
    content: String(body.content ?? ""),
    entityHint: body.entityHint ? String(body.entityHint) : null,
    decayClass: (body.decayClass ? String(body.decayClass) : "profile") as DecayClass,
    importance: Number(body.importance ?? 0.5),
    confidence: body.confidence === undefined ? undefined : Number(body.confidence),
    sourceRef: body.sourceRef ? String(body.sourceRef) : `http:${now}`,
    sourceAgent: body.sourceAgent ? String(body.sourceAgent) : "ob-http",
    validAt: body.validAt ? String(body.validAt) : undefined,
    invalidAt: body.invalidAt ? String(body.invalidAt) : undefined,
    metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
  };
}

export interface HttpServerOptions {
  host?: string;
  port?: number;
}

export function createHttpApiServer(services: MemoryServices, options: HttpServerOptions = {}): Server {
  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    let route = url.pathname;
    let statusCode = 500;
    let clientId = "anonymous";
    let metadata: Record<string, unknown> = {};

    try {
      if (url.pathname !== "/healthz") {
        const auth = parseAuth(request);
        if (!auth.ok || !auth.clientId) {
          statusCode = 401;
          sendJson(response, 401, { error: "Unauthorized" });
          return;
        }
        clientId = auth.clientId;
      }

      if (method === "GET" && url.pathname === "/healthz") {
        statusCode = 200;
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/capture") {
        const body = await readJsonBody(request);
        const result = await services.capture(normalizeCaptureInput(body));
        metadata = {
          automation: result.automation,
        };
        statusCode = 201;
        sendJson(response, 201, result);
        return;
      }

      if (method === "POST" && url.pathname === "/query") {
        const body = await readJsonBody(request);
        const text = String(body.text ?? "");
        const result = await services.query(text);
        metadata = {
          reasoning: result.reasoning,
        };
        statusCode = 200;
        sendJson(response, 200, result);
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/entity/")) {
        route = "/entity/:id";
        const entityId = decodeURIComponent(url.pathname.slice("/entity/".length));
        const result = await services.getEntityDetail(entityId);
        if (!result) {
          statusCode = 404;
          sendJson(response, 404, { error: "Entity not found" });
          return;
        }
        statusCode = 200;
        sendJson(response, 200, result);
        return;
      }

      if (method === "POST" && url.pathname === "/correction") {
        const body = await readJsonBody(request);
        const result = await services.proposeCorrection(
          body.targetAtomId ? String(body.targetAtomId) : null,
          String(body.proposedContent ?? ""),
          body.reason ? String(body.reason) : undefined,
        );
        statusCode = 201;
        sendJson(response, 201, result);
        return;
      }

      if (method === "POST" && url.pathname === "/consolidate") {
        const body = await readJsonBody(request);
        if (body.forceEnable === true) {
          await services.forceEnableConsolidation();
          statusCode = 200;
          sendJson(response, 200, { status: "re-enabled" });
          return;
        }
        const result = await services.consolidate();
        statusCode = 200;
        sendJson(response, 200, result);
        return;
      }

      if (method === "GET" && url.pathname === "/export") {
        const result = await services.exportData();
        statusCode = 200;
        sendJson(response, 200, result);
        return;
      }

      if (method === "GET" && url.pathname === "/openapi.json") {
        statusCode = 200;
        sendJson(response, 200, {
          openapi: "3.1.0",
          info: { title: "Open Brain 2 API", version: "0.1.0" },
          paths: {
            "/capture": { post: {} },
            "/query": { post: {} },
            "/entity/{id}": { get: {} },
            "/correction": { post: {} },
            "/consolidate": { post: {} },
            "/export": { get: {} },
          },
        });
        return;
      }

      statusCode = 404;
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metadata = { ...metadata, error: message };
      statusCode = statusCode >= 400 ? statusCode : 500;
      sendJson(response, statusCode, { error: message });
    } finally {
      if (url.pathname !== "/healthz") {
        await services.createRequestLog({
          id: makeId(),
          clientId,
          method,
          route,
          statusCode,
          durationMs: Date.now() - startedAt,
          metadata,
        });
      }
    }
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}

export async function startHttpApiServer(services: MemoryServices, options: HttpServerOptions = {}): Promise<Server> {
  const server = createHttpApiServer(services, options);
  const host = options.host ?? getApiHost();
  const port = options.port ?? getApiPort();
  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });
  return server;
}
