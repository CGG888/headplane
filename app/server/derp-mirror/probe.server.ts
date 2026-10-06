// MARK: Server-side latency probe for the official DERP regions
//
// The latency column of the official region filter only ever knew what the
// Headplane Agent's machines reported, and a machine only knows the map
// Headscale handed it — the embedded relay and the mirrored regions. The
// official regions are therefore always unmeasured on a mirrored setup, however
// well they answer. This module measures them from *this* server instead, on
// demand, so an operator can rank the official regions by a path that is at
// least a good proxy for the clients near this machine.
//
// What it dials, and in what order:
//
// 1. a UDP STUN binding request to the node's `stunport` (3478 by default),
//    which is the transport DERP itself uses; then
// 2. a TCP/TLS handshake on the node's `derpport` (443 by default) when UDP
//    gave nothing — a blocked UDP port, a silent node, a filtered path.
//
// IPv4 and IPv6 are measured separately, using the address the official map
// declares for a family when it declares one and the node's hostname otherwise
// (the socket family steers the lookup, so no new dependency is needed). Every
// attempt has a budget of its own ({@link DEFAULT_PROBE_TIMEOUT_MS}, about
// 1.2 s), at most {@link DEFAULT_PROBE_CONCURRENCY} attempts run at once, and
// the whole run is cancellable through an `AbortSignal`.
//
// Nothing here throws and nothing here hangs: every failure becomes a labelled
// result, an unreachable node never fails the run it belongs to, and a
// cancelled run returns what it gathered so far.

import { createSocket, type Socket as DgramSocket } from "node:dgram";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { connect as connectTls, type ConnectionOptions, type TLSSocket } from "node:tls";

import type {
  DerpLatencyNodeReading,
  DerpLatencyRegionReading,
  DerpMirrorLatency,
  DerpMirrorProbeOutcome,
  OfficialRegion,
  OfficialRegionNode,
  ProbeFailure,
  ProbeFamily,
  ProbeMethod,
} from "./types";

/** The per-attempt budget, in milliseconds. */
export const DEFAULT_PROBE_TIMEOUT_MS = 1200;

/** How many node-and-family attempts may run at once. */
export const DEFAULT_PROBE_CONCURRENCY = 8;

/** The STUN port the format defaults to when a node does not declare one. */
export const DEFAULT_STUN_PORT = 3478;

/** The DERP port the format defaults to when a node does not declare one. */
export const DEFAULT_DERP_PORT = 443;

/** The fixed part of every modern STUN message: the magic cookie. */
export const STUN_MAGIC_COOKIE = 0x2112a442;

/** Message types this module recognises: a binding request, and its answer. */
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_SUCCESS = 0x0101;

/** The `XOR-MAPPED-ADDRESS` attribute, the address the server saw us as. */
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;

// MARK: STUN wire format

/** A fresh 12-byte STUN transaction id from the CSPRNG. */
export function stunTransactionId(): Uint8Array {
  const id = new Uint8Array(12);
  globalThis.crypto.getRandomValues(id);
  return id;
}

/**
 * The 20-byte STUN binding request for one transaction id. `stunport` speaks
 * bare STUN, not DERP over TLS, so the request is a plain datagram with the
 * fixed header and no attributes.
 */
export function buildStunBindingRequest(transactionId: Uint8Array): Uint8Array {
  const message = new Uint8Array(20);
  const view = new DataView(message.buffer);
  view.setUint16(0, STUN_BINDING_REQUEST, false);
  view.setUint16(2, 0, false);
  view.setUint32(4, STUN_MAGIC_COOKIE, false);
  message.set(transactionId.subarray(0, 12), 8);
  return message;
}

/** One attribute of a parsed STUN message. */
interface StunMappedAddress {
  family: ProbeFamily;
  address: string;
  port: number;
}

