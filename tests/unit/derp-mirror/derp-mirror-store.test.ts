import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DEFAULT_DERP_MIRROR_SETTINGS } from "~/server/derp-mirror/settings";
import {
  DERP_MIRROR_FILE,
  defaultDerpMirrorDocument,
  derpMirrorPath,
  parseDerpMirrorDocument,
  readDerpMirrorDocument,
  readDerpMirrorSettings,
  serializeDerpMirrorDocument,
  writeDerpMirrorDocument,
  writeDerpMirrorSettings,
} from "~/server/derp-mirror/store";
import type { DerpMirrorRun } from "~/server/derp-mirror/types";

const RUN: DerpMirrorRun = {
  at: "2026-01-01T00:00:00.000Z",
  mode: "run",
  outcome: "changed",
  selected: ["20", "3", "9"],
  mirrored: ["20", "3", "9"],
  assignment: { "20": 901, "3": 902, "9": 903 },
  targetPath: "/mnt/derp/official-mirror.yaml",
  changed: true,
  snapshotId: "20260101T000000Z-derp-region-mirror",
  reload: "triggered",
};

describe("DERP mirror document parsing", () => {
  test("a missing or corrupt document reads as the defaults", () => {
    expect(parseDerpMirrorDocument(undefined)).toEqual(defaultDerpMirrorDocument());
    expect(parseDerpMirrorDocument("")).toEqual(defaultDerpMirrorDocument());
    expect(parseDerpMirrorDocument("{not json")).toEqual(defaultDerpMirrorDocument());
    expect(parseDerpMirrorDocument("[1,2,3]")).toEqual(defaultDerpMirrorDocument());
    expect(parseDerpMirrorDocument("null")).toEqual(defaultDerpMirrorDocument());
  });

  test("normalizes hand-edited settings instead of trusting them", () => {
    const document = parseDerpMirrorDocument(
      JSON.stringify({
        settings: {
          enabled: true,
          officialRegionIds: ["20", 3, "junk"],
          assignment: { "20": 901, "3": 42 },
          intervalHours: 7,
          targetPath: "relative.yaml",
        },
      }),
    );

    expect(document.settings).toEqual({
      enabled: true,
      officialRegionIds: ["20", "3"],
      assignment: { "20": 901 },
      targetPath: DEFAULT_DERP_MIRROR_SETTINGS.targetPath,
      intervalHours: DEFAULT_DERP_MIRROR_SETTINGS.intervalHours,
      autoReload: true,
    });
  });

  test("drops parts of the last run that are not usable", () => {
    const document = parseDerpMirrorDocument(
      JSON.stringify({
        last: {
          at: "2026-01-01T00:00:00.000Z",
          mode: "nonsense",
          outcome: "nonsense",
          selected: ["20", "x", 3],
          mirrored: "nope",
          assignment: { "20": 901, bad: "x" },
          targetPath: "/mnt/derp/mirror.yaml",
          changed: "yes",
          reason: "why",
          reload: "nonsense",
        },
      }),
    );

    expect(document.last).toMatchObject({
      at: "2026-01-01T00:00:00.000Z",
      // A document written before the two buttons existed recorded a run.
      mode: "run",
      outcome: "failed",
      selected: ["20", "3"],
      mirrored: [],
      assignment: { "20": 901 },
      changed: false,
      reload: "manual",
    });
    expect(document.last?.reason).toBeUndefined();
  });

  test("keeps a check run and its reason code", () => {
    const document = parseDerpMirrorDocument(
      JSON.stringify({
        last: {
          at: "2026-01-01T00:00:00.000Z",
          mode: "check",
          outcome: "skipped",
          reason: "validation-failed",
          detail: "derpNodeInvalidIpv4",
          reload: "not-needed",
        },
      }),
    );

    expect(document.last?.mode).toBe("check");
    expect(document.last?.reason).toBe("validation-failed");
    expect(document.last?.detail).toBe("derpNodeInvalidIpv4");
  });

  test("serializes stable JSON with a trailing newline", () => {
    const raw = serializeDerpMirrorDocument({ settings: DEFAULT_DERP_MIRROR_SETTINGS, last: RUN });
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ settings: DEFAULT_DERP_MIRROR_SETTINGS, last: RUN });
  });

  test("omits a run that has never happened", () => {
    expect(JSON.parse(serializeDerpMirrorDocument(defaultDerpMirrorDocument()))).toEqual({
      settings: DEFAULT_DERP_MIRROR_SETTINGS,
    });
  });
});

describe("DERP mirror file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-mirror-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(DERP_MIRROR_FILE).toBe("derp-region-mirror.json");
    expect(derpMirrorPath(dir)).toBe(join(dir, DERP_MIRROR_FILE));
  });

  test("round-trips a document through an atomic write", async () => {
    const document = {
      settings: { ...DEFAULT_DERP_MIRROR_SETTINGS, enabled: true, intervalHours: 6 as const },
      last: RUN,
    };

    await writeDerpMirrorDocument(dir, document);
    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([DERP_MIRROR_FILE]);

    const read = await readDerpMirrorDocument(dir);
    expect(read.settings).toEqual(document.settings);
    expect(read.last).toEqual(RUN);
    expect((await readFile(derpMirrorPath(dir), "utf8")).endsWith("\n")).toBe(true);
    expect(await readDerpMirrorSettings(dir)).toEqual(document.settings);
  });

  test("a missing file reads as the defaults", async () => {
    expect(await readDerpMirrorDocument(dir)).toEqual(defaultDerpMirrorDocument());
    expect(await readDerpMirrorSettings(dir)).toEqual(DEFAULT_DERP_MIRROR_SETTINGS);
  });

  test("a corrupt file reads as the defaults instead of throwing", async () => {
    await writeFile(derpMirrorPath(dir), "{ half written", "utf8");
    expect(await readDerpMirrorDocument(dir)).toEqual(defaultDerpMirrorDocument());
  });

  test("a settings save keeps the newest run", async () => {
    await writeDerpMirrorDocument(dir, { settings: DEFAULT_DERP_MIRROR_SETTINGS, last: RUN });
    await writeDerpMirrorSettings(dir, { ...DEFAULT_DERP_MIRROR_SETTINGS, enabled: true });

    const read = await readDerpMirrorDocument(dir);
    expect(read.settings.enabled).toBe(true);
    expect(read.last).toEqual(RUN);
  });

  test("a settings save normalizes what it is handed", async () => {
    await writeDerpMirrorSettings(dir, {
      ...DEFAULT_DERP_MIRROR_SETTINGS,
      intervalHours: 7 as unknown as 6,
      targetPath: "relative.yaml",
    });

    const settings = await readDerpMirrorSettings(dir);
    expect(settings.intervalHours).toBe(24);
    expect(settings.targetPath).toBe(DEFAULT_DERP_MIRROR_SETTINGS.targetPath);
  });

  test("an unwritable data directory reports failure instead of throwing silently", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    await expect(
      writeDerpMirrorDocument(blocker, defaultDerpMirrorDocument()),
    ).rejects.toBeDefined();
    expect(await readDerpMirrorDocument(blocker)).toEqual(defaultDerpMirrorDocument());
  });
});
