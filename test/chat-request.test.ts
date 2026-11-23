import { expect, test } from "bun:test";
import { parseChatRequest } from "../src/http/chat-completions.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import request from "./fixtures/chat-completions/default-request.json";
import mixed from "./fixtures/chat-completions/mixed-request.json";
import rejected from "./fixtures/chat-completions/rejected-requests.json";

test("accepted fixtures preserve neutral values and omit wire fields", () => {
  const parsedMixed = parseChatRequest(mixed);
  expect(parsedMixed).toEqual({
    request: { messages: mixed.messages },
    stream: false,
    includeUsage: false,
  });
  expect(Object.isFrozen(parsedMixed)).toBe(true);
  expect(Object.isFrozen(parsedMixed.request)).toBe(true);
  expect(Object.isFrozen(parsedMixed.request.messages)).toBe(true);
  expect(parseChatRequest(request)).toEqual({
    request: { messages: request.messages, maxOutputTokens: 16 },
    stream: false,
    includeUsage: false,
  });
});

test.each([
  { stream: true },
  { stream: true, stream_options: {} },
  { stream: true, stream_options: { include_usage: false } },
] as const)(
  "streaming controls %j never enter the neutral request",
  (control) => {
    expect(parseChatRequest({ ...mixed, ...control })).toEqual({
      request: { messages: mixed.messages },
      stream: true,
      includeUsage: false,
    });
  },
);

test("stream_options.include_usage selects usage reporting", () => {
  expect(
    parseChatRequest({
      ...mixed,
      stream: true,
      stream_options: { include_usage: true },
    }),
  ).toEqual({
    request: { messages: mixed.messages },
    stream: true,
    includeUsage: true,
  });
});

const invalid = [
  ...rejected,
  ...[
    "max_tokens",
    "temperature",
    "n",
    "tools",
    "response_format",
    "tenant",
    "SECRET-KEY",
  ].map((key) => ({ ...request, [key]: 1 })),
  ...[null, "true", "false", 0, 1, undefined].map((stream) => ({
    ...request,
    stream,
  })),
  ...[
    null,
    [],
    "include_usage",
    { include_usage: null },
    { include_usage: "true" },
    { include_usage: 0 },
    { include_usage: 1 },
    { include_usage: true, extra: 1 },
    { unknown: true },
  ].map((stream_options) => ({ ...request, stream: true, stream_options })),
  ...[{}, { include_usage: true }, { include_usage: false }, null].map(
    (stream_options) => ({ ...mixed, stream_options }),
  ),
  { ...request, stream: false, stream_options: { include_usage: true } },
  ...[null, 0, -1, 1.5, "16", 8193, undefined].map((max_completion_tokens) => ({
    ...request,
    max_completion_tokens,
  })),
  {
    ...request,
    messages: Array.from({ length: 129 }, () => request.messages[0]),
  },
  { ...request, model: "unknown", messages: [] },
];

test.each(invalid.map((input) => [input]))(
  "invalid request is rejected without leaking submitted fields",
  (input) => {
    expect(() => parseChatRequest(input)).toThrow(ProxyError);
    try {
      parseChatRequest(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ProxyError);
      expect(error.body).toEqual(new ProxyError("invalid_request").body);
    }
  },
);

test.each([1, 8192])("output-token boundary %i is accepted", (limit) => {
  expect(
    parseChatRequest({ ...request, max_completion_tokens: limit }).request
      .maxOutputTokens,
  ).toBe(limit);
});

test.each([1, 128])("message count %i is accepted", (count) => {
  expect(
    parseChatRequest({
      ...request,
      messages: Array.from({ length: count }, () => request.messages[0]),
    }).request.messages,
  ).toHaveLength(count);
});

test.each(["other", " mock-chat", "mock-chat "])(
  "model aliases are exact: %s",
  (model) => {
    try {
      parseChatRequest({ ...request, model });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error.body).toEqual(new ProxyError("model_not_found").body);
    }
  },
);
