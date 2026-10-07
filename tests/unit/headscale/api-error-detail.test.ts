import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { isDataWithApiError, type HeadscaleAPIError } from "~/server/headscale/api/error-client";
import { createTransport, type Transport } from "~/server/headscale/api/transport";

// The transport wraps every non-2xx upstream response in a 502 `data()` whose
// payload ends up in the browser. These tests pin what that payload may contain:
// the upstream body is summarised into `detail`, and the body itself never
// travels. A reverse proxy in front of Headscale answers with its own HTML error
// page when the backend is down, so the old "carry the raw body along" behaviour
// shipped a stranger's markup (and whatever it contained) into the console.

let server: Server;
let transport: Transport;
let reply: { status: number; body: string; contentType?: string } = {
  status: 500,
  body: "oops",
};

async function failedRequest(): Promise<HeadscaleAPIError> {
  try {
    await transport.request<unknown>({ method: "GET", path: "v1/node", apiKey: "hskey-api-test" });
  } catch (error) {
    if (isDataWithApiError(error)) {
      return error.data;
    }
    throw error;
  }
  throw new Error("Expected the request to fail");
}

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.statusCode = reply.status;
    response.setHeader("content-type", reply.contentType ?? "text/plain");
    response.end(reply.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  transport = await createTransport({ url: `http://127.0.0.1:${port}` });
});

afterAll(async () => {
  await transport?.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("error payloads", () => {
  test("carries a summary instead of the upstream body", async () => {
    reply = { status: 404, body: "acl policy not found" };

    const payload = await failedRequest();

    expect(payload.statusCode).toBe(404);
    expect(payload.detail).toBe("acl policy not found");
    // The old field is gone on purpose: nothing may render the body's bytes.
    expect(Object.keys(payload).sort()).toEqual(["data", "detail", "requestUrl", "statusCode"]);
  });

  test("collapses a multi-line body into a single line", async () => {
    reply = { status: 500, body: "policy is broken\n\n  at line 3\r\n" };

    const payload = await failedRequest();

    expect(payload.detail).toBe("policy is broken at line 3");
  });

  test("drops control characters an upstream body could smuggle in", async () => {
    // An ESC and a BEL: the terminal-clear sequence and the bell an upstream
    // body could use to rewrite the error card.
    reply = { status: 500, body: "before\u001b[2Jafter\u0007" };

    const payload = await failedRequest();

    expect(payload.detail).toBe("before[2Jafter");
  });

  test("replaces a proxy's HTML error page", async () => {
    reply = {
      status: 502,
      body: "<html><body><h1>502 Bad Gateway</h1><p>upstream 10.0.0.7:8080</p></body></html>",
    };

    const payload = await failedRequest();

    expect(payload.detail).toBe("(the upstream service answered with an HTML document)");
  });

  test("bounds how much text a stranger can put in the console", async () => {
    reply = { status: 500, body: "x".repeat(5_000) };

    const payload = await failedRequest();

    expect(payload.detail).toHaveLength(513);
    expect(payload.detail.endsWith("…")).toBe(true);
  });

  test("still exposes Headscale's own JSON error", async () => {
    reply = {
      status: 500,
      body: JSON.stringify({ message: "update is disabled", code: 2 }),
      contentType: "application/json",
    };

    const payload = await failedRequest();

    expect(payload.data).toEqual({ message: "update is disabled", code: 2 });
    expect(payload.detail).toContain("update is disabled");
  });

  test("leaves an oversized body unparsed", async () => {
    reply = {
      status: 500,
      body: JSON.stringify({ message: "x".repeat(9_000) }),
      contentType: "application/json",
    };

    const payload = await failedRequest();

    expect(payload.data).toBeNull();
    expect(payload.detail.length).toBeLessThanOrEqual(513);
  });
});
