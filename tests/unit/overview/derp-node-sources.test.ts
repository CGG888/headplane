import { describe, expect, test } from "vitest";

import {
  derpNodeSources,
  type EmbeddedDerpNodeInput,
} from "~/routes/overview-helpers";
import type { DerpMapFileState, DerpMapGroupReading } from "~/server/headscale/derp-region-sources";

/** One node as a map declares it; only what the card reads is stated. */
function node(name: string, hostname: string, derpPort?: number) {
  return { name, hostname, stunOnly: false, ...(derpPort === undefined ? {} : { derpPort }) };
}

function group(
  kind: DerpMapGroupReading["kind"],
  source: string,
  state: DerpMapFileState,
  regions: { regionId: number; code?: string; name?: string; nodes?: ReturnType<typeof node>[] }[],
  unlisted = false,
): DerpMapGroupReading {
  return {
    kind,
    source,
    state,
    ...(unlisted ? { unlisted: true } : {}),
    regions: regions.map((region) => ({
      regionId: region.regionId,
      code: region.code ?? "",
      name: region.name ?? "",
      nodes: region.nodes ?? [],
    })),
  };
}

const EMBEDDED: EmbeddedDerpNodeInput = {
  enabled: true,
  regionId: 999,
  code: "headscale",
  name: "Headscale Embedded DERP",
  endpoint: "derp.example.com:443",
};

function view(input: {
  embedded?: Partial<EmbeddedDerpNodeInput>;
  groups?: DerpMapGroupReading[];
  mirrorEnabled?: boolean;
  manual?: Record<string, string>;
}) {
  return derpNodeSources({
    embedded: { ...EMBEDDED, ...input.embedded },
    groups: input.groups ?? [],
    mirrorEnabled: input.mirrorEnabled ?? false,
    ...(input.manual === undefined ? {} : { manual: input.manual }),
  });
}

function source(view: ReturnType<typeof derpNodeSources>, kind: string) {
  return view.sources.find((entry) => entry.kind === kind);
}

