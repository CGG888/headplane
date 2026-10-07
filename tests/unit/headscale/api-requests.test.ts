import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Capabilities } from "~/server/headscale/api/capabilities";
import { makeApiKeyApi } from "~/server/headscale/api/resources/api-keys";
import { makeAuthApi } from "~/server/headscale/api/resources/auth";
import { makeNodeApi } from "~/server/headscale/api/resources/nodes";
import { makePreAuthKeyApi } from "~/server/headscale/api/resources/pre-auth-keys";
import { createTransport, type Transport } from "~/server/headscale/api/transport";

// These tests pin the exact HTTP requests Headplane sends to Headscale. The wire
// format is not negotiable: Headscale's gateway binds `expiry` and
// `disableExpiry` as *query* parameters and silently discards a JSON body, so a
// regression there would look like a working button that never changes anything.

interface Recorded {
  method: string;
  url: string;
  body: string;
  auth: string | undefined;
}

const API_KEY = "hskey-api-abcdefghijkl-secret";
const capabilities = {
  preAuthKeysHaveStableIds: true,
  nodeTagsAreFlat: true,
  nodeOwnerIsImmutable: true,
  registerKeyIncludesAuthReqPrefix: true,
  keyExpiryCanBeDisabled: true,
  authRequestsCanBeRejected: true,
} as unknown as Capabilities;

