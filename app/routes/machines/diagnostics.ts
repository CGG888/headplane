/**
 * The node-diagnostics card's pure part: the plain per-node facts the machine
 * page already holds, turned into the labelled, grouped rows the card prints.
 *
 * There is no per-node debug read in Headscale's HTTP API, so nothing here
 * asks one for data and nothing here can fail on the wire: the payload is the
 * agent-reported host info the page already loads, the per-region relay rows
 * the relay card computes from that same report, and the served-region
 * inventory the loader derived from the configured DERP maps. Everything is a
 * plain function over plain values — the loader, the card and the tests share
 * one implementation, and this module stays free of server-only imports.
 *
 * Two rules shape what it prints. First, the payload's own field names are
 * kept — a person debugging a node needs the identifier the agent reported,
 * not a renamed copy of it — so a row is `label: value` with the raw path as
 * its tooltip, and a fact nobody reported prints as the card's own "not
 * reported" wording instead of vanishing. Second, nothing is ever dumped as
 * raw JSON: nested objects are walked into dotted rows, arrays of objects are
 * indexed into their own rows, and the whole view is bounded so a large
 * deployment cannot fill the page.
 */

import type { DerpNodeSourceKind } from "~/routes/overview-helpers";
import type { HostInfo } from "~/types";

import {
  buildMachineLatencyRows,
  embeddedDerpRegion,
  parseDerpRegionKey,
  resolveDerpRegionLabel,
  type DerpEmbeddedServer,
  type DerpRegionLabelSources,
  type DerpRegionNameData,
  type MachineLatencyInventory,
  type MachineLatencySource,
} from "./derp-info";

/** What one row's value is, which is what decides how the card renders it. */
export type NodeDebugFieldKind = "address" | "identifier" | "text";

/** One leaf of the debug payload, as the card's definition list prints it. */
export interface NodeDebugField {
  /** Stable identity of the row: the dotted path, indices included. */
  key: string;
  /** Humanized last segment, e.g. `givenName` -> `Given name`. */
  label: string;
  /** The raw dotted path, kept exact for the row's tooltip. */
  path: string;
  /** The value as text, already trimmed and length-bounded. */
  value: string;
  kind: NodeDebugFieldKind;
  /** True for identifiers and addresses, which are worth copying. */
  copyable: boolean;
  /** True for addresses, which render masked by default. */
  address: boolean;
}

/** One top-level area of the payload, as the card's section. */
export interface NodeDebugGroup {
  /** The payload's own top-level key, or `value` for a scalar payload. */
  key: string;
  /** Humanized group heading. */
  label: string;
  fields: NodeDebugField[];
}

export type NodeDebugStatus = "ok" | "empty" | "unavailable";

/** Why the card has nothing reported to show. */
export type NodeDiagnosticsFailure = "no-agent" | "no-report";

/**
 * What the loader and the card together know about one node's diagnostics:
 * plain values only, so it survives the wire and the builder stays pure.
 *
 * Every field is a value the machine page already holds — the builder adds
 * nothing, reads nothing and asks no client for anything.
 */
export interface NodeDiagnosticsInput {
  /** False when the Headplane Agent feature is off, so nothing reported. */
  agentEnabled: boolean;
  /** The agent's host info for this machine, when it reported any at all. */
  stats?: HostInfo;
  /** Region names the loader resolved, for the one region-label chain. */
  regions?: DerpRegionNameData;
  /** Which configured source serves each region, prepared by the loader. */
  relaySources?: Readonly<Record<string, DerpNodeSourceKind>>;
  /** Headscale's embedded DERP configuration, when it could be read. */
  server?: DerpEmbeddedServer;
  /** The regions this deployment serves and the values the server measured. */
  inventory?: MachineLatencyInventory;
}

/** The card's own wording, passed in so the builder stays free of i18n. */
export interface NodeDiagnosticsLabels {
  /** What a fact the agent did not report reads as. */
  notReported: string;
  /** What a region no source names reads as. */
  unknown: string;
  /** Where a latency row's number came from, worded like the relay card. */
  latencySources: Readonly<Record<MachineLatencySource, string>>;
  /** Which configured source serves a region, worded like the relay card. */
  relaySources: Readonly<Record<DerpNodeSourceKind, string>>;
}

