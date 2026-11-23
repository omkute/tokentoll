# Design

## Context

See `proposal.md` for motivation and the delta specs for required behavior. The current implementation constructs one `ModelDeployment` and one `ProviderAdapter` in `createMockChat()`, passes both to `registerChatCompletions`, and invokes the adapter directly after request parsing. Deployment descriptors are strict, frozen objects with no enablement fact. The HTTP boundary already owns parsing, admission, deadlines, and streaming; eligibility must slot in before admission without moving any of those responsibilities.

## Goals / Non-Goals

**Goals:**

- Keep eligibility and selection pure, deterministic, and independent of HTTP, providers, and persistence.
- Make catalog and adapter-registry inconsistencies fail at startup rather than during a request.
- Let the HTTP boundary receive an already-resolved deployment and adapter, so it never reasons about catalog internals.
- Preserve every currently accepted request and response for the default process.

**Non-Goals:**

- Cost comparison, ranking, weighted scoring, or price tie-breaking; catalog order is the only preference.
- Retries, fallback, circuit breakers, health probes, readiness, or provider availability signals.
- Tenant/key policy, governance, credentials, or live providers.
- Exact tokenization, token accounting, or provider-specific tokenizers.

## Decisions

### Add a required `enabled` boolean to the deployment descriptor

The descriptor gains `enabled: boolean`, validated as a strict boolean and frozen with the rest of the object. An optional field defaulting to `true` was rejected because it hides operator intent and makes a disabled-by-omission deployment impossible to distinguish from an enabled one. The cost is a breaking constructor change; all call sites and fixtures must state enablement explicitly.

### Model the catalog as an ordered, validated list plus an adapter registry

`createDeploymentCatalog` accepts an ordered deployment list and a registry keyed by `adapterId`. It rejects an empty catalog, duplicate `deploymentId` values, and any `adapterId` that the registry cannot resolve. The catalog preserves input order because that order is the operator preference. A plain array plus explicit registry checks was preferred over a map keyed by deployment id, which would discard order, and over startup-time persistence, which is out of scope.

### Encapsulate selection behind a deployment router

A small `createDeploymentRouter({ catalog, adapters })` returns `select(requirements)` yielding `{ deployment, adapter } | undefined`. The HTTP boundary passes required capabilities and the context estimate; it does not inspect the catalog or adapter map. This keeps the selection policy swappable when cost-aware routing arrives and keeps provider wiring out of the HTTP module.

### Required capabilities include the adapter operation

Eligibility requires the deployment to declare `generation` always and `streaming` for SSE requests, and requires the registered adapter to expose the corresponding operation. Trusting the descriptor alone was rejected because a descriptor that declares streaming while its adapter has no `stream` method would pass selection and fail later as an internal error. The combined check fails closed before admission.

### Use a conservative byte-based context estimate

The context estimate is `sum(UTF-8 byte length of message content) + 4 × message count + (maxOutputTokens ?? 8192)`. For accepted text, a token encodes at least one byte, so content bytes are an upper bound on content tokens; the per-message allowance covers role and delimiter framing; and 8192 is the endpoint's maximum content bound in bytes and therefore a safe token allowance when no output limit is supplied. A real tokenizer was rejected for this slice because it adds a dependency and provider-specific assumptions, and skipping context checks was rejected because context fit is part of the approved slice. The estimate deliberately errs toward exclusion; exact accounting remains M7 work.

### Select the first eligible deployment in catalog order

Selection scans the catalog in order and returns the first eligible entry. Prices, provider identity, request content, randomness, and clocks do not affect the outcome. Cheapest-first was rejected because cost-aware routing is a separate approved slice; round-robin was rejected because it is non-deterministic and not requested. When cost ranking arrives, only the router implementation and its policy input should change.

### Evaluate eligibility before admission and map failure to `deployment_unavailable`

The handler order becomes: parse and resolve the model alias, compute requirements, select, then admission, then invoke. This ensures an ineligible configuration does not consume a permit and cannot be masked by `gateway_busy`. A new fixed `ProxyError` code maps to HTTP 503, type `server_error`, param `null`, and a fixed safe message. Reusing `model_not_found` was rejected because the model alias exists; reusing `upstream_unavailable` was rejected because no upstream call occurs.

### Keep `createApp` compatible while allowing injected catalogs

`createApp` keeps the existing `adapter` option as the `mock` adapter registration and adds an optional `deployments` list. The default remains the mock deployment and mock adapter. Tests can inject alternate deployment lists through the app and test the catalog/router modules directly for multi-adapter cases. A full multi-provider registry in `createApp` is deferred until live adapters exist.

### Preserve default behavior with explicit mock facts

The default mock deployment gains `enabled: true` and the `streaming` capability it already implements, and its context window rises to 131072 tokens. The maximum accepted request body is 65,536 bytes and the worst-case context estimate is 65,536 + framing + 8192, which fits 131072. This keeps every previously accepted request eligible and avoids turning the new check into a default-process regression.

## Risks / Trade-offs

- **Byte-based estimate over-reserves for non-Latin text and rejects some requests that would fit a real tokenizer** → Documented as conservative; boundaries are tested; revisit with exact accounting in M7.
- **Required `enabled` breaks every existing descriptor constructor and fixture** → Update all call sites in one task and run the full domain and HTTP suites.
- **Catalog order as preference is temporary and could be mistaken for routing policy** → Isolate selection behind the router interface and state catalog-order semantics in the spec.
- **Adding an error code without updating every error table or client expectation** → Update the proxy error map, spec classification table, and HTTP tests together.
- **Declaring `streaming` on the mock without checking adapter support would fail at request time** → The eligibility check validates both the declaration and the adapter operation, and a default streaming test covers the regression.

## Migration Plan

1. Extend the descriptor and update constructors and fixtures with explicit `enabled`.
2. Add catalog, eligibility estimate, and router modules with unit tests.
3. Add the `deployment_unavailable` proxy error and wire the router into the chat handler before admission.
4. Update the default mock facts and app wiring; keep existing tests passing.
5. Rollback is a code revert; there is no persisted state or schema migration.
