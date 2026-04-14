import { stdin as input, stdout as output } from "node:process";
import { getApiClientTokens, getApiHost, getApiPort } from "../../config/env.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function writeMessage(message: unknown): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  output.write(`Content-Length: ${payload.length}\r\n\r\n`);
  output.write(payload);
}

function getHttpAuthHeader(): string {
  const tokens = getApiClientTokens();
  const first = tokens.values().next().value as string | undefined;
  if (!first) {
    throw new Error("MCP shim requires OB2_API_TOKEN or OB2_API_CLIENT_TOKENS.");
  }
  return `Bearer ${first}`;
}

function getBaseUrl(): string {
  return `http://${getApiHost()}:${getApiPort()}`;
}

async function proxyToolCall(name: string, argumentsValue: Record<string, unknown> | undefined): Promise<unknown> {
  const headers = {
    authorization: getHttpAuthHeader(),
    "content-type": "application/json",
  };

  if (name === "capture") {
    const response = await fetch(`${getBaseUrl()}/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify(argumentsValue ?? {}),
    });
    return response.json();
  }

  if (name === "query") {
    const response = await fetch(`${getBaseUrl()}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: argumentsValue?.text ?? "" }),
    });
    return response.json();
  }

  if (name === "get_entity") {
    const response = await fetch(`${getBaseUrl()}/entity/${encodeURIComponent(String(argumentsValue?.id ?? ""))}`, {
      headers,
    });
    return response.json();
  }

  if (name === "propose_correction") {
    const response = await fetch(`${getBaseUrl()}/correction`, {
      method: "POST",
      headers,
      body: JSON.stringify(argumentsValue ?? {}),
    });
    return response.json();
  }

  if (name === "consolidate") {
    const response = await fetch(`${getBaseUrl()}/consolidate`, {
      method: "POST",
      headers,
      body: JSON.stringify(argumentsValue ?? {}),
    });
    return response.json();
  }

  if (name === "export") {
    const response = await fetch(`${getBaseUrl()}/export`, {
      headers,
    });
    return response.json();
  }

  throw new Error(`Unknown tool: ${name}`);
}

function toolList() {
  return [
    {
      name: "capture",
      description: "Capture a new memory atom through the Open Brain 2 HTTP API.",
      inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
    },
    {
      name: "query",
      description: "Query memory through the Open Brain 2 HTTP API.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "get_entity",
      description: "Fetch an entity and its linked atoms by entity ID.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "propose_correction",
      description: "Create a correction proposal against an existing atom.",
      inputSchema: { type: "object", properties: { proposedContent: { type: "string" } }, required: ["proposedContent"] },
    },
    {
      name: "consolidate",
      description: "Run manual consolidation through the HTTP API.",
      inputSchema: { type: "object", properties: { forceEnable: { type: "boolean" } } },
    },
    {
      name: "export",
      description: "Create a portable export artifact through the HTTP API.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

async function handleMessage(request: JsonRpcRequest): Promise<void> {
  if (request.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "open-brain-2-mcp",
          version: "0.1.0",
        },
        capabilities: {
          tools: {},
        },
      },
    });
    return;
  }

  if (request.method === "notifications/initialized") {
    return;
  }

  if (request.method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: { tools: toolList() },
    });
    return;
  }

  if (request.method === "tools/call") {
    try {
      const result = await proxyToolCall(
        String(request.params?.name ?? ""),
        (request.params?.arguments as Record<string, unknown> | undefined) ?? {},
      );
      writeMessage({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
        },
      });
    } catch (error) {
      writeMessage({
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return;
  }

  writeMessage({
    jsonrpc: "2.0",
    id: request.id ?? null,
    error: {
      code: -32601,
      message: `Method not found: ${request.method}`,
    },
  });
}

export async function startMcpProxyServer(): Promise<void> {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const headerBlock = buffer.slice(0, headerEnd);
      const match = headerBlock.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = "";
        return;
      }

      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) {
        return;
      }

      const payload = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);
      void handleMessage(JSON.parse(payload) as JsonRpcRequest);
    }
  });
}
