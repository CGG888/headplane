/**
 * Structural validation of a local DERP map file (`derp.paths`).
 *
 * Headscale merges every file listed in `derp.paths` into the relay map it hands
 * to clients, and it does that at startup: a file it cannot decode either makes
 * Headscale refuse to start or silently contributes nothing. The rules here are
 * the ones Tailscale's `derpmap` format actually requires, checked before
 * anything is written.
 *
 * Kept free of server imports so the action (the authority) and the editor
 * (inline, while typing) share exactly one implementation, and no message text:
 * every problem is a stable code plus the position the YAML parser reports, so
 * the browser localizes it and the server never returns English.
 */

import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Range } from "yaml";

import { DERP_DEFAULT_PORT, MAX_DERP_MAP_ISSUES } from "./derp-map-limits";
import { parseIpv4, parseIpv6 } from "./trusted-proxies";

/** Every way a DERP map file can fail validation, in the order we check. */
export type DerpMapIssueCode =
  | "yamlSyntax"
  | "derpMapTooLarge"
  | "derpMapInvalidRoot"
  | "derpMapMissingRegions"
  | "derpMapInvalidRegions"
  | "derpRegionInvalid"
  | "derpRegionMissingId"
  | "derpRegionInvalidId"
  | "derpRegionMissingCode"
  | "derpRegionMissingName"
  | "derpRegionMissingNodes"
  | "derpRegionInvalidNodes"
  | "derpRegionDuplicateId"
  | "derpRegionDuplicateCode"
  | "derpNodeInvalid"
  | "derpNodeMissingName"
  | "derpNodeMissingHostname"
  | "derpNodeMissingRegionId"
  | "derpNodeInvalidRegionId"
  | "derpNodeRegionMismatch"
  | "derpNodeInvalidDerpPort"
  | "derpNodeInvalidStunPort"
  | "derpNodeInvalidIpv4"
  | "derpNodeInvalidIpv6"
  | "derpNodeInvalidStunOnly";

/** One problem, with the 1-indexed position the parser reported when known. */
export interface DerpMapIssue {
  code: DerpMapIssueCode;
  line?: number;
  column?: number;
  /** Values for `{placeholders}` in the localized message. */
  vars?: Record<string, string | number>;
}

/**
 * Re-exported for callers that already load the validator (the tests and the
 * server action); anything on the browser's critical path imports the limits
 * module directly so the YAML parser stays out of the page bundle.
 */
export { DERP_DEFAULT_PORT, MAX_DERP_MAP_BYTES, MAX_DERP_MAP_ISSUES } from "./derp-map-limits";

/** Anything the YAML parser produced, which carries the offset it started at. */
interface Positioned {
  range?: Range | null;
}

/**
 * The 1-indexed line and column a node starts at. A node the parser synthesized
 * (or a value that never came from the document) has no range, so the caller
 * simply reports the problem without a position.
 */
function position(counter: LineCounter, node: unknown): Omit<DerpMapIssue, "code"> {
  const offset = (node as Positioned | null | undefined)?.range?.[0];
  if (typeof offset !== "number") {
    return {};
  }

  const { line, col } = counter.linePos(offset);
  return { line, column: col };
}

/** The scalar a node holds, or `undefined` for a missing or non-scalar node. */
function scalarValue(node: unknown): unknown {
  return isScalar(node) ? node.value : undefined;
}

