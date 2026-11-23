import { expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, createServer as createTcpServer } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { ProxyError } from "../src/http/proxy-errors.js";

// Real-HTTP streaming matrix against the built fixture. The two cases here
// close the gaps the in-process suites cannot reach: Bun's test runtime
// never reports a disconnect for a request that had a body, and its fake
// ServerResponse cannot exercise kernel-level write backpressure. Both
// scenarios run against a real Node child serving the built gateway.

const streamingServerFixture = fileURLToPath(
  new URL("./fixtures/built-streaming-server.mjs", import.meta.url),
);

// The backpressure fixture mode yields 8192 one-byte content deltas, one
// usage event, and one completion: exactly 8194 adapter pulls when the
// whole stream is consumed.
const BACKPRESSURE_EVENTS = 8_194;
const BACKPRESSURE_CONTENT_DELTAS = 8_192;

// The plateau depth is OS-dependent: the kernel socket buffers plus the
// Node write buffer absorb roughly half of the ~1.6 MB response before
// write() blocks (observed: 4042 of 8194). A plateau at least 2048 events
// below the total proves the writer stopped pulling instead of buffering
// the whole stream in memory.
const WELL_BELOW_MARGIN = 2_048;

const PARTIAL_MARKER = '"content":"Partial"';

/** Raw last-chunk bytes that end every chunked response body. */
const CHUNKED_END = "0\r\n\r\n";

const defaultStreamRequest = {
  model: "mock-chat",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
} as const;

interface WireChunk {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: { readonly content?: string };
    readonly finish_reason: string | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
    readonly prompt_tokens_details: { readonly cached_tokens: number };
  };
}

