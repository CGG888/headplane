import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Capabilities } from "~/server/headscale/api/capabilities";
import { makePolicyApi } from "~/server/headscale/api/resources/policy";
import { createTransport, type Transport } from "~/server/headscale/api/transport";

// Headplane validates a policy through `POST /api/v1/policy/check` before it
// stores it. The wire format is what makes that safe: the policy text has to
// travel in a JSON `policy` field, because a query parameter or a differently
// named field would let Headscale check a policy other than the one being
// saved.

interface Recorded {
  method: string;
  url: string;
  body: string;
  auth: string | undefined;
}

const API_KEY = "hskey-api-abcdefghijkl-secret";
const POLICY = '{"acls": [{"action": "accept", "src": ["*"], "dst": ["*:*"]}]}';
const PARSE_ERROR = "parsing HuJSON: invalid character '}' looking for beginning of value";

const capabilities = {} as Capabilities;

let server: Server;
let transport: Transport;
let recorded: Recorded[] = [];
let rejectPolicy = false;

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
      if (rejectPolicy) {
        response.statusCode = 500;
        response.end(JSON.stringify({ code: 13, message: PARSE_ERROR }));
        return;
      }

      // Headscale answers a successful check with an empty object.
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

describe("Policy check request", () => {
  test("posts the policy text to the check endpoint and resolves void", async () => {
    const policy = makePolicyApi(transport, capabilities, API_KEY);
    recorded = [];

    await expect(policy.check(POLICY)).resolves.toBeUndefined();

    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/v1/policy/check");
    expect(JSON.parse(request.body)).toEqual({ policy: POLICY });
    expect(request.auth).toBe(`Bearer ${API_KEY}`);
  });

  test("propagates the parser message when headscale rejects the policy", async () => {
    const policy = makePolicyApi(transport, capabilities, API_KEY);
    recorded = [];
    rejectPolicy = true;

    try {
      await expect(policy.check("not json")).rejects.toMatchObject({
        data: {
          requestUrl: "POST v1/policy/check",
          statusCode: 500,
          data: { code: 13, message: PARSE_ERROR },
        },
      });
    } finally {
      rejectPolicy = false;
    }

    expect(lastRequest().url).toBe("/api/v1/policy/check");
  });
});
