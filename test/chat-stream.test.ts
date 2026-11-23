import { expect, spyOn, test } from "bun:test";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { createApp } from "../src/app.js";
import { createMockProvider } from "../src/adapters/mock-provider.js";
import type { ProviderAdapter } from "../src/domain/provider-adapter.js";
import {
  createGenerationResponse,
  createStreamEvent,
  NormalizedProviderError,
  type NormalizedStreamEvent,
  type NormalizedUsage,
} from "../src/domain/provider-contracts.js";
import { ProxyError } from "../src/http/proxy-errors.js";

const usage: NormalizedUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
};

const success = createGenerationResponse({
  content: "Mock response.",
  finishReason: "stop",
  usage,
});

const streamRequest = {
  model: "mock-chat",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
} as const;

interface WireChunk {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: { readonly content?: string };
    readonly finish_reason: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
    readonly prompt_tokens_details: { readonly cached_tokens: number };
  };
}

interface StreamResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function postCompletion(url: URL, payload: unknown): Promise<StreamResponse> {
  return new Promise<StreamResponse>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key] = value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}

async function withServer(
  adapter: ProviderAdapter | undefined,
  run: (post: (payload: unknown) => Promise<StreamResponse>) => Promise<void>,
): Promise<void> {
  const app = createApp(adapter === undefined ? {} : { adapter });
  const url = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  const post = (payload: unknown) => postCompletion(url, payload);
  try {
    await run(post);
  } finally {
    await app.close();
  }
}

function parseFrames(body: string): string[] {
  return body
    .split("\n\n")
    .filter((frame) => frame.length > 0)
    .map((frame) => frame.slice("data: ".length));
}

function parseChunk(frame: string): WireChunk {
  return JSON.parse(frame) as WireChunk;
}

/** An async iterable that rejects on the very first pull. */
function rejectingStream(
  error: NormalizedProviderError,
): AsyncIterable<NormalizedStreamEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(error),
    }),
  };
}

/** An async iterable that ends immediately without any event. */
function emptyStream(): AsyncIterable<NormalizedStreamEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.resolve({
          done: true as const,
          value: undefined,
        }),
    }),
  };
}

/** Streams fixed content deltas, then usage, then completion. */
function boundedAdapter(deltas: readonly string[]): ProviderAdapter {
  return {
    async generate() {
      return success;
    },
    async *stream() {
      for (const delta of deltas)
        yield createStreamEvent({ type: "content_delta", delta });
      yield createStreamEvent({ type: "usage", usage });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  };
}

test("default mock streams Mock + response. deltas, one finish, then DONE", async () => {
  await withServer(undefined, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body.endsWith("data: [DONE]\n\n")).toBe(true);

    const frames = parseFrames(response.body);
    expect(frames[frames.length - 1]).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(3);
    const [first, second, finish] = chunks;
    expect(first.choices[0]?.delta.content).toBe("Mock ");
    expect(first.choices[0]?.finish_reason).toBeNull();
    expect(second.choices[0]?.delta.content).toBe("response.");
    expect(finish.choices[0]?.delta).toEqual({});
    expect(finish.choices[0]?.finish_reason).toBe("stop");
    for (const chunk of chunks) {
      expect(chunk.id).toBe(first.id);
      expect(chunk.created).toBe(first.created);
      expect(chunk.model).toBe("mock-chat");
      expect(chunk.object).toBe("chat.completion.chunk");
      expect(chunk.usage).toBeUndefined();
    }
    expect(
      chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""),
    ).toBe("Mock response.");
  });
});

test("requested usage chunk follows the finish chunk and precedes DONE", async () => {
  await withServer(undefined, async (post) => {
    const response = await post({
      ...streamRequest,
      stream_options: { include_usage: true },
    });
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames[frames.length - 1]).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(4);
    expect(chunks[2]?.choices[0]?.finish_reason).toBe("stop");
    const usageChunk = chunks[3];
    expect(usageChunk?.choices).toEqual([]);
    expect(usageChunk?.usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      prompt_tokens_details: { cached_tokens: 0 },
    });
  });
});

