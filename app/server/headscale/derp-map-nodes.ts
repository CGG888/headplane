/**
 * The nodes a DERP map lists, region by region.
 *
 * The region-name chain (`~/server/headscale/derp-region-sources`) only needs a
 * region's id, code and name, so the reader it shares with the map editor drops
 * everything else. The Overview card shows an operator what a configured map
 * actually relays, which means the nodes: their names, hostnames, ports and
 * declared addresses. This module reads exactly that in one pass over the same
 * document, keeping the scalar rules of
 * `~/routes/settings/headscale/derp-map-schema` — the reader the editor
 * validates with — so a value the editor accepts reads the same way here.
 *
 * Nothing here reports problems and nothing throws: a document that is not a
 * DERP map reads as `ok: false` with no nodes, and a node without a hostname is
 * skipped because no client could ever dial it.
 */

import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import type { DerpMapRegionEntry } from "~/routes/settings/headscale/derp-map-schema";

/** One node as a DERP map declares it. */
export interface DerpMapNodeEntry {
  /** `name`, or the hostname when the map leaves the name out. */
  name: string;
  hostname: string;
  /** `derpport` as declared; undefined when the map leaves the default (443). */
  derpPort?: number;
  /** `stunport` as declared; 0 is the format's "this node does not answer STUN". */
  stunPort?: number;
  stunOnly: boolean;
  ipv4?: string;
  ipv6?: string;
}

/** One region with the nodes the map lists under it. */
export interface DerpMapRegionDetail extends DerpMapRegionEntry {
  nodes: DerpMapNodeEntry[];
}

/** The nodes of every region one document lists, keyed by decimal region id. */
export interface DerpMapNodesRead {
  /** False when the document is not a DERP map at all. */
  ok: boolean;
  nodes: Map<number, DerpMapNodeEntry[]>;
}

/** Integer value of a scalar, accepting `443` and `"443"` alike. */
function integerValue(node: unknown): number | undefined {
  const value = isScalar(node) ? node.value : undefined;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return undefined;
}

/** Non-empty text of a scalar; a number or a blank string is not text here. */
function textValue(node: unknown): string | undefined {
  const value = isScalar(node) ? node.value : undefined;
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A port in its declared range, or undefined for a missing or invalid value. */
function portValue(node: unknown, min: number): number | undefined {
  const port = integerValue(node);
  return port !== undefined && port >= min && port <= 65_535 ? port : undefined;
}

/** One map node, or undefined when it cannot be dialled at all. */
function readNode(node: unknown): DerpMapNodeEntry | undefined {
  if (!isMap(node)) {
    return undefined;
  }

  const hostname = textValue(node.get("hostname", true));
  if (hostname === undefined) {
    return undefined;
  }

  const derpPort = portValue(node.get("derpport", true), 1);
  const stunPort = portValue(node.get("stunport", true), 0);
  const stunOnly = node.get("stunonly", true);
  const ipv4 = textValue(node.get("ipv4", true));
  const ipv6 = textValue(node.get("ipv6", true));

  return {
    name: textValue(node.get("name", true)) ?? hostname,
    hostname,
    ...(derpPort === undefined ? {} : { derpPort }),
    ...(stunPort === undefined ? {} : { stunPort }),
    // Only a real `true` marks a node STUN-only; anything else is not a marker.
    stunOnly: isScalar(stunOnly) && stunOnly.value === true,
    ...(ipv4 === undefined ? {} : { ipv4 }),
    ...(ipv6 === undefined ? {} : { ipv6 }),
  };
}

/** Every node a region lists; anything else under `nodes` contributes nothing. */
function readNodes(node: unknown): DerpMapNodeEntry[] {
  if (!isSeq(node)) {
    return [];
  }

  const nodes: DerpMapNodeEntry[] = [];
  for (const item of node.items) {
    const entry = readNode(item);
    if (entry !== undefined) {
      nodes.push(entry);
    }
  }

  return nodes;
}

/**
 * The nodes of every region a DERP map document describes (YAML or JSON — YAML
 * is a superset), keyed by region id. A duplicate id keeps its first region, as
 * everywhere else; a region the document does not state is simply absent.
 */
export function readDerpMapNodes(source: string): DerpMapNodesRead {
  const nodes = new Map<number, DerpMapNodeEntry[]>();
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return { ok: false, nodes };
  }

  const root = document.contents;
  if (!isMap(root)) {
    return { ok: false, nodes };
  }

  const regions = root.get("regions", true);
  if (!isMap(regions)) {
    return { ok: false, nodes };
  }

  for (const pair of regions.items) {
    const region = pair.value;
    if (!isMap(region)) {
      continue;
    }

    const id = integerValue(region.get("regionid", true));
    if (id === undefined || id < 1 || nodes.has(id)) {
      continue;
    }

    nodes.set(id, readNodes(region.get("nodes", true)));
  }

  return { ok: true, nodes };
}
