import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import log from "~/utils/log";

import {
  parseSnapshotIndex,
  parseSnapshotMeta,
  serializeSnapshotIndex,
  sortSnapshots,
  upsertSnapshotIndex,
} from "./index-file";
import {
  isInside,
  isSafeFileName,
  isSafeSnapshotId,
  samePath,
  snapshotId,
  snapshotsRoot,
  uniqueFileName,
} from "./paths";
import {
  SNAPSHOT_INDEX_FILE,
  SNAPSHOT_META_FILE,
  SnapshotError,
  type SnapshotFile,
  type SnapshotMeta,
  type SnapshotTarget,
} from "./types";

export interface SnapshotServiceOptions {
  /** Headplane's data directory; snapshots live in `<data_path>/snapshots`. */
  dataPath: string;
  /** Resolved absolute paths Headplane is allowed to snapshot and restore. */
  getTargets: () => SnapshotTarget[];
  clock?: () => Date;
}

export interface RestoreResult {
  snapshot: SnapshotMeta;
  restored: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copies Headscale's configuration (and policy) files into
 * `<data_path>/snapshots/<timestamp>-<reason>/` and restores them on demand.
 * Everything is guarded by the configured target paths, so a snapshot can never
 * be restored onto a path Headplane was not told about.
 */
export function createSnapshotService(options: SnapshotServiceOptions) {
  const rootDir = snapshotsRoot(options.dataPath);
  const clock = options.clock ?? (() => new Date());

  async function readIndex(): Promise<SnapshotMeta[]> {
    try {
      const raw = await readFile(join(rootDir, SNAPSHOT_INDEX_FILE), "utf8");
      return parseSnapshotIndex(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("config", "Cannot read the snapshot index: %s", errorMessage(error));
      }

      return [];
    }
  }

  async function writeIndex(entries: readonly SnapshotMeta[]): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await writeFile(join(rootDir, SNAPSHOT_INDEX_FILE), serializeSnapshotIndex(entries), "utf8");
  }

  /** Rebuilds the index from the per-snapshot `meta.json` files on disk. */
  async function scanDirectories(): Promise<SnapshotMeta[]> {
    let dirents;
    try {
      dirents = await readdir(rootDir, { withFileTypes: true });
    } catch {
      // A missing data directory simply means there is nothing to list.
      return [];
    }

    const entries: SnapshotMeta[] = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || !isSafeSnapshotId(dirent.name)) {
        continue;
      }

