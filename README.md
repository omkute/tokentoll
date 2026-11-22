# tokenToll

tokenToll is a provider-neutral AI gateway under incremental development. The
current foundation change is limited to a Node.js, TypeScript, and Fastify
service with environment configuration, liveness, process lifecycle, and
quality checks.

## Runtime configuration

The service reads these variables before opening its HTTP listener:

| Variable            | Default   | Valid values                                  |
| ------------------- | --------- | --------------------------------------------- |
| `HOST`              | `0.0.0.0` | A non-empty string after whitespace trimming  |
| `PORT`              | `3000`    | A decimal integer from `1` through `65535`    |
| `SHUTDOWN_GRACE_MS` | `10000`   | A decimal integer from `1` through `60000` ms |

Surrounding whitespace is trimmed from configured values. Invalid variables
cause configuration loading to fail before the service listens.

The default host binds on all network interfaces for deployable environments.
For a local-only listener, set:

```sh
HOST=127.0.0.1
```

## Health endpoint

`GET /health` is an unauthenticated process-liveness probe. While the service is
live and accepting requests, it returns HTTP 200 with a JSON content type and
this exact body:

```json
{ "status": "ok" }
```

The endpoint does not report readiness or the state of databases, providers,
caches, telemetry, or other downstream dependencies.

## Build and run

Install the locked dependencies and compile the production artifact:

```sh
bun install --frozen-lockfile
bun run build
```

Start the compiled Node.js service from `dist/server.js` through the package
script:

```sh
bun run start
```

Send `SIGINT` or `SIGTERM` to shut down. The process stops accepting new
connections, waits for active requests while Fastify closes, and exits with
status 0 when closure finishes within `SHUTDOWN_GRACE_MS`.

Invalid configuration and listener startup failures exit non-zero without
opening the service. A closure error or grace-period timeout also reports a
generic shutdown failure and exits non-zero.
