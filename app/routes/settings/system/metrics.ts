// MARK: Headscale metrics
//
// The pure half of the metrics panel: where Headscale's metrics listener is,
// how to parse the Prometheus exposition text it serves, and which numbers of
// it are worth showing. Like `diagnostics.ts` and `config-checks.ts`, this
// module performs no I/O and produces no text: the route reads Headscale's
// configuration file and fetches the endpoint, then hands both in.

/** How the configured metrics listener should be reached. */
export type MetricsTarget =
  | { kind: "ok"; address: string; url: string }
  | { kind: "disabled" }
  | { kind: "invalid"; raw: string }
  | { kind: "unknown" };

/**
 * Addresses that mean "every interface". They cannot be dialed, so the host of
 * Headplane's own Headscale URL is substituted when the listener binds one.
 */
const UNSPECIFIED_HOSTS = new Set(["0.0.0.0", "::", "0:0:0:0:0:0:0:0"]);

const HOST_RE = /^[0-9A-Za-z._-]+$/;
const IPV6_RE = /^[0-9A-Fa-f:.]+$/;
const PORT_RE = /^[0-9]{1,5}$/;

/**
 * Resolves `metrics_listen_addr` from Headscale's parsed configuration.
 *
 * An unreadable configuration is `unknown` rather than `disabled`: Headplane
 * must not claim the listener is off when it simply could not read the file. A
 * missing or empty key really does mean the listener is off, which is
 * Headscale's own behaviour.
 */
export function deriveMetricsTarget(
  config: unknown,
  headscaleUrl: string | undefined,
): MetricsTarget {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return { kind: "unknown" };
  }

  const raw = (config as Record<string, unknown>).metrics_listen_addr;
  if (raw === undefined || raw === null) {
    return { kind: "disabled" };
  }

  if (typeof raw !== "string") {
    return { kind: "invalid", raw: JSON.stringify(raw) };
  }

  const value = raw.trim();
  if (value.length === 0) {
    return { kind: "disabled" };
  }

  const parsed = splitHostPort(value);
  if (!parsed) {
    return { kind: "invalid", raw: value };
  }

  // Binding 0.0.0.0 or [::] means the listener answers on the machine's
  // addresses; Headplane can only dial it by the host it already knows.
  const host = UNSPECIFIED_HOSTS.has(parsed.host)
    ? (hostnameOf(headscaleUrl) ?? parsed.host)
    : parsed.host;
  const address = formatHostPort(host, parsed.port);

  return { kind: "ok", address, url: `http://${address}/metrics` };
}

/** Splits `host:port`, `[v6]:port`, `[::]:port`, or a bare `host:port`. */
function splitHostPort(value: string): { host: string; port: string } | undefined {
  let host: string;
  let port: string;

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end <= 1 || value[end + 1] !== ":") {
      return undefined;
    }

    host = value.slice(1, end);
    port = value.slice(end + 2);
    if (!IPV6_RE.test(host)) {
      return undefined;
    }
  } else {
    const index = value.lastIndexOf(":");
    if (index <= 0) {
      return undefined;
    }

    host = value.slice(0, index);
    port = value.slice(index + 1);
    // A bare IPv6 address is ambiguous; Headscale requires the brackets too.
    if (host.includes(":") || !HOST_RE.test(host)) {
      return undefined;
    }
  }

  if (!PORT_RE.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    return undefined;
  }

  return { host, port };
}

/** The host of a URL, without the brackets a URL keeps around IPv6. */
function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (hostname.length === 0 || UNSPECIFIED_HOSTS.has(hostname)) {
      return undefined;
    }

    return hostname;
  } catch {
    return undefined;
  }
}

function formatHostPort(host: string, port: string): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

// MARK: Exposition parsing

export type MetricsType = "counter" | "gauge" | "histogram" | "summary" | "untyped";

export interface MetricsSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface ParsedMetrics {
  samples: MetricsSample[];
  /** Family name to the type from its `# TYPE` line. */
  types: Record<string, MetricsType>;
}

const TYPE_RE = /^#\s*TYPE\s+([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(\w+)/;
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parses Prometheus exposition text. Comments (`# HELP`, `# TYPE`, anything
 * else), blank lines, and malformed samples are skipped instead of failing the
 * whole response, so one bad line never costs the operator the panel.
 */
export function parseMetrics(text: string): ParsedMetrics {
  const samples: MetricsSample[] = [];
  const types: Record<string, MetricsType> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      const type = TYPE_RE.exec(line);
      if (type) {
        types[type[1]] = normalizeType(type[2]);
      }

      continue;
    }

    const sample = parseSample(line);
    if (sample) {
      samples.push(sample);
    }
  }

  return { samples, types };
}

function normalizeType(value: string): MetricsType {
  switch (value.toLowerCase()) {
    case "counter":
    case "gauge":
    case "histogram":
    case "summary":
      return value.toLowerCase() as MetricsType;
    default:
      return "untyped";
  }
}

function parseSample(line: string): MetricsSample | undefined {
  const name = NAME_RE.exec(line);
  if (!name) {
    return undefined;
  }

  let index = name[0].length;
  let labels: Record<string, string> = {};

  if (line[index] === "{") {
    const parsed = parseLabels(line, index);
    if (!parsed) {
      return undefined;
    }

    labels = parsed.labels;
    index = parsed.index;
  }

  const rest = line.slice(index).trim();
  const token = rest.split(/\s+/)[0];
  if (!token || !NUMBER_RE.test(token)) {
    return undefined;
  }

  return { name: name[0], labels, value: Number(token) };
}

