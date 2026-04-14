import { describe, expect, it } from "vitest";
import { ValidationError, validateCaptureMemoryInput } from "../src/domain/validation.js";

describe("validateCaptureMemoryInput", () => {
  it("rejects out-of-range importance", () => {
    expect(() =>
      validateCaptureMemoryInput({
        content: "Hello",
        sourceRef: "test:1",
        importance: 1.2,
        decayClass: "profile",
      }),
    ).toThrow(ValidationError);
  });

  it("rejects malformed timestamps", () => {
    expect(() =>
      validateCaptureMemoryInput({
        content: "Hello",
        sourceRef: "test:1",
        importance: 0.5,
        decayClass: "profile",
        validAt: "not-a-date",
      }),
    ).toThrow("validAt must be a valid timestamp");
  });

  it("rejects empty timestamps instead of treating them as missing", () => {
    expect(() =>
      validateCaptureMemoryInput({
        content: "Hello",
        sourceRef: "test:1",
        importance: 0.5,
        decayClass: "profile",
        validAt: "",
      }),
    ).toThrow("validAt must be a valid timestamp");
  });

  it("rejects non-string required fields", () => {
    expect(() =>
      validateCaptureMemoryInput({
        content: 123 as unknown as string,
        sourceRef: "test:1",
        importance: 0.5,
        decayClass: "profile",
      }),
    ).toThrow("content must be a string");
  });

  it("rejects non-plain metadata objects", () => {
    expect(() =>
      validateCaptureMemoryInput({
        content: "Hello",
        sourceRef: "test:1",
        importance: 0.5,
        decayClass: "profile",
        metadata: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow("metadata must be an object");
  });

  it("accepts valid input", () => {
    const result = validateCaptureMemoryInput({
      content: "Morgan prefers morning flights",
      sourceRef: "test:1",
      importance: 0.8,
      confidence: 0.9,
      decayClass: "preference",
      validAt: "2026-04-13T12:00:00.000Z",
    });

    expect(result.content).toBe("Morgan prefers morning flights");
    expect(result.confidence).toBe(0.9);
    expect(result.validAt?.toISOString()).toBe("2026-04-13T12:00:00.000Z");
  });
});
