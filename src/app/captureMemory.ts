import { ENTITY_FUZZY_MATCH_THRESHOLD } from "../domain/constants.js";
import type { Repository } from "../domain/repository.js";
import type { CaptureMemoryInput, MemoryAtom } from "../domain/types.js";
import { validateCaptureMemoryInput } from "../domain/validation.js";
import { makeFingerprint, makeId } from "../utils/crypto.js";

export interface EmbeddingServiceLike {
  isEnabled(): boolean;
  embed(text: string): Promise<number[] | null>;
}

export async function captureMemory(
  repository: Repository,
  input: CaptureMemoryInput,
  embeddingService?: EmbeddingServiceLike,
): Promise<MemoryAtom> {
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

  const atom = await repository.createMemoryAtom({
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

  if (embeddingService?.isEnabled()) {
    embeddingService
      .embed(atom.content)
      .then((embedding) => {
        if (!embedding) {
          return;
        }

        return repository.storeAtomEmbedding(atom.id, embedding).catch((error: unknown) => {
          console.warn(`Failed to store embedding for atom ${atom.id}:`, error);
        });
      })
      .catch((error: unknown) => {
        console.warn(`Failed to generate embedding for atom ${atom.id}:`, error);
      });
  }

  return atom;
}
