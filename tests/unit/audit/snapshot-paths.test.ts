import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  parseSnapshotIndex,
  parseSnapshotMeta,
  serializeSnapshotIndex,
  sortSnapshots,
  upsertSnapshotIndex,
} from "~/server/snapshots/index-file";
import {
  isInside,
  isSafeFileName,
  isSafeSnapshotId,
  reasonSlug,
  resolveTargetPath,
  samePath,
  snapshotId,
  snapshotsRoot,
  timestampSlug,
  uniqueFileName,
} from "~/server/snapshots/paths";
import type { SnapshotMeta } from "~/server/snapshots/types";

function meta(overrides: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    id: "20261005T013000Z-manual",
    at: "2026-10-05T01:30:00.000Z",
    reason: "manual",
    files: [{ name: "config.yaml", sourcePath: "/etc/headscale/config.yaml", size: 12 }],
    totalSize: 12,
    ...overrides,
  };
}

describe("snapshot naming", () => {
  test("names directories <timestamp>-<reason>", () => {
    expect(timestampSlug(new Date("2026-10-05T01:30:09.999Z"))).toBe("20261005T013009Z");
    expect(snapshotId(new Date("2026-10-05T01:30:00Z"), "Manual Snapshot")).toBe(
      "20261005T013000Z-manual-snapshot",
    );
  });

  test("slugifies reasons and falls back when nothing is left", () => {
    expect(reasonSlug("  OIDC Restrictions!!!  ")).toBe("oidc-restrictions");
    expect(reasonSlug("///")).toBe("snapshot");
    expect(reasonSlug("a".repeat(80))).toHaveLength(40);
  });

  test("keeps snapshot paths inside the snapshots root", () => {
    const root = snapshotsRoot("/var/lib/headplane");
    expect(root.endsWith("snapshots")).toBe(true);
    expect(isInside(root, join(root, "20261005T013000Z-manual", "config.yaml"))).toBe(true);
    expect(isInside(root, `${root}/../hp_persist.db`)).toBe(false);
    expect(isInside(root, root)).toBe(false);
  });

  test("rejects unsafe ids and file names", () => {
    expect(isSafeSnapshotId("20261005T013000Z-manual")).toBe(true);
    expect(isSafeSnapshotId("../evil")).toBe(false);
    expect(isSafeSnapshotId("a/b")).toBe(false);
    expect(isSafeSnapshotId("")).toBe(false);
    expect(isSafeSnapshotId("/abs")).toBe(false);

    expect(isSafeFileName("config.yaml")).toBe(true);
    expect(isSafeFileName("..")).toBe(false);
    expect(isSafeFileName("a/b")).toBe(false);
    expect(isSafeFileName("a\\b")).toBe(false);
  });

  test("deduplicates file names inside one snapshot", () => {
    const used = new Set(["config.yaml"]);
    expect(uniqueFileName("config.yaml", used)).toBe("config-2.yaml");
    expect(uniqueFileName("config.yaml", new Set(["config.yaml", "config-2.yaml"]))).toBe(
      "config-3.yaml",
    );
    expect(uniqueFileName("policy.hujson", used)).toBe("policy.hujson");
  });

  test("treats the same path as equal", () => {
    expect(samePath("/etc/headscale/config.yaml", "/etc/headscale/./config.yaml")).toBe(true);
    expect(samePath("/etc/headscale/config.yaml", "/etc/headscale/other.yaml")).toBe(false);
  });

  test("resolves relative targets against the headscale config directory", () => {
    expect(resolveTargetPath("policy.hujson", "/etc/headscale")).toBe(
      resolveTargetPath("/etc/headscale/policy.hujson"),
    );
    expect(resolveTargetPath("/opt/policy.hujson", "/etc/headscale")).toBe(
      resolveTargetPath("/opt/policy.hujson"),
    );
  });
});

describe("snapshot metadata index", () => {
  test("parses a stored index and recomputes sizes", () => {
    const parsed = parseSnapshotIndex(
      JSON.stringify([
        meta({ files: [{ name: "config.yaml", sourcePath: "/a/config.yaml", size: 10 }] }),
      ]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.totalSize).toBe(10);
  });

  test("degrades to an empty index instead of throwing", () => {
    expect(parseSnapshotIndex("not json")).toEqual([]);
    expect(parseSnapshotIndex("{}")).toEqual([]);
    expect(parseSnapshotMeta({ id: "../evil", at: "nope" })).toBeUndefined();
    expect(
      parseSnapshotMeta(meta({ files: [{ name: "../x", sourcePath: "/a", size: 1 }] })),
    ).toEqual(meta({ files: [], totalSize: 0 }));
  });

  test("round-trips and keeps the newest snapshot first", () => {
    const older = meta({ id: "20261005T010000Z-manual", at: "2026-10-05T01:00:00.000Z" });
    const newer = meta({ id: "20261005T020000Z-manual", at: "2026-10-05T02:00:00.000Z" });

    expect(sortSnapshots([older, newer]).map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(upsertSnapshotIndex([older], newer).map((item) => item.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(upsertSnapshotIndex([older], meta(older))).toHaveLength(1);

    const roundTripped = parseSnapshotIndex(serializeSnapshotIndex([older, newer]));
    expect(roundTripped.map((item) => item.id)).toEqual([newer.id, older.id]);
  });
});