      try {
        const raw = await readFile(join(rootDir, dirent.name, SNAPSHOT_META_FILE), "utf8");
        const meta = parseSnapshotMeta(JSON.parse(raw));
        if (meta) {
          entries.push(meta);
        }
      } catch {
        // Ignore unreadable or malformed snapshot directories.
      }
    }

    return sortSnapshots(entries);
  }

  async function list(): Promise<SnapshotMeta[]> {
    const indexed = await readIndex();
    if (indexed.length > 0) {
      return sortSnapshots(indexed);
    }

    return scanDirectories();
  }

  async function get(id: string): Promise<SnapshotMeta | undefined> {
    if (!isSafeSnapshotId(id)) {
      return undefined;
    }

    const entries = await list();
    return entries.find((entry) => entry.id === id);
  }

  /**
   * Copies every allowed target into a new snapshot. `overrideTargets` narrows
   * the snapshot to those files only, which is how the DERP map editor keeps a
   * copy of the single file it is about to write: restoring such a snapshot
   * cannot touch Headscale's configuration by accident.
   */
  async function take(reason: string, overrideTargets?: SnapshotTarget[]): Promise<SnapshotMeta> {
    const targets = (overrideTargets ?? options.getTargets()).filter(
      (target) => target.path.length > 0,
    );
    if (targets.length === 0) {
      throw new SnapshotError("noTargets", "No Headscale configuration file is configured");
    }

    const at = clock();
    const id = snapshotId(at, reason);
    const dir = join(rootDir, id);
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      throw new SnapshotError(
        "unavailable",
        `Cannot use the snapshot directory ${rootDir}: ${errorMessage(error)}`,
      );
    }

    const used = new Set<string>();
    const files: SnapshotFile[] = [];
    for (const target of targets) {
      const source = resolve(target.path);
      try {
        const info = await stat(source);
        if (!info.isFile()) {
          log.warn("config", "Skipping %s: not a regular file", source);
          continue;
        }

        const name = uniqueFileName(basename(source), used);
        used.add(name);
        await copyFile(source, join(dir, name));
        files.push({ name, sourcePath: source, size: info.size });
      } catch (error) {
        log.warn("config", "Skipping %s: %s", source, errorMessage(error));
      }
    }

    if (files.length === 0) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new SnapshotError("copyFailed", "No configured configuration file could be read");
    }

    const meta: SnapshotMeta = {
      id,
      at: at.toISOString(),
      reason,
      files,
      totalSize: files.reduce((total, file) => total + file.size, 0),
    };

    try {
      await writeFile(join(dir, SNAPSHOT_META_FILE), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new SnapshotError("unavailable", errorMessage(error));
    }

    try {
      await writeIndex(upsertSnapshotIndex(await readIndex(), meta));
    } catch (error) {
      // The index is a cache; the per-snapshot meta.json is the source of truth.
      log.warn("config", "Cannot update the snapshot index: %s", errorMessage(error));
    }

    return meta;
  }

  async function read(
    id: string,
    fileName: string,
  ): Promise<{ snapshot: SnapshotMeta; file: SnapshotFile; content: Buffer }> {
    if (!isSafeSnapshotId(id) || !isSafeFileName(fileName)) {
      throw new SnapshotError("notFound", "Unknown snapshot file");
    }

    const snapshot = await get(id);
    const file = snapshot?.files.find((entry) => entry.name === fileName);
    if (!snapshot || !file) {
      throw new SnapshotError("notFound", "Unknown snapshot file");
    }

    const path = join(rootDir, snapshot.id, file.name);
    if (!isInside(rootDir, path)) {
      throw new SnapshotError("unexpectedPath", `Refusing to read ${path}`);
    }

    try {
      return { snapshot, file, content: await readFile(path) };
    } catch (error) {
      throw new SnapshotError("notFound", errorMessage(error));
    }
  }

  async function restore(id: string, overrideTargets?: SnapshotTarget[]): Promise<RestoreResult> {
    const snapshot = await get(id);
    if (!snapshot) {
      throw new SnapshotError("notFound", `Unknown snapshot ${id}`);
    }

    const targets = (overrideTargets ?? options.getTargets()).filter(
      (target) => target.path.length > 0,
    );
    if (targets.length === 0) {
      throw new SnapshotError("noTargets", "No Headscale configuration file is configured");
    }

    // Resolve everything before writing anything: a snapshot that references a
    // path Headplane does not manage is refused untouched.
    const plan: Array<{ file: SnapshotFile; target: string }> = [];
    for (const file of snapshot.files) {
      const target = targets.find((candidate) => samePath(candidate.path, file.sourcePath));
      if (!target) {
        throw new SnapshotError(
          "unexpectedPath",
          `Refusing to restore ${file.sourcePath}: not a configured path`,
        );
      }

      const resolved = resolve(target.path);
      if (isInside(rootDir, resolved)) {
        throw new SnapshotError("unexpectedPath", `Refusing to restore into ${rootDir}`);
      }

      plan.push({ file, target: resolved });
    }

    if (plan.length === 0) {
      throw new SnapshotError("noTargets", `Snapshot ${id} has no files to restore`);
    }

    const restored: string[] = [];
    for (const { file, target } of plan) {
      const content = await readFile(join(rootDir, snapshot.id, file.name));
      await writeFile(target, content);
      restored.push(file.name);
    }

    return { snapshot, restored };
  }

  return {
    /** Directory snapshots are stored in; also shown in the UI. */
    root: () => rootDir,
    take,
    list,
    get,
    read,
    restore,
  };
}

export type SnapshotService = ReturnType<typeof createSnapshotService>;

/**
 * Takes a snapshot before a mutation. Snapshot failures are logged and never
 * block the mutation they were protecting.
 */
export async function snapshotBeforeMutation(
  snapshots: SnapshotService | undefined,
  reason: string,
): Promise<SnapshotMeta | undefined> {
  if (!snapshots) {
    return undefined;
  }

  try {
    return await snapshots.take(reason);
  } catch (error) {
    log.warn("config", "Failed to snapshot before %s: %s", reason, errorMessage(error));
    return undefined;
  }
}