/** Integer value of a scalar, accepting `443` and `"443"` alike. */
function integerValue(node: unknown): number | undefined {
  const value = scalarValue(node);
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
  const value = scalarValue(node);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validates a DERP map file. Returns every problem found (up to
 * `MAX_DERP_MAP_ISSUES`); an empty list means Headscale can load the file.
 */
export function validateDerpMap(source: string): DerpMapIssue[] {
  const issues: DerpMapIssue[] = [];
  // A hard cap: a file with hundreds of problems is reported from the top down.
  const push = (issue: DerpMapIssue) => {
    if (issues.length < MAX_DERP_MAP_ISSUES) {
      issues.push(issue);
    }
  };

  const counter = new LineCounter();
  const document = parseDocument(source, { lineCounter: counter });

  // The parser's own message is English and never leaves this module; only the
  // position is passed on, and the browser words the problem.
  if (document.errors.length > 0) {
    const first = document.errors[0];
    const linePos = first.linePos?.[0];
    return [{ code: "yamlSyntax", line: linePos?.line, column: linePos?.col }];
  }

  const root = document.contents;
  if (!isMap(root)) {
    return [{ code: "derpMapInvalidRoot", ...position(counter, root) }];
  }

  const regions = root.get("regions", true);
  if (regions === undefined || regions === null) {
    return [{ code: "derpMapMissingRegions", ...position(counter, root) }];
  }

  if (!isMap(regions)) {
    return [{ code: "derpMapInvalidRegions", ...position(counter, regions) }];
  }

  // Region ids and codes identify a region everywhere else (clients, region-name
  // mappings), so a duplicate would make two relays indistinguishable.
  const seenIds = new Set<number>();
  const seenCodes = new Set<string>();

  for (const pair of regions.items) {
    const region = pair.value;

    if (!isMap(region)) {
      push({ code: "derpRegionInvalid", ...position(counter, pair.key) });
      continue;
    }

    const idNode = region.get("regionid", true);
    const id = integerValue(idNode);
    if (idNode === undefined || idNode === null) {
      push({ code: "derpRegionMissingId", ...position(counter, pair.key) });
    } else if (id === undefined || id < 1) {
      push({ code: "derpRegionInvalidId", ...position(counter, idNode) });
    } else if (seenIds.has(id)) {
      push({ code: "derpRegionDuplicateId", ...position(counter, idNode), vars: { id } });
    } else {
      seenIds.add(id);
    }

    const codeNode = region.get("regioncode", true);
    const regionCode = textValue(codeNode);
    if (regionCode === undefined) {
      push({ code: "derpRegionMissingCode", ...position(counter, codeNode ?? pair.key) });
    } else if (seenCodes.has(regionCode)) {
      push({
        code: "derpRegionDuplicateCode",
        ...position(counter, codeNode),
        vars: { code: regionCode },
      });
    } else {
      seenCodes.add(regionCode);
    }

    if (textValue(region.get("regionname", true)) === undefined) {
      push({
        code: "derpRegionMissingName",
        ...position(counter, region.get("regionname", true) ?? pair.key),
      });
    }

    const nodes = region.get("nodes", true);
    if (nodes === undefined || nodes === null) {
      push({ code: "derpRegionMissingNodes", ...position(counter, pair.key) });
      continue;
    }

    if (!isSeq(nodes)) {
      push({ code: "derpRegionInvalidNodes", ...position(counter, nodes) });
      continue;
    }

    for (const node of nodes.items) {
      validateNode(node, id, push, counter);
    }
  }

  return issues;
}

/** Convenience predicate for callers that only need a verdict. */
export function isDerpMap(source: string): boolean {
  return validateDerpMap(source).length === 0;
}

/**
 * One region as a DERP map describes it, reduced to what naming a region needs.
 * `code` and `name` are empty strings when the document does not carry them.
 */
export interface DerpMapRegionEntry {
  regionId: number;
  code: string;
  name: string;
}

/**
 * Reads the regions out of a DERP map document (YAML or JSON — YAML is a
 * superset), reusing the same scalar rules as {@link validateDerpMap}.
 *
 * This never reports problems: it is the read-only naming path, so anything the
 * document does not state is simply absent. A syntax error, a root that is not a
 * mapping, a `regions` value that is not a mapping and a region without a usable
 * `regionid` all contribute no entry, while a duplicate id keeps its first
 * occurrence so a repeated block cannot shadow the one Headscale reads first.
 * Two regions that share a `regioncode` are kept apart here because regions are
 * keyed by id everywhere else.
 */
export function readDerpMapRegions(source: string): DerpMapRegionEntry[] {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return [];
  }

  const root = document.contents;
  if (!isMap(root)) {
    return [];
  }

  const regions = root.get("regions", true);
  if (!isMap(regions)) {
    return [];
  }

  const entries: DerpMapRegionEntry[] = [];
  const seenIds = new Set<number>();

  for (const pair of regions.items) {
    const region = pair.value;
    if (!isMap(region)) {
      continue;
    }

    const id = integerValue(region.get("regionid", true));
    if (id === undefined || id < 1 || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    entries.push({
      regionId: id,
      code: textValue(region.get("regioncode", true)) ?? "",
      name: textValue(region.get("regionname", true)) ?? "",
    });
  }

  return entries;
}

function validateNode(
  node: unknown,
  regionId: number | undefined,
  push: (issue: DerpMapIssue) => void,
  counter: LineCounter,
) {
  if (!isMap(node)) {
    push({ code: "derpNodeInvalid", ...position(counter, node) });
    return;
  }

  if (textValue(node.get("name", true)) === undefined) {
    push({ code: "derpNodeMissingName", ...position(counter, node) });
  }

  if (textValue(node.get("hostname", true)) === undefined) {
    push({ code: "derpNodeMissingHostname", ...position(counter, node) });
  }

  const nodeIdNode = node.get("regionid", true);
  const nodeId = integerValue(nodeIdNode);
  if (nodeIdNode === undefined || nodeIdNode === null) {
    push({ code: "derpNodeMissingRegionId", ...position(counter, node) });
  } else if (nodeId === undefined || nodeId < 1) {
    push({ code: "derpNodeInvalidRegionId", ...position(counter, nodeIdNode) });
  } else if (regionId !== undefined && nodeId !== regionId) {
    push({
      code: "derpNodeRegionMismatch",
      ...position(counter, nodeIdNode),
      vars: { node: nodeId, region: regionId },
    });
  }

  const derpPort = node.get("derpport", true);
  if (derpPort !== undefined && derpPort !== null) {
    const port = integerValue(derpPort);
    if (port === undefined || port < 1 || port > 65_535) {
      push({
        code: "derpNodeInvalidDerpPort",
        ...position(counter, derpPort),
        vars: { default: DERP_DEFAULT_PORT },
      });
    }
  }

  // `stunport: 0` is how the format spells "this node does not answer STUN",
  // so zero is valid while an absent value simply leaves the default in place.
  const stunPort = node.get("stunport", true);
  if (stunPort !== undefined && stunPort !== null) {
    const port = integerValue(stunPort);
    if (port === undefined || port < 0 || port > 65_535) {
      push({ code: "derpNodeInvalidStunPort", ...position(counter, stunPort) });
    }
  }

  for (const family of ["ipv4", "ipv6"] as const) {
    const address = node.get(family, true);
    if (address === undefined || address === null) {
      continue;
    }

    const raw = scalarValue(address);
    // A blank string is the format's way of saying "no address of this family";
    // anything that is not a scalar at all is a mistake.
    if (typeof raw === "string" && raw.trim().length === 0) {
      continue;
    }

    const value = typeof raw === "string" ? raw.trim() : undefined;
    const valid =
      value !== undefined &&
      (family === "ipv4" ? parseIpv4(value) !== undefined : parseIpv6(value) !== undefined);

    if (!valid) {
      push({
        code: family === "ipv4" ? "derpNodeInvalidIpv4" : "derpNodeInvalidIpv6",
        ...position(counter, address),
      });
    }
  }

  const stunOnly = node.get("stunonly", true);
  if (stunOnly !== undefined && stunOnly !== null && typeof scalarValue(stunOnly) !== "boolean") {
    push({ code: "derpNodeInvalidStunOnly", ...position(counter, stunOnly) });
  }
}
