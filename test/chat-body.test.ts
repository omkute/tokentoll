import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../src/app.js";
import { createMockChat } from "../src/mock-chat.js";
import { ProxyError } from "../src/http/proxy-errors.js";
import input from "./fixtures/chat-completions/default-request.json";

test("media and parser failures use safe proxy errors without invoking adapters", async () => {
  let calls = 0;
  const mock = createMockChat();
  const app = createApp({
    adapter: {
      async generate(invocation) {
        calls++;
        return mock.adapter.generate(invocation);
      },
    },
  });
  try {
    const cases = [
      [{}, JSON.stringify(input), "unsupported_media_type"],
      [
        { "content-type": "text/plain" },
        JSON.stringify(input),
        "unsupported_media_type",
      ],
      [
        { "content-type": "application/json; charset=iso-8859-1" },
        JSON.stringify(input),
        "unsupported_media_type",
      ],
      [
        { "content-type": "application/json", "content-encoding": "gzip" },
        JSON.stringify(input),
        "unsupported_media_type",
      ],
      [{ "content-type": "application/json" }, "", "invalid_request"],
      [{ "content-type": "application/json" }, '{"SECRET":', "invalid_request"],
    ] as const;
    for (const [headers, payload, code] of cases) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers,
        payload,
      });
      const error = new ProxyError(code);
      expect(response.statusCode).toBe(error.statusCode);
      expect(response.json()).toEqual(error.body);
    }
    expect(calls).toBe(0);
    for (const contentType of [
      "application/json",
      "application/json; charset=utf-8",
      'application/json; charset="UTF-8"',
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          "content-type": contentType,
          "content-encoding": "identity",
        },
        payload: JSON.stringify(input),
      });
      expect(response.statusCode).toBe(200);
    }
    expect(calls).toBe(3);
  } finally {
    await app.close();
  }
});

test("exact request byte bound passes and overflow rejects before generation", async () => {
  let calls = 0;
  const mock = createMockChat();
  const app = createApp({
    adapter: {
      async generate(invocation) {
        calls++;
        return mock.adapter.generate(invocation);
      },
    },
  });
  try {
    const json = JSON.stringify(input);
    const exact = json + " ".repeat(65_536 - Buffer.byteLength(json));
    for (const [payload, status] of [
      [exact, 200],
      [exact + " ", 413],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(status);
      if (status === 413)
        expect(response.json()).toEqual(
          new ProxyError("request_too_large").body,
        );
    }
    expect(calls).toBe(1);
  } finally {
    await app.close();
  }
});

test("real Node HTTP chunked bodies enforce the limit without content-length", async () => {
  const app = createApp();
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const script = `
      import { request } from 'node:http';
      const size = Number(process.argv[2]);
      const json = JSON.stringify({model:'mock-chat',messages:[{role:'user',content:'Hello'}]});
      const body = json + ' '.repeat(size - Buffer.byteLength(json));
      const req = request(process.argv[1] + '/v1/chat/completions', {
        method:'POST', headers:{'content-type':'application/json'}, agent:false,
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => response += chunk);
        res.on('end', () => console.log(JSON.stringify({status:res.statusCode,body:JSON.parse(response),headers:req.getHeaders()})));
      });
      req.setTimeout(2000, () => req.destroy(new Error('HTTP test deadline')));
      req.on('error', () => { process.exitCode = 1; });
      req.write(body.slice(0, 32768));
      req.end(body.slice(32768));
    `;
    for (const [size, status] of [
      [65_536, 200],
      [65_537, 413],
    ]) {
      const { stdout, stderr } = await promisify(execFile)(
        "node",
        ["--input-type=module", "-e", script, address, String(size)],
        { timeout: 5000 },
      );
      expect(stderr).toBe("");
      const result = JSON.parse(stdout);
      expect(result.status).toBe(status);
      expect(result.headers["content-length"]).toBeUndefined();
      if (status === 413)
        expect(result.body).toEqual(new ProxyError("request_too_large").body);
    }
  } finally {
    await app.close();
  }
});