interface ExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ProductionChild {
  readonly process: ChildProcessWithoutNullStreams;
  readonly exit: Promise<ExitResult>;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

async function unusedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

function spawnStreamingServer(port: number): ProductionChild {
  const child = spawn("node", [streamingServerFixture], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SHUTDOWN_GRACE_MS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exit = new Promise<ExitResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  return {
    process: child,
    exit,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function waitForHealth(
  port: number,
  child: ProductionChild,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (child.process.exitCode !== null || child.process.signalCode !== null) {
      throw new Error(`Server exited before health check: ${child.stderr()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(250),
      });
      if (response.ok && (await response.text()) === '{"status":"ok"}') {
        return;
      }
    } catch {
      // The listener may not be ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Server did not become healthy before the deadline");
}

async function assertListenerClosed(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(500),
    });
    throw new Error("Listener still accepted a request after shutdown");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Listener still accepted a request after shutdown"
    ) {
      throw error;
    }
  }
}

async function forceCleanup(child: ProductionChild): Promise<void> {
  if (child.process.exitCode === null && child.process.signalCode === null) {
    child.process.kill("SIGKILL");
  }

  await withTimeout(child.exit, 1_000, "Child cleanup did not finish");
}

/**
 * Runs one matrix scenario against a fresh built fixture: a bounded health
 * wait, a process-level unhandledRejection collector around the scenario,
 * and SIGKILL cleanup that also covers assertion failures. The collector
 * assertion runs after the child is gone so late rejections still land.
 */
async function withStreamingMatrixServer(
  run: (port: number, child: ProductionChild) => Promise<void>,
): Promise<void> {
  const port = await unusedPort();
  const child = spawnStreamingServer(port);
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);

  try {
    await waitForHealth(port, child);
    await run(port, child);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await forceCleanup(child);
  }
  expect(unhandled).toEqual([]);
}

interface FixtureState {
  readonly pulls: number;
  readonly aborts: number;
  readonly active: number;
  readonly probes: number;
}

async function fetchState(port: number): Promise<FixtureState> {
  const response = await fetch(`http://127.0.0.1:${port}/test/state`, {
    signal: AbortSignal.timeout(500),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as FixtureState;
}

/** Polls /test/state until the predicate holds, with a bounded deadline. */
async function pollState(
  port: number,
  settled: (state: FixtureState) => boolean,
  timeoutMs: number,
  message: string,
): Promise<FixtureState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await fetchState(port);
    if (settled(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(`${message} (last: ${JSON.stringify(state)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Samples /test/state until `pulls` stops moving. Three equal nonzero
 * samples spaced by the poll interval mean the gateway stopped pulling
 * from the adapter while the consumer refuses to read.
 */
async function pollForPlateau(port: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  let last = -1;
  let stable = 0;

  for (;;) {
    const { pulls } = await fetchState(port);
    if (pulls === last && pulls > 0) {
      stable++;
      if (stable >= 3) return pulls;
    } else {
      stable = 0;
    }
    last = pulls;
    if (Date.now() > deadline) {
      throw new Error(`pulls never plateaued (last: ${last})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Writes one request as a hand-framed chunked body on a raw socket. */
function writeChunkedRequest(socket: Socket, payload: unknown): void {
  const body = JSON.stringify(payload);
  socket.write(
    "POST /v1/chat/completions HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Content-Type: application/json\r\n" +
      "Connection: close\r\n" +
      "Transfer-Encoding: chunked\r\n\r\n",
  );
  const size = Buffer.byteLength(body, "utf8").toString(16);
  socket.write(`${size}\r\n${body}\r\n0\r\n\r\n`);
}

/** Decodes a `Transfer-Encoding: chunked` body captured from a raw socket. */
function decodeChunked(raw: string): string {
  let body = "";
  let rest = raw;
  for (;;) {
    const lineEnd = rest.indexOf("\r\n");
    if (lineEnd < 0) return body;
    const size = Number.parseInt(rest.slice(0, lineEnd), 16);
    if (Number.isNaN(size) || size < 0) return body;
    if (size === 0) return body;
    rest = rest.slice(lineEnd + 2);
    if (rest.length < size + 2) return body; // truncated capture
    body += rest.slice(0, size);
    rest = rest.slice(size + 2);
  }
}

function parseFrames(body: string): string[] {
  return body
    .split("\n\n")
    .filter((frame) => frame.length > 0)
    .map((frame) => frame.slice("data: ".length));
}

/**
 * A flowing raw-socket stream against the fixture's default parked mode.
 * `partial` resolves once the "Partial" frame arrives; `received()` exposes
 * everything the client captured before its socket was destroyed.
 */
interface ParkedStream {
  readonly partial: Promise<void>;
  destroy(): void;
  received(): string;
}

function openParkedStream(port: number): ParkedStream {
  let parked = "";
  let markPartial: () => void = () => {};
  const partial = new Promise<void>((resolve) => {
    markPartial = resolve;
  });
  const socket = connect(port, "127.0.0.1", () => {
    writeChunkedRequest(socket, defaultStreamRequest);
  });
  socket.on("data", (data: Buffer) => {
    parked += data.toString("utf8");
    if (parked.includes(PARTIAL_MARKER)) markPartial();
  });
  socket.on("error", () => {});
  return {
    partial,
    destroy() {
      socket.destroy();
    },
    received: () => parked,
  };
}

/**
 * A raw pre-commit stream request: the adapter parks before its first
 * yield, so no frame ever arrives incrementally and `closed` resolves with
 * everything the server answered once the connection ends.
 */
interface PrecommitStream {
  readonly closed: Promise<string>;
  destroy(): void;
}

function openPrecommitStream(port: number): PrecommitStream {
  let received = "";
  let markClosed: (raw: string) => void = () => {};
  const closed = new Promise<string>((resolve) => {
    markClosed = resolve;
  });
  const socket = connect(port, "127.0.0.1", () => {
    writeChunkedRequest(socket, {
      model: "mock-chat",
      messages: [{ role: "user", content: "precommit" }],
      stream: true,
    });
  });
  socket.on("data", (data: Buffer) => {
    received += data.toString("utf8");
    if (received.includes(CHUNKED_END)) markClosed(received);
  });
  socket.on("error", () => {});
  socket.on("close", () => markClosed(received));
  return {
    closed,
    destroy() {
      socket.destroy();
    },
  };
}

test("a paused consumer stalls the writer well before the stream ends, then drains the exact bounded content", async () => {
  await withStreamingMatrixServer(async (port, child) => {
    // No 'data' listener exists until resumeReading(), so the client never
    // reads: the kernel window closes and the server-side writer must stop
    // pulling adapter events instead of buffering the whole stream.
    let received = "";
    let markOpen: (raw: string) => void = () => {};
    const socket = connect(port, "127.0.0.1", () => {
      writeChunkedRequest(socket, {
        model: "mock-chat",
        messages: [{ role: "user", content: "backpressure" }],
        stream: true,
        stream_options: { include_usage: true },
      });
      socket.pause();
    });
    const drained = new Promise<string>((resolve) => {
      markOpen = resolve;
    });
    socket.on("error", () => {});

    try {
      const plateau = await pollForPlateau(port);
      expect(plateau).toBeGreaterThan(0);
      expect(plateau).toBeLessThan(BACKPRESSURE_EVENTS - WELL_BELOW_MARGIN);

      // The control plane stays independent while the data plane stalls.
      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      expect(health.status).toBe(200);
      expect(await health.text()).toBe('{"status":"ok"}');

      socket.on("data", (data: Buffer) => {
        received += data.toString("utf8");
        if (received.includes(CHUNKED_END)) markOpen(received);
      });
      socket.once("close", () => markOpen(received));
      socket.resume();
      const raw = await withTimeout(
        drained,
        10_000,
        "Paused stream did not drain after resuming reads",
      );

      // The full response: 8192 content frames, finish, usage, [DONE].
      const separator = raw.indexOf("\r\n\r\n");
      expect(separator).toBeGreaterThanOrEqual(0);
      const statusLine = raw.slice(0, separator).split("\r\n", 1)[0] ?? "";
      expect(Number.parseInt(statusLine.split(" ")[1] ?? "0", 10)).toBe(200);

      const body = decodeChunked(raw.slice(separator + 4));
      expect(body).not.toContain('"error"');
      expect(body).not.toContain("backpressure");
      const frames = parseFrames(body);
      expect(frames).toHaveLength(BACKPRESSURE_EVENTS + 1);
      expect(frames.at(-1)).toBe("[DONE]");

      const chunks = frames
        .slice(0, -1)
        .map((frame) => JSON.parse(frame) as WireChunk);
      const content = chunks.slice(0, BACKPRESSURE_CONTENT_DELTAS);
      expect(
        content.every(
          (chunk) =>
            chunk.choices[0]?.delta.content === "a" &&
            chunk.choices[0]?.finish_reason === null &&
            chunk.usage === undefined,
        ),
      ).toBe(true);
      expect(
        Buffer.byteLength(
          content
            .map((chunk) => chunk.choices[0]?.delta.content ?? "")
            .join(""),
          "utf8",
        ),
      ).toBe(BACKPRESSURE_CONTENT_DELTAS);
      expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);

      const finish = chunks[BACKPRESSURE_CONTENT_DELTAS];
      expect(finish?.choices[0]?.delta).toEqual({});
      expect(finish?.choices[0]?.finish_reason).toBe("stop");

      const usageChunk = chunks[BACKPRESSURE_CONTENT_DELTAS + 1];
      expect(usageChunk?.choices).toEqual([]);
      expect(usageChunk?.usage).toEqual({
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        prompt_tokens_details: { cached_tokens: 0 },
      });

      // Every event was pulled by the end and the stream fully settled.
      const final = await pollState(
        port,
        (state) => state.pulls >= BACKPRESSURE_EVENTS && state.active === 0,
        5_000,
        "Backpressure stream did not finish after draining",
      );
      expect(final.pulls).toBe(BACKPRESSURE_EVENTS);
      expect(final.aborts).toBe(0);
      expect(final.active).toBe(0);

      child.process.kill("SIGINT");
      const exit = await withTimeout(
        child.exit,
        3_000,
        "Server did not exit after SIGINT",
      );
      expect(exit).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("");
      expect(child.stderr()).toBe("");
      await assertListenerClosed(port);
    } finally {
      socket.destroy();
    }
  });
}, 20_000);

test("a client disconnect aborts the parked stream, releases the permit, and leaves health serving", async () => {
  await withStreamingMatrixServer(async (port, child) => {
    const first = openParkedStream(port);
    try {
      await withTimeout(
        first.partial,
        3_000,
        "First parked stream never delivered Partial",
      );
      const parked = await fetchState(port);
      expect(parked.pulls).toBe(1);
      expect(parked.aborts).toBe(0);
      expect(parked.active).toBe(1);

      // The client vanishes mid-stream: the Node runtime must surface the
      // disconnect, cancel the adapter iterator, and release the permit.
      first.destroy();
      const received = first.received();
      const disconnected = await pollState(
        port,
        (state) => state.aborts >= 1 && state.active === 0,
        5_000,
        "Client disconnect did not settle the parked stream",
      );
      expect(disconnected.pulls).toBe(1);

      // The vanished client ends quietly: one delivered frame, no error
      // frame, no [DONE], and nothing sensitive in the captured bytes.
      expect(received).toContain(PARTIAL_MARKER);
      expect(received).not.toContain('"error"');
      expect(received).not.toContain("[DONE]");

      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      expect(health.status).toBe(200);
      expect(await health.text()).toBe('{"status":"ok"}');

      // The released permit admits a second stream, which also delivers.
      const second = openParkedStream(port);
      try {
        await withTimeout(
          second.partial,
          3_000,
          "Second parked stream never delivered Partial",
        );
        second.destroy();
        await pollState(
          port,
          (state) => state.aborts >= 2 && state.active === 0,
          5_000,
          "Second disconnect did not settle the parked stream",
        );
      } finally {
        second.destroy();
      }

      child.process.kill("SIGINT");
      const exit = await withTimeout(
        child.exit,
        3_000,
        "Server did not exit after SIGINT",
      );
      expect(exit).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("");
      expect(child.stderr()).toBe("");
      await assertListenerClosed(port);
    } finally {
      first.destroy();
    }
  });
}, 20_000);

test("SIGINT settles an admitted stream whose adapter has not produced its first event", async () => {
  await withStreamingMatrixServer(async (port, child) => {
    const open = openPrecommitStream(port);
    try {
      // Admitted without commitment: the adapter entered (active) but the
      // gateway pulled no event (pulls) and no frame was ever written.
      const admitted = await pollState(
        port,
        (state) => state.active === 1 && state.pulls === 0,
        3_000,
        "Pre-commit stream was never admitted",
      );
      expect(admitted.aborts).toBe(0);

      // Dispatched before the signal: this probe parks until the fixture
      // observes a cancellation, so it survives route closure during the
      // shutdown and reports the final counters without racing the fast
      // close. With the admission-registration defect it never resolves
      // before the process exits non-zero on the grace timeout.
      const afterAbort = fetch(
        `http://127.0.0.1:${port}/test/state?awaitAbort=1`,
        { signal: AbortSignal.timeout(3_000) },
      ).then((response) => {
        expect(response.status).toBe(200);
        return response.json() as Promise<FixtureState>;
      });
      // The probe must be dispatched before the signal arrives: once the
      // gateway starts closing, its routes answer nothing new. The parked
      // count proves the fixture is holding the probe.
      await pollState(
        port,
        (state) => state.probes === 1,
        3_000,
        "Post-abort state probe was never dispatched",
      );

      child.process.kill("SIGINT");

      // preClose aborts the admitted stream, the route answers with the
      // mapped 500 JSON status instead of [DONE], and the child exits
      // cleanly well inside the grace period — not on its timeout path.
      const raw = await withTimeout(
        open.closed,
        3_000,
        "Pre-commit stream did not end after SIGINT",
      );
      const exit = await withTimeout(
        child.exit,
        3_000,
        "Server did not exit after SIGINT",
      );
      const final = await withTimeout(
        afterAbort,
        3_000,
        "Post-abort state probe never answered",
      );

      expect(final).toEqual({ pulls: 0, aborts: 1, active: 0, probes: 0 });
      expect(exit).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("");
      expect(child.stderr()).toBe("");
      await assertListenerClosed(port);

      expect(raw).not.toContain("[DONE]");
      expect(raw).not.toContain("data: ");
      const separator = raw.indexOf("\r\n\r\n");
      expect(separator).toBeGreaterThanOrEqual(0);
      const statusLine = raw.slice(0, separator).split("\r\n", 1)[0] ?? "";
      expect(Number.parseInt(statusLine.split(" ")[1] ?? "0", 10)).toBe(500);
      expect(JSON.parse(raw.slice(separator + 4))).toEqual(
        new ProxyError("internal_error").body,
      );
    } finally {
      open.destroy();
    }
  });
}, 20_000);
