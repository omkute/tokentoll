// Test-only composition of the built gateway with a streaming adapter that
// parks mid-stream until an abort, or floods one-byte content deltas for the
// backpressure matrix. The production entrypoint cannot express these
// adapters, and the production modules stay free of test hooks.
import process from "node:process";
import { createApp } from "../../dist/app.js";
import {
  createGenerationResponse,
  createStreamEvent,
} from "../../dist/domain/provider-contracts.js";
import {
  createShutdownHandler,
  createSignalHandler,
} from "../../dist/server.js";

// Counters exposed only through the test-only GET /test/state route:
// `pulls` counts every adapter event the gateway pulled, `aborts` every
// observed cancellation signal, `active` the running adapter streams, and
// `probes` the await-abort probes currently parked in the state route.
let pulls = 0;
let aborts = 0;
let active = 0;
let probes = 0;

// Resolves once the fixture observes its first cancellation. The
// await-abort state probe parks on it, so a test can read the
// post-abort counters even while the gateway is shutting down and its
// routes no longer accept new work.
let markFirstAbort = () => {};
const firstAbort = new Promise((resolve) => {
  markFirstAbort = resolve;
});

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };

// One-byte content deltas totaling exactly the 8192-byte streamed bound.
const BACKPRESSURE_DELTAS = 8192;

/** Resolves once the invocation signal aborts, counting the observation. */
function waitForAbort(signal) {
  return new Promise((resolve) => {
    if (signal === undefined) {
      resolve();
      return;
    }
    if (signal.aborted) {
      aborts++;
      resolve();
      // Released only after the caller's park above: the parked stream
      // settles (and releases its entry) before any await-abort probe
      // reports the counters.
      markFirstAbort();
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        aborts++;
        resolve();
        markFirstAbort();
      },
      { once: true },
    );
  });
}

const adapter = {
  async generate() {
    return createGenerationResponse({
      content: "Mock response.",
      finishReason: "stop",
      usage,
    });
  },
  async *stream(invocation) {
    active++;
    try {
      const precommit = invocation.request.messages.some(
        (message) => message.role === "user" && message.content === "precommit",
      );
      if (precommit) {
        // Parks before its first yield: no pull is counted and no event is
        // produced, so the gateway holds a stream that was admitted but
        // never committed. Only the shutdown abort can settle it.
        await waitForAbort(invocation.signal);
        return;
      }
      const backpressure = invocation.request.messages.some(
        (message) =>
          message.role === "user" && message.content === "backpressure",
      );
      if (backpressure) {
        // Yields 8192 one-byte deltas, then usage and completion: 8194
        // events total, with no timers or sleeps between them. The pulls
        // counter advances once per pulled event, so a gateway that stops
        // pulling under backpressure stalls well below the total.
        const delta = createStreamEvent({ type: "content_delta", delta: "a" });
        for (let i = 0; i < BACKPRESSURE_DELTAS; i++) {
          pulls++;
          yield delta;
        }
        pulls++;
        yield createStreamEvent({ type: "usage", usage });
        pulls++;
        yield createStreamEvent({ type: "completed", finishReason: "stop" });
        return;
      }
      pulls++;
      yield createStreamEvent({ type: "content_delta", delta: "Partial" });
      await waitForAbort(invocation.signal);
      // Ends without completion: shutdown must end the stream instead.
    } finally {
      active--;
    }
  },
};

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const graceMs = Number(process.env.SHUTDOWN_GRACE_MS ?? 10_000);

const app = createApp({ adapter });

// Test-only counter route for the streaming matrix. It never exists in the
// production modules and answers independently of any paused stream. With
// `?awaitAbort=1` the response parks until the fixture has observed an
// abort, so a probe dispatched before shutdown reports the post-abort
// counters once the gateway's routes no longer accept new requests. The
// parked-probe count lets a test wait for the probe to be dispatched
// before it sends the shutdown signal.
app.get("/test/state", async (request) => {
  if (request.query.awaitAbort === "1") {
    probes++;
    try {
      await firstAbort;
    } finally {
      probes--;
    }
  }
  return { pulls, aborts, active, probes };
});

try {
  await app.listen({ host, port });
} catch {
  process.exit(1);
}

const shutdown = createShutdownHandler({
  close: () => app.close(),
  graceMs,
});

const handleSignal = createSignalHandler(
  shutdown,
  () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    process.exitCode = 0;
  },
  () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    process.exit(1);
  },
);

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);
