import { expect, test } from "bun:test";
import { parseChatRequest } from "../src/http/chat-completions.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import request from "./fixtures/chat-completions/default-request.json";
import mixed from "./fixtures/chat-completions/mixed-request.json";
import rejected from "./fixtures/chat-completions/rejected-requests.json";

test("accepted fixtures preserve neutral values and omit wire fields", () => {
  expect(parseChatRequest(request)).toEqual({
    messages: request.messages,
    maxOutputTokens: 16,
  });
  expect(parseChatRequest(mixed)).toEqual({ messages: mixed.messages });
  expect(Object.isFrozen(parseChatRequest(mixed).messages)).toBe(true);
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
  ...[true, null, "false", 0, undefined].map((stream) => ({
    ...request,
    stream,
  })),
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
    parseChatRequest({ ...request, max_completion_tokens: limit })
      .maxOutputTokens,
  ).toBe(limit);
});

test.each([1, 128])("message count %i is accepted", (count) => {
  expect(
    parseChatRequest({
      ...request,
      messages: Array.from({ length: count }, () => request.messages[0]),
    }).messages,
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