test.each([{}, { include_usage: false }] as const)(
  "no usage chunk is emitted when include_usage is %j",
  async (stream_options) => {
    await withServer(undefined, async (post) => {
      const response = await post({ ...streamRequest, stream_options });
      const frames = parseFrames(response.body);
      expect(frames[frames.length - 1]).toBe("[DONE]");
      const chunks = frames.slice(0, -1).map(parseChunk);
      expect(chunks.some((chunk) => chunk.usage !== undefined)).toBe(false);
      expect(chunks).toHaveLength(3);
    });
  },
);

test("missing requested usage ends with an error frame and no DONE", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Mock " });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post({
      ...streamRequest,
      stream_options: { include_usage: true },
    });
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(3);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe("Mock ");
    expect(parseChunk(frames[1]).choices[0]?.finish_reason).toBe("stop");
    expect(frames[2]).not.toBe("[DONE]");
    expect(JSON.parse(frames[2])).toEqual(
      new ProxyError("invalid_provider_response").body,
    );

    const withoutUsage = await post(streamRequest);
    expect(parseFrames(withoutUsage.body).at(-1)).toBe("[DONE]");
  });
});

test("mid-stream provider failure after content emits one mapped error frame and no DONE", async () => {
  const sentinel = "UNIQUE-MIDSTREAM-SENTINEL";
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Partial" });
      throw NormalizedProviderError.create({
        category: "provider_error",
        retryable: true,
        message: sentinel,
      });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers["retry-after"]).toBeUndefined();
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe("Partial");
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("upstream_error").body,
    );
    expect(response.body).not.toContain(sentinel);
    expect(response.body).not.toContain("[DONE]");
  });
});

test.each([
  {
    label: "missing stream operation",
    adapter: {
      async generate() {
        return success;
      },
    } as ProviderAdapter,
    status: 500,
    code: "internal_error" as const,
  },
  {
    label: "immediate provider error",
    adapter: {
      async generate() {
        return success;
      },
      stream: () =>
        rejectingStream(
          NormalizedProviderError.create({
            category: "provider_error",
            retryable: false,
            message: "SECRET-PRECOMMIT",
          }),
        ),
    } as ProviderAdapter,
    status: 502,
    code: "upstream_error" as const,
  },
  {
    label: "immediate timeout error",
    adapter: {
      async generate() {
        return success;
      },
      stream: () =>
        rejectingStream(
          NormalizedProviderError.create({
            category: "timeout",
            retryable: false,
            message: "SECRET-PRECOMMIT",
          }),
        ),
    } as ProviderAdapter,
    status: 504,
    code: "upstream_timeout" as const,
  },
  {
    label: "empty event stream",
    adapter: {
      async generate() {
        return success;
      },
      stream: () => emptyStream(),
    } as ProviderAdapter,
    status: 502,
    code: "invalid_provider_response" as const,
  },
  {
    label: "malformed first event",
    adapter: {
      async generate() {
        return success;
      },
      async *stream() {
        yield { type: "content_delta", delta: "" };
      },
    } as ProviderAdapter,
    status: 502,
    code: "invalid_provider_response" as const,
  },
])("pre-commit failure %s keeps the JSON status table", async (caseInfo) => {
  await withServer(caseInfo.adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(caseInfo.status);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError(caseInfo.code).body,
    );
    expect(response.body).not.toContain("SECRET-PRECOMMIT");
  });
});

test("duplicate usage events end the stream with an error frame", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Hi" });
      yield createStreamEvent({ type: "usage", usage });
      yield createStreamEvent({ type: "usage", usage });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe("Hi");
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("invalid usage ends the stream with an error frame even when not requested", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Hi" });
      yield createStreamEvent({
        type: "usage",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 },
      });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("usage-first stream that fails before any frame keeps the JSON status table", async () => {
  const sentinel = "SECRET-USAGE-FIRST";
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "usage", usage });
      throw NormalizedProviderError.create({
        category: "provider_error",
        retryable: true,
        message: sentinel,
      });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError("upstream_error").body,
    );
    expect(response.body).not.toContain(sentinel);
  });
});

test("invalid usage as the first event returns the JSON status before any frame", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({
        type: "usage",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 },
      });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("usage-first stream commits on the finish frame and ends with DONE", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "usage", usage });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    const frames = parseFrames(response.body);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta).toEqual({});
    expect(chunks[0]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[0]?.usage).toBeUndefined();
  });
});

