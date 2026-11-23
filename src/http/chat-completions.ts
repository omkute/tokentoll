import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ModelDeployment } from "../domain/model-deployment.js";
import type { ProviderAdapter } from "../domain/provider-adapter.js";
import {
  createGenerationRequest,
  createGenerationResponse,
  NormalizedProviderError,
  type NormalizedGenerationRequest,
} from "../domain/provider-contracts.js";
import {
  mapChatUsage,
  createStreamControl,
  streamChatCompletion,
  type StreamControl,
} from "./sse.js";
import { normalizeProxyError, ProxyError } from "./proxy-errors.js";

export const CHAT_MODEL = "mock-chat";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_completion_tokens",
]);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export interface ParsedChatRequest {
  readonly request: NormalizedGenerationRequest;
  readonly stream: boolean;
  readonly includeUsage: boolean;
}

export function parseChatRequest(input: unknown): ParsedChatRequest {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !REQUEST_KEYS.has(key)) ||
    typeof input.model !== "string" ||
    input.model.trim().length === 0 ||
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 128 ||
    (Object.hasOwn(input, "stream") &&
      input.stream !== true &&
      input.stream !== false) ||
    (Object.hasOwn(input, "max_completion_tokens") &&
      (typeof input.max_completion_tokens !== "number" ||
        !Number.isInteger(input.max_completion_tokens) ||
        input.max_completion_tokens < 1 ||
        input.max_completion_tokens > 8192))
  )
    throw new ProxyError("invalid_request");

  const stream = Object.hasOwn(input, "stream") && input.stream === true;
  let includeUsage = false;
  if (Object.hasOwn(input, "stream_options")) {
    const options = input.stream_options;
    if (
      !stream ||
      !isRecord(options) ||
      Object.keys(options).some((key) => key !== "include_usage")
    )
      throw new ProxyError("invalid_request");
    if (Object.hasOwn(options, "include_usage")) {
      if (typeof options.include_usage !== "boolean")
        throw new ProxyError("invalid_request");
      includeUsage = options.include_usage;
    }
  }

  let request: NormalizedGenerationRequest;
  try {
    request = createGenerationRequest({
      messages: input.messages,
      ...(Object.hasOwn(input, "max_completion_tokens")
        ? { maxOutputTokens: input.max_completion_tokens }
        : {}),
    });
  } catch {
    // Domain paths can include arbitrary submitted keys. Never expose them.
    throw new ProxyError("invalid_request");
  }
  if (input.model !== CHAT_MODEL) throw new ProxyError("model_not_found");
  return Object.freeze({ request, stream, includeUsage });
}

export function serializeChatResponse(input: unknown): string {
  try {
    if (
      !isRecord(input) ||
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content, "utf8") > 8192
    ) {
      throw new ProxyError("invalid_provider_response");
    }
    const response = createGenerationResponse(input);
    const usage = mapChatUsage(response.usage);
    const serialized = JSON.stringify({
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: CHAT_MODEL,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: response.content },
          finish_reason: response.finishReason,
        },
      ],
      usage,
    });
    if (Buffer.byteLength(serialized, "utf8") > 65_536)
      throw new ProxyError("invalid_provider_response");
    return serialized;
  } catch {
    throw new ProxyError("invalid_provider_response");
  }
}

