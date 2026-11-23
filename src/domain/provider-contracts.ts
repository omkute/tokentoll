import { DomainValidationError } from "./validation.js";

export type MessageRole = "system" | "user" | "assistant";

export interface NormalizedMessage {
  readonly role: MessageRole;
  readonly content: string;
}

export interface NormalizedGenerationRequest {
  readonly messages: readonly NormalizedMessage[];
  readonly maxOutputTokens?: number;
}

export type FinishReason = "stop" | "length" | "content_filter";

export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

export interface NormalizedGenerationResponse {
  readonly content: string;
  readonly finishReason: FinishReason;
  readonly usage: NormalizedUsage;
}

export type NormalizedStreamEvent =
  | Readonly<{ type: "content_delta"; delta: string }>
  | Readonly<{ type: "usage"; usage: NormalizedUsage }>
  | Readonly<{ type: "completed"; finishReason: FinishReason }>;

export type ProviderErrorCategory =
  | "invalid_request"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error";

export class NormalizedProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;

  private constructor(
    category: ProviderErrorCategory,
    retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "NormalizedProviderError";
    this.category = category;
    this.retryable = retryable;
    Object.freeze(this);
  }

  static create(input: unknown): NormalizedProviderError {
    if (!isRecord(input)) {
      throw new DomainValidationError(["error"]);
    }

    const invalidPaths: string[] = [];
    collectExtraKeys(input, PROVIDER_ERROR_KEYS, "", invalidPaths);

    const category = input.category;
    if (
      typeof category !== "string" ||
      !PROVIDER_ERROR_CATEGORIES.has(category as ProviderErrorCategory)
    ) {
      invalidPaths.push("category");
    }

    const retryable = input.retryable;
    if (typeof retryable !== "boolean") {
      invalidPaths.push("retryable");
    } else if (category === "invalid_request" && retryable) {
      invalidPaths.push("retryable");
    }

    const message = input.message;
    if (typeof message !== "string" || message.trim().length === 0) {
      invalidPaths.push("message");
    }

    if (invalidPaths.length > 0) {
      throw new DomainValidationError(invalidPaths);
    }

    return new NormalizedProviderError(
      category as ProviderErrorCategory,
      retryable as boolean,
      message as string,
    );
  }
}

const MESSAGE_ROLES = new Set<MessageRole>(["system", "user", "assistant"]);
const REQUEST_KEYS = new Set(["messages", "maxOutputTokens"]);
const MESSAGE_KEYS = new Set(["role", "content"]);
const RESPONSE_KEYS = new Set(["content", "finishReason", "usage"]);
const USAGE_KEYS = new Set(["inputTokens", "outputTokens", "cacheReadTokens"]);
const FINISH_REASONS = new Set<FinishReason>([
  "stop",
  "length",
  "content_filter",
]);
const PROVIDER_ERROR_KEYS = new Set(["category", "retryable", "message"]);
const PROVIDER_ERROR_CATEGORIES = new Set<ProviderErrorCategory>([
  "invalid_request",
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "provider_error",
]);
const CONTENT_DELTA_EVENT_KEYS = new Set(["type", "delta"]);
const USAGE_EVENT_KEYS = new Set(["type", "usage"]);
const COMPLETED_EVENT_KEYS = new Set(["type", "finishReason"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectExtraKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  prefix: string,
  invalidPaths: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      invalidPaths.push(prefix.length === 0 ? key : `${prefix}.${key}`);
    }
  }
}

function createUsage(
  input: unknown,
  path: string,
  invalidPaths: string[],
): NormalizedUsage | undefined {
  if (!isRecord(input)) {
    invalidPaths.push(path);
    return undefined;
  }

  collectExtraKeys(input, USAGE_KEYS, path, invalidPaths);
  const values: Record<keyof NormalizedUsage, number> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  let valid = true;
  for (const key of USAGE_KEYS) {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      invalidPaths.push(`${path}.${key}`);
      valid = false;
    } else {
      values[key as keyof NormalizedUsage] = value;
    }
  }

  return valid ? (Object.freeze(values) as NormalizedUsage) : undefined;
}