test("exhaustion without completion ends the stream with an error frame", async () => {
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Hi" });
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe("Hi");
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("unexpected mid-stream exception emits an internal_error frame", async () => {
  const sentinel = "SECRET-UNEXPECTED";
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream() {
      yield createStreamEvent({ type: "content_delta", delta: "Hi" });
      throw new Error(sentinel);
    },
  };
  await withServer(adapter, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("internal_error").body,
    );
    expect(response.body).not.toContain(sentinel);
  });
});

test("empty content streams only finish and usage chunks", async () => {
  const adapter = createMockProvider({
    outcome: "success",
    response: { content: "", finishReason: "stop", usage },
  });
  await withServer(adapter, async (post) => {
    const withUsage = await post({
      ...streamRequest,
      stream_options: { include_usage: true },
    });
    const frames = parseFrames(withUsage.body);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices[0]?.delta).toEqual({});
    expect(chunks[0]?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks[1]?.usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      prompt_tokens_details: { cached_tokens: 0 },
    });

    const withoutUsage = await post(streamRequest);
    expect(parseFrames(withoutUsage.body)).toHaveLength(2);
  });
});

test("streaming keeps sensitive data out of error frames and logs", async () => {
  const sentinel = "STREAM-SENSITIVE-SENTINEL";
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream(): AsyncGenerator<NormalizedStreamEvent> {
      yield createStreamEvent({ type: "content_delta", delta: sentinel });
      throw new Error(sentinel);
    },
  };
  const stdout = spyOn(process.stdout, "write");
  const stderr = spyOn(process.stderr, "write");
  const consoles = [
    spyOn(console, "log"),
    spyOn(console, "error"),
    spyOn(console, "warn"),
  ];
  try {
    await withServer(adapter, async (post) => {
      const response = await post({
        model: "mock-chat",
        messages: [{ role: "user", content: sentinel }],
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(response.status).toBe(200);
      const frames = parseFrames(response.body);
      expect(frames).toHaveLength(2);
      const errorFrame = JSON.parse(frames[1]) as {
        error: Record<string, unknown>;
      };
      expect(errorFrame).toEqual(new ProxyError("internal_error").body);
      expect(Object.keys(errorFrame.error).sort()).toEqual([
        "code",
        "message",
        "param",
        "type",
      ]);
      expect(JSON.stringify(errorFrame)).not.toContain(sentinel);
    });
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    for (const log of consoles) expect(log).not.toHaveBeenCalled();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    consoles.forEach((log) => log.mockRestore());
  }
});

test("streamed content of exactly 8192 ASCII bytes succeeds with finish and DONE", async () => {
  const exact = "a".repeat(8192);
  await withServer(boundedAdapter([exact]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    const frames = parseFrames(response.body);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.choices[0]?.delta.content).toBe(exact);
    expect(chunks[0]?.choices[0]?.finish_reason).toBeNull();
    expect(chunks[1]?.choices[0]?.delta).toEqual({});
    expect(chunks[1]?.choices[0]?.finish_reason).toBe("stop");
  });
});

