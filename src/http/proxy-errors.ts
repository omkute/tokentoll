import { NormalizedProviderError } from "../domain/provider-contracts.js";

const ERRORS = {
  invalid_request: [400, "invalid_request_error", "Invalid request."],
  model_not_found: [404, "invalid_request_error", "Model not found."],
  request_too_large: [413, "invalid_request_error", "Request body too large."],
  unsupported_media_type: [
    415,
    "invalid_request_error",
    "Unsupported media type.",
  ],
  upstream_timeout: [504, "server_error", "Upstream request timed out."],
  upstream_rate_limited: [
    429,
    "rate_limit_error",
    "Upstream rate limit exceeded.",
  ],
  upstream_unavailable: [503, "server_error", "Upstream unavailable."],
  upstream_error: [502, "server_error", "Upstream request failed."],
  invalid_provider_response: [
    502,
    "server_error",
    "Invalid upstream response.",
  ],
  internal_error: [500, "server_error", "Internal server error."],
  gateway_busy: [503, "server_error", "Gateway is busy."],
} as const;

export type ProxyErrorCode = keyof typeof ERRORS;

export class ProxyError extends Error {
  readonly statusCode: number;
  readonly body;

  constructor(code: ProxyErrorCode) {
    const [statusCode, type, message] = ERRORS[code];
    super(message);
    this.name = "ProxyError";
    this.statusCode = statusCode;
    this.body = Object.freeze({
      error: Object.freeze({
        message,
        type,
        param: code === "model_not_found" ? "model" : null,
        code,
      }),
    });
  }
}

export function normalizeProxyError(error: unknown): ProxyError {
  if (error instanceof ProxyError) return error;
  if (error instanceof NormalizedProviderError) {
    const codes = {
      invalid_request: "invalid_request",
      timeout: "upstream_timeout",
      rate_limited: "upstream_rate_limited",
      provider_unavailable: "upstream_unavailable",
      provider_error: "upstream_error",
    } as const;
    return new ProxyError(codes[error.category]);
  }
  return new ProxyError("internal_error");
}
