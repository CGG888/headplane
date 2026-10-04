import { describe, expect, test } from "vitest";

import { parsePolicy, serializePolicy } from "~/utils/acl-policy";

// Headscale stores a grant's `app` as a capability map. Such a policy never went
// through the Headplane editor, so it has no `name`/`connectors` keys — and
// saving the policy from anywhere else must not invent them.

const CAPABILITY_MAP_POLICY = `{
  "grants": [
    { "src": ["group:eng"], "dst": ["tag:web"], "app": { "example.com": ["tag:connector"] } }
  ]
}`;

function parseOrThrow(raw: string) {
  const result = parsePolicy(raw);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.policy;
}

describe("grant app round-trips", () => {
  test("a capability map keeps its keys and gains none", () => {
    const serialized = serializePolicy(parseOrThrow(CAPABILITY_MAP_POLICY));
    const app = JSON.parse(serialized).grants[0].app;

    expect(app).toEqual({ "example.com": ["tag:connector"] });
    expect(app).not.toHaveProperty("name");
    expect(app).not.toHaveProperty("connectors");
  });

  test("parses an app written by the editor", () => {
    const policy = parseOrThrow(
      `{ "grants": [ { "src": ["alice@"], "dst": ["tag:web"], "app": { "name": "example.com", "connectors": ["tag:connector"] } } ] }`,
    );

    expect(policy.grants[0].app).toMatchObject({
      name: "example.com",
      connectors: ["tag:connector"],
    });

    const serialized = serializePolicy(policy);
    expect(JSON.parse(serialized).grants[0].app).toEqual({
      name: "example.com",
      connectors: ["tag:connector"],
    });
  });

  test("keeps unknown keys alongside the editor's own fields", () => {
    const serialized = serializePolicy(
      parseOrThrow(
        `{ "grants": [ { "src": ["alice@"], "dst": ["tag:web"], "app": { "name": "example.com", "connectors": ["tag:connector"], "extra.com": ["tag:x"] } } ] }`,
      ),
    );

    expect(JSON.parse(serialized).grants[0].app).toEqual({
      name: "example.com",
      connectors: ["tag:connector"],
      "extra.com": ["tag:x"],
    });
  });

  test("writes via and keeps an empty ip out of the output", () => {
    const serialized = serializePolicy(
      parseOrThrow(
        `{ "grants": [ { "src": ["alice@"], "dst": ["app:example.com"], "app": { "name": "example.com" }, "via": ["tag:connector"] } ] }`,
      ),
    );

    const grant = JSON.parse(serialized).grants[0];
    expect(grant.via).toEqual(["tag:connector"]);
    expect(grant).not.toHaveProperty("ip");
  });
});
