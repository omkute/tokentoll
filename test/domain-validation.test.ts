import { expect, test } from "bun:test";

import { DomainValidationError } from "../src/domain/validation.js";

test("reports one invalid field path", () => {
  const error = new DomainValidationError(["messages"]);

  expect(error.name).toBe("DomainValidationError");
  expect(error.message).toBe("Invalid domain value: messages");
  expect(error.invalidPaths).toEqual(["messages"]);
  expect(Object.isFrozen(error.invalidPaths)).toBe(true);
});

test("reports multiple unique invalid paths in discovery order", () => {
  const error = new DomainValidationError([
    "messages[0].role",
    "maxOutputTokens",
    "messages[0].role",
  ]);

  expect(error.invalidPaths).toEqual(["messages[0].role", "maxOutputTokens"]);
  expect(error.message).toBe(
    "Invalid domain value: messages[0].role, maxOutputTokens",
  );
});

test("diagnostics do not contain submitted keys or values", () => {
  const secretKey = "AUTHORIZATION";
  const secretValue = "Bearer do-not-disclose";
  const error = new DomainValidationError(["messages[0].content"]);

  expect(error.message).not.toContain(secretKey);
  expect(error.message).not.toContain(secretValue);
  expect(JSON.stringify(error.invalidPaths)).not.toContain(secretValue);
});

test("rejects an empty invalid-path list", () => {
  expect(() => new DomainValidationError([])).toThrow(
    "Domain validation requires at least one invalid path",
  );
});
