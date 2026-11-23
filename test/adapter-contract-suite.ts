import { describe, expect, test } from "bun:test";
import type {
  ProviderAdapter,
  ProviderInvocation,
} from "../src/domain/provider-adapter.js";

export function adapterContractSuite(
  name: string,
  factory: (
    outcome: "success" | "provider_error" | "timeout",
    retryable: boolean,
  ) => ProviderAdapter,
  invocation: ProviderInvocation,
): void {
  describe(name, () => {
    test("normalizes success and freezes nested output", async () => {
      const adapter = factory("success", false);
      const response = await adapter.generate(invocation);
      expect(typeof response.content).toBe("string");
      expect(response.usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(Object.isFrozen(response)).toBe(true);
      expect(Object.isFrozen(response.usage)).toBe(true);
    });
    test.each(["success", "provider_error", "timeout"] as const)(
      "validates input before %s",
      async (outcome) => {
        await expect(
          factory(outcome, false).generate({
            ...invocation,
            request: { messages: [] },
          }),
        ).rejects.toMatchObject({
          category: "invalid_request",
          retryable: false,
        });
      },
    );
    test.each([true, false])(
      "classifies configured failures (%s)",
      async (retryable) => {
        for (const outcome of ["provider_error", "timeout"] as const) {
          try {
            await factory(outcome, retryable).generate(invocation);
            throw new Error("Expected failure");
          } catch (error) {
            expect(error).toMatchObject({
              category: outcome,
              retryable,
              message: "Safe failure",
            });
            expect(Object.keys(error as object).sort()).toEqual([
              "category",
              "name",
              "retryable",
            ]);
            expect(String(error)).not.toContain("hello");
          }
        }
      },
    );
  });
}
