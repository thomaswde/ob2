import { ENTITY_FUZZY_MATCH_THRESHOLD } from "../domain/constants.js";
import type { Repository } from "../domain/repository.js";
import type { CaptureMemoryInput, MemoryAtom } from "../domain/types.js";
import { validateCaptureMemoryInput } from "../domain/validation.js";
import { makeFingerprint, makeId } from "../utils/crypto.js";

export async function captureMemory(repository: Repository, input: CaptureMemoryInput): Promise<MemoryAtom> {
  const validated = validateCaptureMemoryInput(input);
  const contentFingerprint = makeFingerprint(validated.content);
  const existing = await repository.getMemoryAtomByFingerprint(validated.sourceRef, contentFingerprint);

  if (existing) {
    return existing;
  }

  let entityId: string | null = null;

  if (validated.entityHint) {
    const exactMatch = await repository.findEntityExact(validated.entityHint);
    if (exactMatch) {
      entityId = exactMatch.id;
    } else {
      const fuzzyMatch = await repository.findEntityFuzzy(
        validated.entityHint,
        ENTITY_FUZZY_MATCH_THRESHOLD,
      );
      entityId = fuzzyMatch?.entity.id ?? null;
    }
  }

  return repository.createMemoryAtom({
    id: makeId(),
    content: validated.content,
    contentFingerprint,
    entityId,
    sourceRef: validated.sourceRef,
    sourceAgent: validated.sourceAgent,
    importance: validated.importance,
    confidence: validated.confidence,
    decayClass: validated.decayClass,
    validAt: validated.validAt,
    invalidAt: validated.invalidAt,
    metadata: validated.metadata,
  });
}