export function registerChatCompletions(
  app: FastifyInstance,
  adapter: ProviderAdapter,
  deployment: ModelDeployment,
  requestTimeoutMs?: number,
): void {
  const deadlineMs = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  app.register(async (proxy) => {
    let active = 0;
    // Set synchronously at the start of preClose. From that moment new
    // streaming requests are rejected before admission, so the stream
    // registry below can only shrink while closing and the preClose loop
    // terminates. Non-streaming requests keep draining as before.
    let closing = false;

    // One entry per admitted streaming request. The registry lives in this
    // plugin closure, so every createApp() instance owns an independent
    // registry and no module-global state is shared across applications.
    interface ActiveStream {
      readonly control: StreamControl;
      readonly settled: Promise<void>;
    }
    const activeStreams = new Set<ActiveStream>();

    // Shutdown aborts every admitted stream — including one whose adapter
    // has not produced its first event yet — and awaits the settlement of
    // each hijacked response, so app.close() completes within the caller's
    // grace period instead of blocking on open sockets. Entries that settle
    // during an await unregister themselves; the loop re-snapshots so late
    // settlements cannot strand a stream. A stream that still fails to
    // settle is left to the existing shutdown timeout path.
    proxy.addHook("preClose", async () => {
      closing = true;
      while (activeStreams.size > 0) {
        const pending = [...activeStreams];
        for (const stream of pending) stream.control.abort("shutdown");
        await Promise.allSettled(pending.map((stream) => stream.settled));
      }
    });

    proxy.setErrorHandler((error, _request, reply) => {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      const failure =
        code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? new ProxyError("request_too_large")
          : code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
            ? new ProxyError("unsupported_media_type")
            : code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
                code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
                code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH"
              ? new ProxyError("invalid_request")
              : normalizeProxyError(error);
      return reply.code(failure.statusCode).send(failure.body);
    });
    proxy.post(
      "/v1/chat/completions",
      {
        bodyLimit: 65_536,
        onRequest: async (request) => {
          const contentType = request.headers["content-type"];
          const encoding = request.headers["content-encoding"];
          if (
            typeof contentType !== "string" ||
            !/^application\/json(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?\s*$/i.test(
              contentType.trim(),
            ) ||
            (encoding !== undefined &&
              (typeof encoding !== "string" ||
                encoding.trim().toLowerCase() !== "identity"))
          ) {
            throw new ProxyError("unsupported_media_type");
          }
        },
      },
      async (request, reply) => {
        const parsed = parseChatRequest(request.body);
        const streamOperation = parsed.stream ? adapter.stream : undefined;
        if (parsed.stream && streamOperation === undefined)
          throw new ProxyError("internal_error");
        // Once closing begins, new streaming requests are refused before
        // admission so they can never outlive the preClose abort loop.
        // Non-streaming requests keep draining through shutdown.
        if (parsed.stream && closing) throw new ProxyError("gateway_busy");
        if (active >= 64) throw new ProxyError("gateway_busy");
        active++;
        try {
          if (streamOperation === undefined) {
            let response: unknown;
            try {
              response = await adapter.generate({
                request: parsed.request,
                deployment,
              });
            } catch (error) {
              throw error instanceof NormalizedProviderError
                ? normalizeProxyError(error)
                : new ProxyError("internal_error");
            }
            return reply
              .type("application/json")
              .send(serializeChatResponse(response));
          }
          // One controller and one deadline timer per streaming request; the
          // timer is cleared on every exit path and an idle deadline never
          // holds the event loop open.
          const control = createStreamControl();
          const deadline = setTimeout(
            () => control.abort("timeout"),
            deadlineMs,
          );
          deadline.unref();
          let markSettled: () => void = () => {};
          const settled = new Promise<void>((resolve) => {
            markSettled = resolve;
          });
          const entry: ActiveStream = { control, settled };
          // Registered synchronously with admission, before the adapter is
          // invoked, so preClose can abort even a stream that has not yet
          // produced — let alone committed — its first event. The closing
          // gate above makes this the only registration point, and the
          // check-and-register span is fully synchronous, so no entry can
          // appear after preClose started. Unregistered and settled on
          // every exit path below.
          activeStreams.add(entry);
          try {
            await streamChatCompletion(
              reply,
              streamOperation.call(adapter, {
                request: parsed.request,
                deployment,
                signal: control.signal,
              }),
              control,
              parsed.includeUsage,
              CHAT_MODEL,
            );
            return;
          } finally {
            clearTimeout(deadline);
            activeStreams.delete(entry);
            markSettled();
          }
        } finally {
          active--;
        }
      },
    );
  });
}
