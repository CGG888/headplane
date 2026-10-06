import { describe, expect, test } from "vitest";

import {
  buildStunBindingRequest,
  isStunBindingResponse,
  parseStunBindingResponse,
  probeRegionLatencies,
  STUN_MAGIC_COOKIE,
  stunTransactionId,
  type ProbeTlsAttempt,
  type ProbeUdpFactory,
  type ProbeUdpSocket,
} from "~/server/derp-mirror/probe.server";
import type { OfficialRegion, ProbeFamily } from "~/server/derp-mirror/types";

const MEASURED_AT = new Date("2026-01-02T03:04:05.000Z");
const COOKIE_BYTES = [0x21, 0x12, 0xa4, 0x42];

/** A monotonic clock the fakes advance, so every measured value is exact. */
function makeClock() {
  const state = { value: 0 };
  return {
    now: () => state.value,
    set: (value: number) => {
      state.value = value;
    },
    advance: (ms: number) => {
      state.value += ms;
    },
  };
}

/** One `XOR-MAPPED-ADDRESS` attribute, encoded as the wire format states it. */
function xorMappedAttribute(
  transactionId: Uint8Array,
  input: { family: ProbeFamily; bytes: number[]; port: number },
): Uint8Array {
  const addressSize = input.family === "ipv4" ? 4 : 16;
  // reserved, family, port, address — the length field covers the value only.
  const valueSize = 4 + addressSize;
  const attribute = new Uint8Array(4 + valueSize);
  const view = new DataView(attribute.buffer);
  view.setUint16(0, 0x0020, false);
  view.setUint16(2, valueSize, false);
  attribute[4] = 0;
  attribute[5] = input.family === "ipv4" ? 0x01 : 0x02;

  const port = input.port ^ (STUN_MAGIC_COOKIE >>> 16);
  attribute[6] = (port >>> 8) & 0xff;
  attribute[7] = port & 0xff;

  const mask = [...COOKIE_BYTES, ...transactionId];
  for (let index = 0; index < addressSize; index += 1) {
    attribute[8 + index] = (input.bytes[index] ?? 0) ^ (mask[index] ?? 0);
  }

  return attribute;
}

/** A STUN message of one type and transaction id, with optional attributes. */
function stunMessage(
  type: number,
  transactionId: Uint8Array,
  attributes: Uint8Array[] = [],
): Uint8Array {
  const length = attributes.reduce((total, attribute) => total + attribute.byteLength, 0);
  const message = new Uint8Array(20 + length);
  const view = new DataView(message.buffer);
  view.setUint16(0, type, false);
  view.setUint16(2, length, false);
  view.setUint32(4, STUN_MAGIC_COOKIE, false);
  message.set(transactionId, 8);

  let offset = 20;
  for (const attribute of attributes) {
    message.set(attribute, offset);
    offset += attribute.byteLength;
  }

  return message;
}

/** The transaction id a request carries. */
function requestTransactionId(request: Uint8Array): Uint8Array {
  return request.slice(8, 20);
}

/** A UDP socket that answers every binding request after a scripted latency. */
function answeringSocket(input: {
  clock: ReturnType<typeof makeClock>;
  latencyMs: number;
}): ProbeUdpSocket {
  let onMessage: ((message: Uint8Array) => void) | undefined;

  return {
    send(request, _port, _address, callback) {
      callback?.();
      // The probe read the clock just before this call, so the current value is
      // this attempt's start; the answer lands at start + latency exactly, even
      // while several sockets are in flight.
      const startedAt = input.clock.now();
      const answer = stunMessage(0x0101, requestTransactionId(request));
      queueMicrotask(() => {
        input.clock.set(startedAt + input.latencyMs);
        onMessage?.(answer);
      });
    },
    onMessage(listener) {
      onMessage = listener;
    },
    onError() {
      // Never fails here.
    },
    close() {
      // Nothing to release in a fake.
    },
  };
}

/** A UDP socket that never answers and never errors: a filtered port. */
function silentSocket(): ProbeUdpSocket {
  return {
    send() {
      // Dropped on the floor, as a filtered port does.
    },
    onMessage() {
      // No answer will ever arrive.
    },
    onError() {
      // No error will ever arrive.
    },
    close() {
      // Nothing to release.
    },
  };
}

function node(name: string, overrides: Partial<OfficialRegion["nodes"][number]> = {}) {
  return {
    name,
    hostname: `${name}.example.com`,
    derpPort: 443,
    stunPort: 3478,
    stunOnly: false,
    ...overrides,
  };
}

function region(regionId: number, nodes: OfficialRegion["nodes"]): OfficialRegion {
  return { regionId, code: `r${regionId}`, name: `Region ${regionId}`, nodes };
}

