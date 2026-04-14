import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let loaded = false;
const LLM_BACKENDS = ["stub", "anthropic-api", "anthropic-agent"] as const;

export type LlmBackend = (typeof LLM_BACKENDS)[number];

function loadDotEnv(): void {
  if (loaded) {
    return;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    loaded = true;
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  loaded = true;
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  loadDotEnv();
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`);
  }

  return value;
}

export function getDatabaseUrl(): string {
  loadDotEnv();
  return process.env.DATABASE_URL ?? "postgres://ob2:ob2@127.0.0.1:54329/ob2";
}

export function getAnthropicApiKey(): string | null {
  loadDotEnv();
  return process.env.ANTHROPIC_API_KEY ?? null;
}

function getAnthropicDefaultModel(): string {
  loadDotEnv();
  return process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
}

export function shouldUseStubLlm(): boolean {
  loadDotEnv();
  return process.env.OB2_USE_STUB_LLM === "1";
}

function parseLlmBackend(value: string): LlmBackend {
  if ((LLM_BACKENDS as readonly string[]).includes(value)) {
    return value as LlmBackend;
  }

  throw new Error(
    `OB2_LLM_BACKEND must be one of ${LLM_BACKENDS.join(", ")}, got ${JSON.stringify(value)}.`,
  );
}

function isExplicitTestContext(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

export function getLlmBackend(): LlmBackend {
  loadDotEnv();

  const configuredBackend = process.env.OB2_LLM_BACKEND?.trim();
  if (configuredBackend) {
    return parseLlmBackend(configuredBackend);
  }

  if (shouldUseStubLlm()) {
    return "stub";
  }

  if (getAnthropicApiKey()) {
    return "anthropic-api";
  }

  if (isExplicitTestContext()) {
    return "stub";
  }

  throw new Error(
    "No LLM backend configured. Set OB2_LLM_BACKEND to stub, anthropic-api, or anthropic-agent.",
  );
}

export function getLlmModel(backend: LlmBackend): string {
  loadDotEnv();

  const configuredModel = process.env.OB2_LLM_MODEL?.trim();
  if (configuredModel) {
    return configuredModel;
  }

  if (backend === "stub") {
    return "stub";
  }

  return getAnthropicDefaultModel();
}

export function getApiHost(): string {
  loadDotEnv();
  return process.env.OB2_API_HOST ?? "127.0.0.1";
}

export function getApiPort(): number {
  return parsePositiveIntegerEnv("OB2_API_PORT", 4318);
}

export function getApiToken(): string | null {
  loadDotEnv();
  return process.env.OB2_API_TOKEN ?? null;
}

export function getApiClientTokens(): Map<string, string> {
  loadDotEnv();
  const tokens = new Map<string, string>();
  const raw = process.env.OB2_API_CLIENT_TOKENS ?? "";

  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const clientId = trimmed.slice(0, separator).trim();
    const token = trimmed.slice(separator + 1).trim();
    if (clientId && token) {
      tokens.set(clientId, token);
    }
  }

  const singleToken = getApiToken();
  if (singleToken && tokens.size === 0) {
    tokens.set("default", singleToken);
  }

  return tokens;
}

export function getPendingConsolidationThreshold(): number {
  return parsePositiveIntegerEnv("OB2_PENDING_CONSOLIDATION_THRESHOLD", 50);
}

export function isAutomationEnabled(): boolean {
  loadDotEnv();
  return process.env.OB2_AUTOMATION_ENABLED === "1";
}

export function getAutomationLockFilePath(): string {
  loadDotEnv();
  return process.env.OB2_AUTOMATION_LOCK_FILE ?? path.resolve(process.cwd(), ".ob2-consolidate.lock");
}
