import { expect, test } from "bun:test";

import { createApp } from "../src/app.js";

test("GET /health returns the exact liveness response", async () => {
  const app = createApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(
      /^application\/json(?:;|$)/,
    );
    expect(response.json()).toEqual({ status: "ok" });
  } finally {
    await app.close();
  }
});

test("GET /health reports liveness without dependency readiness", async () => {
  const app = createApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    const body: unknown = response.json();

    expect(body).toEqual({ status: "ok" });
    expect(Object.keys(body as Record<string, unknown>)).toEqual(["status"]);
  } finally {
    await app.close();
  }
});