describe("STUN wire format", () => {
  test("builds a binding request with the magic cookie and a fresh transaction id", () => {
    const transactionId = stunTransactionId();
    const request = buildStunBindingRequest(transactionId);

    expect(transactionId).toHaveLength(12);
    expect(request).toHaveLength(20);

    const view = new DataView(request.buffer);
    expect(view.getUint16(0, false)).toBe(0x0001);
    expect(view.getUint16(2, false)).toBe(0);
    expect(view.getUint32(4, false)).toBe(STUN_MAGIC_COOKIE);
    expect(Array.from(request.slice(8, 20))).toEqual(Array.from(transactionId));
  });

  test("accepts only a binding success carrying the request's own transaction id", () => {
    const transactionId = stunTransactionId();
    const answer = stunMessage(0x0101, transactionId);

    expect(isStunBindingResponse(answer, transactionId)).toBe(true);
    expect(isStunBindingResponse(answer, stunTransactionId())).toBe(false);
    expect(isStunBindingResponse(stunMessage(0x0111, transactionId), transactionId)).toBe(false);
    expect(isStunBindingResponse(stunMessage(0x0001, transactionId), transactionId)).toBe(false);
    expect(isStunBindingResponse(new Uint8Array(12), transactionId)).toBe(false);
  });

  test("parses the XOR-mapped address a success carries", () => {
    const transactionId = stunTransactionId();
    const ipv4 = stunMessage(0x0101, transactionId, [
      xorMappedAttribute(transactionId, { family: "ipv4", bytes: [203, 0, 113, 7], port: 3478 }),
    ]);

    const parsed = parseStunBindingResponse(ipv4);
    expect(parsed?.transactionId).toEqual(transactionId);
    expect(parsed?.mapped).toEqual({ family: "ipv4", address: "203.0.113.7", port: 3478 });

    const ipv6Bytes = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const ipv6 = stunMessage(0x0101, transactionId, [
      xorMappedAttribute(transactionId, { family: "ipv6", bytes: ipv6Bytes, port: 19302 }),
    ]);

    expect(parseStunBindingResponse(ipv6)?.mapped).toEqual({
      family: "ipv6",
      address: "2001:0db8:0000:0000:0000:0000:0000:0001",
      port: 19302,
    });
    expect(parseStunBindingResponse(new Uint8Array(8))).toBeUndefined();
  });
});

