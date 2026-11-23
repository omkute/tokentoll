import { describe, expect, test } from "bun:test";

import { createStreamSequenceValidator } from "../src/domain/provider-contracts.js";
import { DomainValidationError } from "../src/domain/validation.js";

const USAGE = { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1 };

function expectSequenceFailure(
  action: () => void,
  invalidPaths: readonly string[],
): void {
  try {
    action();
    throw new Error("Expected stream-sequence validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).invalidPaths).toEqual(invalidPaths);
  }
}

describe("createStreamSequenceValidator", () => {
  test("accepts content deltas, one usage event, and completion in order", () => {
    const validator = createStreamSequenceValidator();
    expect(validator.isComplete).toBe(false);
    expect(validator.usage).toBeUndefined();

    expect(validator.accept({ type: "content_delta", delta: "Mock " })).toEqual(
      {
        type: "content_delta",
        delta: "Mock ",
      },
    );
    expect(
      validator.accept({ type: "content_delta", delta: "response." }),
    ).toEqual({ type: "content_delta", delta: "response." });

    expect(validator.accept({ type: "usage", usage: USAGE })).toEqual({
      type: "usage",
      usage: USAGE,
    });
    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(false);

    expect(
      validator.accept({ type: "completed", finishReason: "stop" }),
    ).toEqual({ type: "completed", finishReason: "stop" });
    expect(validator.isComplete).toBe(true);

    validator.complete();
  });

  test("accepts a completion-only sequence without deltas or usage", () => {
    const validator = createStreamSequenceValidator();

    expect(
      validator.accept({ type: "completed", finishReason: "length" }),
    ).toEqual({ type: "completed", finishReason: "length" });

    expect(validator.usage).toBeUndefined();
    expect(validator.isComplete).toBe(true);
    validator.complete();
  });

  test("accepts content deltas without a usage event", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "content_delta", delta: "Hello" });
    validator.accept({ type: "completed", finishReason: "stop" });

    expect(validator.usage).toBeUndefined();
    expect(validator.isComplete).toBe(true);
    validator.complete();
  });

  test("returns a frozen normalized event for a mutable input", () => {
    const validator = createStreamSequenceValidator();
    const event = validator.accept({ type: "content_delta", delta: "Hi" });

    expect(event).toEqual({ type: "content_delta", delta: "Hi" });
    expect(Object.isFrozen(event)).toBe(true);
  });

  test("rejects finalization of an empty sequence", () => {
    const validator = createStreamSequenceValidator();
    expectSequenceFailure(() => validator.complete(), ["completed"]);
    expect(validator.isComplete).toBe(false);
  });

  test("rejects finalization after a content-only sequence", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "content_delta", delta: "Hello" });

    expectSequenceFailure(() => validator.complete(), ["completed"]);
    expect(validator.isComplete).toBe(false);
    expect(validator.usage).toBeUndefined();
  });

  test("rejects finalization when usage arrived without completion", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "usage", usage: USAGE });

    expectSequenceFailure(() => validator.complete(), ["completed"]);
    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(false);
  });

  test.each([
    { type: "usage", usage: USAGE },
    {
      type: "usage",
      usage: { inputTokens: 9, outputTokens: 9, cacheReadTokens: 9 },
    },
  ] as const)("rejects a duplicate usage event: %j", (secondUsage) => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "content_delta", delta: "Hi" });
    validator.accept({ type: "usage", usage: USAGE });

    expectSequenceFailure(() => validator.accept(secondUsage), ["usage"]);
    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(false);
  });

  test("rejects a content delta after a usage event", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "usage", usage: USAGE });

    expectSequenceFailure(
      () => validator.accept({ type: "content_delta", delta: "late" }),
      ["sequence"],
    );
    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(false);
  });

  test("rejects a content delta after earlier deltas and a usage event", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "content_delta", delta: "Hello" });
    validator.accept({ type: "usage", usage: USAGE });

    expectSequenceFailure(
      () => validator.accept({ type: "content_delta", delta: "late" }),
      ["sequence"],
    );
    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(false);
  });

  test("accepts a usage event followed directly by completion", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "usage", usage: USAGE });
    validator.accept({ type: "completed", finishReason: "stop" });

    expect(validator.usage).toEqual(USAGE);
    expect(validator.isComplete).toBe(true);
    validator.complete();
  });

  test.each([
    [{ type: "content_delta", delta: "late" }],
    [{ type: "usage", usage: USAGE }],
    [{ type: "completed", finishReason: "stop" }],
  ] as const)("rejects any event after completion: %j", (lateEvent) => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "completed", finishReason: "content_filter" });

    expectSequenceFailure(() => validator.accept(lateEvent), ["sequence"]);
    expect(validator.isComplete).toBe(true);
    expect(() => validator.complete()).not.toThrow();
  });

  test.each([
    ["not-an-event", ["streamEvent"]],
    [
      { type: "content_block_delta", anthropicEvent: { delta: "Hi" } },
      ["type"],
    ],
    [{ type: "content_delta", delta: "" }, ["delta"]],
    [
      {
        type: "usage",
        usage: { inputTokens: -1, outputTokens: 1, cacheReadTokens: 0 },
      },
      ["usage.inputTokens"],
    ],
    [{ type: "completed", finishReason: "tool_calls" }, ["finishReason"]],
  ] as const)("rejects a malformed event: %j", (event, invalidPaths) => {
    const validator = createStreamSequenceValidator();
    expectSequenceFailure(() => validator.accept(event), invalidPaths);
  });

  test("rejects provider-specific fields on an otherwise valid event", () => {
    const validator = createStreamSequenceValidator();

    expectSequenceFailure(
      () =>
        validator.accept({
          type: "content_delta",
          delta: "Hi",
          openaiIndex: 0,
          anthropicEvent: { delta: "Hi" },
        }),
      ["openaiIndex", "anthropicEvent"],
    );
  });

  test("keeps prior state after rejecting a malformed event", () => {
    const validator = createStreamSequenceValidator();
    validator.accept({ type: "content_delta", delta: "Hi" });

    expectSequenceFailure(
      () => validator.accept({ type: "unknown_kind" }),
      ["type"],
    );
    expect(validator.isComplete).toBe(false);
    expect(validator.usage).toBeUndefined();

    validator.accept({ type: "completed", finishReason: "stop" });
    validator.complete();
  });
});