/** Reads the `{a="1",b="two"}` block starting at `start`, honouring escapes. */
function parseLabels(
  line: string,
  start: number,
): { labels: Record<string, string>; index: number } | undefined {
  const labels: Record<string, string> = {};
  let index = start + 1;

  if (line[index] === "}") {
    return { labels, index: index + 1 };
  }

  for (;;) {
    const key = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(line.slice(index));
    if (!key || line[index + key[0].length] !== "=" || line[index + key[0].length + 1] !== '"') {
      return undefined;
    }

    index += key[0].length + 2;
    let value = "";
    let closed = false;

    while (index < line.length) {
      const char = line[index];
      if (char === "\\") {
        value += unescape(line[index + 1]);
        index += 2;
        continue;
      }

      if (char === '"') {
        index += 1;
        closed = true;
        break;
      }

      value += char;
      index += 1;
    }

    if (!closed) {
      return undefined;
    }

    labels[key[0]] = value;

    if (line[index] === ",") {
      index += 1;
      continue;
    }

    if (line[index] === "}") {
      return { labels, index: index + 1 };
    }

    return undefined;
  }
}

function unescape(char: string | undefined): string {
  switch (char) {
    case "n":
      return "\n";
    case "\\":
      return "\\";
    case '"':
      return '"';
    default:
      return char ?? "";
  }
}

// MARK: The displayed subset

export type MetricsGroupId = "nodes" | "users" | "relay" | "policy" | "process";

/** One metric family, summed across the label sets it was reported with. */
export interface MetricsFamily {
  name: string;
  value: number;
  series: number;
}

export interface MetricsGroup {
  id: MetricsGroupId;
  families: MetricsFamily[];
}

export interface MetricsSummary {
  groups: MetricsGroup[];
  goroutines?: number;
  uptimeSeconds?: number;
}

/**
 * The families worth a number on a status page, in the order an operator reads
 * them. Everything else stays available through the raw view.
 */
const GROUP_MATCHERS: ReadonlyArray<{ id: MetricsGroupId; test: (name: string) => boolean }> = [
  { id: "nodes", test: (name) => /node/i.test(name) },
  { id: "users", test: (name) => /user/i.test(name) },
  { id: "relay", test: (name) => /derp|relay/i.test(name) },
  { id: "policy", test: (name) => /policy/i.test(name) },
  { id: "process", test: (name) => /^(go|process)_/i.test(name) },
];

/** The two process metrics that get their own row instead of a family row. */
const GOROUTINES_METRIC = "go_goroutines";
const START_TIME_METRIC = "process_start_time_seconds";

/** Keeps a noisy endpoint from turning the panel into a wall of numbers. */
export const MAX_FAMILIES_PER_GROUP = 12;

export function summarizeMetrics(
  parsed: ParsedMetrics,
  nowMs: number = Date.now(),
): MetricsSummary {
  const families = collectFamilies(parsed);
  const groups: MetricsGroup[] = [];

  for (const matcher of GROUP_MATCHERS) {
    const matching = families
      .filter((family) => matcher.test(family.name))
      .filter((family) => !isDedicated(family.name))
      .slice(0, MAX_FAMILIES_PER_GROUP);

    if (matching.length > 0) {
      groups.push({ id: matcher.id, families: matching });
    }
  }

  const goroutines = families.find((family) => family.name === GOROUTINES_METRIC)?.value;
  const startTime = families.find((family) => family.name === START_TIME_METRIC)?.value;
  const uptimeSeconds =
    startTime === undefined || !Number.isFinite(startTime)
      ? undefined
      : Math.max(0, Math.floor(nowMs / 1000 - startTime));

  return {
    groups,
    ...(goroutines !== undefined && Number.isFinite(goroutines) ? { goroutines } : {}),
    ...(uptimeSeconds !== undefined ? { uptimeSeconds } : {}),
  };
}

function isDedicated(name: string): boolean {
  return name === GOROUTINES_METRIC || name === START_TIME_METRIC;
}

/**
 * Aggregates raw samples into families. Histograms and summaries are dropped:
 * their `_bucket`, `_sum` and `_count` series are not numbers anyone reads off
 * a status page without a query language.
 */
function collectFamilies(parsed: ParsedMetrics): MetricsFamily[] {
  const totals = new Map<string, { value: number; series: number }>();

  for (const sample of parsed.samples) {
    const type = parsed.types[familyOf(sample.name, parsed.types)];
    if (type === "histogram" || type === "summary") {
      continue;
    }

    const current = totals.get(sample.name);
    if (current) {
      current.value += sample.value;
      current.series += 1;
    } else {
      totals.set(sample.name, { value: sample.value, series: 1 });
    }
  }

  return [...totals.entries()]
    .map(([name, total]) => ({ name, value: total.value, series: total.series }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Histogram and summary series carry a `_bucket`/`_sum`/`_count` suffix. */
function familyOf(name: string, types: Record<string, MetricsType>): string {
  if (types[name]) {
    return name;
  }

  const suffix = /(_bucket|_sum|_count)$/.exec(name);
  return suffix ? name.slice(0, -suffix[1].length) : name;
}

/** Grouped digits without `toLocaleString`, so server and client always agree. */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const [whole, fraction] = rounded.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

// MARK: The report the page renders

/**
 * What the panel has to render. `unreachable` covers every way the endpoint
 * failed to produce usable numbers — an unreadable address, a refused
 * connection, a timeout, a non-200 response, or a body no sample could be
 * parsed from. It stays a value instead of an error so the status page renders.
 */
export type MetricsReport =
  | { state: "unknown" }
  | { state: "disabled" }
  | { state: "invalid"; raw: string }
  | { state: "unreachable"; address: string; url: string }
  | {
      state: "ok";
      address: string;
      url: string;
      summary: MetricsSummary;
      raw: string;
      truncated: boolean;
    };
