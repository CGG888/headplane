import { describe, expect, test } from "vitest";

import type { HostInfo } from "~/types";
import {
  AGENT_NODE_ROW_LIMIT,
  agentNodeName,
  agentOs,
  agentSelfVersion,
  agentVersion,
  buildAgentCoverage,
  describeInterval,
  type AgentHostRecord,
} from "~/utils/agent-coverage";

function record(nodeKey: string, host: HostInfo, updatedAt?: Date | null): AgentHostRecord {
  return { nodeKey, host, updatedAt: updatedAt ?? null };
}

describe("agentVersion", () => {
  test("keeps the semver part of IPNVersion", () => {
    expect(agentVersion({ IPNVersion: "1.78.1-t1234abcd" })).toBe("1.78.1");
    expect(agentVersion({ IPNVersion: "1.78.1" })).toBe("1.78.1");
  });

  test("reports nothing when the node did not report a version", () => {
    expect(agentVersion({})).toBeNull();
    expect(agentVersion({ IPNVersion: "" })).toBeNull();
  });
});

describe("agentOs", () => {
  test("formats the OS with its version", () => {
    expect(agentOs({ OS: "linux", OSVersion: "6.6.1" })).toBe("Linux 6.6.1");
    expect(agentOs({ OS: "macOS", OSVersion: "14.4" })).toBe("macOS 14.4");
  });

  test("falls back to the kernel version when the OS is missing", () => {
    expect(agentOs({ OSVersion: "5.10.0-17-amd64" })).toBe("5.10.0-17-amd64");
  });

  test("reports nothing when neither the OS nor its version is known", () => {
    expect(agentOs({})).toBeNull();
    expect(agentOs({ OS: "", OSVersion: "  " })).toBeNull();
  });
});

describe("agentNodeName", () => {
  test("trims the reported hostname", () => {
    expect(agentNodeName({ Hostname: "  laptop  " })).toBe("laptop");
  });

  test("reports nothing when the hostname is missing or blank", () => {
    expect(agentNodeName({})).toBeNull();
    expect(agentNodeName({ Hostname: "   " })).toBeNull();
  });
});

describe("agentSelfVersion", () => {
  test("prefers the node the agent identified as itself", () => {
    const hosts = {
      self: { IPNVersion: "1.80.0-abc" },
      other: { IPNVersion: "1.70.0-def" },
    };

    expect(agentSelfVersion(hosts, "self")).toBe("1.80.0");
  });

  test("falls back to the node flagged as the agent", () => {
    const hosts = {
      a: { IPNVersion: "1.70.0-def" },
      b: { IPNVersion: "1.80.0-abc", HeadplaneAgent: true },
    };

    expect(agentSelfVersion(hosts)).toBe("1.80.0");
  });

  test("reports nothing when no agent node is in the report", () => {
    expect(agentSelfVersion({ a: { IPNVersion: "1.70.0" } })).toBeNull();
    expect(agentSelfVersion({}, "missing")).toBeNull();
  });
});

