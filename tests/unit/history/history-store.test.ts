import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { appendHistorySample } from "~/server/history/sample";
import {
  defaultHistoryDocument,
  historyPath,
  parseHistoryDocument,
  readHistoryDocument,
  serializeHistoryDocument,
  writeHistoryDocument,
} from "~/server/history/store";
import {
  emptyHistoryDocument,
  HISTORY_MAX_NODES,
  HISTORY_MAX_SAMPLES_PER_NODE,
  HISTORY_VERSION,
  NODE_HISTORY_FILE,
  type NodeHistoryDocument,
} from "~/server/history/types";

const MINUTE = 60 * 1000;
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const iso = (at: number) => new Date(at).toISOString();

function document(): NodeHistoryDocument {
  let document = emptyHistoryDocument();
  for (let tick = 0; tick < 4; tick += 1) {
    document = appendHistorySample(
      document,
      [
        { id: "1", name: "alpha", online: tick % 2 === 0 },
        { id: "2", name: "beta", online: true },
      ],
      BASE + tick * MINUTE,
    );
  }

  return document;
}

describe("node history document parsing", () => {
  test("a missing, corrupt or foreign document reads as empty", () => {
    expect(parseHistoryDocument(undefined)).toEqual(defaultHistoryDocument());
    expect(parseHistoryDocument("")).toEqual(defaultHistoryDocument());
    expect(parseHistoryDocument("{not json")).toEqual(defaultHistoryDocument());
    expect(parseHistoryDocument("[1,2,3]")).toEqual(defaultHistoryDocument());
    expect(parseHistoryDocument("null")).toEqual(defaultHistoryDocument());
    // A document from a different format cannot be trusted to mean the same thing.
    expect(parseHistoryDocument(JSON.stringify({ ticks: ["2026-01-01T00:00:00.000Z"] }))).toEqual(
      defaultHistoryDocument(),
    );
  });

  test("drops ticks and samples that are not usable", () => {
    const parsed = parseHistoryDocument(
      JSON.stringify({
        version: HISTORY_VERSION,
        ticks: ["2026-01-01T00:00:00.000Z", "whenever", 42, "2026-01-01T00:05:00.000Z"],
        nodes: [
          { id: "1", samples: [{ at: "2026-01-01T00:00:00.000Z", online: true }, { at: "x" }] },
          { id: "2", samples: [] },
          { samples: [{ at: "2026-01-01T00:00:00.000Z", online: false }] },
          "nope",
        ],
      }),
    );

    expect(parsed.ticks).toEqual(["2026-01-01T00:00:00.000Z", "2026-01-01T00:05:00.000Z"]);
    expect(parsed.nodes).toEqual([
      { id: "1", samples: [{ at: "2026-01-01T00:00:00.000Z", online: true }] },
    ]);
  });

  test("sorts hand-edited entries and keeps the newest samples", () => {
    const count = HISTORY_MAX_SAMPLES_PER_NODE + 10;
    const samples = Array.from({ length: count }, (_, index) => ({
      at: iso(BASE + index * MINUTE),
      online: index % 2 === 0,
    }));

    const parsed = parseHistoryDocument(
      JSON.stringify({
        version: HISTORY_VERSION,
        ticks: [iso(BASE + MINUTE), iso(BASE)],
        nodes: [{ id: "1", samples: samples.toReversed() }],
      }),
    );

    expect(parsed.ticks).toEqual([iso(BASE), iso(BASE + MINUTE)]);
    expect(parsed.nodes[0].samples).toHaveLength(HISTORY_MAX_SAMPLES_PER_NODE);
    expect(parsed.nodes[0].samples.at(-1)?.at).toBe(iso(BASE + (count - 1) * MINUTE));
  });

  test("caps the per-tick node list and keeps the newest records", () => {
    const count = HISTORY_MAX_NODES + 10;
    const at = iso(BASE);
    const nodes = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      samples: [{ at, online: index % 2 === 0 }],
    }));

    const parsed = parseHistoryDocument(
      JSON.stringify({ version: HISTORY_VERSION, ticks: [at], nodes }),
    );

    expect(parsed.nodes).toHaveLength(HISTORY_MAX_NODES);
    expect(parsed.nodes[0]?.id).toBe(String(count - HISTORY_MAX_NODES));
    expect(parsed.nodes.at(-1)?.id).toBe(String(count - 1));
  });

  test("serializes at most the capped node list", () => {
    const count = HISTORY_MAX_NODES + 5;
    const at = iso(BASE);
    const nodes = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      samples: [{ at, online: true }],
    }));

    const raw = serializeHistoryDocument({ version: HISTORY_VERSION, ticks: [at], nodes });
    const written = JSON.parse(raw) as { nodes: { id: string }[] };

    expect(written.nodes).toHaveLength(HISTORY_MAX_NODES);
    expect(written.nodes.at(-1)?.id).toBe(String(count - 1));
  });

  test("serializes stable JSON with a trailing newline", () => {
    const raw = serializeHistoryDocument(document());

    expect(raw.endsWith("\n")).toBe(true);
    expect(parseHistoryDocument(raw)).toEqual(document());
  });
});

describe("node history file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-history-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(NODE_HISTORY_FILE).toBe("node-history.json");
    expect(historyPath(dir)).toBe(join(dir, NODE_HISTORY_FILE));
  });

  test("round-trips a pruned document through an atomic write", async () => {
    const expected = document();

    expect(await writeHistoryDocument(dir, expected)).toBe(true);
    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([NODE_HISTORY_FILE]);

    expect(await readHistoryDocument(dir)).toEqual(expected);
    expect((await readFile(historyPath(dir), "utf8")).endsWith("\n")).toBe(true);
  });

  test("a missing file reads as empty", async () => {
    expect(await readHistoryDocument(dir)).toEqual(defaultHistoryDocument());
  });

  test("a corrupt file reads as empty instead of throwing", async () => {
    await writeFile(historyPath(dir), "{ half written", "utf8");
    expect(await readHistoryDocument(dir)).toEqual(defaultHistoryDocument());
  });

  test("an unwritable data directory reports failure instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeHistoryDocument(blocker, document())).toBe(false);
    expect(await readHistoryDocument(blocker)).toEqual(defaultHistoryDocument());
  });
});