export function createGenerationRequest(
  input: unknown,
): NormalizedGenerationRequest {
  if (!isRecord(input)) {
    throw new DomainValidationError(["request"]);
  }

  const invalidPaths: string[] = [];
  collectExtraKeys(input, REQUEST_KEYS, "", invalidPaths);

  const normalizedMessages: NormalizedMessage[] = [];
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    invalidPaths.push("messages");
  } else {
    Array.from(input.messages).forEach((message, index) => {
      const path = `messages[${index}]`;
      if (!isRecord(message)) {
        invalidPaths.push(path);
        return;
      }

      collectExtraKeys(message, MESSAGE_KEYS, path, invalidPaths);
      if (
        typeof message.role !== "string" ||
        !MESSAGE_ROLES.has(message.role as MessageRole)
      ) {
        invalidPaths.push(`${path}.role`);
      }
      if (
        typeof message.content !== "string" ||
        message.content.trim().length === 0
      ) {
        invalidPaths.push(`${path}.content`);
      }

      if (
        typeof message.role === "string" &&
        MESSAGE_ROLES.has(message.role as MessageRole) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
      ) {
        normalizedMessages.push(
          Object.freeze({
            role: message.role as MessageRole,
            content: message.content,
          }),
        );
      }
    });
  }

  const maxOutputTokens = input.maxOutputTokens;
  let normalizedMaxOutputTokens: number | undefined;
  if (maxOutputTokens === undefined) {
    normalizedMaxOutputTokens = undefined;
  } else if (
    typeof maxOutputTokens === "number" &&
    Number.isSafeInteger(maxOutputTokens) &&
    maxOutputTokens > 0
  ) {
    normalizedMaxOutputTokens = maxOutputTokens;
  } else {
    invalidPaths.push("maxOutputTokens");
  }

  if (invalidPaths.length > 0) {
    throw new DomainValidationError(invalidPaths);
  }

  const messages = Object.freeze(normalizedMessages);
  return normalizedMaxOutputTokens === undefined
    ? Object.freeze({ messages })
    : Object.freeze({ messages, maxOutputTokens: normalizedMaxOutputTokens });
}

export function createGenerationResponse(
  input: unknown,
): NormalizedGenerationResponse {
  if (!isRecord(input)) {
    throw new DomainValidationError(["response"]);
  }

  const invalidPaths: string[] = [];
  collectExtraKeys(input, RESPONSE_KEYS, "", invalidPaths);

  const content = input.content;
  if (typeof content !== "string") {
    invalidPaths.push("content");
  }

  const finishReason = input.finishReason;
  if (
    typeof finishReason !== "string" ||
    !FINISH_REASONS.has(finishReason as FinishReason)
  ) {
    invalidPaths.push("finishReason");
  }

  const usage = createUsage(input.usage, "usage", invalidPaths);

  if (invalidPaths.length > 0) {
    throw new DomainValidationError(invalidPaths);
  }

  return Object.freeze({
    content: content as string,
    finishReason: finishReason as FinishReason,
    usage: usage as NormalizedUsage,
  });
}

export function createStreamEvent(input: unknown): NormalizedStreamEvent {
  if (!isRecord(input)) {
    throw new DomainValidationError(["streamEvent"]);
  }

  const invalidPaths: string[] = [];
  switch (input.type) {
    case "content_delta": {
      collectExtraKeys(input, CONTENT_DELTA_EVENT_KEYS, "", invalidPaths);
      if (typeof input.delta !== "string" || input.delta.length === 0) {
        invalidPaths.push("delta");
      }
      if (invalidPaths.length > 0) {
        throw new DomainValidationError(invalidPaths);
      }
      return Object.freeze({
        type: "content_delta",
        delta: input.delta as string,
      });
    }
    case "usage": {
      collectExtraKeys(input, USAGE_EVENT_KEYS, "", invalidPaths);
      const usage = createUsage(input.usage, "usage", invalidPaths);
      if (invalidPaths.length > 0) {
        throw new DomainValidationError(invalidPaths);
      }
      return Object.freeze({ type: "usage", usage: usage as NormalizedUsage });
    }
    case "completed": {
      collectExtraKeys(input, COMPLETED_EVENT_KEYS, "", invalidPaths);
      const finishReason = input.finishReason;
      if (
        typeof finishReason !== "string" ||
        !FINISH_REASONS.has(finishReason as FinishReason)
      ) {
        invalidPaths.push("finishReason");
      }
      if (invalidPaths.length > 0) {
        throw new DomainValidationError(invalidPaths);
      }
      return Object.freeze({
        type: "completed",
        finishReason: finishReason as FinishReason,
      });
    }
    default:
      throw new DomainValidationError(["type"]);
  }
}
