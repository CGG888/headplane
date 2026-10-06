import { describe, expect, test } from "vitest";

import {
  capDerpSourceNodes,
  DERP_SOURCE_NODE_LINE_LIMIT,
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
}) {
  return derpNodeSources({
    embedded: { ...EMBEDDED, ...input.embedded },
    groups: input.groups ?? [],
    mirrorEnabled: input.mirrorEnabled ?? false,
  });
}

function source(view: ReturnType<typeof derpNodeSources>, kind: string) {
  return view.sources.find((entry) => entry.kind === kind);
}

describe("derpNodeSources", () => {
  test("lists the embedded relay as one node with the address clients dial", () => {
    const result = view({});

    expect(source(result, "embedded")).toEqual({
      kind: "embedded",
      served: true,
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

    expect(source(result, "local")).toEqual({
      kind: "local",
      served: true,
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

    expect(source(result, "official")).toEqual({
      kind: "official",
      served: false,
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
    expect(source(result, "mirror")?.note).toBeUndefined();
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
    // The file holds nodes, so it has no gap: it carries the "not listed yet"
    // note instead, and this machine does not serve what it describes.
    expect(source(result, "mirror")?.gap).toBeUndefined();
    expect(source(result, "mirror")?.note).toBe("unlisted");
    expect(source(result, "mirror")?.served).toBe(false);
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
    expect(source(result, "mirror")?.note).toBeUndefined();
    expect(source(result, "mirror")?.served).toBe(true);
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
    expect(source(result, "mirror")?.note).toBeUndefined();
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
    expect(result.sources.map((entry) => entry.served)).toEqual([true, true, true, false]);
  });
});

describe("capDerpSourceNodes", () => {
  test("lists every node while there are few enough", () => {
    const nodes = Array.from({ length: 3 }, (_, index) => ({ name: `n${index}` }));

    expect(capDerpSourceNodes(nodes).lines).toHaveLength(3);
    expect(capDerpSourceNodes(nodes).hidden).toBe(0);
  });

  test("caps the list and counts the rest for the '+N more' line", () => {
    const nodes = Array.from({ length: DERP_SOURCE_NODE_LINE_LIMIT + 4 }, (_, index) => ({
      name: `n${index}`,
    }));
    const capped = capDerpSourceNodes(nodes);

    expect(capped.lines).toHaveLength(DERP_SOURCE_NODE_LINE_LIMIT);
    expect(capped.hidden).toBe(4);
  });

  test("a limit of zero hides every node instead of failing", () => {
    expect(capDerpSourceNodes([{ name: "n0" }], 0)).toEqual({ lines: [], hidden: 1 });
    expect(capDerpSourceNodes([])).toEqual({ lines: [], hidden: 0 });
  });

  test("the cap stays small enough that a source cannot flood the card", () => {
    expect(DERP_SOURCE_NODE_LINE_LIMIT).toBeGreaterThan(0);
    expect(DERP_SOURCE_NODE_LINE_LIMIT).toBeLessThanOrEqual(64);
  });
});
