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
