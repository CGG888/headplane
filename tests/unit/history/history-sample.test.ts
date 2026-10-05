import { describe, expect, test } from "vitest";

import { appendHistorySample, pruneSamples } from "~/server/history/sample";
import { emptyHistoryDocument, HISTORY_MAX_TICKS } from "~/server/history/types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

const iso = (at: number) => new Date(at).toISOString();

describe("appendHistorySample", () => {
  test("records the first sighting of every node and one tick", () => {
    const document = appendHistorySample(
      emptyHistoryDocument(),
      [
        { id: "1", name: "alpha", online: true },
        { id: "2", name: "beta", online: false },
      ],
      BASE,
    );

    expect(document.ticks).toEqual([iso(BASE)]);
    expect(document.nodes).toEqual([
      { id: "1", name: "alpha", samples: [{ at: iso(BASE), online: true }] },
      { id: "2", name: "beta", samples: [{ at: iso(BASE), online: false }] },
    ]);
  });

  test("an unchanged tick keeps the tick but adds no sample", () => {
    const nodes = [{ id: "1", name: "alpha", online: true }];
    let document = appendHistorySample(emptyHistoryDocument(), nodes, BASE);
    document = appendHistorySample(document, nodes, BASE + 5 * MINUTE);
    document = appendHistorySample(document, nodes, BASE + 10 * MINUTE);

    // Three ticks prove the sampler ran; one sample says the state never moved.
    expect(document.ticks).toHaveLength(3);
    expect(document.nodes[0].samples).toEqual([{ at: iso(BASE), online: true }]);
  });

  test("a changed state appends one sample at the tick that saw it", () => {
    let document = appendHistorySample(
      emptyHistoryDocument(),
      [{ id: "1", name: "alpha", online: true }],
      BASE,
    );
    document = appendHistorySample(
      document,
      [{ id: "1", name: "alpha", online: false }],
      BASE + HOUR,
    );

    expect(document.nodes[0].samples).toEqual([
      { at: iso(BASE), online: true },
      { at: iso(BASE + HOUR), online: false },
    ]);
  });

  test("refreshes the node name without adding a sample", () => {
    let document = appendHistorySample(
      emptyHistoryDocument(),
      [{ id: "1", name: "alpha", online: true }],
      BASE,
    );
    document = appendHistorySample(
      document,
      [{ id: "1", name: "alpha-renamed", online: true }],
      BASE + MINUTE,
    );

    expect(document.nodes[0].name).toBe("alpha-renamed");
    expect(document.nodes[0].samples).toHaveLength(1);
  });

  test("a repeated tick is idempotent and keeps the document reference", () => {
    const document = appendHistorySample(emptyHistoryDocument(), [{ id: "1", online: true }], BASE);

    expect(appendHistorySample(document, [{ id: "1", online: true }], BASE)).toBe(document);
  });

  test("drops ticks and samples that left the retention window", () => {
    const nodes = [{ id: "1", name: "alpha", online: true }];
    let document = appendHistorySample(emptyHistoryDocument(), nodes, BASE);
    document = appendHistorySample(document, nodes, BASE + 8 * DAY);

    expect(document.ticks).toEqual([iso(BASE + 8 * DAY)]);
    // The node is still reported, so its last sample stays as the state it
    // carries into the window even though it is older than the window.
    expect(document.nodes).toEqual([
      { id: "1", name: "alpha", samples: [{ at: iso(BASE), online: true }] },
    ]);
  });

  test("ages a node out once nobody reports it any more", () => {
    let document = appendHistorySample(
      emptyHistoryDocument(),
      [{ id: "1", name: "alpha", online: true }],
      BASE,
    );
    document = appendHistorySample(document, [], BASE + 8 * DAY);

    expect(document.nodes).toEqual([]);
    expect(document.ticks).toEqual([iso(BASE + 8 * DAY)]);
  });

  test("honours an explicit retention window", () => {
    const nodes = [{ id: "1", online: true }];
    let document = appendHistorySample(emptyHistoryDocument(), nodes, BASE, {
      retentionMs: HOUR,
    });
    document = appendHistorySample(document, nodes, BASE + 2 * HOUR, { retentionMs: HOUR });

    expect(document.ticks).toEqual([iso(BASE + 2 * HOUR)]);
  });

  test("caps the fleet tick list", () => {
    let document = emptyHistoryDocument();
    for (let tick = 0; tick < 5; tick += 1) {
      document = appendHistorySample(document, [], BASE + tick * MINUTE, { maxTicks: 2 });
    }

    expect(document.ticks).toEqual([iso(BASE + 3 * MINUTE), iso(BASE + 4 * MINUTE)]);
  });

  test("caps the samples kept per node", () => {
    let document = emptyHistoryDocument();
    for (let tick = 0; tick < 5; tick += 1) {
      document = appendHistorySample(
        document,
        [{ id: "1", online: tick % 2 === 0 }],
        BASE + tick * MINUTE,
        { maxSamplesPerNode: 3 },
      );
    }

    expect(document.nodes[0].samples).toEqual([
      { at: iso(BASE + 2 * MINUTE), online: true },
      { at: iso(BASE + 3 * MINUTE), online: false },
      { at: iso(BASE + 4 * MINUTE), online: true },
    ]);
  });

  test("ignores a tick the clock cannot represent", () => {
    const document = emptyHistoryDocument();
    expect(appendHistorySample(document, [], Number.NaN)).toBe(document);
  });

  test("the default tick cap is the seven day window", () => {
    expect(HISTORY_MAX_TICKS).toBe((7 * 24 * 60 * 60 * 1000) / (5 * 60 * 1000));
  });
});

describe("pruneSamples", () => {
  const samples = [
    { at: iso(BASE), online: true },
    { at: iso(BASE + HOUR), online: false },
  ];

  test("keeps only the samples inside the window", () => {
    expect(pruneSamples(samples, BASE + 30 * MINUTE, 10)).toEqual([samples[1]]);
  });

  test("keeps the newest sample as the carry-in state", () => {
    expect(pruneSamples(samples, BASE + 2 * HOUR, 10, true)).toEqual([samples[1]]);
    expect(pruneSamples(samples, BASE + 2 * HOUR, 10, false)).toEqual([]);
  });

  test("drops samples with an unusable timestamp", () => {
    expect(pruneSamples([{ at: "whenever", online: true }], BASE, 10, false)).toEqual([]);
  });
});
