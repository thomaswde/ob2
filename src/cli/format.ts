import type { Entity, MemoryAtom, QueryMemoryResult } from "../domain/types.js";

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

  lines.push("", `gates: ${result.reasoning.gatesUsed.join(", ")}`);
  return lines.join("\n");
}
