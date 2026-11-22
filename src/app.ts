import fastify, { type FastifyInstance } from "fastify";

export function createApp(): FastifyInstance {
  const app = fastify({ logger: false });

  app.get("/health", () => ({ status: "ok" as const }));

  return app;
}
