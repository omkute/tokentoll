import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { expect, test } from "bun:test";
import {
  createStreamEvent,
  type NormalizedStreamEvent,
  type NormalizedUsage,
} from "../src/domain/provider-contracts.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import {
  createSseChunks,
  createSseWriter,
  createStreamControl,
  formatSseFrame,
  mapChatUsage,
  SSE_DONE,
  streamChatCompletion,
  type SseReply,
} from "../src/http/sse.js";

const usage: NormalizedUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
};

test("frame helpers produce exact wire bytes", () => {
  expect(formatSseFrame({ a: 1 })).toBe('data: {"a":1}\n\n');
  expect(formatSseFrame({ error: { code: "x" } })).toBe(
    'data: {"error":{"code":"x"}}\n\n',
  );
  expect(SSE_DONE).toBe("data: [DONE]\n\n");
});

test("usage mapping mirrors the non-streaming response envelope", () => {
  expect(
    mapChatUsage({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 }),
  ).toEqual({
    prompt_tokens: 10,
    completion_tokens: 3,
    total_tokens: 13,
    prompt_tokens_details: { cached_tokens: 4 },
  });
  expect(
    mapChatUsage({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 }),
  ).toEqual({
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    prompt_tokens_details: { cached_tokens: 1 },
  });
});

test.each([
  { inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 },
  {
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 1,
    cacheReadTokens: 0,
  },
] as const)("invalid usage %j is rejected safely", (usage) => {
  try {
    mapChatUsage(usage);
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ProxyError);
    expect((error as ProxyError).body).toEqual(
      new ProxyError("invalid_provider_response").body,
    );
  }
});