describe("describeInterval", () => {
  test("uses the largest whole unit", () => {
    expect(describeInterval(180_000)).toEqual({ unit: "minutes", count: 3 });
    expect(describeInterval(3_600_000)).toEqual({ unit: "hours", count: 1 });
    expect(describeInterval(86_400_000)).toEqual({ unit: "hours", count: 24 });
  });

  test("keeps an interval that is not a whole minute in seconds", () => {
    expect(describeInterval(90_000)).toEqual({ unit: "seconds", count: 90 });
    expect(describeInterval(1_500)).toEqual({ unit: "seconds", count: 2 });
  });

  test("reports nothing for a value that is not a usable interval", () => {
    expect(describeInterval(0)).toBeNull();
    expect(describeInterval(-1)).toBeNull();
    expect(describeInterval(Number.NaN)).toBeNull();
    expect(describeInterval(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("buildAgentCoverage", () => {
  test("counts the nodes Headplane holds host information for", () => {
    const at = new Date("2024-05-01T10:00:00Z");
    const coverage = buildAgentCoverage({
      hosts: { a: { Hostname: "alpha" }, b: { Hostname: "beta" } },
      records: [record("a", { Hostname: "alpha" }, at), record("b", { Hostname: "beta" }, at)],
      tailnetCount: 2,
    });

    expect(coverage.reportedCount).toBe(2);
    expect(coverage.tailnetCount).toBe(2);
    expect(coverage.missingCount).toBe(0);
    expect(coverage.surplusCount).toBe(0);
    expect(coverage.newestAt).toEqual(at);
    expect(coverage.oldestAt).toEqual(at);
    expect(coverage.hiddenCount).toBe(0);
  });

  test("keeps a stored row the agent did not report this time", () => {
    const fresh = new Date("2024-05-01T10:00:00Z");
    const stale = new Date("2024-04-01T10:00:00Z");
    const coverage = buildAgentCoverage({
      hosts: { a: { Hostname: "alpha" } },
      records: [
        record("a", { Hostname: "alpha" }, fresh),
        record("b", { Hostname: "beta" }, stale),
      ],
      tailnetCount: 3,
    });

    expect(coverage.reportedCount).toBe(2);
    expect(coverage.missingCount).toBe(1);
    expect(coverage.newestAt).toEqual(fresh);
    expect(coverage.oldestAt).toEqual(stale);
    expect(coverage.rows.map((row) => row.nodeKey)).toEqual(["a", "b"]);
  });

  test("leaves the comparison open when the tailnet count is unknown", () => {
    const coverage = buildAgentCoverage({
      hosts: { a: {} },
      tailnetCount: null,
    });

    expect(coverage.reportedCount).toBe(1);
    expect(coverage.tailnetCount).toBeNull();
    expect(coverage.missingCount).toBeNull();
    expect(coverage.surplusCount).toBeNull();
  });

  test("flags host information for nodes the tailnet no longer has", () => {
    const coverage = buildAgentCoverage({
      hosts: { a: {}, b: {} },
      tailnetCount: 1,
    });

    expect(coverage.surplusCount).toBe(1);
    expect(coverage.missingCount).toBe(0);
  });

  test("sorts the freshest report first and rows without a time last", () => {
    const coverage = buildAgentCoverage({
      hosts: { zeta: {}, alpha: {}, beta: {} },
      records: [
        record("zeta", {}, new Date("2024-05-01T12:00:00Z")),
        record("alpha", {}, new Date("2024-05-01T13:00:00Z")),
        record("beta", {}, null),
      ],
    });

    expect(coverage.rows.map((row) => row.nodeKey)).toEqual(["alpha", "zeta", "beta"]);
  });

  test("breaks ties by name, falling back to the node key", () => {
    const at = new Date("2024-05-01T12:00:00Z");
    const coverage = buildAgentCoverage({
      hosts: { b: { Hostname: "beta" }, a: { Hostname: "alpha" }, c: {} },
      records: [record("b", {}, at), record("a", {}, at), record("c", {}, at)],
    });

    expect(coverage.rows.map((row) => row.nodeKey)).toEqual(["a", "b", "c"]);
  });

  test("limits the table and reports how many rows are hidden", () => {
    const hosts: Record<string, HostInfo> = {};
    for (let index = 0; index < 25; index++) {
      hosts[`node-${index}`] = { Hostname: `node-${index}` };
    }

    const coverage = buildAgentCoverage({ hosts, limit: 20 });
    expect(coverage.rows).toHaveLength(20);
    expect(coverage.hiddenCount).toBe(5);
    expect(coverage.reportedCount).toBe(25);
  });

  test("defaults to the shared row limit", () => {
    const hosts: Record<string, HostInfo> = {};
    for (let index = 0; index < AGENT_NODE_ROW_LIMIT + 3; index++) {
      hosts[`node-${index}`] = {};
    }

    const coverage = buildAgentCoverage({ hosts });
    expect(coverage.rows).toHaveLength(AGENT_NODE_ROW_LIMIT);
    expect(coverage.hiddenCount).toBe(3);
  });

  test("renders unknown versions, OSes and names as null", () => {
    const coverage = buildAgentCoverage({ hosts: { a: {} } });

    expect(coverage.rows[0]).toEqual({
      nodeKey: "a",
      name: null,
      version: null,
      os: null,
      updatedAt: null,
    });
  });

  test("drops an unusable stored timestamp", () => {
    const coverage = buildAgentCoverage({
      hosts: { a: {} },
      records: [record("a", {}, new Date(Number.NaN))],
    });

    expect(coverage.rows[0].updatedAt).toBeNull();
    expect(coverage.newestAt).toBeNull();
  });

  test("copes with a report and a store that are both empty", () => {
    const coverage = buildAgentCoverage({ hosts: {}, records: [], tailnetCount: 4 });

    expect(coverage.reportedCount).toBe(0);
    expect(coverage.missingCount).toBe(4);
    expect(coverage.rows).toEqual([]);
    expect(coverage.newestAt).toBeNull();
    expect(coverage.oldestAt).toBeNull();
  });

  test("ignores a stored row without a payload", () => {
    const coverage = buildAgentCoverage({
      hosts: { a: {} },
      records: [{ nodeKey: "b", host: undefined as unknown as HostInfo, updatedAt: new Date() }],
    });

    expect(coverage.rows.map((row) => row.nodeKey)).toEqual(["a"]);
  });
});
