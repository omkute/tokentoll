# Tasks

## 1. Deployment enablement fact

- [x] 1.1 Add a required boolean `enabled` field to the model-deployment descriptor, validate it strictly, and include it in the frozen result; verify `bun test test/model-deployment.test.ts` covers missing, non-boolean, true, and false values.
- [x] 1.2 Update every deployment constructor and fixture to state `enabled` explicitly; verify `bun run typecheck` and the domain, mock-provider, and adapter test files pass.

## 2. Catalog and eligibility

- [x] 2.1 Add the conservative context-estimate helper described in `design.md` and verify unit tests cover the exact boundary, one-unit overflow, multi-byte content, message framing, and the omitted-output-limit reservation.
- [x] 2.2 Add catalog construction that preserves order and rejects an empty list, duplicate deployment identifiers, and unresolved adapter identifiers; verify each rejection and the valid ordering case with unit tests.
- [x] 2.3 Add the deployment router with capability, streaming-operation, enablement, context, and catalog-order checks; verify tests prove first-eligible selection, skipped ineligible entries, streaming-capability rejection, adapter-without-stream rejection, and the no-eligible result.

## 3. HTTP eligibility integration

- [x] 3.1 Add the `deployment_unavailable` proxy error with HTTP 503, type `server_error`, fixed safe message, and `param: null`; verify its exact envelope and the existing error-map tests still pass.
- [x] 3.2 Wire eligibility before admission into the chat handler, use the selected deployment and adapter for both JSON and SSE paths, and verify HTTP tests cover known-model 503, no adapter invocation, streaming capability failure, unknown-model 404 precedence, and `deployment_unavailable` while all 64 permits are held.

## 4. Default configuration and documentation

- [x] 4.1 Update the mock deployment to `enabled: true`, declare `generation` and `streaming`, and raise its context window enough for every previously accepted request; verify default non-streaming, streaming, and usage HTTP suites remain green.
- [x] 4.2 Extend `createApp` with an optional deployment list while keeping the existing adapter option and default behavior; verify injection tests show a disabled first entry is skipped for an enabled later entry.
- [x] 4.3 Document catalog order, eligibility facts, the conservative context estimate, and the 503 outcome in `README.md`; verify the documented behavior matches the implemented routes and error envelope.

## 5. Integration verification

- [x] 5.1 Run `bun run check` and `openspec validate deployment-eligibility --strict`; report exact results for formatting, linting, type checking, tests, build, and validation.
- [x] 5.2 Review the implementation for sensitive logging, secret exposure, admission accounting, timer and listener lifecycle, and startup failure paths; record findings and any follow-ups.

## Workflow follow-up

- Archive the change after implementation, review, and verification are approved.
- Start the cost-aware routing change only after this slice is archived.