/**
 * The header and the `XOR-MAPPED-ADDRESS` of a STUN binding *success* response,
 * or `undefined` for anything that is not one: too short, a request or an
 * error response, a foreign magic cookie, or a truncated attribute.
 *
 * The transaction id is returned rather than checked here, so a caller can
 * decide which request an answer belongs to.
 */
export function parseStunBindingResponse(
  message: Uint8Array,
): { transactionId: Uint8Array; mapped?: StunMappedAddress } | undefined {
  if (message.byteLength < 20) {
    return undefined;
  }

  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  if (view.getUint16(0, false) !== STUN_BINDING_SUCCESS) {
    return undefined;
  }

  if (view.getUint32(4, false) !== STUN_MAGIC_COOKIE) {
    return undefined;
  }

  const transactionId = message.slice(8, 20);
  const length = view.getUint16(2, false);
  const end = Math.min(20 + length, message.byteLength);

  let offset = 20;
  while (offset + 4 <= end) {
    const type = view.getUint16(offset, false);
    const attributeLength = view.getUint16(offset + 2, false);
    const valueStart = offset + 4;
    if (valueStart + attributeLength > end) {
      break;
    }

    if (type === STUN_ATTR_XOR_MAPPED_ADDRESS) {
      const mapped = parseXorMappedAddress(
        message.subarray(valueStart, valueStart + attributeLength),
        transactionId,
      );
      if (mapped !== undefined) {
        return { transactionId, mapped };
      }
    }

    // Attributes are padded to a four-byte boundary.
    offset = valueStart + attributeLength + ((4 - (attributeLength % 4)) % 4);
  }

  return { transactionId };
}

/** The magic cookie's bytes, as the XOR mask for a mapped address. */
const MAGIC_COOKIE_BYTES = [0x21, 0x12, 0xa4, 0x42] as const;

/**
 * The address inside one `XOR-MAPPED-ADDRESS` value, or `undefined`. The port
 * and the address are XORed with the magic cookie (and, for IPv6, with the
 * transaction id as well), which is the whole point of the attribute: it cannot
 * be rewritten by a NAT that knows nothing about STUN.
 */
function parseXorMappedAddress(
  value: Uint8Array,
  transactionId: Uint8Array,
): StunMappedAddress | undefined {
  if (value.byteLength < 8) {
    return undefined;
  }

  const familyByte = value[1];
  const port = (((value[2] ?? 0) << 8) | (value[3] ?? 0)) ^ (STUN_MAGIC_COOKIE >>> 16);
  const mask = [...MAGIC_COOKIE_BYTES, ...transactionId];

  if (familyByte === 0x01) {
    const bytes = [4, 5, 6, 7].map((index) => (value[index] ?? 0) ^ (mask[index - 4] ?? 0));
    return { family: "ipv4", address: bytes.join("."), port };
  }

  if (familyByte === 0x02 && value.byteLength >= 20) {
    const groups: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      const high = (value[4 + index] ?? 0) ^ (mask[index] ?? 0);
      const low = (value[5 + index] ?? 0) ^ (mask[index + 1] ?? 0);
      groups.push(((high << 8) | low).toString(16).padStart(4, "0"));
    }

    return { family: "ipv6", address: groups.join(":"), port };
  }

  return undefined;
}

/** Whether this datagram is the binding answer to exactly this request. */
export function isStunBindingResponse(message: Uint8Array, transactionId: Uint8Array): boolean {
  const parsed = parseStunBindingResponse(message);
  if (parsed === undefined || parsed.transactionId.byteLength !== transactionId.byteLength) {
    return false;
  }

  for (let index = 0; index < transactionId.byteLength; index += 1) {
    if (parsed.transactionId[index] !== transactionId[index]) {
      return false;
    }
  }

  return true;
}

// MARK: Injectable network

/**
 * The slice of a `node:dgram` socket this probe drives. A test passes its own
 * implementation, so nothing in a unit test touches a real socket.
 */
