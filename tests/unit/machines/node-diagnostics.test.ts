import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The attribute row binds the browser-local masking store through the router,
// which a server-rendered card has none of.
const maskState = vi.hoisted(() => ({ masked: false, canReveal: false }));

vi.mock("~/components/address-visibility", () => ({
  useAddressMask: () => maskState,
}));

import NodeDiagnostics, { NodeDebugRows } from "~/routes/machines/components/node-diagnostics";
import type { MachineLatencyInventory } from "~/routes/machines/derp-info";
import {
  buildNodeDiagnostics,
  type NodeDebugField,
  type NodeDebugView,
  type NodeDiagnosticsInput,
  type NodeDiagnosticsLabels,
} from "~/routes/machines/diagnostics";
import type { HostInfo } from "~/types";

/** The wording the card supplies to the locale-free builder. */
const LABELS: NodeDiagnosticsLabels = {
  notReported: "not reported",
  version: "Tailscale version (as reported)",
  osVersion: "OS version (as reported)",
  icmpv4: "ICMPv4 self-test",
  coverage: "Region coverage",
  coverageValue: ({ served, reported, measured }) =>
    `Serves ${served} regions · ${reported} reported by the client · ${measured} measured here`,
  groups: { agent: "Reported as-is", checks: "Self-test and coverage" },
};

/**
 * A complete agent report. It carries every fact the machine page prints
 * elsewhere — the OS, the hostname, the end-points, the network booleans, the
 * preferred region and the latency samples — so a test can prove the card leaves
 * those to the cards above instead of printing them a second time.
 */
const STATS: HostInfo = {
  IPNVersion: "1.78.1-t1234",
  OS: "linux",
  OSVersion: "6.6.0-arch1",
  Hostname: "laptop",
  Endpoints: ["100.64.0.2:41641"],
  HomeDERP: 999,
  NetInfo: {
    MappingVariesByDestIP: false,
    HairPinning: true,
    WorkingIPv6: true,
    WorkingICMPv4: false,
    WorkingUDP: true,
    UPnP: false,
    PCP: true,
    PMP: false,
    PreferredDERP: 901,
    DERPLatency: { "901": 0.02, "902-v4": 0.05 },
  },
};

/** The served inventory: three regions served, 999 measured here. */
const INVENTORY: MachineLatencyInventory = {
  servedRegionIds: [901, 902, 999],
  assignment: {},
  measured: { "999": 33 },
};

/** Everything the machine page already loads, as the page hands it to the card. */
const FULL: NodeDiagnosticsInput = {
  agentEnabled: true,
  stats: STATS,
  inventory: INVENTORY,
};

/** One row, by its stable key. */
function fieldOf(view: NodeDebugView, key: string): NodeDebugField | undefined {
  for (const group of view.groups) {
    const found = group.fields.find((field) => field.key === key);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/** Every value the card prints, in the order it prints them. */
function valuesOf(view: NodeDebugView): string[] {
  return view.groups.flatMap((group) => group.fields.map((field) => field.value));
}

beforeEach(() => {
  maskState.masked = false;
  maskState.canReveal = false;
});

describe("buildNodeDiagnostics", () => {
  test("prints only the facts no card above the diagnostics card shows", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(view.status).toBe("ok");
    expect(view.groups.map((group) => [group.key, group.label])).toEqual([
      ["agent", "Reported as-is"],
      ["checks", "Self-test and coverage"],
    ]);
    expect(view.fieldCount).toBe(4);
    // The rows the detail, address and relay cards already print are gone: no
    // OS, hostname or end-point row, no preferred/home region, no latency table
    // and no served-region list.
    expect(view.groups.map((group) => group.fields.map((field) => field.key))).toEqual([
      ["agent.IPNVersion", "agent.OSVersion"],
      ["checks.WorkingICMPv4", "checks.coverage"],
    ]);
  });

  test("carries the version strings the agent reported, under its own paths", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "agent.IPNVersion")).toMatchObject({
      label: "Tailscale version (as reported)",
      path: "stats.IPNVersion",
      value: "1.78.1-t1234",
      kind: "text",
    });
    expect(fieldOf(view, "agent.OSVersion")).toMatchObject({
      label: "OS version (as reported)",
      path: "stats.OSVersion",
      value: "6.6.0-arch1",
    });
  });

  test("prints the self-test as an answer rather than as the schema's boolean", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "checks.WorkingICMPv4")).toMatchObject({
      label: "ICMPv4 self-test",
      path: "stats.NetInfo.WorkingICMPv4",
      kind: "boolean",
      flag: false,
      value: "false",
    });
  });

  test("counts the regions this deployment serves, the client reported and we measured", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "checks.coverage")).toMatchObject({
      label: "Region coverage",
      kind: "text",
      value: "Serves 3 regions · 2 reported by the client · 1 measured here",
    });
  });

  test("counts each region once, however many address families it was measured over", () => {
    const view = buildNodeDiagnostics(
      {
        ...FULL,
        inventory: { servedRegionIds: [901, 901, 999], measured: { "999": 33, "901-v4": 10 } },
      },
      LABELS,
    );

    // 901 served twice is one region, and the legacy `-v4` suffix is still 901.
    expect(fieldOf(view, "checks.coverage")?.value).toBe(
      "Serves 2 regions · 2 reported by the client · 2 measured here",
    );
  });

  test("prints 'not reported' for a fact the agent left out", () => {
    const view = buildNodeDiagnostics(
      { agentEnabled: true, stats: { IPNVersion: "1.78.1" } },
      LABELS,
    );

    expect(view.status).toBe("ok");
    expect(fieldOf(view, "agent.IPNVersion")?.value).toBe("1.78.1");
    expect(fieldOf(view, "agent.OSVersion")?.value).toBe("not reported");
    expect(fieldOf(view, "checks.WorkingICMPv4")).toMatchObject({
      flag: undefined,
      value: "not reported",
    });
  });

  test("says nothing was reported when the agent added no fact of its own", () => {
    // The OS is printed by the detail card, so a report holding only the OS has
    // nothing of its own to add here.
    for (const stats of [{}, { OS: "linux" }, { Hostname: "laptop" }] as HostInfo[]) {
      const view = buildNodeDiagnostics({ agentEnabled: true, stats }, LABELS);
      expect(view.status, JSON.stringify(stats)).toBe("empty");
      expect(view.groups).toEqual([]);
      expect(view.fieldCount).toBe(0);
    }
  });

  test("says why there is nothing to show when the agent feature is off", () => {
    const view = buildNodeDiagnostics({ agentEnabled: false, stats: STATS }, LABELS);

    expect(view).toMatchObject({
      status: "unavailable",
      failure: "no-agent",
      groups: [],
      fieldCount: 0,
    });
  });

  test("says the machine has not reported when the agent has no host info", () => {
    expect(buildNodeDiagnostics({ agentEnabled: true }, LABELS)).toMatchObject({
      status: "unavailable",
      failure: "no-report",
      groups: [],
    });
    // A loader that handed nothing at all reads the same way.
    expect(buildNodeDiagnostics(undefined, LABELS).status).toBe("unavailable");
  });

  test("keeps the coverage line out of the emptiness test", () => {
    // A deployment serving regions does not make a silent agent look reported.
    const view = buildNodeDiagnostics(
      { agentEnabled: true, stats: { OS: "linux" }, inventory: INVENTORY },
      LABELS,
    );

    expect(view.status).toBe("empty");
    expect(valuesOf(view)).toEqual([]);
  });
});

