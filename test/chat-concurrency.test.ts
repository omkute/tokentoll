import { expect, spyOn, test } from "bun:test";
import { createApp } from "../src/app.js";
import {
  createGenerationResponse,
  NormalizedProviderError,
  type NormalizedGenerationResponse,
} from "../src/domain/provider-contracts.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import input from "./fixtures/chat-completions/default-request.json";

const success = createGenerationResponse({
  content: "ok",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
});

test.each(["success", "rejection", "invalid_output", "serialization_failure"])(
  "capacity is released after %s without queueing or retries",
  async (outcome) => {
    const held: {
      resolve: (value: NormalizedGenerationResponse) => void;
      reject: (error: unknown) => void;
    }[] = [];
    let markFull: () => void = () => {};
    const full = new Promise<void>((resolve) => {
      markFull = resolve;
    });
    let calls = 0;
    const app = createApp({
      adapter: {
        generate() {
          calls++;
          if (calls > 64) return Promise.resolve(success);
          return new Promise<NormalizedGenerationResponse>(
            (resolve, reject) => {
              held.push({ resolve, reject });
              if (held.length === 64) markFull();
            },
          );
        },
      },
    });
    const independent = createApp();
    const options = {
      method: "POST",
      url: "/v1/chat/completions",
      payload: input,
    } as const;
    const requests = Array.from({ length: 64 }, () =>
      Promise.resolve(app.inject(options)),
    );
    let serialization:
      ReturnType<typeof spyOn<typeof JSON, "stringify">> | undefined;
    try {
      await full;
      const busy = await app.inject(options);
      expect(busy.statusCode).toBe(503);
      expect(busy.json()).toEqual(new ProxyError("gateway_busy").body);
      expect(calls).toBe(64);
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect((await independent.inject(options)).statusCode).toBe(200);

      const first = held[0];
      if (outcome === "serialization_failure") {
        serialization = spyOn(JSON, "stringify").mockImplementationOnce(() => {
          throw new Error("Serialization failed");
        });
        first.resolve(success);
      } else if (outcome === "success") first.resolve(success);
      else if (outcome === "rejection")
        first.reject(
          NormalizedProviderError.create({
            category: "provider_error",
            retryable: true,
            message: "SECRET",
          }),
        );
      else
        first.resolve({
          ...success,
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 },
        });
      expect((await requests[0]).statusCode).toBe(
        outcome === "success" ? 200 : 502,
      );
      expect((await app.inject(options)).statusCode).toBe(200);
      expect(calls).toBe(65);
    } finally {
      serialization?.mockRestore();
      for (const pending of held) pending.resolve(success);
      await Promise.all(requests);
      await app.close();
      await independent.close();
    }
  },
);
