import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The attribute row binds the browser-local masking store through the router,
// which a server-rendered card has none of; the card's own contract is that it
// hands addresses to that row, so the row's decision is stubbed here and driven
// by each test.
const maskState = vi.hoisted(() => ({ masked: false, canReveal: false }));

vi.mock("~/components/address-visibility", () => ({
  useAddressMask: () => maskState,
}));

import NodeDiagnostics, { NodeDebugRows } from "~/routes/machines/components/node-diagnostics";
import type {
  DerpEmbeddedServer,
  DerpRegionNameData,
  MachineLatencyInventory,
} from "~/routes/machines/derp-info";
import {
  buildNodeDiagnostics,
  humanizeFieldName,
  NODE_DEBUG_FIELD_LIMIT,
  NODE_DEBUG_GROUP_LIMIT,
  type NodeDebugField,
  type NodeDebugView,
  type NodeDiagnosticsInput,
  type NodeDiagnosticsLabels,
} from "~/routes/machines/diagnostics";
import type { DerpNodeSourceKind } from "~/routes/overview-helpers";
import type { HostInfo } from "~/types";

/**
 * The wording the card supplies to the locale-free builder, using the same
 * relay and latency source keys the relay card prints, so these tests read the
 * words a person would actually see.
 */
const LABELS: NodeDiagnosticsLabels = {
  notReported: "not reported",
  unknown: "Unknown",
  latencySources: { reported: "Client report", measured: "Measured here" },
  relaySources: {
    embedded: "Embedded relay",
    local: "Local map files",
    mirror: "Official filter",
    official: "Official upstream",
  },
};

/** Headscale's embedded relay, as the loader reads it out of the config. */
const EMBEDDED: DerpEmbeddedServer = {
  enabled: true,
  regionId: 999,
  regionCode: "headscale",
  regionName: "Headscale Embedded DERP",
};

/** A complete agent report: version, host, endpoints and the NetInfo block. */
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

/** Region names the loader resolved, and the source serving each region. */
const REGIONS: DerpRegionNameData = {
  manual: { "999": "Headscale Embedded DERP" },
  local: { "901": { regionId: 901, code: "hkg", name: "香港" } },
  remote: { "902": { regionId: 902, code: "sin", name: "Singapore" } },
};

const RELAY_SOURCES: Readonly<Record<string, DerpNodeSourceKind>> = {
  "901": "local",
  "902": "mirror",
  "999": "embedded",
};

/** The served inventory the loader prepares: 999 measured here, 901/902 reported. */
const INVENTORY: MachineLatencyInventory = {
  servedRegionIds: [901, 902, 999],
  assignment: {},
  measured: { "999": 33 },
};

/** Everything the machine page already loads, as the page hands it to the card. */
const FULL: NodeDiagnosticsInput = {
  agentEnabled: true,
  stats: STATS,
  regions: REGIONS,
  relaySources: RELAY_SOURCES,
  server: EMBEDDED,
  inventory: INVENTORY,
};

/** Every row of one group, by the group's own key. */
function fieldsOf(view: NodeDebugView, group: string): NodeDebugField[] {
  return view.groups.find((entry) => entry.key === group)?.fields ?? [];
}

