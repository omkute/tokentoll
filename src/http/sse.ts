import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { ServerResponse } from "node:http";
import {
  createStreamSequenceValidator,
  NormalizedProviderError,
  type FinishReason,
  type NormalizedStreamEvent,
  type NormalizedUsage,
} from "../domain/provider-contracts.js";
import { DomainValidationError } from "../domain/validation.js";
import { normalizeProxyError, ProxyError } from "./proxy-errors.js";

/**
 * Minimal reply surface the SSE path needs. Keeps the streaming helpers
 * structurally compatible with any Fastify route reply.
 */
export type SseReply = Pick<FastifyReply, "hijack" | "raw">;

export const SSE_DONE = "data: [DONE]\n\n";

const MAX_STREAMED_CONTENT_BYTES = 8192;
const MAX_SSE_FRAME_BYTES = 65_536;

export function formatSseFrame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export type StreamAbortReason = "client" | "timeout" | "shutdown";

export interface StreamControl {
  /** Cancellation signal handed to the adapter invocation. */
  readonly signal: AbortSignal;
  /** First recorded cause of an abort, or undefined while none happened. */
  readonly reason: StreamAbortReason | undefined;
  /** Records only the first cause; later calls are no-ops. */
  abort(reason: StreamAbortReason): void;
}

export function createStreamControl(): StreamControl {
  const controller = new AbortController();
  let reason: StreamAbortReason | undefined;
  return {
    signal: controller.signal,
    get reason() {
      return reason;
    },
    abort(cause) {
      if (reason !== undefined) return;
      reason = cause;
      controller.abort();
    },
  };
}

export interface WireUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly prompt_tokens_details: { readonly cached_tokens: number };
}

/** Usage mapping shared with the non-streaming response serialization. */
export function mapChatUsage(usage: NormalizedUsage): WireUsage {
  const { inputTokens, outputTokens, cacheReadTokens } = usage;
  const totalTokens = inputTokens + outputTokens;
  if (cacheReadTokens > inputTokens || !Number.isSafeInteger(totalTokens)) {
    throw new ProxyError("invalid_provider_response");
  }
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: { cached_tokens: cacheReadTokens },
  };
}

export interface ChatChunkChoice {
  readonly index: number;
  readonly delta: { readonly content?: string };
  readonly finish_reason: FinishReason | null;
}

export interface ChatCompletionChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly ChatChunkChoice[];
  readonly usage?: WireUsage;
}

export interface SseChunkBuilder {
  contentChunk(delta: string): ChatCompletionChunk;
  finishChunk(finishReason: FinishReason): ChatCompletionChunk;
  usageChunk(usage: NormalizedUsage): ChatCompletionChunk;
}

/** One shared id and creation timestamp for every chunk of one stream. */
export function createSseChunks(model: string): SseChunkBuilder {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    contentChunk(delta) {
      return {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      };
    },
    finishChunk(finishReason) {
      return {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      };
    },
    usageChunk(usage) {
      return {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [],
        usage: mapChatUsage(usage),
      };
    },
  };
}

export interface SseWriter {
  commit(): void;
  write(value: unknown): Promise<void>;
  writeDone(): Promise<void>;
  writeError(failure: ProxyError): Promise<void>;
  end(): void;
  readonly committed: boolean;
}

export function createSseWriter(
  reply: SseReply,
  signal: AbortSignal,
): SseWriter {
  let committed = false;

  return {
    commit() {
      if (committed) return;
      committed = true;
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      });
    },
    async write(value) {
      await writeFrame(reply.raw, formatSseFrame(value), signal);
    },
    async writeDone() {
      await writeFrame(reply.raw, SSE_DONE, signal);
    },
    async writeError(failure) {
      await writeFrame(reply.raw, formatSseFrame(failure.body), signal);
    },
    end() {
      reply.raw.end();
    },
    get committed() {
      return committed;
    },
  };
}

async function writeFrame(
  raw: ServerResponse,
  frame: string,
  signal: AbortSignal,
): Promise<void> {
  if (Buffer.byteLength(frame, "utf8") > MAX_SSE_FRAME_BYTES)
    throw new ProxyError("invalid_provider_response");
  // A destroyed or ended response can never drain again; skip the write so
  // cancellation paths cannot hang or write into a closed socket.
  if (raw.destroyed || raw.writableEnded) return;
  if (raw.write(frame)) return;
  // A slow consumer cannot outlive an abort: never queue behind a drain
  // that may never come once the stream has been cancelled.
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const settle = () => {
      raw.off("drain", settle);
      raw.off("close", settle);
      raw.off("error", settle);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    raw.once("drain", settle);
    raw.once("close", settle);
    raw.once("error", settle);
    signal.addEventListener("abort", settle, { once: true });
  });
}

function mapStreamFailure(error: unknown): ProxyError {
  if (error instanceof ProxyError) return error;
  if (error instanceof NormalizedProviderError)
    return normalizeProxyError(error);
  if (error instanceof DomainValidationError)
    return new ProxyError("invalid_provider_response");
  return new ProxyError("internal_error");
}

/**
 * Result of one raced adapter read. An abort that wins the race is reported
 * by its first cause; a client abort ends the stream without any frame.
 */
