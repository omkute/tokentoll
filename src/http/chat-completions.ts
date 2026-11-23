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
import { normalizeProxyError, ProxyError } from "./proxy-errors.js";

export const CHAT_MODEL = "mock-chat";
const REQUEST_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "max_completion_tokens",
]);

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function parseChatRequest(input: unknown): NormalizedGenerationRequest {
  if (
    !isRecord(input) ||
    Object.keys(input).some((key) => !REQUEST_KEYS.has(key)) ||
    typeof input.model !== "string" ||
    input.model.trim().length === 0 ||
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 128 ||
    (Object.hasOwn(input, "stream") && input.stream !== false) ||
    (Object.hasOwn(input, "max_completion_tokens") &&
      (typeof input.max_completion_tokens !== "number" ||
        !Number.isInteger(input.max_completion_tokens) ||
        input.max_completion_tokens < 1 ||
        input.max_completion_tokens > 8192))
  )
    throw new ProxyError("invalid_request");

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
  return request;
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
    const { inputTokens, outputTokens, cacheReadTokens } = response.usage;
    const totalTokens = inputTokens + outputTokens;
    if (cacheReadTokens > inputTokens || !Number.isSafeInteger(totalTokens)) {
      throw new ProxyError("invalid_provider_response");
    }
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
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: totalTokens,
        prompt_tokens_details: { cached_tokens: cacheReadTokens },
      },
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
): void {
  app.register(async (proxy) => {
    let active = 0;
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
        const normalized = parseChatRequest(request.body);
        if (active >= 64) throw new ProxyError("gateway_busy");
        active++;
        try {
          let response: unknown;
          try {
            response = await adapter.generate({
              request: normalized,
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
        } finally {
          active--;
        }
      },
    );
  });
}
