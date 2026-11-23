import { expect, test } from "bun:test";
import { serializeChatResponse } from "../src/http/chat-completions.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import expected from "./fixtures/chat-completions/default-response.json";

const response = {
  content: "Mock response.",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
};

test("exact completion fixture with fresh identifiers and Unix timestamps", () => {
  const start = Math.floor(Date.now() / 1000);
  const first = JSON.parse(serializeChatResponse(response));
  const second = JSON.parse(serializeChatResponse(response));
  expect({ ...first, id: "<id>", created: 0 }).toEqual(expected);
  expect(first.id).toMatch(
    /^chatcmpl-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(first.id).not.toBe(second.id);
  expect(Number.isInteger(first.created)).toBe(true);
  expect(first.created).toBeGreaterThanOrEqual(start);
  expect(first.created).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
});

test.each(["stop", "length", "content_filter"])(
  "finish reason %s and empty content",
  (finishReason) => {
    const body = JSON.parse(
      serializeChatResponse({ ...response, content: "", finishReason }),
    );
    expect(body.choices).toEqual([
      {
        index: 0,
        message: { role: "assistant", content: "" },
        finish_reason: finishReason,
      },
    ]);
  },
);

test("cached input is included once", () => {
  const body = JSON.parse(
    serializeChatResponse({
      ...response,
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 },
    }),
  );
  expect(body.usage).toEqual({
    prompt_tokens: 10,
    completion_tokens: 3,
    total_tokens: 13,
    prompt_tokens_details: { cached_tokens: 4 },
  });
});

const invalid = [
  null,
  {},
  { ...response, finishReason: "tool_calls" },
  { ...response, content: 4 },
  { ...response, extra: "SECRET" },
  ...[
    undefined,
    { inputTokens: -1, outputTokens: 1, cacheReadTokens: 0 },
    { inputTokens: 1, outputTokens: 0.5, cacheReadTokens: 0 },
    { inputTokens: 1, outputTokens: 1 },
    { inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 },
    {
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      cacheReadTokens: 0,
    },
  ].map((usage) => ({ ...response, usage })),
];
test.each(invalid.map((input) => [input]))(
  "invalid adapter output is rejected safely",
  (input) => {
    try {
      serializeChatResponse(input);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.body).toEqual(
        new ProxyError("invalid_provider_response").body,
      );
    }
  },
);

test.each([
  "a".repeat(8192),
  "🌍".repeat(2048),
  "\u0000".repeat(8192),
  '"\\'.repeat(4096),
])("content fits the UTF-8 and encoded JSON limits", (content) => {
  expect(Buffer.byteLength(content)).toBe(8192);
  const serialized = serializeChatResponse({ ...response, content });
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(65_536);
  expect(JSON.parse(serialized).choices[0].message.content).toBe(content);
  expect(() =>
    serializeChatResponse({ ...response, content: content + "a" }),
  ).toThrow(ProxyError);
});