let server: Server;
let transport: Transport;
let recorded: Recorded[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      recorded.push({
        method: request.method ?? "",
        url: request.url ?? "",
        body,
        auth: request.headers.authorization,
      });

      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/api/v1/apikey") {
        response.end(JSON.stringify({ apiKeys: [] }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/apikey") {
        response.end(JSON.stringify({ apiKey: API_KEY }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/debug/node") {
        response.end(JSON.stringify({ node: { id: "9", name: "debug-node", tags: [] } }));
        return;
      }
      if (request.method === "POST" && request.url === "/api/v1/node/backfillips?confirmed=true") {
        response.end(
          JSON.stringify({
            changes: ['assigned IPv4 "100.64.0.1" to Node(3) "alpha"'],
          }),
        );
        return;
      }
      response.end(JSON.stringify({}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  transport = await createTransport({ url: `http://127.0.0.1:${port}` });
});

afterAll(async () => {
  await transport?.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function lastRequest(): Recorded {
  const request = recorded.at(-1);
  if (!request) throw new Error("No request was recorded");
  return request;
}

describe("API key requests", () => {
  test("lists keys with a GET and no body", async () => {
    const apiKeys = makeApiKeyApi(transport, capabilities, API_KEY);
    recorded = [];

    await apiKeys.list();

    const request = lastRequest();
    expect(request.method).toBe("GET");
    expect(request.url).toBe("/api/v1/apikey");
    expect(request.body).toBe("");
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("creates a key with an explicit RFC3339 expiration", async () => {
    const apiKeys = makeApiKeyApi(transport, capabilities, API_KEY);
    recorded = [];

    const created = await apiKeys.create(new Date("2027-01-01T00:00:00.000Z"));

    expect(created).toEqual({ apiKey: API_KEY });

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/apikey");
    expect(JSON.parse(request.body)).toEqual({ expiration: "2027-01-01T00:00:00.000Z" });
  });

  test("expires a key by prefix", async () => {
    const apiKeys = makeApiKeyApi(transport, capabilities, API_KEY);
    recorded = [];

    await apiKeys.expire("abcdefghijkl");

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/apikey/expire");
    expect(JSON.parse(request.body)).toEqual({ prefix: "abcdefghijkl" });
  });

  test("deletes a key by its raw prefix in the path", async () => {
    const apiKeys = makeApiKeyApi(transport, capabilities, API_KEY);
    recorded = [];

    await apiKeys.delete("abcdefghijkl");

    const request = lastRequest();
    expect(request.method).toBe("DELETE");
    // The spec's optional `id` query parameter is deliberately not sent: the
    // spec does not say which identifier wins when both are present.
    expect(request.url).toBe("/api/v1/apikey/abcdefghijkl");
    expect(request.body).toBe("");
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });
});

describe("Pre-auth key deletion requests", () => {
  test("deletes a key by its stable id in the query string", async () => {
    const preAuthKeys = makePreAuthKeyApi(transport, capabilities, API_KEY);
    recorded = [];

    await preAuthKeys.delete?.("7");

    const request = lastRequest();
    expect(request.method).toBe("DELETE");
    expect(request.url).toBe("/api/v1/preauthkey?id=7");
    expect(request.body).toBe("");
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("is unavailable before pre-auth keys have stable ids", () => {
    const older = {
      ...capabilities,
      preAuthKeysHaveStableIds: false,
    } as unknown as Capabilities;
    const preAuthKeys = makePreAuthKeyApi(transport, older, API_KEY);

    // The endpoint does not exist before 0.28, which is also the release that
    // gave keys the id it deletes by.
    expect(preAuthKeys.delete).toBeUndefined();
    expect(preAuthKeys.listAll).toBeUndefined();
  });
});

describe("Auth request requests", () => {
  test("approves a pending registration by auth id", async () => {
    const auth = makeAuthApi(transport, capabilities, API_KEY);
    recorded = [];

    await auth.approve("auth-123");

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/auth/approve");
    expect(JSON.parse(request.body)).toEqual({ authId: "auth-123" });
  });

  test("rejects a pending registration by the same auth id", async () => {
    const auth = makeAuthApi(transport, capabilities, API_KEY);
    recorded = [];

    await auth.reject?.("auth-123");

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/auth/reject");
    expect(JSON.parse(request.body)).toEqual({ authId: "auth-123" });
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("is unavailable before 0.29", async () => {
    const older = {
      ...capabilities,
      authRequestsCanBeRejected: false,
    } as unknown as Capabilities;
    const auth = makeAuthApi(transport, older, API_KEY);
    recorded = [];

    expect(auth.reject).toBeUndefined();

    // Approving still works on those versions.
    await auth.approve("auth-123");
    expect(lastRequest().url).toBe("/api/v1/auth/approve");
  });
});

describe("Debug node requests", () => {
  test("creates a debug node from the spec's body", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    const node = await nodes.debug({
      user: "alice",
      key: "machine-key",
      name: "debug-1",
      routes: ["10.0.0.0/24"],
    });

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/debug/node");
    expect(JSON.parse(request.body)).toEqual({
      user: "alice",
      key: "machine-key",
      name: "debug-1",
      routes: ["10.0.0.0/24"],
    });
    expect(node.id).toBe("9");
  });

  test("omits fields the caller left out", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    await nodes.debug({});

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/debug/node");
    expect(JSON.parse(request.body)).toEqual({});
  });
});

describe("Node backfill requests", () => {
  test("asks for the backfill with confirmed=true and reads the changes back", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    const changes = await nodes.backfillIps();

    const request = lastRequest();
    expect(request.method).toBe("POST");
    // `confirmed` is a query parameter on the gateway, and it is the only thing
    // standing between a request and "not confirmed, aborting".
    expect(request.url).toBe("/api/v1/node/backfillips?confirmed=true");
    expect(request.body).toBe("");
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
    expect(changes).toEqual(['assigned IPv4 "100.64.0.1" to Node(3) "alpha"']);
  });
});

describe("Node expiry requests", () => {
  test("sets an explicit expiry as a query parameter with no body", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    await nodes.setExpiry("7", new Date("2027-01-01T00:00:00.000Z"));

    const request = lastRequest();
    expect(request.method).toBe("POST");
    // A JSON body would be discarded by Headscale's gateway.
    expect(request.url).toBe("/api/v1/node/7/expire?expiry=2027-01-01T00%3A00%3A00.000Z");
    expect(request.body).toBe("");
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("disables expiry through disableExpiry", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    await nodes.toggleExpiry("7", true);

    expect(lastRequest().url).toBe("/api/v1/node/7/expire?disableExpiry=true");
  });

  test("re-enables the default expiry without the disable flag", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);
    recorded = [];

    await nodes.toggleExpiry("7", false);

    expect(lastRequest().url).toBe("/api/v1/node/7/expire?disableExpiry=false");
  });

  test("a node list without a nodes array is reported, not read as empty", async () => {
    const nodes = makeNodeApi(transport, capabilities, API_KEY);

    // The transport hands back `undefined` for an empty body, so an answer in
    // the wrong shape must fail loudly instead of looking like an empty tailnet.
    await expect(nodes.list()).rejects.toThrow(/unexpected node list/);
  });
});