/** One row, by the exact dotted path its tooltip prints. */
function fieldOf(view: NodeDebugView, path: string): NodeDebugField | undefined {
  for (const group of view.groups) {
    const found = group.fields.find((field) => field.path === path);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

beforeEach(() => {
  maskState.masked = false;
  maskState.canReveal = false;
});

describe("humanizeFieldName", () => {
  test("reads a field name as a heading", () => {
    expect(humanizeFieldName("givenName")).toBe("Given name");
    expect(humanizeFieldName("node_key")).toBe("Node key");
    expect(humanizeFieldName("DERPLatency")).toBe("DERP latency");
    expect(humanizeFieldName("id")).toBe("ID");
  });

  test("keeps a version suffix and an acronym joined to their word", () => {
    expect(humanizeFieldName("WorkingIPv6")).toBe("Working IPv6");
    expect(humanizeFieldName("WorkingIPv4")).toBe("Working IPv4");
    expect(humanizeFieldName("WorkingICMPv4")).toBe("Working ICMPv4");
    expect(humanizeFieldName("PreferredDERP")).toBe("Preferred DERP");
  });

  test("prints a name the camel-case rules cannot recover as it is written", () => {
    expect(humanizeFieldName("UPnP")).toBe("UPnP");
  });
});

describe("buildNodeDiagnostics", () => {
  test("groups the agent's report, this machine's relays and the served regions", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(view.status).toBe("ok");
    expect(view.truncated).toBe(false);
    expect(view.groups.map((group) => [group.key, group.label])).toEqual([
      ["agent", "Agent"],
      ["network", "Network"],
      ["latency", "Latency"],
      ["servedRegions", "Served regions"],
    ]);
    // 5 agent rows, 10 network rows, 3 latency rows of 5, 3 served rows of 3.
    expect(view.fieldCount).toBe(39);
  });

  test("carries the values the agent reported, under the agent's own names", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldsOf(view, "agent").map((field) => [field.label, field.value])).toEqual([
      ["IPN version", "1.78.1-t1234"],
      ["OS", "linux"],
      ["OS version", "6.6.0-arch1"],
      ["Hostname", "laptop"],
      ["Endpoints", "100.64.0.2:41641"],
    ]);
    // The row's tooltip is the exact path a person would search the agent's
    // report for.
    expect(fieldOf(view, "agent.Hostname")?.path).toBe("agent.Hostname");
  });

  test("names the regions the NetInfo block points at through the one label chain", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "network.PreferredDERP")?.value).toBe("#901 · hkg · 香港");
    expect(fieldOf(view, "network.HomeDERP")?.value).toBe("#999 · Headscale Embedded DERP");
    expect(fieldOf(view, "network.WorkingIPv6")?.value).toBe("true");
    expect(fieldOf(view, "network.UPnP")?.value).toBe("false");
    expect(fieldOf(view, "network.UPnP")?.label).toBe("UPnP");
  });

  test("prints 'not reported' for every fact the agent left out", () => {
    // No NetInfo block, no hostname and no endpoints: the card still lists what
    // it looked for, so a reader can see exactly what is missing.
    const view = buildNodeDiagnostics(
      { agentEnabled: true, stats: { IPNVersion: "1.78.1", OS: "linux" } },
      LABELS,
    );

    expect(view.status).toBe("ok");
    expect(fieldOf(view, "agent.IPNVersion")?.value).toBe("1.78.1");
    expect(fieldOf(view, "agent.Hostname")?.value).toBe("not reported");
    expect(fieldOf(view, "agent.Endpoints")?.value).toBe("not reported");
    expect(fieldsOf(view, "network").map((field) => field.value)).toEqual(
      Array.from({ length: 10 }, () => "not reported"),
    );
    // Nothing served and nothing measured is one honest row each, never nothing.
    expect(fieldsOf(view, "latency").map((field) => [field.label, field.value])).toEqual([
      ["Latency", "not reported"],
    ]);
    expect(fieldsOf(view, "servedRegions").map((field) => [field.label, field.value])).toEqual([
      ["Served regions", "not reported"],
    ]);
  });

  test("marks addresses and identifiers so the card masks and copies them", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "agent.Endpoints")).toMatchObject({
      kind: "address",
      address: true,
      copyable: true,
    });
    expect(fieldOf(view, "servedRegions.[2].regionId")).toMatchObject({
      kind: "identifier",
      address: false,
      copyable: true,
    });
    expect(fieldOf(view, "agent.Hostname")).toMatchObject({
      kind: "text",
      address: false,
      copyable: false,
    });
  });

  test("lists the same per-region latency rows as the relay card, with their sources", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldOf(view, "latency.[0].region")?.value).toBe("#901 · hkg · 香港");
    expect(fieldOf(view, "latency.[0].latency")?.value).toBe("20ms");
    expect(fieldOf(view, "latency.[0].latencySource")?.value).toBe("Client report");
    expect(fieldOf(view, "latency.[0].relaySource")?.value).toBe("Local map files");
    expect(fieldOf(view, "latency.[0].inUse")?.value).toBe("true");
    // The region this server measured says so, rather than posing as a report.
    expect(fieldOf(view, "latency.[1].region")?.value).toBe("#999 · Headscale Embedded DERP");
    expect(fieldOf(view, "latency.[1].latency")?.value).toBe("33ms");
    expect(fieldOf(view, "latency.[1].latencySource")?.value).toBe("Measured here");
    expect(fieldOf(view, "latency.[1].relaySource")?.value).toBe("Embedded relay");
    expect(fieldOf(view, "latency.[2].region")?.value).toBe("#902 · sin · Singapore");
    expect(fieldOf(view, "latency.[2].inUse")?.value).toBe("false");
  });

  test("lists the served-region inventory with the source that serves each region", () => {
    const view = buildNodeDiagnostics(FULL, LABELS);

    expect(fieldsOf(view, "servedRegions").map((field) => field.value)).toEqual([
      "901",
      "#901 · hkg · 香港",
      "Local map files",
      "902",
      "#902 · sin · Singapore",
      "Official filter",
      "999",
      "#999 · Headscale Embedded DERP",
      "Embedded relay",
    ]);
  });

  test("says there is nothing to show when the agent reported no fact at all", () => {
    const view = buildNodeDiagnostics({ agentEnabled: true, stats: {} }, LABELS);

    expect(view.status).toBe("empty");
    expect(view.groups).toEqual([]);
    expect(view.fieldCount).toBe(0);
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
    const view = buildNodeDiagnostics({ agentEnabled: true }, LABELS);

    expect(view).toMatchObject({ status: "unavailable", failure: "no-report", groups: [] });
    // A loader that handed nothing at all reads the same way.
    expect(buildNodeDiagnostics(undefined, LABELS).status).toBe("unavailable");
  });

  test("bounds a deployment with far more regions than the card may print", () => {
    const view = buildNodeDiagnostics(
      {
        ...FULL,
        inventory: {
          servedRegionIds: Array.from({ length: 40 }, (_, index) => 900 + index),
          assignment: {},
          measured: {},
        },
      },
      LABELS,
    );

    expect(view.status).toBe("ok");
    expect(view.truncated).toBe(true);
    expect(view.groups.length).toBeLessThanOrEqual(NODE_DEBUG_GROUP_LIMIT);
    for (const group of view.groups) {
      expect(group.fields.length, group.key).toBeLessThanOrEqual(NODE_DEBUG_FIELD_LIMIT);
    }
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

  test("summarises the reported fields while it stays closed", () => {
    const markup = render(FULL);

    // Collapsed by default: the card says what it holds and shows the rows only
    // once opened, except when there is nothing to report at all.
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Node diagnostics");
    expect(markup).toContain("39 fields");
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

  test("prints one labelled row per reported field, grouped", () => {
    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view }));

    expect(markup).toContain("Agent");
    expect(markup).toContain("IPN version");
    expect(markup).toContain("1.78.1-t1234");
    expect(markup).toContain("Network");
    expect(markup).toContain("Preferred DERP");
    expect(markup).toContain("#901 · hkg · 香港");
    // Identifiers keep their exact value, and the copyable rows carry the
    // page's own copy control.
    expect(markup).toContain("Region ID");
    expect(markup).toContain("lucide-copy");
  });

  test("keeps addresses hidden by default while identifiers stay readable", () => {
    maskState.masked = true;
    maskState.canReveal = true;
    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view }));

    // The address is the fixed mask, never the address behind it.
    expect(markup).toContain("••••••••");
    expect(markup).not.toContain("100.64.0.2:41641");
    // An identifier is not an address, so masking leaves it alone.
    expect(markup).toContain(">901<");
  });

  test("says when the view was cut down to size", () => {
    const wide = buildNodeDiagnostics(
      {
        ...FULL,
        inventory: {
          servedRegionIds: Array.from({ length: 40 }, (_, index) => 900 + index),
          assignment: {},
          measured: {},
        },
      },
      LABELS,
    );

    const markup = renderToStaticMarkup(createElement(NodeDebugRows, { view: wide }));
    expect(markup).toContain("Some fields are not shown here to keep the card readable.");
  });
});