type PullOutcome =
  | { readonly kind: "event"; readonly event: NormalizedStreamEvent }
  | { readonly kind: "exhausted" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "client" }
  | { readonly kind: "timeout" }
  | { readonly kind: "shutdown" };

/**
 * Event-to-frame state machine with cancellation. Pulls and validates the
 * first event before any headers; headers commit only with the first actual
 * wire frame (content, finish, usage, or `[DONE]`). Any failure before that
 * point — including an unusable first usage event — throws the mapped
 * ProxyError so the caller can answer with the non-streaming status table.
 * After that commit, exactly one safe error frame replaces any further
 * failure and the response ends without `[DONE]`.
 *
 * Every adapter read races the abort signal, so a pending pull cannot
 * outlive a deadline, a disconnect, or a shutdown. A won abort chooses its
 * end by cause: timeout and shutdown map to their error path (pre-commit
 * status table or one mid-stream error frame), while a vanished client ends
 * the stream quietly with no frame. The drain wait settles on the same
 * signal so a slow consumer plus deadline cannot hang. Streamed content is
 * capped at 8192 UTF-8 bytes and every serialized frame at 65,536 UTF-8
 * bytes; overflow fails through the same error paths and is never truncated.
 * One frame is in flight at a time: the next adapter event is pulled only
 * after the current frame has drained.
 */
export async function streamChatCompletion(
  reply: SseReply,
  events: AsyncIterable<NormalizedStreamEvent>,
  control: StreamControl,
  includeUsage: boolean,
  model: string,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  const validator = createStreamSequenceValidator();
  const writer = createSseWriter(reply, control.signal);
  const chunks = createSseChunks(model);
  let finished = false;

  // A vanished client surfaces as `close` on the response (Node) or on the
  // underlying socket; either path aborts unless the stream already ended.
  const onConnectionClosed = (): void => {
    if (!finished) control.abort("client");
  };
  reply.raw.once("close", onConnectionClosed);
  const socket = reply.raw.socket;
  socket?.once("close", onConnectionClosed);

  /** Pulls one adapter event; a won abort is reported by its first cause. */
  const pull = (): Promise<PullOutcome> => {
    const before = control.reason;
    if (before !== undefined) return Promise.resolve({ kind: before });

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<true>((resolve) => {
      if (control.signal.aborted) {
        resolve(true);
        return;
      }
      onAbort = () => resolve(true);
      control.signal.addEventListener("abort", onAbort, { once: true });
    });

    return Promise.race([
      iterator.next().then(
        (result): PullOutcome =>
          result.done
            ? { kind: "exhausted" }
            : { kind: "event", event: result.value },
        (error): PullOutcome => ({ kind: "error", error }),
      ),
      aborted,
    ]).then((outcome): PullOutcome => {
      if (onAbort !== undefined)
        control.signal.removeEventListener("abort", onAbort);
      if (outcome !== true) return outcome;
      const reason = control.reason;
      return reason === undefined ? { kind: "client" } : { kind: reason };
    });
  };

  /** Cause-chosen failure for an abort that ended the stream. */
  const abortFailure = (reason: "timeout" | "shutdown"): ProxyError =>
    reason === "timeout"
      ? new ProxyError("upstream_timeout")
      : new ProxyError("internal_error");

  let contentBytes = 0;

  /** Commits the response exactly when the first frame is written. */
  const commitAndWrite = async (chunk: ChatCompletionChunk): Promise<void> => {
    writer.commit();
    await writer.write(chunk);
  };

  try {
    for (;;) {
      const outcome = await pull();
      if (outcome.kind === "client") return; // quiet end, no frame
      if (outcome.kind === "timeout" || outcome.kind === "shutdown")
        throw abortFailure(outcome.kind);
      if (outcome.kind === "error") throw outcome.error;
      if (outcome.kind === "exhausted")
        throw new ProxyError("invalid_provider_response");
      const event = validator.accept(outcome.event);
      if (event.type === "completed") {
        await commitAndWrite(chunks.finishChunk(event.finishReason));
        const usage = validator.usage;
        if (includeUsage) {
          if (usage === undefined)
            throw new ProxyError("invalid_provider_response");
          await writer.write(chunks.usageChunk(usage));
        }
        await writer.writeDone();
        return;
      }
      if (event.type === "content_delta") {
        const deltaBytes = Buffer.byteLength(event.delta, "utf8");
        if (contentBytes + deltaBytes > MAX_STREAMED_CONTENT_BYTES)
          throw new ProxyError("invalid_provider_response");
        contentBytes += deltaBytes;
        await commitAndWrite(chunks.contentChunk(event.delta));
      } else {
        // Validate the wire mapping even when no usage chunk is emitted.
        mapChatUsage(event.usage);
      }
    }
  } catch (error) {
    const failure = mapStreamFailure(error);
    if (!writer.committed) throw failure;
    await writer.writeError(failure);
  } finally {
    finished = true;
    reply.raw.off("close", onConnectionClosed);
    socket?.off("close", onConnectionClosed);
    await iterator.return?.().catch(() => undefined);
    if (writer.committed) writer.end();
  }
}
