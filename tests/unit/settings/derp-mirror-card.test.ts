import { describe, expect, test } from "vitest";

import {
  defaultMirrorSelection,
  fixedRegionIds,
  isDefaultMirrorSelection,
  isMirrorProbeStale,
  MIRROR_LATENCY_SOURCE_KEYS,
  MIRROR_PROBE_FRESH_MS,
  MIRROR_PROBE_OUTCOME_KEYS,
  MIRROR_PROBE_POLL_MS,
  MIRROR_PROBE_STATUS_ACTION_ID,
  mirrorLatencyNotice,
  mirrorRegionLatency,
  previewRegionNumbers,
  regionsBelowLatency,
  sortMirrorRegions,
  storedRegionNumbers,
  withLiveMeasurements,
  type MirrorNumbering,
  type MirrorRegionRow,
} from "~/routes/settings/headscale/derp-mirror";

/**
 * A ranking the server produced for five official regions: the two anchors first
 * (Hong Kong 20 and Singapore 3), then whatever the measured latency ordered.
 */
const numbering: MirrorNumbering = {
  fixed: [
    { officialId: 20, number: 901 },
    { officialId: 3, number: 902 },
  ],
  firstFreeNumber: 903,
  order: [5, 20, 3, 7, 9],
  reserved: [901, 902, 999],
};

function row(officialId: number, storedNumber?: number, latencyMs?: number): MirrorRegionRow {
  return {
    officialId,
    code: `c${officialId}`,
    officialName: `Region ${officialId}`,
    chineseName: `区域${officialId}`,
    nodeCount: 2,
    latencyMs,
    storedNumber,
  };
}

function numbersOf(map: Map<number, number>): Record<string, number> {
  return Object.fromEntries([...map].map(([id, number]) => [String(id), number]));
}

describe("region numbering preview", () => {
  test("numbers the pinned anchors the default selection ticks", () => {
    const selection = defaultMirrorSelection(numbering);

    expect(fixedRegionIds(numbering)).toEqual([20, 3]);
    expect(isDefaultMirrorSelection(numbering, selection)).toBe(true);
    expect(numbersOf(previewRegionNumbers(numbering, selection))).toEqual({ "20": 901, "3": 902 });
  });

  test("previews nothing at all once the selection is cleared", () => {
    // The stored assignment still covers Hong Kong and Singapore; a cleared
    // selection must not keep showing their numbers.
    const stored = storedRegionNumbers([row(20, 901), row(3, 902), row(5, 903)]);

    expect(numbersOf(previewRegionNumbers(numbering, new Set(), stored))).toEqual({});
    expect(isDefaultMirrorSelection(numbering, new Set())).toBe(false);
  });

  test("keeps the stored number of a ticked region, as the server's rule does", () => {
    const stored = storedRegionNumbers([row(5, 903), row(9, 904), row(7)]);

    const numbers = previewRegionNumbers(numbering, new Set([20, 3, 5, 7, 9]), stored);

    // 7 is the only region the assignment does not cover, so it is appended
    // after the highest number in use (904) instead of taking 903.
    expect(numbersOf(numbers)).toEqual({ "20": 901, "3": 902, "5": 903, "9": 904, "7": 905 });
  });

  test("ranks a ticked region the stored assignment numbers below its anchors", () => {
    // No number is shown for the unticked region 5, even though it has one.
    const stored = storedRegionNumbers([row(5, 903), row(7, 904)]);
    const numbers = previewRegionNumbers(numbering, new Set([20, 3, 7]), stored);

    expect(numbersOf(numbers)).toEqual({ "20": 901, "3": 902, "7": 904 });
  });

  test("re-ranks stored numbers the server would refuse", () => {
    // 999 belongs to Headscale's embedded region, and two regions cannot share a
    // number: both stored collisions are dropped and the regions ranked again.
    const stored = storedRegionNumbers([row(5, 999), row(7, 903), row(9, 903)]);

    const numbers = previewRegionNumbers(numbering, new Set([20, 3, 5, 7, 9]), stored);

    expect(numbersOf(numbers)).toEqual({ "20": 901, "3": 902, "7": 903, "5": 904, "9": 905 });
  });

  test("numbers a ticked region even when the anchors are not ticked", () => {
    const numbers = previewRegionNumbers(numbering, new Set([5]));

    // 901 and 902 stay reserved for the anchors, so the first free number is 903.
    expect(numbersOf(numbers)).toEqual({ "5": 903 });
  });

  test("storedRegionNumbers reads the assignment off the rows", () => {
    expect([...storedRegionNumbers([row(5, 903), row(7), row(9, 901)])]).toEqual([
      [5, 903],
      [9, 901],
    ]);
  });
});