export interface ProbeUdpSocket {
  send(
    request: Uint8Array,
    port: number,
    address: string,
    callback: (error?: Error | null) => void,
  ): void;
  onMessage(listener: (message: Uint8Array) => void): void;
  onError(listener: (error: Error) => void): void;
  /** Closes the socket; safe to call more than once. */
  close(): void;
}

/** Opens one UDP socket of one family, as the probe needs it. */
export type ProbeUdpFactory = (family: ProbeFamily) => ProbeUdpSocket;

/**
 * One TCP/TLS handshake timing. Resolves when the handshake completed, rejects
 * when it failed; the implementation honours `timeoutMs` and `signal`, so the
 * probe measures what came back instead of guarding a socket it cannot see.
 */
export type ProbeTlsAttempt = (input: {
  target: string;
  port: number;
  family: ProbeFamily;
  /** The hostname for SNI; omitted when the map named an address instead. */
  servername: string;
  timeoutMs: number;
  signal: AbortSignal;
}) => Promise<void>;

export interface RegionLatencyProbeOptions {
  /** Stops the run: pending attempts are closed and the report says so. */
  signal?: AbortSignal;
  /** The budget of one attempt, in milliseconds. */
  timeoutMs?: number;
  /** How many attempts may run at once. */
  concurrency?: number;
  /** Read the monotonic clock; injected so a test can script latencies. */
  now?: () => number;
  /** Open a UDP socket; injected so a test can answer instead of a network. */
  udp?: ProbeUdpFactory;
  /** Time one TCP/TLS handshake; injected so a test can script the fallback. */
  tcp?: ProbeTlsAttempt;
  /** Read the wall clock, for the stored timestamp. */
  wallClock?: () => Date;
}

/** One attempt exactly as it ended, including the ones that only failed. */
export interface ProbeAttempt {
  regionId: number;
  node: string;
  hostname: string;
  family: ProbeFamily;
  target: string;
  measured: boolean;
  latencyMs?: number;
  method?: ProbeMethod;
  reason?: ProbeFailure;
}

/** Everything one run produced: the storable record plus its diagnostics. */
export interface RegionLatencyProbeReport extends DerpMirrorLatency {
  attempts: ProbeAttempt[];
  attempted: number;
  measured: number;
  cancelled: boolean;
}

// MARK: The default network

/** The real `node:dgram` socket, with the events this probe listens to. */
const defaultUdpFactory: ProbeUdpFactory = (family) => {
  const socket: DgramSocket = createSocket(family === "ipv6" ? "udp6" : "udp4");

  return {
    send(request, port, address, callback) {
      socket.send(Buffer.from(request), port, address, (error) => callback(error ?? undefined));
    },
    onMessage(listener) {
      socket.on("message", (message) => listener(message));
    },
    onError(listener) {
      socket.on("error", (error) => listener(error));
    },
    close() {
      try {
        socket.close();
      } catch {
        // Already closed, or never bound: nothing left to release.
      }
    },
  };
};

/**
 * The real handshake timing. The certificate is deliberately not verified: what
 * is measured is whether the DERP port answers and how fast, not whether this
 * server trusts the certificate — a reply that fails the handshake still proves
 * the path, and `rejectUnauthorized: false` keeps a clock-skewed container from
 * reporting every official region as unreachable.
 */
const defaultTlsAttempt: ProbeTlsAttempt = (input) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: TLSSocket | undefined;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      input.signal.removeEventListener("abort", onAbort);
      try {
        socket?.destroy();
      } catch {
        // The socket already destroyed itself; the error is what matters.
      }

      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    const onAbort = () => finish(new Error("The latency probe was cancelled"));

    try {
      // `family` steers the lookup the socket underneath performs, so one
      // family can be measured on its own; the published options type does not
      // spell that field out, though `tls.connect` passes it through.
      const options: ConnectionOptions & { family: number } = {
        host: input.target,
        port: input.port,
        family: input.family === "ipv6" ? 6 : 4,
        ...(isIP(input.servername) === 0 ? { servername: input.servername } : {}),
        rejectUnauthorized: false,
      };
      socket = connectTls(options);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    socket.once("secureConnect", () => finish());
    socket.once("error", (error) => finish(error));
    socket.setTimeout(input.timeoutMs, () => finish(new Error("The DERP port did not answer")));
    input.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(new Error("The DERP port did not answer")), input.timeoutMs);
  });

