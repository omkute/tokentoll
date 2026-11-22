import { expect, test } from "bun:test";

import {
  createShutdownHandler,
  createSignalHandler,
  ShutdownTimeoutError,
} from "../src/server.js";

function createTimerHarness(): {
  readonly scheduleTimeout: (callback: () => void) => object;
  readonly cancelTimeout: (handle: unknown) => void;
  readonly fire: () => void;
  readonly cancelledHandles: () => readonly unknown[];
} {
  const handle = {};
  const cancelled: unknown[] = [];
  let callback: (() => void) | undefined;

  return {
    scheduleTimeout: (scheduledCallback) => {
      callback = scheduledCallback;
      return handle;
    },
    cancelTimeout: (cancelledHandle) => {
      cancelled.push(cancelledHandle);
    },
    fire: () => {
      if (callback === undefined) {
        throw new Error("Timer has not been scheduled");
      }
      callback();
    },
    cancelledHandles: () => cancelled,
  };
}

test("successful shutdown closes once and clears its timer", async () => {
  const timer = createTimerHarness();
  let closeCalls = 0;
  const shutdown = createShutdownHandler({
    close: () => {
      closeCalls += 1;
      return Promise.resolve();
    },
    graceMs: 100,
    ...timer,
  });

  await shutdown();

  expect(closeCalls).toBe(1);
  expect(timer.cancelledHandles()).toHaveLength(1);
});

test("duplicate shutdown requests share one closure", async () => {
  const timer = createTimerHarness();
  let closeCalls = 0;
  let resolveClose: (() => void) | undefined;
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const shutdown = createShutdownHandler({
    close: () => {
      closeCalls += 1;
      return closePromise;
    },
    graceMs: 100,
    ...timer,
  });

  const first = shutdown();
  const second = shutdown();

  expect(second).toBe(first);
  resolveClose?.();
  await first;
  expect(closeCalls).toBe(1);
  expect(timer.cancelledHandles()).toHaveLength(1);
});

test("duplicate signals start only one shutdown", async () => {
  let shutdownCalls = 0;
  let completeShutdown: (() => void) | undefined;
  const shutdownFinished = new Promise<void>((resolve) => {
    completeShutdown = resolve;
  });
  let successCalls = 0;
  let finishSuccess: (() => void) | undefined;
  const successFinished = new Promise<void>((resolve) => {
    finishSuccess = resolve;
  });
  const handleSignal = createSignalHandler(
    () => {
      shutdownCalls += 1;
      return shutdownFinished;
    },
    () => {
      successCalls += 1;
      finishSuccess?.();
    },
    () => {
      throw new Error("Expected shutdown to succeed");
    },
  );

  handleSignal();
  handleSignal();
  expect(shutdownCalls).toBe(1);

  completeShutdown?.();
  await successFinished;
  expect(successCalls).toBe(1);
});

test("closure failure is propagated and clears its timer", async () => {
  const timer = createTimerHarness();
  const failure = new Error("close failed");
  const shutdown = createShutdownHandler({
    close: () => Promise.reject(failure),
    graceMs: 100,
    ...timer,
  });

  await expect(shutdown()).rejects.toBe(failure);
  expect(timer.cancelledHandles()).toHaveLength(1);
});

test("shutdown timeout is propagated and clears its timer", async () => {
  const timer = createTimerHarness();
  const shutdown = createShutdownHandler({
    close: () => new Promise<void>(() => undefined),
    graceMs: 100,
    ...timer,
  });

  const result = shutdown();
  await Promise.resolve();
  timer.fire();

  let failure: unknown;
  try {
    await result;
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(ShutdownTimeoutError);
  expect(timer.cancelledHandles()).toHaveLength(1);
});