/** The card's view of the payload: rows and groups, never raw JSON. */
export interface NodeDebugView {
  status: NodeDebugStatus;
  groups: NodeDebugGroup[];
  /** Rows the card would print across every group. */
  fieldCount: number;
  /** True when the payload held more than the view is willing to print. */
  truncated: boolean;
  failure?: NodeDiagnosticsFailure;
}

/** Rows one group may print; a debug payload can be arbitrarily large. */
export const NODE_DEBUG_FIELD_LIMIT = 24;

/** Groups the card may print, so a payload of many keys stays readable. */
export const NODE_DEBUG_GROUP_LIMIT = 6;

/** Longest value the card prints before it truncates with an ellipsis. */
export const NODE_DEBUG_VALUE_LIMIT = 240;

/** The one key a scalar (non-object) payload's single group uses. */
const SCALAR_GROUP_KEY = "value";

/** The one key a payload that is itself a list uses. */
const ITEMS_GROUP_KEY = "items";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;
/** A hostname with at least one letter, optionally with a port. */
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*(?::\d{1,5})?$/i;
/** A value that reads as an opaque key rather than as prose. */
const KEY_VALUE = /^(?:hskey-|nodekey:|key:|tskey-)/i;
const HEX_VALUE = /^[0-9a-f]{16,}$/i;
/** Field names that carry an identifier worth copying. */
const IDENTIFIER_NAME = /(?:^|[_-])(?:id|key|hash|token|uuid|guid|fingerprint)$/i;
/** The same names as they appear in camelCase (`nodeKey`, `machineKey`). */
const IDENTIFIER_CAMEL = /(?:Id|ID|Key|Hash|Token|Uuid|GUID|Fingerprint)$/;

/** True when the text is an address (or an address with a prefix or port). */
function looksLikeAddress(value: string): boolean {
  if (IPV4.test(value) || HOSTNAME.test(value)) {
    return true;
  }

  // IPv6 and IPv6 CIDRs: hex groups and colons, nothing else.
  return value.includes(":") && /^[0-9a-f:./]+$/i.test(value);
}

/** True when the field (by name or by value) is an identifier worth copying. */
function looksLikeIdentifier(path: string, value: string): boolean {
  const last = path.split(".").pop() ?? path;
  return (
    IDENTIFIER_NAME.test(last) ||
    IDENTIFIER_CAMEL.test(last) ||
    KEY_VALUE.test(value) ||
    HEX_VALUE.test(value)
  );
}

/** Field names that read as an acronym rather than as a word. */
const ACRONYMS = new Set(["id", "ip", "url", "uri", "api", "os", "dns", "udp", "tcp"]);

/**
 * Words whose printed form is neither the source's nor plain upper case, so the
 * card says `IPv6` where the page says `IPv6` rather than `IPV6`.
 */
const WORD_SPELLINGS: Record<string, string> = {
  ipv4: "IPv4",
  ipv6: "IPv6",
};

/**
 * Names whose own spelling the camel-case rules cannot recover: `UPnP` would
 * otherwise read "UPn P", so it is printed exactly as the agent reports it.
 */
const PRESERVED_FIELD_NAMES = new Set(["UPnP"]);

/**
 * `givenName` / `node_key` / `DERPLatency` as a heading a person can read.
 *
 * The acronym rule needs a run of at least two capitals, and never splits
 * before a digit: `WorkingIPv6` is one word plus `IPv6`, not "I Pv6", and
 * `WorkingICMPv4` keeps its `ICMPv4` whole.
 */