// MARK: The run

/**
 * Both families are always attempted: a node that declares only one address can
 * still answer on the other through its hostname, and a family the name does not
 * have simply fails fast as `unresolved`.
 */
const PROBE_FAMILIES: readonly ProbeFamily[] = ["ipv4", "ipv6"];

/** The address (or hostname) one family is dialled on. */
function targetOf(node: OfficialRegionNode, family: ProbeFamily): string {
  const declared = family === "ipv4" ? node.ipv4 : node.ipv6;
  return declared !== undefined && declared.trim().length > 0 ? declared.trim() : node.hostname;
}

/** One labelled failure, as {@link resolveFailure} reads it. */
function resolveFailure(error: unknown): ProbeFailure {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NODATA" || code === "ENODATA") {
    return "unresolved";
  }

  return "error";
}

/**
 * Runs at most `limit` workers over the items, in order, and returns the
 * results of the items that were started. Work stops early when `stop` says so,
 * which is what makes a cancelled run leave the untouched attempts out instead
 * of filling them with a made-up result.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  stop: () => boolean,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Array<R | undefined> = items.map(() => undefined);
  let next = 0;

  const run = async () => {
    for (;;) {
      if (stop()) {
        return;
      }

      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }

      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(workers);
  return results.filter((entry): entry is R => entry !== undefined);
}

/** One measured attempt, or undefined for "no value". */
interface UdpResult {
  measured: boolean;
  latencyMs?: number;
  reason?: ProbeFailure;
}

/**
 * One UDP STUN attempt: send the binding request, wait for the answer that
 * belongs to it, and settle on the first of an answer, a timeout, an error, or
 * the run being cancelled. The socket is always closed before this resolves.
 */
function measureUdp(input: {
  socket: ProbeUdpSocket;
  target: string;
  port: number;
  timeoutMs: number;
  now: () => number;
  signal: AbortSignal;
}): Promise<UdpResult> {
  return new Promise<UdpResult>((resolve) => {
    const transactionId = stunTransactionId();
    const request = buildStunBindingRequest(transactionId);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: UdpResult) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      input.signal.removeEventListener("abort", onAbort);
      input.socket.close();
      resolve(result);
    };

    const onAbort = () => finish({ measured: false, reason: "cancelled" });
    const started = input.now();

    input.socket.onMessage((message) => {
      if (!isStunBindingResponse(message, transactionId)) {
        return;
      }

      finish({ measured: true, latencyMs: Math.max(0, input.now() - started) });
    });
    input.socket.onError(() => finish({ measured: false, reason: "error" }));
    timer = setTimeout(() => finish({ measured: false, reason: "timeout" }), input.timeoutMs);
    input.signal.addEventListener("abort", onAbort, { once: true });

    try {
      input.socket.send(request, input.port, input.target, (error) => {
        if (error !== undefined && error !== null) {
          finish({ measured: false, reason: resolveFailure(error) });
        }
      });
    } catch (error) {
      finish({ measured: false, reason: resolveFailure(error) });
    }
  });
}

