import { PostgresRepository } from "../adapters/postgres/PostgresRepository.js";
import { getPool } from "../adapters/postgres/db.js";
import {
  getAutomationLockFilePath,
  getPendingConsolidationThreshold,
  isAutomationEnabled,
} from "../config/env.js";
import { createLanguageModel } from "./llmFactory.js";
import { MemoryServices } from "./MemoryServices.js";

export function createRuntimeMemoryServices(rootDir = process.cwd()): MemoryServices {
  const automationEnabled = isAutomationEnabled();
  return new MemoryServices(new PostgresRepository(getPool()), createLanguageModel(), {
    rootDir,
    automation: automationEnabled
      ? {
          enabled: true,
          pendingThreshold: getPendingConsolidationThreshold(),
          lockFilePath: getAutomationLockFilePath(),
        }
      : undefined,
  });
}
