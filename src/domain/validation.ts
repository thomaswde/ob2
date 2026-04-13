import { DEFAULT_CONFIDENCE } from "./constants.js";
import { DECAY_CLASSES, type CaptureMemoryInput } from "./types.js";

export class ValidationError extends Error {}

function parseTimestamp(value: string | Date | null | undefined, fieldName: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid timestamp`);
  }

  return parsed;
}

function assertRange(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ValidationError(`${name} must be between 0 and 1`);
  }
}

export interface ValidatedCaptureMemoryInput {
  content: string;
  sourceRef: string;
  sourceAgent: string | null;
  entityHint: string | null;
  importance: number;
  confidence: number;
  decayClass: CaptureMemoryInput["decayClass"];
  validAt: Date | null;
  invalidAt: Date | null;
  metadata: Record<string, unknown>;
}

export function validateCaptureMemoryInput(input: CaptureMemoryInput): ValidatedCaptureMemoryInput {
  const content = input.content.trim();
  const sourceRef = input.sourceRef.trim();
  const entityHint = input.entityHint?.trim() || null;
  const sourceAgent = input.sourceAgent?.trim() || null;
  const confidence = input.confidence ?? DEFAULT_CONFIDENCE;

  if (!content) {
    throw new ValidationError("content is required");
  }
  if (!sourceRef) {
    throw new ValidationError("sourceRef is required");
  }
  if (!DECAY_CLASSES.includes(input.decayClass)) {
    throw new ValidationError(`decayClass must be one of: ${DECAY_CLASSES.join(", ")}`);
  }

  assertRange("importance", input.importance);
  assertRange("confidence", confidence);

  const validAt = parseTimestamp(input.validAt, "validAt");
  const invalidAt = parseTimestamp(input.invalidAt, "invalidAt");

  if (validAt && invalidAt && invalidAt <= validAt) {
    throw new ValidationError("invalidAt must be later than validAt");
  }

  return {
    content,
    sourceRef,
    sourceAgent,
    entityHint,
    importance: input.importance,
    confidence,
    decayClass: input.decayClass,
    validAt,
    invalidAt,
    metadata: input.metadata ?? {},
  };
}