/** One TCP/TLS attempt, raced against its own budget so it can never hang. */
async function measureTcp(
  input: {
    target: string;
    port: number;
    family: ProbeFamily;
    servername: string;
    timeoutMs: number;
    now: () => number;
    signal: AbortSignal;
  },
  tcp: ProbeTlsAttempt,
): Promise<UdpResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("The DERP port did not answer")), input.timeoutMs);
  });

  const started = input.now();
  try {
    await Promise.race([
      tcp({
        target: input.target,
        port: input.port,
        family: input.family,
        servername: input.servername,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      }),
      budget,
    ]);

    return { measured: true, latencyMs: Math.max(0, input.now() - started) };
  } catch (error) {
    return {
      measured: false,
      reason: input.signal.aborted ? "cancelled" : resolveFailure(error),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** The node-and-family pairs one run attempts. */
interface ProbeJob {
  regionId: number;
  code: string;
  node: OfficialRegionNode;
  family: ProbeFamily;
  target: string;
}

/** One attempt, whatever it turned out to be. */
async function measureJob(
  job: ProbeJob,
  input: {
    timeoutMs: number;
    now: () => number;
    signal: AbortSignal;
    udp: ProbeUdpFactory;
    tcp: ProbeTlsAttempt;
  },
): Promise<ProbeAttempt> {
  const base = {
    regionId: job.regionId,
    node: job.node.name,
    hostname: job.node.hostname,
    family: job.family,
    target: job.target,
  };

  if (input.signal.aborted) {
    return { ...base, measured: false, reason: "cancelled" };
  }

  const stunPort = job.node.stunPort === undefined ? DEFAULT_STUN_PORT : job.node.stunPort;
  let udpFailure: ProbeFailure = "no-stun";

  if (stunPort > 0) {
    const udp = await measureUdp({
      socket: input.udp(job.family),
      target: job.target,
      port: stunPort,
      timeoutMs: input.timeoutMs,
      now: input.now,
      signal: input.signal,
    });

    if (udp.measured) {
      return { ...base, measured: true, latencyMs: udp.latencyMs, method: "stun" };
    }

    if (udp.reason === "cancelled") {
      return { ...base, measured: false, reason: "cancelled" };
    }

    udpFailure = udp.reason ?? "error";
  }

  // A node the map declares STUN-only runs no DERP listener, so there is no
  // handshake to time on it; the STUN outcome is the only one it has.
  if (job.node.stunOnly) {
    return { ...base, measured: false, reason: udpFailure };
  }

  const tcp = await measureTcp(
    {
      target: job.target,
      port: job.node.derpPort === undefined ? DEFAULT_DERP_PORT : job.node.derpPort,
      family: job.family,
      servername: job.node.hostname,
      timeoutMs: input.timeoutMs,
      now: input.now,
      signal: input.signal,
    },
    input.tcp,
  );

  if (tcp.measured) {
    return { ...base, measured: true, latencyMs: tcp.latencyMs, method: "tcp" };
  }

  return {
    ...base,
    measured: false,
    reason: tcp.reason === "cancelled" ? "cancelled" : (tcp.reason ?? udpFailure),
  };
}

/** The stored per-region record, built from the measured attempts. */
function toRegionReadings(
  regions: readonly OfficialRegion[],
  attempts: readonly ProbeAttempt[],
  measuredAt: string,
): DerpLatencyRegionReading[] {
  const readings: DerpLatencyRegionReading[] = [];

  for (const region of regions) {
    const nodes: DerpLatencyNodeReading[] = [];
    let bestV4: number | undefined;
    let bestV6: number | undefined;

    for (const attempt of attempts) {
      if (attempt.regionId !== region.regionId || !attempt.measured) {
        continue;
      }

      const latencyMs = attempt.latencyMs ?? 0;
      nodes.push({
        name: attempt.node,
        hostname: attempt.hostname,
        family: attempt.family,
        target: attempt.target,
        latencyMs,
        method: attempt.method ?? "stun",
      });

      if (attempt.family === "ipv4") {
        bestV4 = bestV4 === undefined ? latencyMs : Math.min(bestV4, latencyMs);
      } else {
        bestV6 = bestV6 === undefined ? latencyMs : Math.min(bestV6, latencyMs);
      }
    }

    if (nodes.length === 0) {
      continue;
    }

    readings.push({
      regionId: region.regionId,
      regionCode: region.code,
      ...(bestV4 === undefined ? {} : { bestV4 }),
      ...(bestV6 === undefined ? {} : { bestV6 }),
      nodes,
      measuredAt,
      source: "measured",
    });
  }

  return readings;
}

/** How a finished run reads, given what it managed to measure. */
function outcomeOf(
  regions: readonly OfficialRegion[],
  readings: readonly DerpLatencyRegionReading[],
  cancelled: boolean,
): DerpMirrorProbeOutcome {
  if (cancelled) {
    return "cancelled";
  }

  if (readings.length === 0) {
    return "empty";
  }

  const measurable = regions.filter((region) => region.nodes.length > 0).length;
  return readings.length >= measurable ? "complete" : "partial";
}

/**
 * Measures every node of every official region from this server, in one run.
 *
 * Never rejects: a node that does not answer, a family a name does not have, a
 * socket that refuses to open and a run the operator stops all become labelled
 * results, and the returned report carries both the storable per-region record
 * and the per-attempt diagnostics behind it.
 */
export async function probeRegionLatencies(
  regions: readonly OfficialRegion[],
  options: RegionLatencyProbeOptions = {},
): Promise<RegionLatencyProbeReport> {
  const signal = options.signal ?? new AbortController().signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_PROBE_CONCURRENCY;
  const now = options.now ?? (() => performance.now());
  const udp = options.udp ?? defaultUdpFactory;
  const tcp = options.tcp ?? defaultTlsAttempt;
  const wallClock = options.wallClock ?? (() => new Date());
  const measuredAt = wallClock().toISOString();

  const jobs: ProbeJob[] = [];
  for (const region of regions) {
    for (const node of region.nodes) {
      for (const family of PROBE_FAMILIES) {
        jobs.push({
          regionId: region.regionId,
          code: region.code,
          node,
          family,
          target: targetOf(node, family),
        });
      }
    }
  }

  const attempts = await mapWithConcurrency(
    jobs,
    concurrency,
    () => signal.aborted,
    (job) => measureJob(job, { timeoutMs, now, signal, udp, tcp }),
  );

  const readings = toRegionReadings(regions, attempts, measuredAt);

  return {
    measuredAt,
    outcome: outcomeOf(regions, readings, signal.aborted),
    regions: readings,
    attempts,
    attempted: jobs.length,
    measured: attempts.filter((attempt) => attempt.measured).length,
    cancelled: signal.aborted,
  };
}

// MARK: One run at a time

/**
 * The run in progress, if any. Only one probe runs at a time: two overlapping
 * runs would fight over the same store and double the traffic the official
 * relays see, and the operator can cancel this one instead.
 */
let activeProbe: AbortController | undefined;

/** Whether a probe is running right now. */
export function isRegionLatencyProbeRunning(): boolean {
  return activeProbe !== undefined;
}

/**
 * Stops the run in progress. Returns whether there was one to stop; the run
 * itself still returns — with `outcome: "cancelled"` and what it had gathered.
 */
export function cancelRegionLatencyProbe(): boolean {
  if (activeProbe === undefined) {
    return false;
  }

  activeProbe.abort();
  return true;
}

/**
 * Runs one probe, refusing to start a second one on top of a running probe.
 * `undefined` means "a probe is already running" — the caller reports that
 * instead of queueing another run.
 */
export async function runRegionLatencyProbe(
  regions: readonly OfficialRegion[],
  options: RegionLatencyProbeOptions & { requestSignal?: AbortSignal } = {},
): Promise<RegionLatencyProbeReport | undefined> {
  if (activeProbe !== undefined) {
    return undefined;
  }

  const controller = new AbortController();
  activeProbe = controller;

  const requestSignal = options.requestSignal;
  const onRequestAbort = () => controller.abort();
  requestSignal?.addEventListener("abort", onRequestAbort, { once: true });

  try {
    return await probeRegionLatencies(regions, { ...options, signal: controller.signal });
  } finally {
    requestSignal?.removeEventListener("abort", onRequestAbort);
    activeProbe = undefined;
  }
}
