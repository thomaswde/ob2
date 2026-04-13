import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let loaded = false;

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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  loaded = true;
}

export function getDatabaseUrl(): string {
  loadDotEnv();
  return process.env.DATABASE_URL ?? "postgres://ob2:ob2@127.0.0.1:54329/ob2";
}

export function getAnthropicApiKey(): string | null {
  loadDotEnv();
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export function getAnthropicModel(): string {
  loadDotEnv();
  return process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";
}

export function shouldUseStubLlm(): boolean {
  loadDotEnv();
  return process.env.OB2_USE_STUB_LLM === "1";
}