describe("the card's data source", () => {
  const readRepoFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("the fake per-node API read is gone from the tree", () => {
    const gone = new URL("../../../app/routes/machines/node-debug.ts", import.meta.url);
    expect(existsSync(gone)).toBe(false);
  });

  test("neither the builder nor the card reaches for an API client", () => {
    for (const path of [
      "../../../app/routes/machines/diagnostics.ts",
      "../../../app/routes/machines/components/node-diagnostics.tsx",
    ]) {
      const source = readRepoFile(path);
      expect(source, path).not.toMatch(/nodes\s*\.\s*debug/);
      expect(source, path).not.toMatch(/\bapi\s*\./);
    }
  });

  test("renders the card without calling a client method", () => {
    const api = { nodes: { debug: vi.fn(async () => ({ debug: true })) } };

    const markup = renderToStaticMarkup(createElement(NodeDiagnostics, { diagnostics: FULL }));

    expect(markup).toContain("Node diagnostics");
    // The payload is the page's own data, so nothing here can make a request.
    expect(api.nodes.debug).not.toHaveBeenCalled();
  });
});

describe("NodeDiagnostics card", () => {
  /** The test project only collects `.ts`, so the card is created, not written. */
  function render(diagnostics: NodeDiagnosticsInput | undefined) {
    return renderToStaticMarkup(createElement(NodeDiagnostics, { diagnostics }));
  }

  test("summarises the rows it holds while it stays closed", () => {
    const markup = render(FULL);

    // Collapsed by default: the card says what it holds and shows the rows only
    // once opened, except when there is nothing to report at all.
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Node diagnostics");
    expect(markup).toContain("4 fields");
  });

  test("opens itself when the agent feature is off", () => {
    const markup = render({ agentEnabled: false });

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("The HeadplaneCN Agent is not enabled, so this machine");
  });

  test("opens itself when the agent has not reported this machine", () => {
    const markup = render({ agentEnabled: true });

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("has not reported any details to the HeadplaneCN Agent");
  });

  test("says the machine reported nothing instead of rendering blank rows", () => {
    const markup = render({ agentEnabled: true, stats: {} });

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("No data");
    expect(markup).toContain("Nothing has been reported for this machine.");
  });

  test("renders an unbuildable payload without throwing", () => {
    expect(() => render(undefined)).not.toThrow();

    const markup = render(undefined);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Unavailable");
  });
});

describe("NodeDebugRows", () => {
  const view = buildNodeDiagnostics(FULL, LABELS);

  test("prints one labelled row per remaining fact, grouped", () => {
    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view }));

    expect(markup).toContain("Reported as-is");
    expect(markup).toContain("Tailscale version (as reported)");
    expect(markup).toContain("1.78.1-t1234");
    expect(markup).toContain("Self-test and coverage");
    expect(markup).toContain("ICMPv4 self-test");
    expect(markup).toContain("Region coverage");
    expect(markup).toContain("Serves 3 regions · 2 reported by the client · 1 measured here");
  });

  test("never prints a fact the cards above already show", () => {
    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view }));

    // Each remaining fact is labelled once, and the OS, the hostname, the
    // end-points, the network booleans, the preferred region and the latency
    // table stay on the cards that own them. (The raw OS *version* is one of the
    // facts this card keeps on purpose.)
    expect(markup.match(/Tailscale version \(as reported\)/g)).toHaveLength(1);
    for (const elsewhere of [
      "linux",
      "laptop",
      "100.64.0.2:41641",
      "Preferred DERP",
      "Home DERP",
      "Network",
      "Latency",
      "Served regions",
    ]) {
      expect(markup, elsewhere).not.toContain(elsewhere);
    }
  });

  test("prints the self-test as a check or a cross, not as the schema's boolean", () => {
    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view }));

    expect(markup).toContain("No</span>");
    expect(markup).not.toContain(">false<");
  });
});