describe("probe run", () => {
  test("measures IPv4 and IPv6 separately and keeps the best value per family", async () => {
    const clock = makeClock();

    const udp: ProbeUdpFactory = (family) =>
      answeringSocket({ clock, latencyMs: family === "ipv4" ? 12 : 30 });

    const report = await probeRegionLatencies(
      [
        region(20, [
          node("a", { ipv4: "44.1.1.1", ipv6: "2001:db8::1" }),
          node("b", { ipv4: "44.1.1.2", ipv6: "2001:db8::2" }),
        ]),
      ],
      { now: clock.now, wallClock: () => MEASURED_AT, udp },
    );

    expect(report.measuredAt).toBe(MEASURED_AT.toISOString());
    expect(report.outcome).toBe("complete");
    expect(report.attempted).toBe(4);
    expect(report.measured).toBe(4);

    const measured = report.regions[0];
    expect(measured?.regionId).toBe(20);
    expect(measured?.regionCode).toBe("r20");
    expect(measured?.source).toBe("measured");
    expect(measured?.measuredAt).toBe(MEASURED_AT.toISOString());
    expect(measured?.bestV4).toBe(12);
    expect(measured?.bestV6).toBe(30);
    expect(
      measured?.nodes.map((entry) => [entry.name, entry.family, entry.target, entry.latencyMs]),
    ).toEqual([
      ["a", "ipv4", "44.1.1.1", 12],
      ["a", "ipv6", "2001:db8::1", 30],
      ["b", "ipv4", "44.1.1.2", 12],
      ["b", "ipv6", "2001:db8::2", 30],
    ]);
    expect(measured?.nodes.every((entry) => entry.method === "stun")).toBe(true);
  });

  test("falls back to a TCP/TLS handshake when UDP gives nothing", async () => {
    const clock = makeClock();
    const tcp: ProbeTlsAttempt = async () => {
      clock.advance(25);
    };

    const report = await probeRegionLatencies([region(20, [node("a", { ipv4: "44.1.1.1" })])], {
      now: clock.now,
      wallClock: () => MEASURED_AT,
      timeoutMs: 5,
      udp: () => silentSocket(),
      tcp,
    });

    expect(report.outcome).toBe("complete");
    expect(report.regions[0]?.bestV4).toBe(25);
    expect(report.attempts.find((attempt) => attempt.family === "ipv4")?.method).toBe("tcp");
  });

  test("skips STUN for a node whose stunport is 0 and for a STUN-only node", async () => {
    const clock = makeClock();
    let udpSockets = 0;
    const tcp: ProbeTlsAttempt = async () => {
      clock.advance(9);
    };

    const report = await probeRegionLatencies(
      [
        region(20, [node("a", { ipv4: "44.1.1.1", stunPort: 0 })]),
        region(21, [node("b", { ipv4: "44.1.1.2", stunOnly: true })]),
      ],
      {
        now: clock.now,
        wallClock: () => MEASURED_AT,
        timeoutMs: 5,
        // One attempt at a time, so the scripted clock stays deterministic.
        concurrency: 1,
        udp: () => {
          udpSockets += 1;
          return silentSocket();
        },
        tcp,
      },
    );

    // Region 20 opened no UDP socket at all (stunport 0), so both of its
    // families were timed on the DERP port; region 21 opened one per family and
    // had no DERP listener to fall back to.
    expect(udpSockets).toBe(2);
    expect(report.regions.map((entry) => entry.regionId)).toEqual([20]);
    expect(report.regions[0]?.bestV4).toBe(9);
    expect(report.regions[0]?.bestV6).toBe(9);
    expect(report.attempts.find((attempt) => attempt.regionId === 21)?.reason).toBe("timeout");
  });

  test("labels an unreachable node without failing the run", async () => {
    const clock = makeClock();
    const tcp: ProbeTlsAttempt = async (input) => {
      if (input.target !== "44.1.1.2") {
        throw new Error("ECONNREFUSED");
      }

      clock.advance(40);
    };

    const report = await probeRegionLatencies(
      [
        region(20, [node("dead", { ipv4: "44.1.1.1", ipv6: "2001:db8::1" })]),
        region(21, [node("alive", { ipv4: "44.1.1.2" })]),
      ],
      {
        now: clock.now,
        wallClock: () => MEASURED_AT,
        timeoutMs: 5,
        udp: () => silentSocket(),
        tcp,
      },
    );

    // The dead region is simply absent from the stored record, each of its
    // attempts carries a reason, and the run as a whole still succeeds.
    expect(report.outcome).toBe("partial");
    expect(report.regions.map((entry) => entry.regionId)).toEqual([21]);
    expect(report.attempts.filter((attempt) => attempt.regionId === 20)).toHaveLength(2);
    expect(
      report.attempts
        .filter((attempt) => attempt.regionId === 20)
        .every((attempt) => !attempt.measured && attempt.reason === "error"),
    ).toBe(true);
  });

  test("caps how many attempts run at once", async () => {
    const clock = makeClock();
    let inFlight = 0;
    let peak = 0;

    const udp: ProbeUdpFactory = () => {
      let onMessage: ((message: Uint8Array) => void) | undefined;
      return {
        send(request, _port, _address, callback) {
          callback?.();
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          const answer = stunMessage(0x0101, requestTransactionId(request));
          setTimeout(() => {
            inFlight -= 1;
            clock.advance(7);
            onMessage?.(answer);
          }, 1);
        },
        onMessage(listener) {
          onMessage = listener;
        },
        onError() {
          // Never fails here.
        },
        close() {
          // Nothing to release.
        },
      };
    };

    const nodes = Array.from({ length: 6 }, (_, index) =>
      node(`n${index}`, { ipv4: `44.1.1.${index + 1}` }),
    );

    const report = await probeRegionLatencies([region(20, nodes)], {
      now: clock.now,
      wallClock: () => MEASURED_AT,
      concurrency: 2,
      udp,
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(report.measured).toBe(12);
  });

  test("cancellation stops the run and reports what it gathered", async () => {
    const clock = makeClock();
    const controller = new AbortController();
    const tcp: ProbeTlsAttempt = async () => {
      throw new Error("ECONNREFUSED");
    };

    const pending = probeRegionLatencies(
      [
        region(20, [node("a", { ipv4: "44.1.1.1" })]),
        region(21, [node("b", { ipv4: "44.1.1.2" })]),
        region(22, [node("c", { ipv4: "44.1.1.3" })]),
      ],
      {
        signal: controller.signal,
        now: clock.now,
        wallClock: () => MEASURED_AT,
        timeoutMs: 1000,
        concurrency: 1,
        udp: () => silentSocket(),
        tcp,
      },
    );

    setTimeout(() => controller.abort(), 1);
    const report = await pending;

    expect(report.cancelled).toBe(true);
    expect(report.outcome).toBe("cancelled");
    // One attempt was in flight and no further one was started after the abort.
    expect(report.attempted).toBe(6);
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0]?.reason).toBe("cancelled");
    expect(report.regions).toEqual([]);
  });
});