export function humanizeFieldName(field: string): string {
  if (PRESERVED_FIELD_NAMES.has(field)) {
    return field;
  }

  const spaced = field
    .replace(/([A-Z]{2,})([A-Z][a-z])(?![0-9])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();

  if (spaced.length === 0) {
    return field;
  }

  // Sentence case, like every other label on the page: `givenName` reads
  // "Given name", while an all-caps run (`DERP`) keeps its capitals.
  return spaced
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      const spelled = WORD_SPELLINGS[lower];
      if (spelled !== undefined) {
        return spelled;
      }

      if (ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }

      if (index === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }

      return /^[A-Z][a-z]+$/.test(word) ? lower : word;
    })
    .join(" ");
}

/** A primitive as the row prints it, or `undefined` when it prints as nothing. */
function formatPrimitive(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : undefined;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return undefined;
}

/** Every primitive of an array, joined into the one row the array becomes. */
function joinPrimitives(values: readonly unknown[]): string | undefined {
  const parts: string[] = [];
  for (const value of values) {
    const text = formatPrimitive(value);
    if (text !== undefined) {
      parts.push(text);
    }
  }

  return parts.length === 0 ? undefined : parts.join(", ");
}

function truncateValue(value: string): string {
  return value.length > NODE_DEBUG_VALUE_LIMIT
    ? `${value.slice(0, NODE_DEBUG_VALUE_LIMIT)}…`
    : value;
}

/** The path's last named segment, ignoring array indices. */
function lastNamedSegment(path: string): string {
  const segments = path.split(".");
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment.length > 0 && !segment.startsWith("[")) {
      return segment;
    }
  }

  return path;
}

/** What a leaf row already knows about its value, before the value is read. */
interface LeafHint {
  /** Every part of a joined array was an address, even if the join is not. */
  address?: boolean;
}

/** Adds one leaf row, unless the group is already full. */
function pushLeaf(out: NodeDebugField[], path: string, value: string, hint: LeafHint = {}): void {
  if (out.length >= NODE_DEBUG_FIELD_LIMIT) {
    return;
  }

  const text = truncateValue(value);
  const address = hint.address === true || looksLikeAddress(text);
  const identifier = !address && looksLikeIdentifier(path, text);
  out.push({
    key: path,
    label: humanizeFieldName(lastNamedSegment(path)),
    path,
    value: text,
    kind: address ? "address" : identifier ? "identifier" : "text",
    copyable: address || identifier,
    address,
  });
}

/**
 * Walks one value into leaf rows. Nested objects become dotted paths, an array
 * of objects is indexed (`peers.[0].key`), an array of primitives is one joined
 * row, and a value that is neither (a function, a symbol) prints as nothing.
 */
function collectFields(value: unknown, path: string, out: NodeDebugField[]): void {
  if (out.length >= NODE_DEBUG_FIELD_LIMIT || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }

    const primitives = joinPrimitives(value);
    if (primitives !== undefined) {
      // An array of addresses joins into one line that no longer reads as an
      // address itself, so the parts decide how the row is treated.
      const parts = value
        .map((entry) => formatPrimitive(entry))
        .filter((entry): entry is string => entry !== undefined);
      pushLeaf(out, path, primitives, {
        address: parts.length > 0 && parts.every((entry) => looksLikeAddress(entry)),
      });
      return;
    }

    value.forEach((entry, index) => collectFields(entry, `${path}.[${index}]`, out));
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectFields(child, path.length === 0 ? key : `${path}.${key}`, out);
    }

    return;
  }

  const text = formatPrimitive(value);
  if (text !== undefined) {
    pushLeaf(out, path, text);
  }
}

/** One top-level entry of the payload as a group, with its rows collected. */
function groupOf(key: string, label: string, value: unknown): NodeDebugGroup | undefined {
  const fields: NodeDebugField[] = [];
  // The group's own key starts every path, so a row reads `node.givenName`.
  collectFields(value, key, fields);
  return fields.length === 0 ? undefined : { key, label, fields };
}

