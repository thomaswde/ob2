import { createHash, randomUUID } from "node:crypto";

export function makeFingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function makeId(): string {
  return randomUUID();
}
