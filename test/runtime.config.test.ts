import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeMemoryServices } from "../src/app/runtimeServices.js";
import { getApiPort, getPendingConsolidationThreshold } from "../src/config/env.js";

const envKeys = [
  "OB2_LLM_BACKEND",
  "OB2_LLM_MODEL",
  "OB2_USE_STUB_LLM",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OB2_AUTOMATION_ENABLED",
  "OB2_API_PORT",
  "OB2_PENDING_CONSOLIDATION_THRESHOLD",
] as const;

const originalEnv = new Map<string, string | undefined>();

function snapshotEnv(): void {
  originalEnv.clear();
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key]);
  }
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("runtime config parsing", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("rejects invalid API ports and automation thresholds", () => {
    snapshotEnv();

    process.env.OB2_API_PORT = "0";
    expect(() => getApiPort()).toThrow("OB2_API_PORT must be a positive integer");

    process.env.OB2_API_PORT = "not-a-number";
    expect(() => getApiPort()).toThrow("OB2_API_PORT must be a positive integer");

    process.env.OB2_PENDING_CONSOLIDATION_THRESHOLD = "0";
    expect(() => getPendingConsolidationThreshold()).toThrow(
      "OB2_PENDING_CONSOLIDATION_THRESHOLD must be a positive integer",
    );

    process.env.OB2_PENDING_CONSOLIDATION_THRESHOLD = "-1";
    expect(() => getPendingConsolidationThreshold()).toThrow(
      "OB2_PENDING_CONSOLIDATION_THRESHOLD must be a positive integer",
    );
  });

  it("does not require automation config when automation is disabled", () => {
    snapshotEnv();

    process.env.OB2_USE_STUB_LLM = "1";
    process.env.OB2_AUTOMATION_ENABLED = "0";
    process.env.OB2_PENDING_CONSOLIDATION_THRESHOLD = "0";

    const services = createRuntimeMemoryServices(process.cwd());

    expect(services.automationService).toBeNull();
  });

  it("fails closed when automation is enabled with an invalid threshold", () => {
    snapshotEnv();

    process.env.OB2_USE_STUB_LLM = "1";
    process.env.OB2_AUTOMATION_ENABLED = "1";
    process.env.OB2_PENDING_CONSOLIDATION_THRESHOLD = "0";

    expect(() => createRuntimeMemoryServices(process.cwd())).toThrow(
      "OB2_PENDING_CONSOLIDATION_THRESHOLD must be a positive integer",
    );
  });
});