describe("derpNodeSources", () => {
  test("lists the embedded relay as one node with the address clients dial", () => {
    const result = view({});

    expect(source(result, "embedded")).toMatchObject({
      kind: "embedded",
      state: "served",
      nodes: [
        { name: "#999 · headscale · Headscale Embedded DERP", address: "derp.example.com:443" },
      ],
      maps: [],
    });
    expect(result.served).toBe(1);
    expect(result.total).toBe(1);
  });

  test("counts a local file's nodes and prints the map's own address", () => {
    const result = view({
      embedded: { enabled: false },
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          {
            regionId: 901,
            code: "ams",
            name: "Amsterdam",
            nodes: [node("901a", "a.example.com", 8443)],
          },
          { regionId: 902, code: "sfo", name: "SF", nodes: [node("902a", "b.example.com")] },
        ]),
      ],
    });

    expect(source(result, "local")).toMatchObject({
      kind: "local",
      state: "served",
      nodes: [
        { name: "901a", address: "a.example.com:8443" },
        { name: "902a", address: "b.example.com:443" },
      ],
      maps: [{ source: "/maps/local.yaml", state: "ok" }],
    });
    expect(source(result, "embedded")?.gap).toBe("disabled");
    expect(result.served).toBe(2);
    expect(result.total).toBe(2);
  });

  test("keeps the region filter's file apart from the local files", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
        group("mirror", "/maps/official-mirror.yaml", "ok", [
          { regionId: 911, code: "hkg", nodes: [node("911a", "hkg.example.com")] },
        ]),
      ],
    });

    expect(source(result, "local")?.nodes.map((line) => line.name)).toEqual(["901a"]);
    expect(source(result, "mirror")?.nodes).toEqual([
      { name: "911a", address: "hkg.example.com:443" },
    ]);
    expect(source(result, "mirror")?.gap).toBeUndefined();
    expect(result.served).toBe(2);
  });

  test("an upstream region this machine does not serve is counted, not served", () => {
    const result = view({
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 901, nodes: [node("901x", "shadow.example.com")] },
          { regionId: 903, code: "syd", nodes: [node("903a", "syd.example.com")] },
        ]),
      ],
    });

    expect(source(result, "official")).toMatchObject({
      kind: "official",
      state: "upstream",
      nodes: [{ name: "903a", address: "syd.example.com:443" }],
      maps: [{ source: "https://example.com/public.yaml", state: "ok" }],
    });
    expect(result.served).toBe(2);
    expect(result.total).toBe(3);
  });

  test("a region the embedded relay claimed is not counted twice", () => {
    const result = view({
      groups: [
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 999, nodes: [node("999a", "official.example.com")] },
        ]),
      ],
    });

    expect(source(result, "official")?.nodes).toEqual([]);
    expect(source(result, "official")?.gap).toBe("covered");
  });

  test("states why every source that lists nothing has nothing", () => {
    const result = view({ embedded: { enabled: false } });

    expect(result.sources.map((entry) => [entry.kind, entry.gap])).toEqual([
      ["embedded", "disabled"],
      ["local", "unconfigured"],
      ["mirror", "unconfigured"],
      ["official", "unconfigured"],
    ]);
    expect(result.served).toBe(0);
    expect(result.total).toBe(0);
  });

  test("a switched-on filter whose file is not loaded reads as unlisted", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
      ],
    });

    expect(source(result, "mirror")?.gap).toBe("unlisted");
    expect(source(result, "mirror")?.state).toBe("pending");
  });

  test("counts an unlisted filter file's nodes and says nobody receives them yet", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group(
          "mirror",
          "/maps/official-mirror.yaml",
          "ok",
          [{ regionId: 911, code: "hkg", nodes: [node("911a", "hkg.example.com")] }],
          true,
        ),
      ],
    });

    expect(source(result, "mirror")?.nodes).toEqual([
      { name: "911a", address: "hkg.example.com:443" },
    ]);
    // The file holds nodes, so it has no gap: its state says the configuration
    // does not load it yet, and this machine does not serve what it describes.
    expect(source(result, "mirror")?.gap).toBeUndefined();
    expect(source(result, "mirror")?.state).toBe("pending");
    expect(result.served).toBe(0);
    expect(result.total).toBe(1);
  });

  test("a listed filter file stays with the filter row, never with the local files", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
        group("mirror", "/maps/official-mirror.yaml", "ok", [
          { regionId: 911, nodes: [node("911a", "hkg.example.com")] },
        ]),
      ],
    });

    expect(source(result, "local")?.nodes.map((line) => line.name)).toEqual(["901a"]);
    expect(source(result, "mirror")?.nodes.map((line) => line.name)).toEqual(["911a"]);
    expect(source(result, "mirror")?.state).toBe("served");
    expect(result.served).toBe(2);
    expect(result.total).toBe(2);
  });

  test("an unlisted filter file nobody could read keeps the honest reason", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [group("mirror", "/maps/official-mirror.yaml", "unreadable", [], true)],
    });

    expect(source(result, "mirror")?.nodes).toEqual([]);
    expect(source(result, "mirror")?.gap).toBe("unreadable");
    expect(source(result, "mirror")?.state).toBe("pending");
  });

  test("a region an unlisted filter file describes is not counted twice", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group(
          "mirror",
          "/maps/official-mirror.yaml",
          "ok",
          [{ regionId: 911, nodes: [node("911a", "hkg.example.com")] }],
          true,
        ),
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 911, nodes: [node("911x", "shadow.example.com")] },
          { regionId: 903, code: "syd", nodes: [node("903a", "syd.example.com")] },
        ]),
      ],
    });

    expect(source(result, "mirror")?.nodes).toEqual([
      { name: "911a", address: "hkg.example.com:443" },
    ]);
    expect(source(result, "official")?.nodes).toEqual([
      { name: "903a", address: "syd.example.com:443" },
    ]);
    expect(result.total).toBe(2);
    expect(result.served).toBe(0);
  });

  test("map files nobody could read, and maps that list nothing, read apart", () => {
    const unreadable = view({
      embedded: { enabled: false },
      groups: [group("local", "/maps/missing.yaml", "unreadable", [])],
    });
    const empty = view({
      embedded: { enabled: false },
      groups: [group("local", "/maps/empty.yaml", "empty", [])],
    });

    expect(source(unreadable, "local")?.gap).toBe("unreadable");
    expect(source(empty, "local")?.gap).toBe("empty");
    expect(source(unreadable, "local")?.maps).toEqual([
      { source: "/maps/missing.yaml", state: "unreadable" },
    ]);
  });

  test("lists the sources in the card's order, with the copies behind them", () => {
    const result = view({
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
        group("mirror", "/maps/official-mirror.yaml", "ok", [
          { regionId: 911, nodes: [node("911a", "hkg.example.com")] },
        ]),
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 903, nodes: [node("903a", "syd.example.com")] },
        ]),
      ],
    });

    expect(result.sources.map((entry) => entry.kind)).toEqual([
      "embedded",
      "local",
      "mirror",
      "official",
    ]);
    expect(result.sources.map((entry) => entry.state)).toEqual([
      "served",
      "served",
      "served",
      "upstream",
    ]);
  });
});

