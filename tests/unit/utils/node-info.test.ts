import { describe, expect, test } from "vitest";

import {
  extractTagOwnerTags,
  isNoExpiry,
  scanHuJson,
  sortAssignableTags,
  stripJsonCommentsAndTrailingCommas,
} from "~/utils/node-info";

describe("isNoExpiry", () => {
  test("returns true for null", () => {
    expect(isNoExpiry(null)).toBe(true);
  });

  test("returns true for undefined", () => {
    expect(isNoExpiry(undefined)).toBe(true);
  });

  test("returns true for Go zero-time ISO format", () => {
    expect(isNoExpiry("0001-01-01T00:00:00Z")).toBe(true);
  });

  test("returns true for Go zero-time space format", () => {
    expect(isNoExpiry("0001-01-01 00:00:00")).toBe(true);
  });

  test("returns false for a real future expiry", () => {
    expect(isNoExpiry("2030-01-01T00:00:00Z")).toBe(false);
  });

  test("returns false for a real past expiry", () => {
    expect(isNoExpiry("2020-01-01T00:00:00Z")).toBe(false);
  });
});

describe("extractTagOwnerTags", () => {
  test("reads tags from HuJSON tagOwners", () => {
    expect(
      extractTagOwnerTags(`{
        // comment
        "tagOwners": {
          "tag:prod": ["group:admins"],
          "tag:server": [],
        },
      }`),
    ).toEqual(["tag:prod", "tag:server"]);
  });

  test("returns undefined when the policy cannot be read or parsed", () => {
    // An unreadable policy is not the same as one declaring no tags: callers
    // use `undefined` to keep the tag dialog from flagging every tag.
    expect(extractTagOwnerTags(undefined)).toBeUndefined();
    expect(extractTagOwnerTags("not-json")).toBeUndefined();
  });

  test("returns an empty list when the policy declares no tags", () => {
    expect(extractTagOwnerTags("")).toEqual([]);
    expect(extractTagOwnerTags('{ "groups": { "group:eng": ["alice@"] } }')).toEqual([]);
  });
});

describe("sortAssignableTags", () => {
  test("unions assigned node tags with ACL tag owners", () => {
    expect(
      sortAssignableTags(
        [
          {
            id: "1",
            givenName: "node",
            name: "node",
            machineKey: "mkey:test",
            nodeKey: "nodekey:test",
            discoKey: "discokey:test",
            ipAddresses: [],
            tags: ["tag:used"],
            lastSeen: "",
            expiry: null,
            online: true,
            registerMethod: "REGISTER_METHOD_AUTH_KEY",
            createdAt: "",
            availableRoutes: [],
            approvedRoutes: [],
            subnetRoutes: [],
          },
        ],
        '{"tagOwners":{"tag:declared":[]}}',
      ),
    ).toEqual(["tag:declared", "tag:used"]);
  });
});

describe("scanHuJson", () => {
  test("reports whether the input carried comments", () => {
    expect(scanHuJson('{"a": 1}').hasComments).toBe(false);
    expect(scanHuJson('{"a": 1} // note').hasComments).toBe(true);
  });

  test("strips comments and trailing commas", () => {
    const stripped = stripJsonCommentsAndTrailingCommas(`{
      // comment
      "tagOwners": { "tag:prod": [], },
    }`);

    expect(JSON.parse(stripped)).toEqual({ tagOwners: { "tag:prod": [] } });
  });

  test("keeps a comma that sits inside a string literal", () => {
    // The comma before `}` is inside the string, so removing it would corrupt
    // the value.
    const stripped = scanHuJson(String.raw`{"message": "done,}", "list": [1, 2,],}`).stripped;

    expect(JSON.parse(stripped)).toEqual({ message: "done,}", list: [1, 2] });
    expect(stripped).toContain('"done,}"');
  });

  test("keeps a comma inside a string that ends with an escaped quote", () => {
    const stripped = scanHuJson(String.raw`{"quote": "she said \"hi,\"", "after": 1,}`).stripped;

    expect(JSON.parse(stripped)).toEqual({ quote: 'she said "hi,"', after: 1 });
  });

  test("handles nested objects and arrays around string commas", () => {
    const stripped = scanHuJson(String.raw`{"a": [{"b": "x,]"}, {"c": ["y,}", 2,],},],}`).stripped;

    expect(JSON.parse(stripped)).toEqual({ a: [{ b: "x,]" }, { c: ["y,}", 2] }] });
  });

  test("leaves a comma inside a string alone even when whitespace follows", () => {
    const stripped = scanHuJson(String.raw`{"a": "text,   }", "b": 1,}`).stripped;

    expect(JSON.parse(stripped)).toEqual({ a: "text,   }", b: 1 });
  });
});
