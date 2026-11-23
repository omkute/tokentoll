import { expect, test } from "bun:test";

import { NormalizedProviderError } from "../src/domain/provider-contracts.js";
import { normalizeProxyError, ProxyError } from "../src/http/proxy-errors.js";

const cases = [
  ["invalid_request", 400, "invalid_request_error", "Invalid request."],
  ["model_not_found", 404, "invalid_request_error", "Model not found."],
  [
    "request_too_large",
    413,
    "invalid_request_error",
    "Request body too large.",
  ],
  [
    "unsupported_media_type",
    415,
    "invalid_request_error",
    "Unsupported media type.",
  ],
  ["upstream_timeout", 504, "server_error", "Upstream request timed out."],
  [
    "upstream_rate_limited",
    429,
    "rate_limit_error",
    "Upstream rate limit exceeded.",
  ],
  ["upstream_unavailable", 503, "server_error", "Upstream unavailable."],
  ["upstream_error", 502, "server_error", "Upstream request failed."],
  [
    "invalid_provider_response",
    502,
    "server_error",
    "Invalid upstream response.",
  ],
  ["internal_error", 500, "server_error", "Internal server error."],
  ["gateway_busy", 503, "server_error", "Gateway is busy."],
] as const;

test.each(cases)("safe envelope for %s", (code, status, type, message) => {
  const error = new ProxyError(code);
  expect(error.statusCode).toBe(status);
  expect(error.body).toEqual({
    error: {
      message,
      type,
      param: code === "model_not_found" ? "model" : null,
      code,
    },
  });
  expect(normalizeProxyError(error)).toBe(error);
});

test.each([
  ["invalid_request", "invalid_request"],
  ["timeout", "upstream_timeout"],
  ["rate_limited", "upstream_rate_limited"],
  ["provider_unavailable", "upstream_unavailable"],
  ["provider_error", "upstream_error"],
] as const)("normalized category %s discards diagnostics", (category, code) => {
  for (const retryable of category === "invalid_request"
    ? [false]
    : [false, true]) {
    const error = NormalizedProviderError.create({
      category,
      retryable,
      message: "SECRET-PAYLOAD",
    });
    expect(normalizeProxyError(error).body).toEqual(new ProxyError(code).body);
    expect(JSON.stringify(normalizeProxyError(error).body)).not.toContain(
      "SECRET-PAYLOAD",
    );
  }
});

test.each([
  new Error("SECRET-PAYLOAD"),
  "SECRET-PAYLOAD",
  null,
  undefined,
  { code: "timeout", message: "SECRET-PAYLOAD" },
])("unknown failures produce a fixed internal error", (error) =>
  expect(normalizeProxyError(error).body).toEqual(
    new ProxyError("internal_error").body,
  ),
);