/** The groups a whole payload yields, capped so the card cannot run away. */
function groupsOf(payload: unknown): { groups: NodeDebugGroup[]; truncated: boolean } {
  if (payload === null || payload === undefined) {
    return { groups: [], truncated: false };
  }

  if (typeof payload !== "object") {
    const scalar = formatPrimitive(payload);
    if (scalar === undefined) {
      return { groups: [], truncated: false };
    }

    const fields: NodeDebugField[] = [];
    pushLeaf(fields, SCALAR_GROUP_KEY, scalar);
    return {
      groups: [{ key: SCALAR_GROUP_KEY, label: humanizeFieldName(SCALAR_GROUP_KEY), fields }],
      truncated: false,
    };
  }

  // A payload that is itself a list reads as one group, never as a group per
  // index.
  if (Array.isArray(payload)) {
    const group = groupOf(ITEMS_GROUP_KEY, humanizeFieldName(ITEMS_GROUP_KEY), payload);
    return group === undefined
      ? { groups: [], truncated: false }
      : { groups: [group], truncated: group.fields.length >= NODE_DEBUG_FIELD_LIMIT };
  }

  const entries = Object.entries(payload as Record<string, unknown>);
  const groups: NodeDebugGroup[] = [];
  let truncated = entries.length > NODE_DEBUG_GROUP_LIMIT;

  for (const [key, value] of entries) {
    if (groups.length >= NODE_DEBUG_GROUP_LIMIT) {
      break;
    }

    const group = groupOf(key, humanizeFieldName(key), value);
    if (group === undefined) {
      continue;
    }

    if (group.fields.length >= NODE_DEBUG_FIELD_LIMIT) {
      truncated = true;
    }

    groups.push(group);
  }

  return { groups, truncated };
}

// MARK: The payload the machine page already holds

/** The four areas every machine page can report on. */
const AGENT_GROUP = "agent";
const NETWORK_GROUP = "network";
const LATENCY_GROUP = "latency";
const SERVED_GROUP = "servedRegions";

/** A value as a row prints it, or the card's own "not reported" wording. */
function reportedValue(value: unknown, notReported: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? notReported : trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : notReported;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return notReported;
}

/** A list the agent reported, or "not reported" when it reported none. */
function reportedList(value: readonly unknown[] | undefined, notReported: string): unknown {
  return value !== undefined && value.length > 0 ? value : notReported;
}

/** The region id a reported value names, as a number or a re-serialised string. */
function regionIdOf(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  return typeof value === "string" ? parseDerpRegionKey(value).regionId : undefined;
}

/** The region a reported id names, through the page's one label chain. */
function reportedRegion(
  value: unknown,
  sources: DerpRegionLabelSources,
  labels: NodeDiagnosticsLabels,
): string {
  const region = regionIdOf(value);
  return region === undefined
    ? labels.notReported
    : resolveDerpRegionLabel(region, sources, labels.unknown).label;
}

/** What this machine's own agent report says about it. */
function agentSection(stats: HostInfo, notReported: string): Record<string, unknown> {
  return {
    IPNVersion: reportedValue(stats.IPNVersion, notReported),
    OS: reportedValue(stats.OS, notReported),
    OSVersion: reportedValue(stats.OSVersion, notReported),
    Hostname: reportedValue(stats.Hostname, notReported),
    Endpoints: reportedList(stats.Endpoints, notReported),
  };
}

/** The connectivity self-test the agent reports, its region rows named. */
function networkSection(
  stats: HostInfo,
  sources: DerpRegionLabelSources,
  labels: NodeDiagnosticsLabels,
): Record<string, unknown> {
  const net = stats.NetInfo;
  return {
    MappingVariesByDestIP: reportedValue(net?.MappingVariesByDestIP, labels.notReported),
    HairPinning: reportedValue(net?.HairPinning, labels.notReported),
    WorkingIPv6: reportedValue(net?.WorkingIPv6, labels.notReported),
    WorkingICMPv4: reportedValue(net?.WorkingICMPv4, labels.notReported),
    WorkingUDP: reportedValue(net?.WorkingUDP, labels.notReported),
    UPnP: reportedValue(net?.UPnP, labels.notReported),
    PCP: reportedValue(net?.PCP, labels.notReported),
    PMP: reportedValue(net?.PMP, labels.notReported),
    PreferredDERP: reportedRegion(net?.PreferredDERP, sources, labels),
    HomeDERP: reportedRegion(stats.HomeDERP, sources, labels),
  };
}