test("a first delta over the content bound returns the normal 502 JSON", async () => {
  await withServer(boundedAdapter(["a".repeat(8193)]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("content overflow after commit emits exactly one error frame and no DONE", async () => {
  const first = "a".repeat(5000);
  const overflow = "b".repeat(4000);
  await withServer(boundedAdapter([first, overflow]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe(first);
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
    expect(response.body).not.toContain(overflow);
    expect(response.body).not.toContain("[DONE]");
  });
});

test("multi-byte content totalling exactly 8192 UTF-8 bytes succeeds", async () => {
  const twoByte = "é".repeat(2048); // 4096 bytes
  const fourByte = "😀".repeat(1024); // 4096 bytes
  expect(Buffer.byteLength(twoByte + fourByte, "utf8")).toBe(8192);

  await withServer(boundedAdapter([twoByte, fourByte]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map(parseChunk);
    expect(chunks).toHaveLength(3);
    expect(
      chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join(""),
    ).toBe(twoByte + fourByte);
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");
  });
});

test("multi-byte content one byte over the bound returns the 502 JSON", async () => {
  const over = "é".repeat(4096) + "a"; // 8193 UTF-8 bytes
  expect(Buffer.byteLength(over, "utf8")).toBe(8193);

  await withServer(boundedAdapter([over]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  });
});

test("8192 control characters complete within the per-frame bound", async () => {
  const control = "\u0000".repeat(8192);
  await withServer(boundedAdapter([control]), async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    const frames = parseFrames(response.body);
    expect(frames.at(-1)).toBe("[DONE]");
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe(control);
    // The serialized content frame stays under the 65,536-byte frame bound
    // even though every content byte escapes to six JSON characters.
    expect(Buffer.byteLength(`data: ${frames[0]}\n\n`, "utf8")).toBeLessThan(
      65_537,
    );
  });
});

// ---------------------------------------------------------------------------
// Deadline and admission integration (task 2.5)
// ---------------------------------------------------------------------------
//
// Client-disconnect behavior is covered as a focused unit test in
// test/sse.test.ts: Bun's HTTP server never reports a disconnect once a
// request body has arrived, so a real-socket abort test cannot settle under
// `bun test`. The production runtime (Node) delivers `close` on the
// hijacked response, which the route turns into the same "client" abort.

/** One macrotask turn so pending microtask cleanup chains finish first. */
async function nextTickTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function withDeadline(
  adapter: ProviderAdapter,
  requestTimeoutMs: number,
  run: (post: (payload: unknown) => Promise<StreamResponse>) => Promise<void>,
): Promise<void> {
  const app = createApp({ adapter, requestTimeoutMs });
  const url = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  try {
    await run((payload) => postCompletion(url, payload));
  } finally {
    await app.close();
  }
}

/**
 * Streams an optional first content delta, then waits for the abort signal
 * and ends without further events. `settled` resolves once the adapter
 * observed the cancellation, proving the pending read did not outlive it.
 */
function abortWaitingAdapter(delta?: string): {
  readonly adapter: ProviderAdapter;
  readonly settled: Promise<boolean>;
} {
  let markSettled: (aborted: boolean) => void = () => {};
  const settled = new Promise<boolean>((resolve) => {
    markSettled = resolve;
  });
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream(invocation) {
      if (delta !== undefined)
        yield createStreamEvent({ type: "content_delta", delta });
      const signal = invocation.signal;
      await new Promise<void>((resolve) => {
        if (signal === undefined || signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      markSettled(signal?.aborted === true);
    },
  };
  return { adapter, settled };
}

/** First stream hangs until aborted; every later stream completes normally. */
function firstHangsThenCompletesAdapter(delta: string): {
  readonly adapter: ProviderAdapter;
  readonly settled: Promise<boolean>;
} {
  let markSettled: (aborted: boolean) => void = () => {};
  const settled = new Promise<boolean>((resolve) => {
    markSettled = resolve;
  });
  let calls = 0;
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream(invocation) {
      if (calls++ > 0) {
        yield createStreamEvent({ type: "content_delta", delta: "Later" });
        yield createStreamEvent({ type: "usage", usage });
        yield createStreamEvent({ type: "completed", finishReason: "stop" });
        return;
      }
      yield createStreamEvent({ type: "content_delta", delta });
      const signal = invocation.signal;
      await new Promise<void>((resolve) => {
        if (signal === undefined || signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      markSettled(signal?.aborted === true);
    },
  };
  return { adapter, settled };
}

/**
 * Every stream yields one delta and then parks until released externally,
 * holding its admission permit for the full iterator lifetime.
 */
function holdingAdapter(): {
  readonly adapter: ProviderAdapter;
  readonly streams: {
    release(): void;
    readonly settled: Promise<boolean>;
  }[];
} {
  const streams: {
    release(): void;
    readonly settled: Promise<boolean>;
  }[] = [];
  const adapter: ProviderAdapter = {
    async generate() {
      return success;
    },
    async *stream(invocation) {
      let releaseStream: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      let markSettled: (aborted: boolean) => void = () => {};
      const settled = new Promise<boolean>((resolve) => {
        markSettled = resolve;
      });
      streams.push({ release: releaseStream, settled });
      yield createStreamEvent({ type: "content_delta", delta: "Held" });
      await released;
      markSettled(invocation.signal?.aborted === true);
      yield createStreamEvent({ type: "usage", usage });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  };
  return { adapter, streams };
}

/** A real HTTP streaming request kept open for incremental observation. */
interface OpenStream {
  readonly status: Promise<number>;
  readonly firstChunk: Promise<string>;
  destroy(): void;
}

function openStreamRequest(url: URL, payload: unknown): OpenStream {
  const body = JSON.stringify(payload);
  let markStatus: (status: number) => void = () => {};
  const status = new Promise<number>((resolve) => {
    markStatus = resolve;
  });
  let markFirst: (chunk: string) => void = () => {};
  const firstChunk = new Promise<string>((resolve) => {
    markFirst = resolve;
  });

  // Hand-written chunked request on a raw socket. Bun's HTTP client always
  // buffers the body into a Content-Length, and a framed request body keeps
  // this helper independent of any client-side body buffering.
  let headersEnded = false;
  const socket = connect(Number(url.port), url.hostname, () => {
    socket.write(
      "POST /v1/chat/completions HTTP/1.1\r\n" +
        `Host: ${url.hostname}\r\n` +
        "Content-Type: application/json\r\n" +
        "Connection: close\r\n" +
        "Transfer-Encoding: chunked\r\n\r\n",
    );
    const size = Buffer.byteLength(body, "utf8").toString(16);
    socket.write(`${size}\r\n${body}\r\n0\r\n\r\n`);
  });
  socket.on("data", (data: Buffer) => {
    if (headersEnded) {
      markFirst(data.toString("utf8"));
      return;
    }
    const separator = data.indexOf("\r\n\r\n");
    if (separator < 0) return;
    headersEnded = true;
    const statusLine =
      data.subarray(0, separator).toString("utf8").split("\r\n", 1)[0] ?? "";
    const statusCode = Number.parseInt(statusLine.split(" ")[1] ?? "0", 10);
    markStatus(Number.isNaN(statusCode) ? 0 : statusCode);
    const rest = data.subarray(separator + 4).toString("utf8");
    if (rest.length > 0) markFirst(rest);
  });
  // Destroying the socket must not surface as an unhandled socket error.
  socket.on("error", () => {});

  return {
    status,
    firstChunk,
    destroy() {
      socket.destroy();
    },
  };
}

test("deadline after content emits one upstream_timeout error frame, no DONE, and frees the permit", async () => {
  const double = firstHangsThenCompletesAdapter("Partial");
  await withDeadline(double.adapter, 30, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    const frames = parseFrames(response.body);
    expect(frames).toHaveLength(2);
    expect(parseChunk(frames[0]).choices[0]?.delta.content).toBe("Partial");
    expect(JSON.parse(frames[1])).toEqual(
      new ProxyError("upstream_timeout").body,
    );
    expect(response.body).not.toContain("[DONE]");
    expect(await double.settled).toBe(true);

    // The deadline aborted the adapter and released the permit: a later
    // request on the same app streams to completion.
    const later = await post(streamRequest);
    expect(later.status).toBe(200);
    expect(parseFrames(later.body).at(-1)).toBe("[DONE]");
    expect(
      parseChunk(parseFrames(later.body)[0]).choices[0]?.delta.content,
    ).toBe("Later");
  });
});

test("deadline before commit returns the normal 504 JSON without SSE headers", async () => {
  const double = abortWaitingAdapter();
  await withDeadline(double.adapter, 30, async (post) => {
    const response = await post(streamRequest);
    expect(response.status).toBe(504);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(response.body)).toEqual(
      new ProxyError("upstream_timeout").body,
    );
    expect(response.body).not.toContain("[DONE]");
    expect(await double.settled).toBe(true);
  });
});

test("each stream clears its deadline timer on completion, failure, and abort", async () => {
  const schedule = spyOn(globalThis, "setTimeout");
  const cancel = spyOn(globalThis, "clearTimeout");
  const heldDelayMs = 12_345; // distinctive: never fires during the test
  const scheduledHandles: unknown[] = [];
  const cancelledHandles: unknown[] = [];

  try {
    // Completion: a normal stream still clears its timer.
    await withDeadline(boundedAdapter(["Hi"]), heldDelayMs, async (post) => {
      const response = await post(streamRequest);
      expect(parseFrames(response.body).at(-1)).toBe("[DONE]");
    });

    // Failure: a pre-commit adapter rejection still clears its timer.
    const failing: ProviderAdapter = {
      async generate() {
        return success;
      },
      stream: () =>
        rejectingStream(
          NormalizedProviderError.create({
            category: "provider_error",
            retryable: false,
            message: "SECRET-TIMER-FAILURE",
          }),
        ),
    };
    await withDeadline(failing, heldDelayMs, async (post) => {
      const response = await post(streamRequest);
      expect(response.status).toBe(502);
      expect(response.body).not.toContain("SECRET-TIMER-FAILURE");
    });

    // Deadline: the timer fires, ends the stream, and is cleared in cleanup.
    const hanging = abortWaitingAdapter();
    await withDeadline(hanging.adapter, 20, async (post) => {
      const response = await post(streamRequest);
      expect(response.status).toBe(504);
      expect(await hanging.settled).toBe(true);
    });

    // Capture before mockRestore(): restoring a Bun spy clears its records.
    for (let i = 0; i < schedule.mock.calls.length; i++) {
      const call = schedule.mock.calls[i];
      const handle = schedule.mock.results[i]?.value;
      if (
        call !== undefined &&
        handle !== undefined &&
        (call[1] === heldDelayMs || call[1] === 20)
      ) {
        scheduledHandles.push(handle);
      }
    }
    for (const entry of cancel.mock.calls) cancelledHandles.push(entry?.[0]);
  } finally {
    schedule.mockRestore();
    cancel.mockRestore();
  }

  // Every deadline timer scheduled by the streaming routes above was
  // cleared on its exit path.
  expect(scheduledHandles.length).toBe(3);
  for (const handle of scheduledHandles) {
    expect(cancelledHandles).toContain(handle);
  }
});

test("64 open streams hold capacity; completing one releases it for the next request", async () => {
  const factory = holdingAdapter();
  const app = createApp({ adapter: factory.adapter });
  const url = new URL(await app.listen({ host: "127.0.0.1", port: 0 }));
  const healthUrl = `http://127.0.0.1:${url.port}/health`;
  const held: {
    readonly open: OpenStream;
    readonly release: () => void;
    readonly settled: Promise<boolean>;
  }[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    for (let i = 0; i < 64; i++) {
      const open = openStreamRequest(url, streamRequest);
      await open.firstChunk;
      const handle = factory.streams[i];
      if (handle === undefined) throw new Error("held stream not registered");
      held.push({ open, release: handle.release, settled: handle.settled });
    }

    // Saturation: the 65th request fails immediately without queueing.
    const busy = await postCompletion(url, streamRequest);
    expect(busy.status).toBe(503);
    expect(JSON.parse(busy.body)).toEqual(new ProxyError("gateway_busy").body);
    expect((await fetch(healthUrl)).status).toBe(200);

    // Completing one held stream releases exactly its permit. The socket is
    // torn down client-side only after the server-side stream has settled:
    // Bun's server never reports a disconnect for a request that had a
    // body, so the adapter's settled promise is the completion signal.
    const first = held[0];
    if (first === undefined) throw new Error("no held stream");
    first.release();
    await first.settled;
    first.open.destroy();
    await nextTickTurn();

    const probe = openStreamRequest(url, streamRequest);
    expect(await probe.status).toBe(200);
    expect(await probe.firstChunk).toContain('"content":"Held"');
    const probeHandle = factory.streams[64];
    if (probeHandle === undefined) throw new Error("probe not registered");
    held.push({
      open: probe,
      release: probeHandle.release,
      settled: probeHandle.settled,
    });

    expect((await fetch(healthUrl)).status).toBe(200);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    for (const { release } of held) release();
    await Promise.all(held.map(({ settled }) => settled));
    for (const { open } of held) open.destroy();
    await nextTickTurn();
    await app.close();
  }
  expect(unhandled).toEqual([]);
});
