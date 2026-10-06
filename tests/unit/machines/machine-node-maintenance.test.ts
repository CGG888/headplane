import { describe, expect, test } from "vitest";

import {
  backfillSummary,
  confirmedBackfillRequest,
  BACKFILL_ACTION,
} from "~/routes/machines/backfill-request";
import {
  confirmedDebugNodeRequest,
  debugNodeSummary,
  DEBUG_NODE_ACTION,
  isCidr,
  MACHINES_LIST_HREF,
  parseRouteList,
} from "~/routes/machines/debug-node-request";

// The dialogs are React components and the unit project has no DOM, so the
// pieces they submit through are tested directly: nothing is sent before the
// operator confirmed inside the dialog, and what is sent carries exactly the
// fields that were filled in.

describe("backfill request", () => {
  test("produces nothing before the operator confirms", () => {
    expect(confirmedBackfillRequest(false)).toBeNull();
  });

  test("asks for the backfill once confirmed, with nothing else attached", () => {
    const form = confirmedBackfillRequest(true);

    expect([...(form?.keys() ?? [])]).toEqual(["action_id"]);
    expect(form?.get("action_id")).toBe(BACKFILL_ACTION);
  });

  test("counts the nodes Headscale named, not the addresses it changed", () => {
    const summary = backfillSummary([
      'assigned IPv4 "100.64.0.1" to Node(3) "alpha"',
      'assigned IPv6 "fd7a::1" to Node(3) "alpha"',
      'assigned IPv4 "100.64.0.2" to Node(7) "beta"',
    ]);

    // Two changes belong to one node, so the dialog reports two nodes fixed.
    expect(summary).toEqual({ changes: 3, nodeIds: ["3", "7"], nodes: 2 });
  });

  test("reports nothing to do for an empty response", () => {
    expect(backfillSummary([])).toEqual({ changes: 0, nodeIds: [], nodes: 0 });
  });

  test("still counts a change whose format names no node", () => {
    const summary = backfillSummary(["removed an address"]);

    expect(summary.changes).toBe(1);
    expect(summary.nodes).toBe(0);
    expect(summary.nodeIds).toEqual([]);
  });
});

describe("debug node request", () => {
  test("produces nothing before the operator confirms", () => {
    expect(confirmedDebugNodeRequest(false, { name: "debug-1" })).toBeNull();
  });

  test("passes through exactly the fields that were filled in", () => {
    const form = confirmedDebugNodeRequest(true, {
      key: "hskey-authreq-abcdefghijklmnop",
      name: "debug-1",
      routes: ["10.0.0.0/24", "192.168.1.0/24"],
      user: "alice",
    });

    expect(form?.get("action_id")).toBe(DEBUG_NODE_ACTION);
    expect(form?.get("user")).toBe("alice");
    expect(form?.get("key")).toBe("hskey-authreq-abcdefghijklmnop");
    expect(form?.get("name")).toBe("debug-1");
    expect(form?.get("routes")).toBe("10.0.0.0/24,192.168.1.0/24");
  });

  test("omits the fields that were left empty", () => {
    const form = confirmedDebugNodeRequest(true, { name: "  debug-1  ", user: "" });

    expect([...(form?.keys() ?? [])].sort()).toEqual(["action_id", "name"]);
    expect(form?.get("name")).toBe("debug-1");
  });

  test("omits every optional field for a blank submission", () => {
    const form = confirmedDebugNodeRequest(true, {});

    expect([...(form?.keys() ?? [])]).toEqual(["action_id"]);
  });
});

describe("debug node routes", () => {
  test("splits on commas and any whitespace", () => {
    expect(parseRouteList(" 10.0.0.0/24, 192.168.1.0/24  fd7a::/64 ")).toEqual([
      "10.0.0.0/24",
      "192.168.1.0/24",
      "fd7a::/64",
    ]);
    expect(parseRouteList("   ")).toEqual([]);
  });

  test("accepts the CIDRs Headscale itself parses", () => {
    for (const route of ["10.0.0.0/24", "0.0.0.0/0", "192.168.1.5/32", "fd7a::/64", "::/0"]) {
      expect(isCidr(route), route).toBe(true);
    }
  });

  test("rejects a bare address, a bad octet and a prefix outside the range", () => {
    // Headscale parses these with netip.ParsePrefix, so each one is an error
    // there too; the dialog says so before the request is ever sent.
    for (const route of ["10.0.0.0", "10.0.0.256/24", "10.0.0.0/33", "fd7a::/129", "not-a-route"]) {
      expect(isCidr(route), route).toBe(false);
    }
  });
});

describe("debug node summary", () => {
  test("names the created node and links to the machines list", () => {
    const summary = debugNodeSummary({ givenName: "debug-1", id: "9", name: "debug-1.local" });

    expect(summary).toEqual({ href: MACHINES_LIST_HREF, id: "9", name: "debug-1" });
  });

  test("falls back to Headscale's own hostname field", () => {
    // DebugCreateNode echoes a synthetic node, so only some fields come back.
    expect(debugNodeSummary({ name: "debug-2" }).name).toBe("debug-2");
  });

  test("leaves the name empty when the response has none", () => {
    expect(debugNodeSummary({}).name).toBe("");
  });
});