describe("derpNodeSources states", () => {
  test("the embedded relay is served here while derp.server enables it", () => {
    expect(source(view({}), "embedded")?.state).toBe("served");
    // A configuration that does not enable derp.server describes no embedded
    // relay at all, so its row reads off rather than served.
    expect(source(view({ embedded: { enabled: false } }), "embedded")?.state).toBe("off");
  });

  test("a file derp.paths lists marks the filter's row as served here", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group("mirror", "/maps/official-mirror.yaml", "ok", [
          { regionId: 911, code: "hkg", nodes: [node("911a", "hkg.example.com")] },
        ]),
      ],
    });

    expect(source(result, "mirror")?.state).toBe("served");
    expect(source(result, "mirror")?.gap).toBeUndefined();
    expect(result.served).toBe(1);
  });

  test("a mirror file derp.paths leaves out is configured but not in effect", () => {
    const result = view({
      embedded: { enabled: false },
      mirrorEnabled: true,
      groups: [
        group(
          "mirror",
          "/maps/official-mirror.yaml",
          "ok",
          [{ regionId: 911, code: "hkg", nodes: [node("911a", "hkg.example.com")] }],
          true,
        ),
      ],
    });

    expect(source(result, "mirror")?.state).toBe("pending");
    // Configured, but nothing hands its nodes to a client: known, not served.
    expect(source(result, "mirror")?.nodes).toHaveLength(1);
    expect(result.served).toBe(0);
    expect(result.total).toBe(1);
  });

  test("a filter that is off, and one that names no file, read apart", () => {
    const off = view({ embedded: { enabled: false } });
    const onWithoutFile = view({ embedded: { enabled: false }, mirrorEnabled: true });

    expect(source(off, "mirror")?.state).toBe("off");
    expect(source(onWithoutFile, "mirror")?.state).toBe("pending");
  });

  test("an empty derp.urls is not enabled; a listed map is provided by Tailscale", () => {
    const none = view({ embedded: { enabled: false } });
    const listed = view({
      embedded: { enabled: false },
      groups: [
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 903, code: "syd", nodes: [node("903a", "syd.example.com")] },
        ]),
      ],
    });

    expect(source(none, "official")?.state).toBe("off");
    expect(source(listed, "official")?.state).toBe("upstream");
    expect(source(listed, "official")?.nodes).toHaveLength(1);
    // Tailscale serves them, so this machine counts none of them as served.
    expect(listed.served).toBe(0);
    expect(listed.total).toBe(1);
  });

  test("a configured upstream nobody could read is still provided by Tailscale", () => {
    const result = view({
      embedded: { enabled: false },
      groups: [group("remote", "https://example.com/public.yaml", "unreadable", [])],
    });

    expect(source(result, "official")?.state).toBe("upstream");
    expect(source(result, "official")?.gap).toBe("unreadable");
  });

  test("no region is counted twice, and only the sources served here count", () => {
    const result = view({
      mirrorEnabled: true,
      groups: [
        group(
          "mirror",
          "/maps/official-mirror.yaml",
          "ok",
          [{ regionId: 911, nodes: [node("911a", "hkg.example.com")] }],
          true,
        ),
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 911, nodes: [node("911x", "shadow.example.com")] },
          { regionId: 999, nodes: [node("999x", "embedded.example.com")] },
          { regionId: 903, nodes: [node("903a", "syd.example.com")] },
        ]),
      ],
    });

    // Five nodes are configured across those maps; three regions are claimed
    // once each, and only the embedded relay is handed to clients here.
    expect(source(result, "mirror")?.nodes.map((line) => line.name)).toEqual(["911a"]);
    expect(source(result, "official")?.nodes.map((line) => line.name)).toEqual(["903a"]);
    expect(source(result, "embedded")?.nodes).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.served).toBe(1);
  });
});

