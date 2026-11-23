export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly shutdownGraceMs: number;
  readonly requestTimeoutMs: number;
}

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const PORT_MIN = 1;
const PORT_MAX = 65_535;
const SHUTDOWN_GRACE_MS_MIN = 1;
const SHUTDOWN_GRACE_MS_MAX = 60_000;
const REQUEST_TIMEOUT_MS_MIN = 1;
const REQUEST_TIMEOUT_MS_MAX = 300_000;

export type RuntimeConfigVariable =
  "HOST" | "PORT" | "SHUTDOWN_GRACE_MS" | "REQUEST_TIMEOUT_MS";

export class RuntimeConfigError extends Error {
  readonly invalidVariables: readonly RuntimeConfigVariable[];

  constructor(invalidVariables: readonly RuntimeConfigVariable[]) {
    super(`Invalid runtime configuration: ${invalidVariables.join(", ")}`);
    this.name = "RuntimeConfigError";
    this.invalidVariables = Object.freeze([...invalidVariables]);
  }
}

function parseInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

export function loadRuntimeConfig(
  environment: RuntimeEnvironment = process.env,
): RuntimeConfig {
  const invalidVariables: RuntimeConfigVariable[] = [];

  const configuredHost = environment.HOST;
  const host =
    configuredHost === undefined ? DEFAULT_HOST : configuredHost.trim();
  if (host.length === 0) {
    invalidVariables.push("HOST");
  }

  const configuredPort = environment.PORT;
  const port =
    configuredPort === undefined
      ? DEFAULT_PORT
      : parseInteger(configuredPort, PORT_MIN, PORT_MAX);
  if (port === undefined) {
    invalidVariables.push("PORT");
  }

  const configuredShutdownGraceMs = environment.SHUTDOWN_GRACE_MS;
  const shutdownGraceMs =
    configuredShutdownGraceMs === undefined
      ? DEFAULT_SHUTDOWN_GRACE_MS
      : parseInteger(
          configuredShutdownGraceMs,
          SHUTDOWN_GRACE_MS_MIN,
          SHUTDOWN_GRACE_MS_MAX,
        );
  if (shutdownGraceMs === undefined) {
    invalidVariables.push("SHUTDOWN_GRACE_MS");
  }

  const configuredRequestTimeoutMs = environment.REQUEST_TIMEOUT_MS;
  const requestTimeoutMs =
    configuredRequestTimeoutMs === undefined
      ? DEFAULT_REQUEST_TIMEOUT_MS
      : parseInteger(
          configuredRequestTimeoutMs,
          REQUEST_TIMEOUT_MS_MIN,
          REQUEST_TIMEOUT_MS_MAX,
        );
  if (requestTimeoutMs === undefined) {
    invalidVariables.push("REQUEST_TIMEOUT_MS");
  }

  if (invalidVariables.length > 0) {
    throw new RuntimeConfigError(invalidVariables);
  }

  if (
    port === undefined ||
    shutdownGraceMs === undefined ||
    requestTimeoutMs === undefined
  ) {
    throw new Error("Runtime configuration validation invariant violated");
  }

  return Object.freeze({
    host,
    port,
    shutdownGraceMs,
    requestTimeoutMs,
  });
}
