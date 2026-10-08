/**
 * The node-diagnostics card's pure part: the few facts about a machine that no
 * card above it already shows, turned into the labelled rows the card prints.
 *
 * The machine page prints the agent's report in full elsewhere — the detail card
 * carries the operating system, the Tailscale version and the host identity, the
 * address card the end-points, the connectivity card the network booleans in
 * their own layout, and the relay card the preferred and home region with the
 * per-region latency table. Repeating those rows here only made a reader compare
 * two views of one fact, so this card keeps what has no other home: the two
 * version strings the agent reported verbatim, the IPv4 ICMP self-test the
 * connectivity card has no row for, and one line saying how much of this
 * deployment's region inventory the machine accounts for.
 *
 * There is no per-node debug read in Headscale's HTTP API, so nothing here asks
 * one for data and nothing here can fail on the wire: the payload is the
 * agent-reported host info the page already loads plus the served-region
 * inventory the loader derived from the configured DERP maps. Everything is a
 * plain function over plain values — the loader, the card and the tests share
 * one implementation, and this module stays free of server-only imports.
 */

import type { HostInfo } from "~/types";

import { parseDerpRegionKey, sortDerpLatencies, type MachineLatencyInventory } from "./derp-info";

/** What one row's value is, which is what decides how the card renders it. */
export type NodeDebugFieldKind = "text" | "boolean";

/** One row of the card, as its definition list prints it. */
export interface NodeDebugField {
  /** Stable identity of the row within its group. */
  key: string;
  /** The row's label, worded by the card. */
  label: string;
  /** The raw path in the agent's report, kept exact for the row's tooltip. */
  path?: string;
  /** The value as text: the reported string, or the card's "not reported". */
  value: string;
  kind: NodeDebugFieldKind;
  /**
   * For a `boolean` row, what the agent reported — `undefined` when it reported
   * nothing, which is what makes the row print the wording instead of an answer.
   */
  flag?: boolean;
}

/** One area of the card, as its section. */
export interface NodeDebugGroup {
  key: string;
  /** The section heading, worded by the card. */
  label: string;
  fields: NodeDebugField[];
}

export type NodeDebugStatus = "ok" | "empty" | "unavailable";

/** Why the card has nothing reported to show. */
export type NodeDiagnosticsFailure = "no-agent" | "no-report";

/** How much of this deployment's region inventory the machine accounts for. */
export interface NodeDiagnosticsCounts {
  /** Regions this deployment serves, from the loader's served inventory. */
  served: number;
  /** Regions the agent itself reported a sample for. */
  reported: number;
  /** Regions this server measured on its own. */
  measured: number;
}

/**
 * What the loader and the card together know: plain values only, so it survives
 * the wire and the builder stays pure.
 */
export interface NodeDiagnosticsInput {
  /** False when the Headplane Agent feature is off, so nothing reported. */
  agentEnabled: boolean;
  /** The agent's host info for this machine, when it reported any at all. */
  stats?: HostInfo;
  /** The regions this deployment serves and the values the server measured. */
  inventory?: MachineLatencyInventory;
}

/** The card's own wording, passed in so the builder stays free of i18n. */
export interface NodeDiagnosticsLabels {
  /** What a fact the agent did not report reads as. */
  notReported: string;
  /** The two version rows and the self-test row. */
  version: string;
  osVersion: string;
  icmpv4: string;
  /** The coverage row's label, and its sentence over the counts. */
  coverage: string;
  coverageValue: (counts: NodeDiagnosticsCounts) => string;
  /** The two group headings. */
  groups: { agent: string; checks: string };
}

/** The card's view: rows and groups, never raw JSON. */
export interface NodeDebugView {
  status: NodeDebugStatus;
  groups: NodeDebugGroup[];
  /** Rows the card prints across every group. */
  fieldCount: number;
  failure?: NodeDiagnosticsFailure;
}

/** The group holding what the agent reported verbatim. */
const AGENT_GROUP = "agent";

/** The group holding the self-test answer and the coverage line. */
const CHECKS_GROUP = "checks";

/** A reported string as a row prints it, or the card's "not reported" wording. */
function reportedValue(value: unknown, notReported: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? notReported : trimmed;
  }

  return notReported;
}

/** The identity two readings share when they name the same region. */
function regionIdentity(region: string | number): string {
  const parsed = parseDerpRegionKey(region);
  return parsed.regionId === undefined ? `key:${parsed.key}` : `id:${parsed.regionId}`;
}

/**
 * The three counts the coverage line prints: the regions this deployment serves,
 * the ones the agent reported a sample for (one per region, however many address
 * families it measured) and the ones this server measured itself.
 */
function regionCounts(
  stats: HostInfo,
  inventory: MachineLatencyInventory | undefined,
): NodeDiagnosticsCounts {
  const served = new Set((inventory?.servedRegionIds ?? []).map((regionId) => `id:${regionId}`));
  const measured = new Set(Object.keys(inventory?.measured ?? {}).map(regionIdentity));
  const reported = sortDerpLatencies(stats.NetInfo?.DERPLatency).length;
  return { served: served.size, reported, measured: measured.size };
}

/** The card's view of a node it can say nothing about. */
function unavailableView(failure: NodeDiagnosticsFailure): NodeDebugView {
  return { status: "unavailable", groups: [], fieldCount: 0, failure };
}

/**
 * The card's view of the page's own data: the agent's own version strings, its
 * IPv4 ICMP self-test, and how much of the region inventory it accounts for.
 *
 * A Headplane without the agent feature, or a machine the agent has not reported
 * on, is `unavailable` and says which of the two it is, so the card opens on the
 * reason instead of rendering an empty list. A report that carried neither a
 * version nor a self-test has nothing to add to the cards above — the coverage
 * line alone is not a report — so that reads as `empty` rather than as a page of
 * placeholders. Everything else is `ok`, with a fact nobody reported printed as
 * `not reported` so a reader can still see what is missing.
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

  const net = stats.NetInfo;
  // Only a real boolean is an answer: a missing or malformed one reads as
  // "not reported" rather than as "no".
  const icmpv4 = typeof net?.WorkingICMPv4 === "boolean" ? net.WorkingICMPv4 : undefined;
  const version = reportedValue(stats.IPNVersion, labels.notReported);
  const osVersion = reportedValue(stats.OSVersion, labels.notReported);

  if (version === labels.notReported && osVersion === labels.notReported && icmpv4 === undefined) {
    return { status: "empty", groups: [], fieldCount: 0 };
  }

  const groups: NodeDebugGroup[] = [
    {
      key: AGENT_GROUP,
      label: labels.groups.agent,
      fields: [
        {
          key: "agent.IPNVersion",
          label: labels.version,
          path: "stats.IPNVersion",
          kind: "text",
          value: version,
        },
        {
          key: "agent.OSVersion",
          label: labels.osVersion,
          path: "stats.OSVersion",
          kind: "text",
          value: osVersion,
        },
      ],
    },
    {
      key: CHECKS_GROUP,
      label: labels.groups.checks,
      fields: [
        {
          key: "checks.WorkingICMPv4",
          label: labels.icmpv4,
          path: "stats.NetInfo.WorkingICMPv4",
          kind: "boolean",
          flag: icmpv4,
          value: icmpv4 === undefined ? labels.notReported : icmpv4 ? "true" : "false",
        },
        {
          key: "checks.coverage",
          label: labels.coverage,
          kind: "text",
          value: labels.coverageValue(regionCounts(stats, input.inventory)),
        },
      ],
    },
  ];

  return {
    status: "ok",
    groups,
    fieldCount: groups.reduce((total, group) => total + group.fields.length, 0),
  };
}
