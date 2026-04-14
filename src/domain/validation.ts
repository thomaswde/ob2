import { DEFAULT_CONFIDENCE } from "./constants.js";
import { DECAY_CLASSES, type CaptureMemoryInput } from "./types.js";

export class ValidationError extends Error {}

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = assertString(value, fieldName);
  return trimmed || null;
}

function parseTimestamp(value: unknown, fieldName: string): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value === "") {
    throw new ValidationError(`${fieldName} must be a valid timestamp`);
  }

  if (!(value instanceof Date) && typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a valid timestamp`);
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
  const content = assertString(input.content, "content");
  const sourceRef = assertString(input.sourceRef, "sourceRef");
  const entityHint = parseOptionalString(input.entityHint, "entityHint");
  const sourceAgent = parseOptionalString(input.sourceAgent, "sourceAgent");
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
  const metadata = input.metadata ?? {};

  if (!isPlainObject(metadata)) {
    throw new ValidationError("metadata must be an object");
  }

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
    metadata,
  };
}
