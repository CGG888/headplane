import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createSnapshotService,
  type SnapshotServiceOptions,
} from "~/server/snapshots/service.server";
import {
  SNAPSHOT_INDEX_FILE,
  SNAPSHOT_META_FILE,
  SnapshotError,
  type SnapshotTarget,
} from "~/server/snapshots/types";

let temp: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "hp-snapshots-"));
});

afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function fixture(overrides: Partial<SnapshotServiceOptions> = {}) {
  const configPath = join(temp, "etc", "config.yaml");
  const policyPath = join(temp, "etc", "policy.hujson");
  await mkdir(join(temp, "etc"), { recursive: true });
  await writeFile(configPath, "server_url: http://headscale\n", "utf8");
  await writeFile(policyPath, '{"acls": []}\n', "utf8");

  const targets: SnapshotTarget[] = [
    { path: configPath, kind: "headscale_config" },
    { path: policyPath, kind: "policy" },
  ];

  const snapshots = createSnapshotService({
    dataPath: join(temp, "data"),
    getTargets: () => targets,
    clock: () => new Date("2026-10-05T01:30:00Z"),
    ...overrides,
  });

  return { snapshots, configPath, policyPath, targets };
}

describe("snapshot service", () => {
  test("copies the configured files and writes a metadata index", async () => {
    const { snapshots, configPath, policyPath } = await fixture();

    const meta = await snapshots.take("manual");

    expect(meta.id).toBe("20261005T013000Z-manual");
    expect(meta.files.map((file) => file.name).sort()).toEqual(["config.yaml", "policy.hujson"]);
    expect(meta.totalSize).toBeGreaterThan(0);

    expect(await readFile(join(snapshots.root(), meta.id, "config.yaml"), "utf8")).toBe(
      await readFile(configPath, "utf8"),
    );

    const listed = await snapshots.list();
    expect(listed.map((item) => item.id)).toEqual([meta.id]);
    expect(listed[0]?.files.map((file) => file.sourcePath).sort()).toEqual(
      [configPath, policyPath].sort(),
    );
  });

  test("a copy named like the metadata file does not overwrite it", async () => {
    const colliding = join(temp, "meta.json");
    await writeFile(colliding, "server_url: http://source\n", "utf8");
    const { snapshots } = await fixture({
      getTargets: () => [{ path: colliding, kind: "headscale_config" }],
    });

    const meta = await snapshots.take("manual");

    // The metadata file name is reserved, so the copy is renamed instead of
    // being overwritten by the metadata that describes it.
    expect(meta.files.map((file) => file.name)).toEqual(["meta-2.json"]);

    const directory = join(snapshots.root(), meta.id);
    const index = JSON.parse(await readFile(join(directory, SNAPSHOT_META_FILE), "utf8")) as {
      files: Array<{ name: string }>;
    };
    expect(index.files.map((file) => file.name)).toEqual(["meta-2.json"]);
    expect(await readFile(join(directory, "meta-2.json"), "utf8")).toBe(
      "server_url: http://source\n",
    );
  });

  test("creates the snapshot directory when the data directory does not exist yet", async () => {
    const { snapshots } = await fixture({
      dataPath: join(temp, "nested", "data"),
    });

    const meta = await snapshots.take("manual");
    expect((await snapshots.list()).map((item) => item.id)).toEqual([meta.id]);
  });

  test("lists nothing when the data directory is missing", async () => {
    const { snapshots } = await fixture({ dataPath: join(temp, "absent") });

    await expect(snapshots.list()).resolves.toEqual([]);
    await expect(snapshots.get("20261005T013000Z-manual")).resolves.toBeUndefined();
  });

  test("fails cleanly when no configuration file can be read", async () => {
    const { snapshots } = await fixture({
      getTargets: () => [{ path: join(temp, "missing.yaml"), kind: "headscale_config" }],
    });

    await expect(snapshots.take("manual")).rejects.toMatchObject({ code: "copyFailed" });
    await expect(snapshots.list()).resolves.toEqual([]);
  });

  test("fails cleanly when nothing is configured", async () => {
    const { snapshots } = await fixture({ getTargets: () => [] });

    await expect(snapshots.take("manual")).rejects.toMatchObject({ code: "noTargets" });
  });

  test("restores the snapshot over the configured file", async () => {
    const { snapshots, configPath } = await fixture();
    const meta = await snapshots.take("manual");

    await writeFile(configPath, "server_url: http://broken\n", "utf8");

    const result = await snapshots.restore(meta.id);
    expect(result.restored).toContain("config.yaml");
    expect(result.snapshot.id).toBe(meta.id);
    expect(await readFile(configPath, "utf8")).toBe("server_url: http://headscale\n");
  });

  test("refuses to restore a snapshot that points at an unexpected path", async () => {
    const { snapshots, configPath } = await fixture();
    const strangerPath = join(temp, "stranger.yaml");
    await writeFile(strangerPath, "server_url: http://evil\n", "utf8");

    // A snapshot written by hand (or moved from another host) referencing a
    // file Headplane was never told about.
    const id = "20261005T013000Z-tampered";
    const dir = join(snapshots.root(), id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.yaml"), "server_url: http://evil\n", "utf8");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify({
        id,
        at: "2026-10-05T01:30:00.000Z",
        reason: "tampered",
        files: [{ name: "config.yaml", sourcePath: strangerPath, size: 20 }],
        totalSize: 20,
      }),
      "utf8",
    );

    await expect(snapshots.restore(id)).rejects.toBeInstanceOf(SnapshotError);
    await expect(snapshots.restore(id)).rejects.toMatchObject({ code: "unexpectedPath" });
    expect(await readFile(configPath, "utf8")).toBe("server_url: http://headscale\n");
    expect(await readFile(strangerPath, "utf8")).toBe("server_url: http://evil\n");
  });

  test("refuses to restore into the snapshot directory itself", async () => {
    const insideDir = join(temp, "data", "snapshots");
    await mkdir(insideDir, { recursive: true });
    const insideFile = join(insideDir, "config.yaml");
    await writeFile(insideFile, "server_url: http://inside\n", "utf8");

    const snapshots = createSnapshotService({
      dataPath: join(temp, "data"),
      getTargets: () => [{ path: insideFile, kind: "headscale_config" }],
      clock: () => new Date("2026-10-05T01:30:00Z"),
    });

    const meta = await snapshots.take("manual");
    await expect(snapshots.restore(meta.id)).rejects.toMatchObject({ code: "unexpectedPath" });
  });

  test("reports unknown snapshots and unsafe file names", async () => {
    const { snapshots } = await fixture();

    await expect(snapshots.restore("20261005T013000Z-missing")).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(snapshots.read("20261005T013000Z-missing", "config.yaml")).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(snapshots.read("../../etc", "config.yaml")).rejects.toMatchObject({
      code: "notFound",
    });

    const meta = await snapshots.take("manual");
    await expect(snapshots.read(meta.id, "../meta.json")).rejects.toMatchObject({
      code: "notFound",
    });

    const { content, file } = await snapshots.read(meta.id, "config.yaml");
    expect(file.size).toBe(content.byteLength);
    expect(content.toString("utf8")).toBe("server_url: http://headscale\n");
  });

  // Windows reports only the read-only bit through `stat`, so the modes can only
  // be checked where they mean something.
  test.skipIf(process.platform === "win32")(
    "gives the snapshot files and directories an owner-only mode",
    async () => {
      const { snapshots } = await fixture();
      const meta = await snapshots.take("manual");
      const dir = join(snapshots.root(), meta.id);

      expect((await stat(snapshots.root())).mode & 0o777).toBe(0o700);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(dir, "config.yaml"))).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, "meta.json"))).mode & 0o777).toBe(0o600);
    },
  );

  test("refuses to read a snapshot file that links out of the snapshot root", async () => {
    const { snapshots } = await fixture();
    const outside = join(temp, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "config.yaml"), "server_url: http://evil\n", "utf8");

    // A snapshot directory that is really a link: everything inside it passes the
    // name checks and still resolves to a file Headplane never copied.
    const id = "20261005T013000Z-linked";
    await mkdir(snapshots.root(), { recursive: true });
    await symlink(outside, join(snapshots.root(), id), "junction");
    await writeFile(
      join(snapshots.root(), SNAPSHOT_INDEX_FILE),
      JSON.stringify([
        {
          id,
          at: "2026-10-05T01:30:00.000Z",
          reason: "linked",
          files: [{ name: "config.yaml", sourcePath: join(outside, "config.yaml"), size: 26 }],
          totalSize: 26,
        },
      ]),
      "utf8",
    );

    await expect(snapshots.read(id, "config.yaml")).rejects.toMatchObject({
      code: "unexpectedPath",
    });
  });

  test("refuses to restore a snapshot file that links out of the snapshot root", async () => {
    const outside = join(temp, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "config.yaml"), "server_url: http://evil\n", "utf8");

    const { snapshots } = await fixture({
      getTargets: () => [{ path: join(outside, "config.yaml"), kind: "headscale_config" }],
    });

    const id = "20261005T013000Z-linked";
    await mkdir(snapshots.root(), { recursive: true });
    await symlink(outside, join(snapshots.root(), id), "junction");
    await writeFile(
      join(snapshots.root(), SNAPSHOT_INDEX_FILE),
      JSON.stringify([
        {
          id,
          at: "2026-10-05T01:30:00.000Z",
          reason: "linked",
          files: [{ name: "config.yaml", sourcePath: join(outside, "config.yaml"), size: 26 }],
          totalSize: 26,
        },
      ]),
      "utf8",
    );

    await expect(snapshots.restore(id)).rejects.toMatchObject({ code: "unexpectedPath" });
    expect(await readFile(join(outside, "config.yaml"), "utf8")).toBe("server_url: http://evil\n");
  });

  test("keeps the newest snapshots and prunes the rest", async () => {
    let tick = 0;
    const { snapshots } = await fixture({
      clock: () => new Date(Date.UTC(2026, 9, 5, 1, 30, 0) + tick++ * 1000),
    });

    const ids: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      ids.push((await snapshots.take("manual")).id);
    }

    const listed = await snapshots.list();
    expect(listed).toHaveLength(50);
    expect(listed[0]?.id).toBe(ids[54]);
    expect(listed.map((entry) => entry.id)).not.toContain(ids[0]);

    // Pruned means gone from disk, not just hidden from the index.
    await expect(stat(join(snapshots.root(), ids[0]!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
