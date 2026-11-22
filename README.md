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
