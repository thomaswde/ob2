import type { Entity, MemoryAtom } from "../domain/types.js";

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
