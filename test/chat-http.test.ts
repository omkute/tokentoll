import { expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createModelDeployment } from "../src/domain/model-deployment.js";
import {
  createGenerationResponse,
  type NormalizedGenerationResponse,
} from "../src/domain/provider-contracts.js";
import { createMockChat } from "../src/mock-chat.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import type { ProviderInvocation } from "../src/domain/provider-adapter.js";
import input from "./fixtures/chat-completions/default-request.json";
import mixed from "./fixtures/chat-completions/mixed-request.json";
import rejected from "./fixtures/chat-completions/rejected-requests.json";
import expected from "./fixtures/chat-completions/default-response.json";

const success = createGenerationResponse({
  content: "ok",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
});

function deployment(overrides: Record<string, unknown> = {}) {
  return createModelDeployment({
    deploymentId: "test-deployment",
    adapterId: "mock",
    providerModelId: "model",
    capabilities: ["generation", "streaming"],
    contextWindowTokens: 131_072,
    prices: {
      currency: "USD",
      unit: "micros_per_million_tokens",
      input: 0,
      output: 0,
      cacheRead: 0,
    },
    enabled: true,
    ...overrides,
  });
}

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

test("known model with no eligible deployment returns deployment_unavailable", async () => {
  let calls = 0;
  const app = createApp({
    adapter: {
      async generate() {
        calls++;
        return success;
      },
    },
    deployments: [deployment({ enabled: false })],
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: input,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(
      new ProxyError("deployment_unavailable").body,
    );
    expect(calls).toBe(0);
  } finally {
    await app.close();
  }
});

test("streaming request rejects a deployment without the streaming capability", async () => {
  let streamCalls = 0;
  const app = createApp({
    adapter: {
      async generate() {
        return success;
      },
      stream() {
        streamCalls++;
        throw new Error("stream must not be invoked");
      },
    },
    deployments: [deployment({ capabilities: ["generation"] })],
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...input, stream: true },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.json()).toEqual(
      new ProxyError("deployment_unavailable").body,
    );
    expect(streamCalls).toBe(0);
  } finally {
    await app.close();
  }
});

test("unknown model keeps 404 precedence over deployment eligibility", async () => {
  const app = createApp({
    adapter: createMockChat().adapter,
    deployments: [deployment({ enabled: false })],
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { ...input, model: "other-model" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(new ProxyError("model_not_found").body);
  } finally {
    await app.close();
  }
});

test("eligibility failure is not masked by admission saturation", async () => {
  const held: Array<(value: NormalizedGenerationResponse) => void> = [];
  let markFull: () => void = () => {};
  const full = new Promise<void>((resolve) => {
    markFull = resolve;
  });
  const app = createApp({
    adapter: {
      generate() {
        return new Promise<NormalizedGenerationResponse>((resolve) => {
          held.push(resolve);
          if (held.length === 64) markFull();
        });
      },
    },
    deployments: [deployment({ capabilities: ["generation"] })],
  });
  const options = {
    method: "POST",
    url: "/v1/chat/completions",
    payload: input,
  } as const;
  const requests = Array.from({ length: 64 }, () =>
    Promise.resolve(app.inject(options)),
  );

  try {
    await full;
    const response = await app.inject({
      ...options,
      payload: { ...input, stream: true },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(
      new ProxyError("deployment_unavailable").body,
    );
  } finally {
    for (const resolve of held) resolve(success);
    await Promise.allSettled(requests);
    await app.close();
  }
});

test("selection skips a disabled first deployment and invokes the later eligible one", async () => {
  const calls: ProviderInvocation[] = [];
  const app = createApp({
    adapter: {
      async generate(invocation) {
        calls.push(invocation);
        return success;
      },
    },
    deployments: [
      deployment({ deploymentId: "first", enabled: false }),
      deployment({ deploymentId: "second" }),
    ],
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: input,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.deployment.deploymentId).toBe("second");
  } finally {
    await app.close();
  }
});
