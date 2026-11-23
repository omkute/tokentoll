import { expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createMockChat } from "../src/mock-chat.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import type { ProviderInvocation } from "../src/domain/provider-adapter.js";
import input from "./fixtures/chat-completions/default-request.json";
import mixed from "./fixtures/chat-completions/mixed-request.json";
import rejected from "./fixtures/chat-completions/rejected-requests.json";
import expected from "./fixtures/chat-completions/default-response.json";

test("default app serves the exact fixture without credentials and preserves health/404", async () => {
  const app = createApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect({ ...response.json(), id: "<id>", created: 0 }).toEqual(expected);
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
    expect((await app.inject("/missing")).statusCode).toBe(404);
    expect((await app.inject("/v1/models")).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/responses",
          payload: input,
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test("wire fields end at the edge and each valid request invokes the fixed target once", async () => {
  const mock = createMockChat();
  const calls: ProviderInvocation[] = [];
  const app = createApp({
    adapter: {
      async generate(invocation) {
        calls.push(invocation);
        return mock.adapter.generate(invocation);
      },
    },
  });
  try {
    for (const payload of [input, mixed]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/chat/completions",
            payload,
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(calls).toEqual([
      {
        request: { messages: input.messages, maxOutputTokens: 16 },
        deployment: mock.deployment,
      },
      { request: { messages: mixed.messages }, deployment: mock.deployment },
    ]);
    for (const payload of [
      ...rejected,
      { ...input, model: "other" },
      { ...input, temperature: 0 },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
      const unknown = payload?.model === "other";
      expect(response.statusCode).toBe(unknown ? 404 : 400);
      expect(response.json()).toEqual(
        new ProxyError(unknown ? "model_not_found" : "invalid_request").body,
      );
    }
    expect(calls).toHaveLength(2);
  } finally {
    await app.close();
  }
});