describe("latency column", () => {
  test("says the agent is not reporting when it is unavailable", () => {
    const regions = [row(5), row(7)];

    expect(mirrorLatencyNotice(regions, false)).toBe("agent-unavailable");
  });

  test("says nothing has been measured when the agent is reporting", () => {
    expect(mirrorLatencyNotice([row(5)], true)).toBe("unmeasured");
  });

  test("stays quiet as soon as one region has a measurement", () => {
    expect(mirrorLatencyNotice([row(5), row(7, undefined, 42)], false)).toBeUndefined();
  });

  test("stays quiet when there is no table at all", () => {
    expect(mirrorLatencyNotice([], false)).toBeUndefined();
  });

  test("keeps unmeasured regions last and breaks ties by official id", () => {
    const regions = [row(7, undefined, 50), row(3), row(5, undefined, 10), row(9, undefined, 50)];

    expect(sortMirrorRegions(regions, "latency").map((region) => region.officialId)).toEqual([
      5, 7, 9, 3,
    ]);
    expect(sortMirrorRegions(regions, "official").map((region) => region.officialId)).toEqual([
      3, 5, 7, 9,
    ]);
  });
});

describe("latency filter", () => {
  const regions = [row(5, undefined, 10), row(7, undefined, 50), row(9)];

  test("an empty ceiling keeps every region, measured or not", () => {
    expect(regionsBelowLatency(regions, undefined).map((region) => region.officialId)).toEqual([
      5, 7, 9,
    ]);
  });

  test("a ceiling drops the regions above it and every unmeasured one", () => {
    expect(regionsBelowLatency(regions, 50).map((region) => region.officialId)).toEqual([5, 7]);
    expect(regionsBelowLatency(regions, 20).map((region) => region.officialId)).toEqual([5]);
  });
});

describe("latency sources", () => {
  test("prefers this server's own measurement and labels it", () => {
    expect(mirrorRegionLatency({ "20": 12 }, { "20": 300, "3": 45 }, 20)).toEqual({
      latencyMs: 12,
      source: "measured",
    });
    expect(mirrorRegionLatency({ "20": 12 }, { "3": 45 }, 3)).toEqual({
      latencyMs: 45,
      source: "reported",
    });
    expect(mirrorRegionLatency({}, {}, 9)).toEqual({});
  });

  test("gives each source its own wording, so the two cannot be confused", () => {
    expect(MIRROR_LATENCY_SOURCE_KEYS.measured).toBe(
      "settings.headscale.derp.mirror.latencySourceMeasured",
    );
    expect(MIRROR_LATENCY_SOURCE_KEYS.reported).toBe(
      "settings.headscale.derp.mirror.latencySourceReported",
    );
    expect(MIRROR_LATENCY_SOURCE_KEYS.measured).not.toBe(MIRROR_LATENCY_SOURCE_KEYS.reported);
  });
});

describe("probe freshness", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");

  test("nothing measured yet is stale, so opening the card probes", () => {
    expect(isMirrorProbeStale({}, now)).toBe(true);
    expect(isMirrorProbeStale({ measuredAt: "whenever" }, now)).toBe(true);
  });

  test("a recent measurement is fresh and an old one is stale", () => {
    expect(isMirrorProbeStale({ measuredAt: "2026-01-02T11:55:00.000Z" }, now)).toBe(false);
    expect(
      isMirrorProbeStale(
        { measuredAt: new Date(now - MIRROR_PROBE_FRESH_MS + 1).toISOString() },
        now,
      ),
    ).toBe(false);
    expect(
      isMirrorProbeStale({ measuredAt: new Date(now - MIRROR_PROBE_FRESH_MS).toISOString() }, now),
    ).toBe(true);
    expect(isMirrorProbeStale({ measuredAt: "2026-01-02T11:00:00.000Z" }, now)).toBe(true);
  });

  test("a finished probe says something for every non-clean outcome", () => {
    expect(MIRROR_PROBE_OUTCOME_KEYS.partial).toBe("settings.headscale.derp.mirror.probePartial");
    expect(MIRROR_PROBE_OUTCOME_KEYS.empty).toBe("settings.headscale.derp.mirror.probeEmpty");
    expect(MIRROR_PROBE_OUTCOME_KEYS.cancelled).toBe(
      "settings.headscale.derp.mirror.probeCancelled",
    );
    expect(MIRROR_PROBE_OUTCOME_KEYS.complete).toBeUndefined();
  });
});

describe("live probe progress", () => {
  test("lays the run's measurements over the rows it has already reached", () => {
    const regions = [row(5, undefined, 300), row(7), row(9, undefined, 10)];

    const live = withLiveMeasurements(regions, { "7": 42 });

    expect(
      live.map((region) => [region.officialId, region.latencyMs, region.latencySource]),
    ).toEqual([
      [5, 300, undefined],
      [7, 42, "measured"],
      [9, 10, undefined],
    ]);
    // A row the run has not measured is the very row the loader handed over.
    expect(live[0]).toBe(regions[0]);
  });

  test("keeps the rows untouched when there is nothing live to lay over them", () => {
    const regions = [row(5)];

    expect(withLiveMeasurements(regions, {})).toBe(regions);
    expect(withLiveMeasurements(regions, { "5": Number.NaN })).toEqual(regions);
    expect(withLiveMeasurements(regions, { "5": -1 })).toEqual(regions);
  });

  test("polls one small read per second, and names it once for action and card", () => {
    expect(MIRROR_PROBE_STATUS_ACTION_ID).toBe("derp_latency_probe_status");
    expect(MIRROR_PROBE_POLL_MS).toBe(1000);
  });
});