/**
 * Every region the relay card's latency table lists, with the source that
 * serves it and the source of its number — the same rows, the same wording.
 */
function latencySection(
  input: NodeDiagnosticsInput,
  stats: HostInfo,
  sources: DerpRegionLabelSources,
  labels: NodeDiagnosticsLabels,
): unknown {
  const rows = buildMachineLatencyRows({
    info: stats,
    inventory: input.inventory,
    relaySources: input.relaySources,
    sources,
    unknown: labels.unknown,
  }).rows;

  if (rows.length === 0) {
    return labels.notReported;
  }

  return rows.map((row) => ({
    region: row.label,
    latency: row.latency ?? labels.notReported,
    inUse: row.inUse,
    latencySource:
      row.latencySource === undefined
        ? labels.notReported
        : labels.latencySources[row.latencySource],
    relaySource: row.source === undefined ? labels.notReported : labels.relaySources[row.source],
  }));
}

/** The regions this deployment serves, from the loader's served inventory. */
function servedSection(
  input: NodeDiagnosticsInput,
  sources: DerpRegionLabelSources,
  labels: NodeDiagnosticsLabels,
): unknown {
  const served = [...new Set(input.inventory?.servedRegionIds ?? [])].toSorted((a, b) => a - b);
  if (served.length === 0) {
    return labels.notReported;
  }

  return served.map((regionId) => {
    const source = input.relaySources?.[String(regionId)];
    return {
      regionId,
      region: resolveDerpRegionLabel(regionId, sources, labels.unknown).label,
      source: source === undefined ? labels.notReported : labels.relaySources[source],
    };
  });
}

/** The card's view of a payload it can say nothing about. */
function unavailableView(failure: NodeDiagnosticsFailure): NodeDebugView {
  return { status: "unavailable", groups: [], fieldCount: 0, truncated: false, failure };
}

/**
 * The card's view of the page's own data: what the agent reported about this
 * machine, which relay each region is reached through, and which regions this
 * deployment serves — grouped, labelled and bounded.
 *
 * A Headplane without the agent feature, or a machine the agent has not
 * reported on, is `unavailable` and says which of the two it is, so the card
 * opens on the reason instead of rendering an empty list. A report that carried
 * no fact at all is `empty`, so the card can say so rather than print a page of
 * placeholders, and everything else is `ok` with each fact nobody reported
 * printed as `not reported`.
 */
export function buildNodeDiagnostics(
  input: NodeDiagnosticsInput | undefined,
  labels: NodeDiagnosticsLabels,
): NodeDebugView {
  if (input === undefined || !input.agentEnabled) {
    return unavailableView("no-agent");
  }

  const stats = input.stats;
  if (stats === undefined) {
    return unavailableView("no-report");
  }

  // The embedded region joins the label chain exactly as the relay card reads
  // it, so a row here can never name a region differently from that card.
  const sources: DerpRegionLabelSources = {
    ...input.regions,
    embedded: embeddedDerpRegion(input.server),
  };

  const { groups, truncated } = groupsOf({
    [AGENT_GROUP]: agentSection(stats, labels.notReported),
    [NETWORK_GROUP]: networkSection(stats, sources, labels),
    [LATENCY_GROUP]: latencySection(input, stats, sources, labels),
    [SERVED_GROUP]: servedSection(input, sources, labels),
  });

  // Every row reading "not reported" means the agent reported no fact about
  // this machine at all, so the card says exactly that instead of printing a
  // page of placeholders. A report holding one real fact keeps every row, so a
  // reader can still see which of the others is missing.
  const reported = groups.some((group) =>
    group.fields.some((field) => field.value !== labels.notReported),
  );

  const fieldCount = groups.reduce((total, group) => total + group.fields.length, 0);
  if (!reported || fieldCount === 0) {
    return { status: "empty", groups: [], fieldCount: 0, truncated: false };
  }

  return { status: "ok", groups, fieldCount, truncated };
}
