import fastify, { type FastifyInstance } from "fastify";
import { createDeploymentCatalog } from "./domain/deployment-catalog.js";
import { createDeploymentRouter } from "./domain/deployment-eligibility.js";
import type { ModelDeployment } from "./domain/model-deployment.js";
import type { ProviderAdapter } from "./domain/provider-adapter.js";
import { registerChatCompletions } from "./http/chat-completions.js";
import { createMockChat } from "./mock-chat.js";

export function createApp(
  options: {
    readonly adapter?: ProviderAdapter;
    readonly deployments?: readonly ModelDeployment[];
    readonly requestTimeoutMs?: number;
  } = {},
): FastifyInstance {
  const app = fastify({ logger: false });
  const mock = createMockChat();
  const router = createDeploymentRouter(
    createDeploymentCatalog({
      deployments: options.deployments ?? [mock.deployment],
      adapters: new Map([["mock", options.adapter ?? mock.adapter]]),
    }),
  );

  app.get("/health", () => ({ status: "ok" as const }));
  registerChatCompletions(app, router, options.requestTimeoutMs);

  return app;
}
