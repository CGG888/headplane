import type { HostInfo } from "~/types";

import { getOSInfo, getTSVersion } from "./host-info";

/**
 * Summarises what the Headplane Agent last reported so the settings page can
 * show which nodes it covers and how fresh they are.
 *
 * Everything here is pure: the counts, the freshest/oldest report times and the
 * table order can be tested without an agent, a database or a request.
 */

/** How many node rows the coverage table renders before it summarises the rest. */
export const AGENT_NODE_ROW_LIMIT = 20;

/** One stored host info row, with the time the agent last wrote it. */
export interface AgentHostRecord {
  nodeKey: string;
  host: HostInfo;
  updatedAt: Date | null;
}

/** One node as the coverage table renders it; `null` means "not reported". */
export interface AgentNodeRow {
  nodeKey: string;
  name: string | null;
  version: string | null;
  os: string | null;
  updatedAt: Date | null;
}

export interface AgentCoverageInput {
  /** Hosts the agent reported in its last successful sync. */
  hosts: Record<string, HostInfo>;
  /** Stored host info, used for per-node report times and stale rows. */
  records?: AgentHostRecord[];
  /** Nodes the tailnet has, or `null` when that could not be read. */
  tailnetCount?: number | null;
  limit?: number;
}

export interface AgentCoverage {
  /** Nodes Headplane holds host information for. */
  reportedCount: number;
  tailnetCount: number | null;
  /** Tailnet nodes without host information, when the tailnet count is known. */
  missingCount: number | null;
  /** Host information for nodes the tailnet no longer has. */
  surplusCount: number | null;
  newestAt: Date | null;
  oldestAt: Date | null;
  rows: AgentNodeRow[];
  /** Rows the table leaves out past the limit. */
  hiddenCount: number;
}

export interface AgentInterval {
  unit: "seconds" | "minutes" | "hours";
  count: number;
}

/** The Tailscale version a node reported, or `null` when it reported none. */
export function agentVersion(host: HostInfo): string | null {
  const version = getTSVersion(host);
  return version === "Unknown" ? null : version;
}

/** The operating system a node reported, or `null` when it reported none. */
export function agentOs(host: HostInfo): string | null {
  if (host.OS) {
    return getOSInfo(host) || null;
  }

  // A node that never named its OS still tells us its kernel version.
  return host.OSVersion?.trim() || null;
}

/** The hostname a node reported, or `null` when it reported none. */
export function agentNodeName(host: HostInfo): string | null {
  return host.Hostname?.trim() || null;
}

/** The version the agent reports for itself, keyed by `self` when available. */
export function agentSelfVersion(hosts: Record<string, HostInfo>, selfKey?: string): string | null {
  const direct = selfKey ? hosts[selfKey] : undefined;
  if (direct) {
    return agentVersion(direct);
  }

  // Older agents were not always keyed by `self`; the flag identifies them.
  const agent = Object.values(hosts).find((host) => host.HeadplaneAgent);
  return agent ? agentVersion(agent) : null;
}

/**
 * Picks the largest whole unit that describes a sync interval, so the default
 * 180000ms cache TTL reads as "3 minutes" instead of "180 seconds".
 */
export function describeInterval(ms: number): AgentInterval | null {
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }

  if (ms % 3_600_000 === 0) {
    return { unit: "hours", count: ms / 3_600_000 };
  }

  if (ms % 60_000 === 0) {
    return { unit: "minutes", count: ms / 60_000 };
  }

  return { unit: "seconds", count: Math.round(ms / 1000) };
}

export function buildAgentCoverage({
  hosts,
  records = [],
  tailnetCount = null,
  limit = AGENT_NODE_ROW_LIMIT,
}: AgentCoverageInput): AgentCoverage {
  const stored = new Map<string, AgentHostRecord>();
  for (const record of records) {
    stored.set(record.nodeKey, record);
  }

  const rows: AgentNodeRow[] = [];
  const seen = new Set<string>();
  for (const [nodeKey, host] of Object.entries(hosts)) {
    seen.add(nodeKey);
    rows.push(toRow(nodeKey, host, stored.get(nodeKey)?.updatedAt));
  }

  // A stored row the agent did not report this time is still worth showing:
  // its timestamp is what tells an operator how stale it is.
  for (const record of records) {
    if (seen.has(record.nodeKey) || !record.host) {
      continue;
    }

    rows.push(toRow(record.nodeKey, record.host, record.updatedAt));
  }

  rows.sort(compareRows);

  const total = rows.length;
  const cap = Math.max(0, Math.floor(limit));
  const times = rows
    .map((row) => row.updatedAt?.getTime())
    .filter((time): time is number => time !== undefined);

  return {
    reportedCount: total,
    tailnetCount,
    missingCount: tailnetCount === null ? null : Math.max(0, tailnetCount - total),
    surplusCount: tailnetCount === null ? null : Math.max(0, total - tailnetCount),
    newestAt: times.length > 0 ? new Date(times.reduce((a, b) => Math.max(a, b))) : null,
    oldestAt: times.length > 0 ? new Date(times.reduce((a, b) => Math.min(a, b))) : null,
    rows: rows.slice(0, cap),
    hiddenCount: Math.max(0, total - cap),
  };
}

function toRow(nodeKey: string, host: HostInfo, updatedAt?: Date | null): AgentNodeRow {
  return {
    nodeKey,
    name: agentNodeName(host),
    version: agentVersion(host),
    os: agentOs(host),
    updatedAt: isUsableDate(updatedAt) ? updatedAt : null,
  };
}

function isUsableDate(date: Date | null | undefined): date is Date {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function compareRows(a: AgentNodeRow, b: AgentNodeRow): number {
  const left = a.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const right = b.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (left !== right) {
    // Freshest first, with rows that have no timestamp at the very end.
    return right - left;
  }

  return rowLabel(a).localeCompare(rowLabel(b));
}

function rowLabel(row: AgentNodeRow): string {
  return row.name ?? row.nodeKey;
}
