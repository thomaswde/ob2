import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import type { ConsolidationResult, ConsolidationService } from "./ConsolidationService.js";
import type { Repository } from "../domain/repository.js";
import type { AutomationTriggerResult } from "../domain/types.js";
import { makeId } from "../utils/crypto.js";

export interface AutomationServiceOptions {
  enabled: boolean;
  pendingThreshold: number;
  lockFilePath: string;
}

export class AutomationService {
  constructor(
    private readonly repository: Repository,
    private readonly consolidationService: ConsolidationService,
    private readonly options: AutomationServiceOptions,
  ) {}

  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    await mkdir(path.dirname(this.options.lockFilePath), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(this.options.lockFilePath, "wx");
    } catch {
      return null;
    }

    try {
      return await fn();
    } finally {
      await handle.close();
      await rm(this.options.lockFilePath, { force: true });
    }
  }

  private async recordFailure(kind: string, detail: string, metadata: Record<string, unknown>): Promise<void> {
    await this.repository.createNotification({
      id: makeId(),
      kind,
      detail,
      metadata,
    });
  }

  private buildResult(
    status: AutomationTriggerResult["status"],
    reason: string,
    runId: string | null,
    attempted: boolean,
    triggered: boolean,
  ): AutomationTriggerResult {
    return { status, reason, runId, attempted, triggered };
  }

  private async runAutomation(reason: string): Promise<AutomationTriggerResult> {
    const locked = await this.withLock(async (): Promise<ConsolidationResult> => this.consolidationService.run());
    if (!locked) {
      return this.buildResult("skipped", "consolidation already in progress", null, true, false);
    }

    if (locked.status === "completed") {
      return this.buildResult("completed", reason, locked.runId, true, true);
    }

    await this.recordFailure("automated_consolidation_aborted", `Automated consolidation ${locked.status}.`, {
      reason,
      runId: locked.runId,
      lowConfidenceCount: locked.lowConfidenceCount,
      errorCount: locked.errorCount,
    });
    return this.buildResult("aborted", reason, locked.runId, true, true);
  }

  async maybeTriggerAfterCapture(): Promise<AutomationTriggerResult> {
    if (!this.options.enabled) {
      return this.buildResult("skipped", "automation disabled", null, false, false);
    }

    const state = await this.repository.getSystemState();
    if (!state.consolidationEnabled) {
      return this.buildResult("skipped", "consolidation circuit breaker disabled automation", null, false, false);
    }

    const pendingCount = await this.repository.countPendingAtoms();
    if (pendingCount < this.options.pendingThreshold) {
      return this.buildResult("skipped", `pending atoms below threshold (${pendingCount}/${this.options.pendingThreshold})`, null, false, false);
    }

    return this.runAutomation(`pending-threshold:${pendingCount}`);
  }

  async runScheduled(): Promise<AutomationTriggerResult> {
    if (!this.options.enabled) {
      return this.buildResult("skipped", "automation disabled", null, false, false);
    }

    const state = await this.repository.getSystemState();
    if (!state.consolidationEnabled) {
      return this.buildResult("skipped", "consolidation circuit breaker disabled automation", null, false, false);
    }

    try {
      return await this.runAutomation("scheduled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure("automated_consolidation_failed", message, { reason: "scheduled" });
      return this.buildResult("failed", message, null, true, false);
    }
  }
}
