import { pathToFileURL } from "node:url";

import { createApp } from "./app.js";
import {
  loadRuntimeConfig,
  RuntimeConfigError,
  type RuntimeEnvironment,
} from "./config.js";

type ScheduleTimeout = (callback: () => void, delayMs: number) => unknown;
type CancelTimeout = (handle: unknown) => void;

export interface ShutdownOptions {
  readonly close: () => Promise<void>;
  readonly graceMs: number;
  readonly scheduleTimeout?: ScheduleTimeout;
  readonly cancelTimeout?: CancelTimeout;
}

export class ShutdownTimeoutError extends Error {
  constructor() {
    super("Graceful shutdown timed out");
    this.name = "ShutdownTimeoutError";
  }
}

export function createShutdownHandler({
  close,
  graceMs,
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ShutdownOptions): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    shutdownPromise ??= closeWithinGracePeriod();
    return shutdownPromise;
  };

  async function closeWithinGracePeriod(): Promise<void> {
    let timeoutHandle: unknown;
    let timeoutScheduled = false;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = scheduleTimeout(() => {
        reject(new ShutdownTimeoutError());
      }, graceMs);
      timeoutScheduled = true;
    });

    try {
      await Promise.race([Promise.resolve().then(close), timeoutPromise]);
    } finally {
      if (timeoutScheduled) {
        cancelTimeout(timeoutHandle);
      }
    }
  }
}

export function createSignalHandler(
  shutdown: () => Promise<void>,
  onSuccess: () => void,
  onFailure: () => void,
): () => void {
  let signalReceived = false;

  return () => {
    if (signalReceived) {
      return;
    }
    signalReceived = true;
    void shutdown().then(onSuccess, onFailure);
  };
}

function installSignalHandlers(
  close: () => Promise<void>,
  graceMs: number,
): void {
  const shutdown = createShutdownHandler({ close, graceMs });

  const removeSignalHandlers = (): void => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  };

  const handleSignal = createSignalHandler(
    shutdown,
    () => {
      removeSignalHandlers();
      process.exitCode = 0;
    },
    () => {
      removeSignalHandlers();
      console.error("Service shutdown failed");
      process.exit(1);
    },
  );

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
}

export async function startServer(
  environment: RuntimeEnvironment = process.env,
): Promise<void> {
  const config = loadRuntimeConfig(environment);
  const app = createApp();

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    });
    installSignalHandlers(() => app.close(), config.shutdownGraceMs);
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    await startServer();
  } catch (error) {
    if (error instanceof RuntimeConfigError) {
      console.error(error.message);
    } else {
      console.error("Service startup failed");
    }

    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void main();
}
