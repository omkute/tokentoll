import { expect, spyOn, test } from "bun:test";
import { createApp } from "../src/app.js";
import {
  createGenerationResponse,
  NormalizedProviderError,
  type NormalizedGenerationResponse,
} from "../src/domain/provider-contracts.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import input from "./fixtures/chat-completions/default-request.json";
import errors from "./fixtures/chat-completions/adapter-errors.json";
import variants from "./fixtures/chat-completions/response-variants.json";

test.each(errors)(
  "HTTP mapping for $category ignores diagnostic text and retryability",
  async (fixture) => {
    for (const retryable of fixture.category === "invalid_request"
      ? [false]
      : [false, true]) {
      let calls = 0;
      const app = createApp({
        adapter: {
          async generate() {
            calls++;
            throw NormalizedProviderError.create({
              category: fixture.category,
              retryable,
              message: "SECRET-DIAGNOSTIC",
            });
          },
        },
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: "/v1/chat/completions",
          payload: input,
        });
        expect(response.statusCode).toBe(fixture.status);
        expect(response.json()).toEqual({
          error: {
            message: fixture.message,
            type: fixture.type,
            code: fixture.code,
            param: null,
          },
        });
        expect(response.headers["retry-after"]).toBeUndefined();
        expect(calls).toBe(1);
      } finally {
        await app.close();
      }
    }
  },
);

test.each(variants)(
  "HTTP output fixture with $finishReason",
  async (variant) => {
    const app = createApp({
      adapter: {
        async generate() {
          return createGenerationResponse(variant);
        },
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: input,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().choices).toEqual([
        {
          index: 0,
          message: { role: "assistant", content: variant.content },
          finish_reason: variant.finishReason,
        },
      ]);
      expect(response.json().usage).toEqual({
        prompt_tokens: variant.usage.inputTokens,
        completion_tokens: variant.usage.outputTokens,
        total_tokens: variant.usage.inputTokens + variant.usage.outputTokens,
        prompt_tokens_details: { cached_tokens: variant.usage.cacheReadTokens },
      });
    } finally {
      await app.close();
    }
  },
);

test("unexpected throws and invalid output have exact safe HTTP envelopes", async () => {
  const cases = [
    {
      generate: async () => {
        throw new ProxyError("model_not_found");
      },
      code: "internal_error",
    },
    {
      generate: () => {
        throw new Error("SECRET");
      },
      code: "internal_error",
    },
    {
      generate: async () => {
        throw "SECRET";
      },
      code: "internal_error",
    },
    { generate: async () => undefined, code: "invalid_provider_response" },
    {
      generate: async () => ({
        content: "a".repeat(8193),
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      }),
      code: "invalid_provider_response",
    },
    {
      generate: async () => ({
        content: "SECRET",
        finishReason: "stop",
        usage: {
          inputTokens: Number.MAX_SAFE_INTEGER,
          outputTokens: 1,
          cacheReadTokens: 0,
        },
      }),
      code: "invalid_provider_response",
    },
  ] as const;
  for (const scenario of cases) {
    const app = createApp({
      adapter: {
        generate: async () =>
          (await scenario.generate()) as NormalizedGenerationResponse,
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: input,
      });
      const expected = new ProxyError(scenario.code);
      expect(response.statusCode).toBe(expected.statusCode);
      expect(response.json()).toEqual(expected.body);
      expect(response.headers["retry-after"]).toBeUndefined();
    } finally {
      await app.close();
    }
  }
});

test("sensitive request, response, headers and exception data never enter logs", async () => {
  const sentinel = "UNIQUE-SENSITIVE-SENTINEL";
  const stdout = spyOn(process.stdout, "write");
  const stderr = spyOn(process.stderr, "write");
  const consoles = [
    spyOn(console, "log"),
    spyOn(console, "error"),
    spyOn(console, "warn"),
  ];
  try {
    for (const outcome of ["success", "provider_error", "exception"]) {
      const app = createApp({
        adapter: {
          async generate() {
            if (outcome === "provider_error")
              throw NormalizedProviderError.create({
                category: "provider_error",
                retryable: true,
                message: sentinel,
              });
            if (outcome === "exception") throw new Error(sentinel);
            return createGenerationResponse({
              content: sentinel,
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
            });
          },
        },
      });
      try {
        const valid = JSON.stringify({
          ...input,
          messages: [{ role: "user", content: sentinel }],
        });
        for (const payload of [
          valid,
          JSON.stringify({ ...input, [sentinel]: true }),
          `{"${sentinel}":`,
          valid + " ".repeat(65_536),
        ]) {
          const response = await app.inject({
            method: "POST",
            url: "/v1/chat/completions",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${sentinel}`,
            },
            payload,
          });
          if (response.statusCode !== 200)
            expect(response.body).not.toContain(sentinel);
        }
      } finally {
        await app.close();
      }
    }
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    for (const log of consoles) expect(log).not.toHaveBeenCalled();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    consoles.forEach((log) => log.mockRestore());
  }
});
