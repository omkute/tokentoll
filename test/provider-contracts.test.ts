import { describe, expect, test } from "bun:test";

import {
  createGenerationRequest,
  createGenerationResponse,
  createStreamEvent,
  NormalizedProviderError,
} from "../src/domain/provider-contracts.js";
import { DomainValidationError } from "../src/domain/validation.js";

function expectInvalidRequest(
  input: unknown,
  invalidPaths: readonly string[],
): void {
  try {
    createGenerationRequest(input);
    throw new Error("Expected request construction to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).invalidPaths).toEqual(invalidPaths);
  }
}

function expectInvalidResponse(
  input: unknown,
  invalidPaths: readonly string[],
): void {
  try {
    createGenerationResponse(input);
    throw new Error("Expected response construction to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).invalidPaths).toEqual(invalidPaths);
  }
}

describe("createGenerationRequest", () => {
  test("creates a valid neutral request", () => {
    expect(
      createGenerationRequest({
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ],
        maxOutputTokens: 128,
      }),
    ).toEqual({
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      maxOutputTokens: 128,
    });
  });

  test.each([[undefined], [[]], ["messages"]] as const)(
    "rejects an empty or invalid message list: %j",
    (messages) => {
      expectInvalidRequest({ messages }, ["messages"]);
    },
  );

  test("rejects unsupported roles and blank content", () => {
    expectInvalidRequest(
      {
        messages: [
          { role: "tool", content: "result" },
          { role: "user", content: "  " },
        ],
      },
      ["messages[0].role", "messages[1].content"],
    );
  });

  test.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid maxOutputTokens: %s",
    (maxOutputTokens) => {
      expectInvalidRequest(
        { messages: [{ role: "user", content: "Hello" }], maxOutputTokens },
        ["maxOutputTokens"],
      );
    },
  );

  test("accepts the positive integer output-token boundary", () => {
    expect(
      createGenerationRequest({
        messages: [{ role: "user", content: "Hello" }],
        maxOutputTokens: 1,
      }).maxOutputTokens,
    ).toBe(1);
  });

  test("rejects provider-specific extra fields", () => {
    expectInvalidRequest(
      {
        messages: [
          { role: "user", content: "Hello", openaiToolCallId: "call-1" },
        ],
        anthropicVersion: "provider-specific",
      },
      ["anthropicVersion", "messages[0].openaiToolCallId"],
    );
  });

  test("copies and freezes the request and nested messages", () => {
    const sourceMessage = { role: "user", content: "Hello" };
    const source = [sourceMessage];
    const request = createGenerationRequest({ messages: source });

    sourceMessage.content = "mutated";
    source.push({ role: "assistant", content: "extra" });

    expect(request.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.messages)).toBe(true);
    expect(Object.isFrozen(request.messages[0])).toBe(true);
  });
});

describe("createGenerationResponse", () => {
  test.each(["stop", "length", "content_filter"] as const)(
    "creates an immutable response with finish reason %s",
    (finishReason) => {
      const response = createGenerationResponse({
        content: "Hello",
        finishReason,
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          cacheReadTokens: 0,
        },
      });

      expect(response).toEqual({
        content: "Hello",
        finishReason,
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          cacheReadTokens: 0,
        },
      });
      expect(Object.isFrozen(response)).toBe(true);
      expect(Object.isFrozen(response.usage)).toBe(true);
    },
  );

  test.each(["inputTokens", "outputTokens", "cacheReadTokens"] as const)(
    "rejects a missing %s usage count",
    (missingKey) => {
      const usage: Record<string, number> = {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 1,
      };
      Reflect.deleteProperty(usage, missingKey);

      expectInvalidResponse({ content: "Hello", finishReason: "stop", usage }, [
        `usage.${missingKey}`,
      ]);
    },
  );

  test.each([
    ["inputTokens", -1],
    ["outputTokens", 1.5],
    ["cacheReadTokens", -0.5],
  ] as const)("rejects invalid %s usage: %s", (key, value) => {
    expectInvalidResponse(
      {
        content: "Hello",
        finishReason: "stop",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 1,
          [key]: value,
        },
      },
      [`usage.${key}`],
    );
  });

  test("rejects unsupported finish reasons and provider usage fields", () => {
    expectInvalidResponse(
      {
        content: "Hello",
        finishReason: "tool_calls",
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          openaiCachedTokens: 1,
        },
      },
      ["finishReason", "usage.openaiCachedTokens"],
    );
  });
});

