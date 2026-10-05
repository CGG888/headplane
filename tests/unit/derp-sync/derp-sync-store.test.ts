import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DEFAULT_DERP_SYNC_SETTINGS } from "~/server/derp-sync/settings";
import {
  DERP_SYNC_FILE,
  defaultDerpSyncDocument,
  derpSyncPath,
  parseDerpSyncDocument,
  readDerpSyncDocument,
  serializeDerpSyncDocument,
  writeDerpSyncDocument,
} from "~/server/derp-sync/store";
import type { DerpSyncRun } from "~/server/derp-sync/types";

const RUN: DerpSyncRun = {
  at: "2026-01-01T00:00:00.000Z",
  outcome: "changed",
  detected: {
    ipv4: { address: "8.8.8.8", source: "dns" },
    ipv6: { address: "2606:4700::1111", source: "host" },
  },
  changes: [{ family: "ipv4", from: "9.9.9.9", to: "8.8.8.8" }],
  skipped: [{ family: "ipv6", reason: "family-disabled" }],
  unchanged: ["ipv6"],
  snapshotId: "20260101T000000Z-derp-address-sync",
  reload: "manual",
};

describe("DERP sync document parsing", () => {
  test("a missing or corrupt document reads as the defaults", () => {
    expect(parseDerpSyncDocument(undefined)).toEqual(defaultDerpSyncDocument());
    expect(parseDerpSyncDocument("")).toEqual(defaultDerpSyncDocument());
    expect(parseDerpSyncDocument("{not json")).toEqual(defaultDerpSyncDocument());
    expect(parseDerpSyncDocument("[1,2,3]")).toEqual(defaultDerpSyncDocument());
    expect(parseDerpSyncDocument("null")).toEqual(defaultDerpSyncDocument());
  });

  test("normalizes hand-edited settings instead of trusting them", () => {
    const document = parseDerpSyncDocument(
      JSON.stringify({
        settings: { enabled: true, intervalHours: 7, families: "ipv4", autoReload: true },
      }),
    );

    expect(document.settings).toEqual({
      enabled: true,
      intervalHours: DEFAULT_DERP_SYNC_SETTINGS.intervalHours,
      families: "ipv4",
      autoReload: true,
    });
  });

  test("drops parts of the last run that are not usable", () => {
    const document = parseDerpSyncDocument(
      JSON.stringify({
        last: {
          at: "2026-01-01T00:00:00.000Z",
          outcome: "not-an-outcome",
          detected: { ipv4: { address: "8.8.8.8", source: "nope" }, ipv6: "junk" },
          changes: [{ family: "ipv4", to: "8.8.8.8" }, { family: "ipv9", to: "x" }, "junk"],
          skipped: [
            { family: "ipv6", reason: "no-records" },
            { family: "ipv6", reason: "why" },
          ],
          unchanged: ["ipv4", "ipv4", "ipv9"],
          reload: "nonsense",
        },
      }),
    );

    expect(document.last?.outcome).toBe("failed");
    expect(document.last?.detected).toEqual({ ipv4: { address: "8.8.8.8", source: "dns" } });
    expect(document.last?.changes).toEqual([{ family: "ipv4", to: "8.8.8.8" }]);
    expect(document.last?.skipped).toEqual([{ family: "ipv6", reason: "no-records" }]);
    expect(document.last?.unchanged).toEqual(["ipv4"]);
    expect(document.last?.reload).toBe("manual");
  });

  test("serializes stable JSON with a trailing newline", () => {
    const raw = serializeDerpSyncDocument({ settings: DEFAULT_DERP_SYNC_SETTINGS, last: RUN });
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ settings: DEFAULT_DERP_SYNC_SETTINGS, last: RUN });
  });

  test("omits a run that has never happened", () => {
    expect(JSON.parse(serializeDerpSyncDocument(defaultDerpSyncDocument()))).toEqual({
      settings: DEFAULT_DERP_SYNC_SETTINGS,
    });
  });
});

describe("DERP sync file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-sync-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(DERP_SYNC_FILE).toBe("derp-sync.json");
    expect(derpSyncPath(dir)).toBe(join(dir, DERP_SYNC_FILE));
  });

  test("round-trips a document through an atomic write", async () => {
    const document = {
      settings: { ...DEFAULT_DERP_SYNC_SETTINGS, enabled: true, intervalHours: 24 as const },
      last: RUN,
    };

    expect(await writeDerpSyncDocument(dir, document)).toBe(true);
    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([DERP_SYNC_FILE]);

    const read = await readDerpSyncDocument(dir);
    expect(read.settings).toEqual(document.settings);
    expect(read.last).toEqual(RUN);
    expect((await readFile(derpSyncPath(dir), "utf8")).endsWith("\n")).toBe(true);
  });

  test("a missing file reads as the defaults", async () => {
    expect(await readDerpSyncDocument(dir)).toEqual(defaultDerpSyncDocument());
  });

  test("a corrupt file reads as the defaults instead of throwing", async () => {
    await writeFile(derpSyncPath(dir), "{ half written", "utf8");
    expect(await readDerpSyncDocument(dir)).toEqual(defaultDerpSyncDocument());
  });

  test("an unwritable data directory reports failure instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeDerpSyncDocument(blocker, defaultDerpSyncDocument())).toBe(false);
    expect(await readDerpSyncDocument(blocker)).toEqual(defaultDerpSyncDocument());
  });
});
