import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { fileURLToPath } from "node:url";

const serverArtifact = fileURLToPath(
  new URL("../dist/server.js", import.meta.url),
);

interface ChildResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runProductionServer(
  environment: Readonly<Record<string, string>>,
): Promise<ChildResult> {
  const child = spawn(process.execPath, [serverArtifact], {
    env: { ...process.env, ...environment },
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

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const exit = await Promise.race([
      new Promise<{
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      }>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Child process did not exit")),
          3_000,
        );
      }),
    ]);

    return { ...exit, stdout, stderr };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
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

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an HTTP address");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

test("invalid configuration fails safely before opening a listener", async () => {
  const port = await unusedPort();
  const result = await runProductionServer({
    HOST: "127.0.0.1",
    PORT: "invalid-port-value",
    SHUTDOWN_GRACE_MS: "100",
    UNRELATED_SECRET: "do-not-disclose",
  });

  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("Invalid runtime configuration: PORT");
  expect(result.stderr).not.toContain("invalid-port-value");
  expect(result.stderr).not.toContain("UNRELATED_SECRET");
  expect(result.stderr).not.toContain("do-not-disclose");
  await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
});

test("an invalid request timeout fails safely before opening a listener", async () => {
  const port = await unusedPort();
  const result = await runProductionServer({
    HOST: "127.0.0.1",
    PORT: String(port),
    SHUTDOWN_GRACE_MS: "100",
    REQUEST_TIMEOUT_MS: "300001",
  });

  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe(
    "Invalid runtime configuration: REQUEST_TIMEOUT_MS",
  );
  expect(result.stderr).not.toContain("300001");
  await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
});

test("an unavailable address fails without replacing its listener", async () => {
  const occupyingServer = createServer((_request, response) => {
    response.end("occupied");
  });
  const port = await listen(occupyingServer);

  try {
    const result = await runProductionServer({
      HOST: "127.0.0.1",
      PORT: String(port),
      SHUTDOWN_GRACE_MS: "100",
    });

    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Service startup failed");

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await response.text()).toBe("occupied");
  } finally {
    await close(occupyingServer);
  }
});
