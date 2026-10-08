/**
 * Shapes shared by the embedded-DERP address sync, its JSON store and the
 * settings card that renders its last run.
 *
 * This module deliberately imports nothing: the browser bundle value-imports
 * {@link DERP_SYNC_INTERVAL_HOURS} to build the interval picker, so anything
 * pulled in here would end up in the client build.
 */

/** The two address families `derp.server` can advertise. */
export type DerpSyncFamily = "ipv4" | "ipv6";

/** Which families a run is allowed to write. */
export type DerpSyncFamilies = "both" | "ipv4" | "ipv6";

/**
 * The intervals the operator may pick. A fixed set rather than a free number:
 * the addresses change slowly, and Headplane must not be able to schedule an
 * aggressive loop that rewrites Headscale's configuration file.
 */
export const DERP_SYNC_INTERVAL_HOURS = [6, 12, 24] as const;

export type DerpSyncIntervalHours = (typeof DERP_SYNC_INTERVAL_HOURS)[number];

/**
 * Which source outranks the other for the advertised IPv6 address when both have
 * a usable answer: the machine running the embedded relay (`host`) or the AAAA
 * record of the relay hostname in `server_url` (`dns`).
 *
 * `host` is the historical behaviour and stays the default. It is right when the
 * host really is the endpoint clients connect to. `dns` is for the other layout:
 * the hostname points at whatever terminates the connection — a router, a
 * reverse proxy, a load balancer — so the address clients must dial is the one
 * the name resolves to, and the relay machine's own address may be unreachable
 * (a private address, or one behind NAT66). In either mode the external echo
 * still wins while it is enabled, because it is the one source that knows what
 * the internet sees.
 */
export type DerpSyncIpv6Preference = "host" | "dns";

export interface DerpSyncSettings {
  /** When false the scheduled tick does nothing; a manual run still works. */
  enabled: boolean;
  intervalHours: DerpSyncIntervalHours;
  families: DerpSyncFamilies;
  /**
   * Which IPv6 source wins when both this host and the relay hostname have a
   * usable address. `host` keeps the pre-existing behaviour exactly; `dns`
   * prefers the AAAA record and falls back to the host's own address when the
   * name has no usable one.
   */
  ipv6Preference: DerpSyncIpv6Preference;
  /**
   * Whether a write may trigger the configured reload/restart integration. On
   * by default, because a written address that never takes effect is worse than
   * the brief interruption a reload causes; the switch turns it off.
   */
  autoReload: boolean;
}

/**
 * Where a detected address came from: the relay hostname's own record (`dns`),
 * a literal address in `server_url` (`literal`), the host's own interface
 * (`host`), or the external IPv6 echo (`echo`) when the host's addresses are not
 * the ones clients reach.
 */
export type DerpSyncSource = "dns" | "host" | "literal" | "echo";

export interface DerpSyncValue {
  address: string;
  source: DerpSyncSource;
}

/**
 * How a run was started. A `check` runs both detections and the comparison and
 * writes nothing; a `run` writes whatever actually changed and then follows the
 * reload switch.
 */
export type DerpSyncMode = "check" | "run";

/**
 * Why one candidate was or was not the address the run settled on. A closed set
 * so the detection panel can explain every candidate in the page's language.
 */
export type DerpSyncCandidateReason =
  | "selected"
  | "ranked-lower"
  | "temporary"
  | "not-public"
  | "echo-wins"
  /** Usable, but the AAAA record of the relay hostname was preferred. */
  | "dns-wins"
  | "excluded";

/**
 * One address a detection considered, and what happened to it. Kept in the run
 * so the settings card can show the whole decision, not just its outcome.
 */
export interface DerpSyncCandidate {
  family: DerpSyncFamily;
  address: string;
  /** Where this candidate came from; the panel labels it with this. */
  source: DerpSyncSource;
  /** True for the one address the detection settled on. */
  chosen: boolean;
  reason: DerpSyncCandidateReason;
  /** True when the kernel marks a host address as a rotating privacy address. */
  temporary?: boolean;
  /** The interface a host candidate was read from. */
  interfaceName?: string;
  /** A technical code, e.g. why an address was excluded. Never translated prose. */
  detail?: string;
}

/**
 * Why a run counts as failed. The alert carries the code, and the card renders
 * it as a sentence, so a failure always says what broke.
 */
export type DerpSyncFailureReason =
  | "detection-unusable"
  | "not-writable"
  | "reload-failed"
  | "unexpected";

/** Why a family was left alone during a run. */
export type DerpSyncSkipReason =
  | "family-disabled"
  | "host-missing"
  | "invalid-host"
  | "lookup-failed"
  | "no-records"
  | "not-public"
  | "no-host-address"
  | "namespace-unavailable"
  | "config-not-writable";

export interface DerpSyncSkip {
  family: DerpSyncFamily;
  reason: DerpSyncSkipReason;
  /** The hostname or the rejected value(s), for the page's detail line. */
  detail?: string;
}

export interface DerpSyncChange {
  family: DerpSyncFamily;
  /** The configured value that was replaced; absent when the key was unset. */
  from?: string;
  to: string;
}

/** What a write means for the running Headscale. */
export type DerpSyncReload = "not-needed" | "manual" | "triggered" | "failed";

export type DerpSyncOutcome = "changed" | "unchanged" | "skipped" | "failed";

/** One run, as the page shows it and as the store keeps it. */
export interface DerpSyncRun {
  /** ISO timestamp of the run. */
  at: string;
  /** Whether this run was allowed to write anything at all. */
  mode: DerpSyncMode;
  outcome: DerpSyncOutcome;
  /** What the run detected, whether or not it was written. */
  detected: Partial<Record<DerpSyncFamily, DerpSyncValue>>;
  /**
   * Every candidate the detections considered, in ranked order, with why each
   * was or was not chosen. Absent on documents written before the panel existed.
   */
  candidates: DerpSyncCandidate[];
  /**
   * The differences a run would write, or did write. A check reports them
   * without touching the configuration.
   */
  changes: DerpSyncChange[];
  skipped: DerpSyncSkip[];
  /** Families whose detected address already matched the configuration. */
  unchanged: DerpSyncFamily[];
  /** The snapshot taken before the write, when one was taken. */
  snapshotId?: string;
  reload: DerpSyncReload;
  /** Set when a run failed; the code the alert reports. Absent on success. */
  failure?: DerpSyncFailureReason;
  /** A short, non-localized message for an unexpected failure. */
  error?: string;
}

export interface DerpSyncDocument {
  settings: DerpSyncSettings;
  /** The newest run; absent until the first run finishes. */
  last?: DerpSyncRun;
}
