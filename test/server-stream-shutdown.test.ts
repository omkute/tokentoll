import { expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect, createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import { ProxyError } from "../src/http/proxy-errors.js";

const streamingServerFixture = fileURLToPath(
  new URL("./fixtures/built-streaming-server.mjs", import.meta.url),
);

const streamRequest = {
  model: "mock-chat",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
} as const;

const PARTIAL_MARKER = '"content":"Partial"';

/** Raw last-chunk bytes that end every chunked response body. */
const CHUNKED_END = "0\r\n\r\n";

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
 * An open streaming request on a raw socket. `partialObserved` proves the
 * first frame was delivered incrementally; `closed` resolves with the raw
 * response body once the server ends the stream and the socket closes.
 */
interface OpenStream {
  readonly status: Promise<number>;
  readonly partialObserved: Promise<void>;
  readonly closed: Promise<string>;
  destroy(): void;
}

function openStreamRequest(port: number): OpenStream {
  const body = JSON.stringify(streamRequest);
  let markStatus: (status: number) => void = () => {};
  const status = new Promise<number>((resolve) => {
    markStatus = resolve;
  });
  let markPartial: () => void = () => {};
  const partialObserved = new Promise<void>((resolve) => {
    markPartial = resolve;
  });
  let markClosed: (body: string) => void = () => {};
  const closed = new Promise<string>((resolve) => {
    markClosed = resolve;
  });

  // Hand-written chunked request on a raw socket, so the response can be
  // observed while it is still open and independent of client buffering.
  let headersEnded = false;
  let received = "";
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /v1/chat/completions HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Content-Type: application/json\r\n" +
        "Connection: close\r\n" +
        "Transfer-Encoding: chunked\r\n\r\n",
    );
    const size = Buffer.byteLength(body, "utf8").toString(16);
    socket.write(`${size}\r\n${body}\r\n0\r\n\r\n`);
  });
  const bodyBytes = (): string => {
    const separator = received.indexOf("\r\n\r\n");
    return separator < 0 ? "" : received.slice(separator + 4);
  };
  socket.on("data", (data: Buffer) => {
    received += data.toString("utf8");
    if (!headersEnded) {
      const separator = received.indexOf("\r\n\r\n");
      if (separator < 0) return;
      headersEnded = true;
      const statusLine = received.slice(0, separator).split("\r\n", 1)[0] ?? "";
      const statusCode = Number.parseInt(statusLine.split(" ")[1] ?? "0", 10);
      markStatus(Number.isNaN(statusCode) ? 0 : statusCode);
    }
    if (received.includes(PARTIAL_MARKER)) markPartial();
    // The last chunk ends the response even when the runtime keeps the
    // socket open after a hijacked stream completes.
    if (received.includes(CHUNKED_END)) markClosed(bodyBytes());
  });
  // Destroying the socket must not surface as an unhandled socket error.
  socket.on("error", () => {});
  socket.on("close", () => {
    markClosed(bodyBytes());
  });

  return {
    status,
    partialObserved,
    closed,
    destroy() {
      socket.destroy();
    },
  };
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

test.each(["SIGINT", "SIGTERM"] as const)(
  "the built streaming process ends the active stream on %s",
  async (signal) => {
    const port = await unusedPort();
    const child = spawnStreamingServer(port);
    let open: OpenStream | undefined;

    try {
      await waitForHealth(port, child);

      // The stream stays open with one delivered frame while the adapter
      // waits for cancellation.
      open = openStreamRequest(port);
      expect(await open.status).toBe(200);
      await withTimeout(
        open.partialObserved,
        3_000,
        "Partial chunk never arrived",
      );

      expect(child.process.kill(signal)).toBe(true);

      // Shutdown aborts the adapter, ends the response without [DONE], and
      // the child exits cleanly within the configured grace period.
      const raw = await withTimeout(
        open.closed,
        3_000,
        "Stream did not end after shutdown",
      );
      const exit = await withTimeout(
        child.exit,
        3_000,
        `Server did not exit after ${signal}`,
      );

      const frames = parseFrames(decodeChunked(raw));
      expect(frames).toHaveLength(2);
      expect(frames[0]).toContain(PARTIAL_MARKER);
      expect(JSON.parse(frames[1] ?? "")).toEqual(
        new ProxyError("internal_error").body,
      );
      expect(raw).not.toContain("[DONE]");

      expect(exit).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("");
      expect(child.stderr()).toBe("");
      await assertListenerClosed(port);
    } finally {
      open?.destroy();
      await forceCleanup(child);
    }
  },
  10_000,
);
