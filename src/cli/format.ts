import type {
  ConsolidationRun,
  CorrectionAction,
  Entity,
  ExportResult,
  MemoryAtom,
  QueryMemoryResult,
  ReviewItem,
  AutomationTriggerResult,
} from "../domain/types.js";

export function formatAtom(atom: MemoryAtom): string {
  return [
    `id: ${atom.id}`,
    `entityId: ${atom.entityId ?? "unlinked"}`,
    `decay: ${atom.decayClass}`,
    `importance: ${atom.importance.toFixed(2)}`,
    `content: ${atom.content}`,
  ].join("\n");
}

export function formatEntity(entity: Entity): string {
  return [
    `id: ${entity.id}`,
    `name: ${entity.name}`,
    `slug: ${entity.slug}`,
    `type: ${entity.type}`,
    `parentEntityId: ${entity.parentEntityId ?? "none"}`,
  ].join("\n");
}

export function formatQueryResult(result: QueryMemoryResult): string {
  const lines: string[] = [
    `needsMemory: ${result.reasoning.classifierDecision.needsMemory ? "yes" : "no"}`,
    `reason: ${result.reasoning.classifierDecision.reason}`,
  ];

  if (result.lifeState) {
    lines.push("", "life_state:", result.lifeState);
  }

  if (result.recent.length > 0) {
    lines.push("", "recent:");
    for (const atom of result.recent) {
      lines.push(`- ${atom.content}`);
    }
  }

  if (result.entities.length > 0) {
    lines.push("", "entities:");
    for (const entity of result.entities) {
      lines.push(`- ${entity.slug}: ${entity.summary}`);
      lines.push(entity.content);
    }
  }

  if (result.fallbackAtoms && result.fallbackAtoms.length > 0) {
    lines.push("", "fallback:");
    for (const atom of result.fallbackAtoms) {
      lines.push(`- ${atom.content}`);
    }
  }

  if (result.reasoning.gateTimingsMs) {
    lines.push("", "timings_ms:");
    for (const [gate, durationMs] of Object.entries(result.reasoning.gateTimingsMs)) {
      lines.push(`- ${gate}: ${durationMs}`);
    }
  }

  if (typeof result.reasoning.totalDurationMs === "number") {
    lines.push(`total_ms: ${result.reasoning.totalDurationMs}`);
  }

  lines.push("", `gates: ${result.reasoning.gatesUsed.join(", ")}`);
  return lines.join("\n");
}

export function formatConsolidationResult(result: {
  runId: string;
  status: string;
  atomCount: number;
  lowConfidenceCount: number;
  errorCount: number;
  outputPath: string | null;
  reviewItemsCreated: number;
  appliedCorrectionIds: string[];
}): string {
  return [
    `runId: ${result.runId}`,
    `status: ${result.status}`,
    `atomCount: ${result.atomCount}`,
    `lowConfidenceCount: ${result.lowConfidenceCount}`,
    `errorCount: ${result.errorCount}`,
    `reviewItemsCreated: ${result.reviewItemsCreated}`,
    `appliedCorrections: ${result.appliedCorrectionIds.length}`,
    `outputPath: ${result.outputPath ?? "none"}`,
  ].join("\n");
}

export function formatConsolidationRun(run: ConsolidationRun): string {
  return [
    `id: ${run.id}`,
    `status: ${run.status}`,
    `atomCount: ${run.atomCount}`,
    `processedAtomCount: ${run.processedAtomCount}`,
    `lowConfidenceAtomCount: ${run.lowConfidenceAtomCount}`,
    `errorCount: ${run.errorCount}`,
    `startedAt: ${run.startedAt.toISOString()}`,
    `completedAt: ${run.completedAt?.toISOString() ?? "pending"}`,
    `notes: ${run.notes ?? ""}`,
  ].join("\n");
}

export function formatCorrectionAction(action: CorrectionAction): string {
  return [
    `id: ${action.id}`,
    `status: ${action.status}`,
    `targetAtomId: ${action.targetAtomId ?? "none"}`,
    `appliedAtomId: ${action.appliedAtomId ?? "none"}`,
    `confidence: ${action.confidence ?? "n/a"}`,
    `proposedContent: ${action.proposedContent}`,
    `reason: ${action.reason ?? ""}`,
  ].join("\n");
}

export function formatReviewItem(item: ReviewItem): string {
  return [
    `id: ${item.id}`,
    `kind: ${item.kind}`,
    `status: ${item.status}`,
    `atomId: ${item.atomId ?? "none"}`,
    `entityId: ${item.entityId ?? "none"}`,
    `confidence: ${item.confidence ?? "n/a"}`,
    `detail: ${item.detail}`,
  ].join("\n");
}

export function formatExportResult(result: ExportResult): string {
  return [
    `outputPath: ${result.outputPath}`,
    `generatedAt: ${result.manifest.generatedAt}`,
    `schemaVersion: ${result.manifest.schemaVersion}`,
    `entityCount: ${result.manifest.entityCount}`,
    `atomCount: ${result.manifest.atomCount}`,
  ].join("\n");
}

export function formatAutomationResult(result: AutomationTriggerResult | null): string {
  if (!result) {
    return "automation: not configured";
  }

  return [
    `status: ${result.status}`,
    `attempted: ${result.attempted ? "yes" : "no"}`,
    `triggered: ${result.triggered ? "yes" : "no"}`,
    `reason: ${result.reason}`,
    `runId: ${result.runId ?? "none"}`,
  ].join("\n");
}
