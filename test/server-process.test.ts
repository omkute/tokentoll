import { expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import chatRequest from "./fixtures/chat-completions/default-request.json";
import chatResponse from "./fixtures/chat-completions/default-response.json";

const serverArtifact = fileURLToPath(
  new URL("../dist/server.js", import.meta.url),
);

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

function spawnProductionServer(port: number): ProductionChild {
  const child = spawn("node", [serverArtifact], {
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

test.each(["SIGINT", "SIGTERM"] as const)(
  "the production process closes cleanly on %s",
  async (signal) => {
    const port = await unusedPort();
    const child = spawnProductionServer(port);

    try {
      await waitForHealth(port, child);
      const response = await fetch(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(chatRequest),
          signal: AbortSignal.timeout(1000),
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect({ ...body, id: "<id>", created: 0 }).toEqual(chatResponse);

      const sensitive = await fetch(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer PROCESS-SECRET-SENTINEL",
          },
          body: JSON.stringify({
            ...chatRequest,
            messages: [{ role: "user", content: "PROCESS-SECRET-SENTINEL" }],
          }),
          signal: AbortSignal.timeout(1000),
        },
      );
      expect(sensitive.status).toBe(200);
      await sensitive.text();
      const invalid = await fetch(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer PROCESS-SECRET-SENTINEL",
          },
          body: '{"PROCESS-SECRET-SENTINEL":',
          signal: AbortSignal.timeout(1000),
        },
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).not.toContain("PROCESS-SECRET-SENTINEL");
      expect(child.process.kill(signal)).toBe(true);

      const exit = await withTimeout(
        child.exit,
        3_000,
        `Server did not exit after ${signal}`,
      );
      expect(exit).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("");
      expect(child.stderr()).toBe("");
      await assertListenerClosed(port);
    } finally {
      await forceCleanup(child);
    }
  },
  10_000,
);
