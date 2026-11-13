# tokenToll 🚦

> **Enterprise Multi-Tenant AI Gateway** with single-digit millisecond overhead, deep tenant isolation, RBAC, token accounting, and resilient routing.

Built with **Node.js**, **Fastify**, and **PostgreSQL**.

---

## 🎯 Overview

**tokenToll** is a high-performance AI gateway engineered for modern enterprises adopting Large Language Models (LLMs). It provides a drop-in OpenAI-compatible proxy interface to manage, meter, secure, and route AI workloads across multi-tenant organizations while guaranteeing millisecond-level routing overhead.

### Key Pillars

- ⚡ **Ultra-Low Latency Overhead**: Sub-5ms p95 gateway routing overhead powered by Fastify and `undici`.
- 🏢 **Multi-Tenant Isolation & RBAC**: Strict organizational hierarchy (Orgs, Teams, Members) with SSO/OIDC integration (Okta, Microsoft Entra ID).
- 🔑 **Virtual Key Vault**: Granular scoped virtual keys (`tt_...`) with automatic rate limits, model restrictions, and budget caps.
- 💰 **Exact Token Accounting**: Input, output, and cache token measurement across streaming (SSE) and non-streaming requests with real-time cost calculation.
- 🛡️ **Security Guardrails**: Pre-request PII detection/masking, prompt injection protection, and outbound credential scrubbing.
- 🔄 **Resilience & Fallback Chains**: Multi-provider failover routing (Azure OpenAI -> Anthropic -> Direct OpenAI) and circuit breaking.
- 🧠 **Semantic Caching**: Redis-backed exact hash and vector similarity caching to slash LLM costs and latency.
- 📊 **High-Concurrency PostgreSQL**: Asynchronous micro-batch telemetry persistence optimized for thousands of concurrent users.

---

## 📐 Architecture

tokenToll is partitioned into two operational planes:

1. **Management Plane (Control)**: Handles administrative REST APIs, SSO/Identity, RBAC, tenant configuration, virtual key generation, and budget quotas.
2. **Data Plane (Serving)**: High-performance Fastify serving engine executing drop-in OpenAI requests (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`), SSE streaming pass-through, semantic caching, and async telemetry dispatch.

---

## 📋 OpenSpec Documentation

This project follows the **OpenSpec** specification-driven development workflow.

Planning and architecture specifications are located in:
- `openspec/changes/tokentoll/`
  - [`proposal.md`](openspec/changes/tokentoll/proposal.md): Scope, problem statement, and capabilities
  - [`design.md`](openspec/changes/tokentoll/design.md): Technical architecture and architectural decisions
  - [`tasks.md`](openspec/changes/tokentoll/tasks.md): Implementation checklist across 6 phases
  - `specs/`: Capability specifications with testable behavioral scenarios

---

## 🚀 Phased Roadmap

- **Phase 1: Foundation & Security**: Centralized key management, virtual keys, OIDC auth, and tenant isolation.
- **Phase 2: Core Routing & Quotas**: Drop-in OpenAI proxy, zero-allocation SSE streaming, token accounting, and PostgreSQL telemetry.
- **Phase 3: Resilience & Caching**: Multi-provider fallback chains, circuit breaking, distributed rate limiting, and semantic caching.
- **Phase 4: Advanced Features & Guardrails**: Inbound PII redaction, prompt injection filtering, and output sanitization.
- **Phase 5: High-Concurrency Benchmarking**: Autocannon load testing and PostgreSQL connection pool optimization under high concurrency.
