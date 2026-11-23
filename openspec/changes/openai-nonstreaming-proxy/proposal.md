# Proposal

## Why

M2 provides validated neutral contracts and deterministic mock adapters, but clients cannot yet exercise them through HTTP. M3 adds the first end-to-end proxy slice with an explicitly limited OpenAI-compatible surface, proving the boundary before streaming or live integrations.

## What Changes

- Expose `POST /v1/chat/completions` for one fixed mock model, `mock-chat`.
- Accept required `model` and text-only `messages` with `system`, `user`, or `assistant` roles; accept optional `max_completion_tokens` and `stream: false` only. Reject unsupported fields without coercion or silent removal.
- Translate the wire format into existing neutral values, invoke the existing adapter once, and translate validated output into one completion with usage.
- Define stable OpenAI-shaped errors, explicit request/response byte limits, and a small per-process admission bound without queues or retry policy.
- Add offline compatibility fixtures and boundary tests, preserve health and process lifecycle behavior, and keep sensitive material out of responses to errors and logs.
- Exclude tools, multimodal input, sampling controls, SSE, live providers, multi-deployment routing, authentication, quotas, caching, billing, persistence, and benchmarks.

## Capabilities

### New Capabilities

- `openai-chat-completions`: The supported non-streaming HTTP schema, neutral translation, fixed mock composition, safe errors, finite resource bounds, and compatibility evidence.

### Modified Capabilities

None. Existing M1/M2 contracts and behavior remain unchanged. `openspec list --specs` currently reports no main specs; completed foundation and provider-neutral-contracts change artifacts and their implementation supply the predecessor context.

## Impact

Add an HTTP boundary under `src/http/`, a fixed mock composition module, and tests/fixtures; extend `src/app.ts` composition while retaining the no-argument production entry point. Reuse Fastify, Node.js, TypeScript, and Bun without new dependencies or environment variables. This slice addresses FR-005 and applicable FR-001, SEC-001, ARC-001, ARC-003, NFR-001, NFR-003, NFR-004, TEST-001, and TEST-002; it makes no throughput or latency claim. Planning artifacts require review before implementation.
