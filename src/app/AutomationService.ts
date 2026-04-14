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

  private isLockAlreadyHeldError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    await mkdir(path.dirname(this.options.lockFilePath), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(this.options.lockFilePath, "wx");
    } catch (error) {
      if (this.isLockAlreadyHeldError(error)) {
        return null;
      }
      throw error;
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

  private async recordFailureSafely(kind: string, detail: string, metadata: Record<string, unknown>): Promise<void> {
    try {
      await this.recordFailure(kind, detail, metadata);
    } catch {
      // Notification writes are best-effort; the automation result must still be returned.
    }
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

    await this.recordFailureSafely("automated_consolidation_aborted", `Automated consolidation ${locked.status}.`, {
      reason,
      runId: locked.runId,
      lowConfidenceCount: locked.lowConfidenceCount,
      errorCount: locked.errorCount,
    });
    return this.buildResult("aborted", reason, locked.runId, true, true);
  }

  async maybeTriggerAfterCapture(): Promise<AutomationTriggerResult> {
    try {
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

      return await this.runAutomation(`pending-threshold:${pendingCount}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailureSafely("automated_consolidation_failed", message, { reason: "capture" });
      return this.buildResult("failed", message, null, true, false);
    }
  }

  async runScheduled(): Promise<AutomationTriggerResult> {
    try {
      if (!this.options.enabled) {
        return this.buildResult("skipped", "automation disabled", null, false, false);
      }

      const state = await this.repository.getSystemState();
      if (!state.consolidationEnabled) {
        return this.buildResult("skipped", "consolidation circuit breaker disabled automation", null, false, false);
      }

      return await this.runAutomation("scheduled");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailureSafely("automated_consolidation_failed", message, { reason: "scheduled" });
      return this.buildResult("failed", message, null, true, false);
    }
  }
}
