import type { FleetTrendBucket, TimelineState } from "~/server/history/timeline";
import cn from "~/utils/cn";

/**
 * One column of the availability bar. `fill` is the height of the filled part
 * (0..1); `undefined` marks a period nobody sampled, which renders as a dashed
 * gap and must never read as "offline". `tone` colours the filled part.
 */
export interface HistoryBarColumn {
  fill: number | undefined;
  tone: "online" | "offline";
}

/** The three legend entries and the accessible name, already translated. */
export interface HistoryBarLabels {
  label: string;
  online: string;
  offline: string;
  unknown: string;
}

export interface HistoryBarProps {
  /** One column per period, oldest first. */
  columns: readonly HistoryBarColumn[];
  label: string;
  className?: string;
}

/**
 * A bucketed availability bar drawn from plain divs: no chart dependency, one
 * column per bucket, height carrying the value. A bucket with no record is
 * drawn as an empty dashed column, so a gap in the history is visually distinct
 * from both a solid "offline" column and an empty "0 online" one.
 */
export function HistoryBar({ columns, label, className }: HistoryBarProps) {
  return (
    <div aria-label={label} className={cn("flex h-8 items-stretch gap-px", className)} role="img">
      {columns.map((column, index) => (
        <span
          key={index}
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden rounded-xs",
            column.fill === undefined
              ? "border border-dashed border-mist-300 dark:border-mist-700"
              : "bg-mist-100 dark:bg-mist-800/70",
          )}
        >
          {column.fill === undefined ? undefined : (
            <span
              className={cn(
                "absolute inset-x-0 bottom-0",
                column.tone === "online" ? "bg-emerald-500" : "bg-mist-400 dark:bg-mist-600",
              )}
              style={{ height: `${Math.round(clamp(column.fill) * 100)}%` }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/** The legend that explains the three colours, in the order the bar uses them. */
export function HistoryLegend({ labels }: { labels: HistoryBarLabels }) {
  const entries = [
    { key: "online", label: labels.online, swatch: "bg-emerald-500" },
    { key: "offline", label: labels.offline, swatch: "bg-mist-400 dark:bg-mist-600" },
    {
      key: "unknown",
      label: labels.unknown,
      swatch: "border border-dashed border-mist-300 dark:border-mist-700",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map((entry) => (
        <span
          key={entry.key}
          className="inline-flex items-center gap-1.5 text-xs text-mist-500 dark:text-mist-400"
        >
          <span
            aria-hidden="true"
            className={cn("h-2.5 w-2.5 shrink-0 rounded-xs", entry.swatch)}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

/** A node's timeline as bar columns: every known bucket is a full column. */
export function nodeBarColumns(states: readonly TimelineState[]): HistoryBarColumn[] {
  return states.map((state) => {
    if (state === "unknown") {
      return { fill: undefined, tone: "offline" };
    }

    return { fill: 1, tone: state === "online" ? "online" : "offline" };
  });
}

/** A fleet trend as bar columns: the fill is the share of known nodes online. */
export function fleetBarColumns(buckets: readonly FleetTrendBucket[]): HistoryBarColumn[] {
  return buckets.map((bucket) => {
    if (!bucket.covered) {
      return { fill: undefined, tone: "online" };
    }

    return { fill: bucket.known === 0 ? 0 : bucket.online / bucket.known, tone: "online" };
  });
}

/** Availability of a node over a window: the shared bar plus its legend. */
export function NodeAvailabilityBar({
  states,
  labels,
  className,
}: {
  states: readonly TimelineState[];
  labels: HistoryBarLabels;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <HistoryBar columns={nodeBarColumns(states)} label={labels.label} />
      <HistoryLegend labels={labels} />
    </div>
  );
}

/** Fleet-wide availability over a window: the shared bar plus its legend. */
export function FleetTrendBar({
  buckets,
  labels,
  className,
}: {
  buckets: readonly FleetTrendBucket[];
  labels: HistoryBarLabels;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <HistoryBar columns={fleetBarColumns(buckets)} label={labels.label} />
      <HistoryLegend labels={labels} />
    </div>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