describe("NormalizedProviderError", () => {
  test.each([
    ["invalid_request", false],
    ["timeout", true],
    ["rate_limited", true],
    ["provider_unavailable", true],
    ["provider_error", false],
  ] as const)("creates the neutral %s category", (category, retryable) => {
    const error = NormalizedProviderError.create({
      category,
      retryable,
      message: "Safe diagnostic",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NormalizedProviderError");
    expect(error.category).toBe(category);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toBe("Safe diagnostic");
    expect(Object.isFrozen(error)).toBe(true);
  });

  test("requires invalid requests to be non-retryable", () => {
    expect(() =>
      NormalizedProviderError.create({
        category: "invalid_request",
        retryable: true,
        message: "Invalid request",
      }),
    ).toThrow(DomainValidationError);
  });

  test("rejects sensitive and provider-specific fields without disclosing values", () => {
    const sensitiveInput = {
      category: "provider_error",
      retryable: false,
      message: "Safe diagnostic",
      cause: new Error("provider cause do-not-disclose"),
      credential: "secret-key",
      prompt: "sensitive prompt",
      completion: "sensitive completion",
      rawProviderPayload: { internal: "private" },
    };

    try {
      NormalizedProviderError.create(sensitiveInput);
      throw new Error("Expected provider error construction to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      const validationError = error as DomainValidationError;
      expect(validationError.invalidPaths).toEqual([
        "cause",
        "credential",
        "prompt",
        "completion",
        "rawProviderPayload",
      ]);
      const diagnostic = `${validationError.message} ${JSON.stringify(validationError.invalidPaths)}`;
      expect(diagnostic).not.toContain("do-not-disclose");
      expect(diagnostic).not.toContain("secret-key");
      expect(diagnostic).not.toContain("sensitive prompt");
      expect(diagnostic).not.toContain("sensitive completion");
      expect(diagnostic).not.toContain("private");
    }
  });

  test("rejects unknown categories and blank messages", () => {
    try {
      NormalizedProviderError.create({
        category: "openai_error",
        retryable: "sometimes",
        message: " ",
      });
      throw new Error("Expected provider error construction to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).invalidPaths).toEqual([
        "category",
        "retryable",
        "message",
      ]);
    }
  });
});

describe("createStreamEvent", () => {
  test("creates a content-delta event", () => {
    expect(
      createStreamEvent({ type: "content_delta", delta: "Hello" }),
    ).toEqual({ type: "content_delta", delta: "Hello" });
  });

  test("creates a deeply immutable usage event", () => {
    const event = createStreamEvent({
      type: "usage",
      usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 },
    });

    expect(event).toEqual({
      type: "usage",
      usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(event.type === "usage" && Object.isFrozen(event.usage)).toBe(true);
  });

  test("creates a completion event", () => {
    expect(
      createStreamEvent({ type: "completed", finishReason: "stop" }),
    ).toEqual({ type: "completed", finishReason: "stop" });
  });

  test.each([
    [{ type: "content_delta", delta: "Hello", usage: {} }, ["usage"]],
    [
      {
        type: "usage",
        delta: "Hello",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      },
      ["delta"],
    ],
    [{ type: "completed", finishReason: "stop", usage: {} }, ["usage"]],
  ] as const)(
    "rejects fields from a mismatched event variant",
    (input, paths) => {
      try {
        createStreamEvent(input);
        throw new Error("Expected stream-event construction to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainValidationError);
        expect((error as DomainValidationError).invalidPaths).toEqual(paths);
      }
    },
  );

  test("rejects provider-specific event shapes", () => {
    try {
      createStreamEvent({
        type: "content_block_delta",
        anthropicEvent: { delta: "Hello" },
      });
      throw new Error("Expected stream-event construction to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).invalidPaths).toEqual(["type"]);
    }
  });
});