test("chunks share one id and created with the fixed model alias", () => {
  const before = Math.floor(Date.now() / 1000);
  const chunks = createSseChunks("mock-chat");
  const content = chunks.contentChunk("Hi");
  const finish = chunks.finishChunk("stop");
  const usage = chunks.usageChunk({
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
  });

  for (const chunk of [content, finish, usage]) {
    expect(chunk.id).toMatch(
      /^chatcmpl-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(chunk.id).toBe(content.id);
    expect(Number.isInteger(chunk.created)).toBe(true);
    expect(chunk.created).toBe(content.created);
    expect(chunk.created).toBeGreaterThanOrEqual(before);
    expect(chunk.created).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(chunk.model).toBe("mock-chat");
    expect(chunk.object).toBe("chat.completion.chunk");
  }
  expect(createSseChunks("mock-chat").contentChunk("Hi").id).not.toBe(
    content.id,
  );
});

test("chunks serialize to exact frame bytes", () => {
  const chunks = createSseChunks("mock-chat");
  const { id, created } = chunks.contentChunk("probe");

  expect(formatSseFrame(chunks.contentChunk("Mock "))).toBe(
    `data: {"id":"${id}","object":"chat.completion.chunk","created":${created},"model":"mock-chat","choices":[{"index":0,"delta":{"content":"Mock "},"finish_reason":null}]}\n\n`,
  );
  expect(formatSseFrame(chunks.contentChunk(""))).toBe(
    `data: {"id":"${id}","object":"chat.completion.chunk","created":${created},"model":"mock-chat","choices":[{"index":0,"delta":{"content":""},"finish_reason":null}]}\n\n`,
  );
  expect(formatSseFrame(chunks.finishChunk("stop"))).toBe(
    `data: {"id":"${id}","object":"chat.completion.chunk","created":${created},"model":"mock-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
  );
  expect(
    formatSseFrame(
      chunks.usageChunk({
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 4,
      }),
    ),
  ).toBe(
    `data: {"id":"${id}","object":"chat.completion.chunk","created":${created},"model":"mock-chat","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":4}}}\n\n`,
  );
});

test.each(["stop", "length", "content_filter"] as const)(
  "finish chunk %s carries an empty delta and the reason",
  (finishReason) => {
    const chunk = createSseChunks("mock-chat").finishChunk(finishReason);
    expect(chunk.choices).toEqual([
      { index: 0, delta: {}, finish_reason: finishReason },
    ]);
    expect(Object.keys(chunk.choices[0]?.delta ?? {})).toEqual([]);
  },
);

/**
 * Minimal `ServerResponse` double built on an EventEmitter. It records every
 * written frame, can signal backpressure, and supports settling a pending
 * drain wait through `drain`, `close`, or `error`.
 */
type FakeRaw = EventEmitter & {
  destroyed: boolean;
  writableEnded: boolean;
  frames: string[];
  write(frame: string): boolean;
  writeHead(status: number, headers: Record<string, string>): FakeRaw;
  end(): void;
};

function createFakeRaw(): FakeRaw {
  const raw = new EventEmitter() as unknown as FakeRaw;
  raw.destroyed = false;
  raw.writableEnded = false;
  raw.frames = [];
  raw.write = (frame: string) => {
    raw.frames.push(frame);
    return true;
  };
  raw.writeHead = () => raw;
  raw.end = () => {
    raw.writableEnded = true;
  };
  return raw;
}

/** Structural test double; only the surface `SseReply` consumes is used. */
function createFakeReply(raw: FakeRaw): SseReply {
  return {
    hijack: () => {},
    raw: raw as unknown as ServerResponse,
  } as unknown as SseReply;
}

/** Lets the promise/microtask chains of the state machine run to rest. */
async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
}

/** An adapter-like iterable that counts how often `next()` was pulled. */
function countingStream(events: readonly NormalizedStreamEvent[]): {
  iterable: AsyncIterable<NormalizedStreamEvent>;
  nextCalls: () => number;
} {
  let pulls = 0;
  const iterable: AsyncIterable<NormalizedStreamEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<NormalizedStreamEvent>> => {
        pulls++;
        const value = events[pulls - 1];
        return value === undefined
          ? { done: true, value: undefined }
          : { done: false, value };
      },
      return: async (): Promise<IteratorResult<NormalizedStreamEvent>> => ({
        done: true,
        value: undefined,
      }),
    }),
  };
  return { iterable, nextCalls: () => pulls };
}

test("maximum content with worst-case JSON escaping stays under the frame bound", () => {
  const chunks = createSseChunks("mock-chat");
  // NUL is one UTF-8 byte on the wire but escapes to six JSON characters.
  const control = "\u0000".repeat(8192);
  expect(Buffer.byteLength(control, "utf8")).toBe(8192);

  const frame = formatSseFrame(chunks.contentChunk(control));
  expect(Buffer.byteLength(frame, "utf8")).toBeGreaterThan(8192);
  expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(65_536);
});

test("stream control records only the first abort cause", () => {
  const control = createStreamControl();
  expect(control.reason).toBeUndefined();
  expect(control.signal.aborted).toBe(false);

  control.abort("timeout");
  control.abort("client");

  expect(control.reason).toBe("timeout");
  expect(control.signal.aborted).toBe(true);
});

test("writer rejects an oversized serialized frame before writing it", async () => {
  const raw = createFakeRaw();
  const writer = createSseWriter(
    createFakeReply(raw),
    createStreamControl().signal,
  );

  let failure: unknown;
  try {
    await writer.write({ oversized: "x".repeat(70_000) });
    throw new Error("Expected the oversized frame to be rejected");
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ProxyError);
  expect((failure as ProxyError).body).toEqual(
    new ProxyError("invalid_provider_response").body,
  );
  expect(raw.frames).toHaveLength(0);
});

test("streamChatCompletion holds one frame in flight until it drains", async () => {
  const raw = createFakeRaw();
  raw.write = (frame: string) => {
    raw.frames.push(frame);
    return false; // every write signals backpressure
  };
  const { iterable, nextCalls } = countingStream([
    createStreamEvent({ type: "content_delta", delta: "a" }),
    createStreamEvent({ type: "content_delta", delta: "b" }),
    createStreamEvent({ type: "usage", usage }),
    createStreamEvent({ type: "completed", finishReason: "stop" }),
  ]);

  const streaming = streamChatCompletion(
    createFakeReply(raw),
    iterable,
    createStreamControl(),
    true,
    "mock-chat",
  );

  // Only the first pull happened; its frame is written and awaiting drain.
  await flushMicrotasks();
  expect(nextCalls()).toBe(1);
  expect(raw.frames).toHaveLength(1);
  expect(raw.frames[0]).toContain('"content":"a"');

  // The adapter is not pulled again until the first frame drains.
  raw.emit("drain");
  await flushMicrotasks();
  expect(nextCalls()).toBe(2);
  expect(raw.frames).toHaveLength(2);
  expect(raw.frames[1]).toContain('"content":"b"');

  // The usage event writes no frame; completion then blocks on drain again.
  raw.emit("drain");
  await flushMicrotasks();
  expect(nextCalls()).toBe(4);
  expect(raw.frames).toHaveLength(3);
  expect(raw.frames[2]).toContain('"finish_reason":"stop"');

  raw.emit("drain");
  await flushMicrotasks();
  expect(raw.frames).toHaveLength(4);
  expect(raw.frames[3]).toContain('"total_tokens":2');

  raw.emit("drain");
  await flushMicrotasks();
  expect(raw.frames).toHaveLength(5);
  expect(raw.frames[4]).toBe(SSE_DONE);
  expect(raw.writableEnded).toBe(false);

  raw.emit("drain");
  await streaming;
  expect(raw.writableEnded).toBe(true);
});

test("an error on the response settles the drain wait and stops further writes", async () => {
  const raw = createFakeRaw();
  raw.write = (frame: string) => {
    raw.frames.push(frame);
    return false;
  };
  const { iterable, nextCalls } = countingStream([
    createStreamEvent({ type: "content_delta", delta: "a" }),
    createStreamEvent({ type: "content_delta", delta: "b" }),
    createStreamEvent({ type: "usage", usage }),
    createStreamEvent({ type: "completed", finishReason: "stop" }),
  ]);

  const streaming = streamChatCompletion(
    createFakeReply(raw),
    iterable,
    createStreamControl(),
    false,
    "mock-chat",
  );
  await flushMicrotasks();
  expect(nextCalls()).toBe(1);
  expect(raw.frames).toHaveLength(1);

  // The terminal event settles the pending wait and the response is gone.
  raw.emit("error");
  raw.destroyed = true;
  await flushMicrotasks();
  expect(nextCalls()).toBe(4);

  await streaming;
  expect(raw.frames).toHaveLength(1);
  expect(raw.writableEnded).toBe(true);
});

test("a close on the response aborts like a client disconnect and ends quietly", async () => {
  const raw = createFakeRaw();
  raw.write = (frame: string) => {
    raw.frames.push(frame);
    return false;
  };
  let pulls = 0;
  let returned = false;
  const iterable: AsyncIterable<NormalizedStreamEvent> = {
    [Symbol.asyncIterator]: () => ({
      // The first pull delivers the committed frame; the second hangs like
      // an upstream that is still producing when the client vanishes.
      next: async (): Promise<IteratorResult<NormalizedStreamEvent>> => {
        pulls++;
        return pulls === 1
          ? {
              done: false,
              value: createStreamEvent({ type: "content_delta", delta: "a" }),
            }
          : new Promise<IteratorResult<NormalizedStreamEvent>>((): void => {});
      },
      return: async (): Promise<IteratorResult<NormalizedStreamEvent>> => {
        returned = true;
        return { done: true, value: undefined };
      },
    }),
  };
  const control = createStreamControl();

  const streaming = streamChatCompletion(
    createFakeReply(raw),
    iterable,
    control,
    false,
    "mock-chat",
  );
  await flushMicrotasks();
  expect(pulls).toBe(1);
  expect(raw.frames).toHaveLength(1);

  raw.emit("close");
  raw.destroyed = true;
  await flushMicrotasks();

  // The client abort is recorded, the iterator is closed instead of read
  // again, and the response ends without an error frame or a [DONE] frame.
  expect(control.reason).toBe("client");
  expect(control.signal.aborted).toBe(true);
  expect(pulls).toBe(1);
  await streaming;
  expect(returned).toBe(true);
  expect(raw.frames).toHaveLength(1);
  expect(raw.writableEnded).toBe(true);
});