/**
 * What the card lists now that nothing collapses: one entry per region, read
 * straight away. The entries are the same claim the node counts come from, so a
 * flat list and the totals can never disagree.
 */
describe("derpNodeSources region lines", () => {
  test("lists one entry per region, with its id, its Chinese name and its node count", () => {
    const result = view({
      embedded: { enabled: false },
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          {
            regionId: 901,
            code: "hkg",
            name: "香港",
            nodes: [node("901a", "a.example.com"), node("901b", "b.example.com")],
          },
          { regionId: 902, code: "sin", name: "新加坡", nodes: [node("902a", "c.example.com")] },
        ]),
      ],
    });

    expect(source(result, "local")?.regions).toEqual([
      {
        regionId: 901,
        name: "香港",
        nodeCount: 2,
        endpoints: ["a.example.com:443", "b.example.com:443"],
      },
      { regionId: 902, name: "新加坡", nodeCount: 1, endpoints: ["c.example.com:443"] },
    ]);
    // The id comes from the region the source declares, never from a node name,
    // and the count is that region's own.
    expect(source(result, "local")?.regions.map((line) => line.regionId)).toEqual([901, 902]);
    expect(source(result, "local")?.regions.map((line) => line.nodeCount)).toEqual([2, 1]);
  });

  test("the operator's manual Chinese name stands for the region", () => {
    const result = view({
      embedded: { enabled: false },
      manual: { "901": "阿姆斯特丹" },
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          {
            regionId: 901,
            code: "ams",
            name: "Amsterdam",
            nodes: [node("901a", "a.example.com")],
          },
        ]),
      ],
    });

    expect(source(result, "local")?.regions).toEqual([
      { regionId: 901, name: "阿姆斯特丹", nodeCount: 1, endpoints: ["a.example.com:443"] },
    ]);
  });

  test("the embedded relay is one entry, named and counted like every other", () => {
    expect(source(view({}), "embedded")?.regions).toEqual([
      {
        regionId: 999,
        name: "Headscale Embedded DERP",
        nodeCount: 1,
        endpoints: ["derp.example.com:443"],
      },
    ]);
    // A region no source names keeps its id alone; the node still counts.
    const unnamed = view({
      embedded: { enabled: false },
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, nodes: [node("901a", "a.example.com")] },
        ]),
      ],
    });

    expect(source(unnamed, "local")?.regions).toEqual([
      { regionId: 901, nodeCount: 1, endpoints: ["a.example.com:443"] },
    ]);
  });

  test("keeps the card's order and lists a region claimed above only once", () => {
    const result = view({
      mirrorEnabled: true,
      groups: [
        group("local", "/maps/local.yaml", "ok", [
          { regionId: 901, code: "hkg", name: "香港", nodes: [node("901a", "a.example.com")] },
        ]),
        group("mirror", "/maps/official-mirror.yaml", "ok", [
          { regionId: 911, code: "sin", name: "新加坡", nodes: [node("911a", "b.example.com")] },
        ]),
        group("remote", "https://example.com/public.yaml", "ok", [
          { regionId: 901, nodes: [node("901x", "shadow.example.com")] },
          { regionId: 911, nodes: [node("911x", "shadow.example.com")] },
          { regionId: 903, code: "syd", name: "悉尼", nodes: [node("903a", "c.example.com")] },
        ]),
      ],
    });

    expect(result.sources.map((entry) => entry.kind)).toEqual([
      "embedded",
      "local",
      "mirror",
      "official",
    ]);
    // Embedded relay first, then the local files, then the filter's file, then
    // the upstream: a region the official map repeats is not listed again.
    expect(result.sources.flatMap((entry) => entry.regions.map((line) => line.regionId))).toEqual([
      999, 901, 911, 903,
    ]);
    const listed = result.sources.flatMap((entry) => entry.regions.map((line) => line.regionId));
    expect(new Set(listed).size).toBe(listed.length);
    // Five nodes are configured; the two shadowed upstream regions add none, and
    // the per-region counts are exactly the node inventory's own total.
    expect(result.total).toBe(4);
    expect(
      result.sources
        .flatMap((entry) => entry.regions)
        .reduce((total, line) => total + line.nodeCount, 0),
    ).toBe(result.total);
  });
});
