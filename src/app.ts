import fastify, { type FastifyInstance } from "fastify";
import type { ProviderAdapter } from "./domain/provider-adapter.js";
import { registerChatCompletions } from "./http/chat-completions.js";
import { createMockChat } from "./mock-chat.js";

export function createApp(
  options: { readonly adapter?: ProviderAdapter } = {},
): FastifyInstance {
  const app = fastify({ logger: false });
  const mock = createMockChat();

  app.get("/health", () => ({ status: "ok" as const }));
  registerChatCompletions(
    app,
    options.adapter ?? mock.adapter,
    mock.deployment,
  );

  return app;
}
