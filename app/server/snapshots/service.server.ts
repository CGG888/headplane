import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  isSnapshotError,
  type SnapshotFile,
  type SnapshotMeta,
  type SnapshotTarget,
} from "./types";

/**
 * Snapshots copy Headscale's configuration, which can carry secrets (an API key,
 * a cookie secret, a policy), so neither the directories nor the copies are left
 * at the mercy of the umask.
 */
const SNAPSHOT_DIR_MODE = 0o700;
const SNAPSHOT_FILE_MODE = 0o600;

/**
 * `O_NOFOLLOW` where the platform has it; Windows has no such flag, and the
 * realpath comparison is what refuses a link there.
 */
const NOFOLLOW: number = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

/**
 * How much snapshot history is kept. Every snapshot copies all of the configured
 * files, and a settings save, a policy change or the scheduled derp-sync each
 * take one, so an uncapped history grows the data directory without bound. The
 * newest entries win; the snapshot being taken is never pruned.
 */
const RETAINED_SNAPSHOTS = 50;
const RETAINED_BYTES = 100 * 1024 * 1024;

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
 * Writes `content` through a temporary file and a rename, preserving the mode of
 * an existing target. Used for the snapshot index (a cache that must never be
 * left truncated) and for restores (which overwrite Headscale's live
 * configuration while Headscale itself may be reading it).
 */
async function atomicWriteFile(path: string, content: Buffer | string) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    const existing = await stat(path).catch(() => undefined);
    await writeFile(temp, content, {
      mode: existing === undefined ? SNAPSHOT_FILE_MODE : existing.mode,
    });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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
    await mkdir(rootDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });
    await atomicWriteFile(join(rootDir, SNAPSHOT_INDEX_FILE), serializeSnapshotIndex(entries));
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
   * Drops the oldest snapshots once the count or the byte budget is used up.
   * `list()` is newest first, so the entries are walked from the newest and the
   * first one over a budget is where the history is cut. `protect` is the
   * snapshot that was just written: it is kept even if it alone exceeds the byte
   * budget, because the caller is about to report it as the restore point.
   */
  async function prune(protect: string): Promise<void> {
    const entries = await list();
    const kept: SnapshotMeta[] = [];
    let bytes = 0;
    let dropped = false;

    for (const entry of entries) {
      const overCount = kept.length >= RETAINED_SNAPSHOTS;
      const overBytes = bytes + entry.totalSize > RETAINED_BYTES;
      if (entry.id !== protect && (overCount || overBytes)) {
        try {
          await rm(join(rootDir, entry.id), { recursive: true, force: true });
          dropped = true;
          continue;
        } catch (error) {
          // Leaving a directory behind is better than hiding it from the index
          // while its bytes are still on disk.
          log.warn("config", "Cannot remove the snapshot %s: %s", entry.id, errorMessage(error));
        }
      }

      kept.push(entry);
      bytes += entry.totalSize;
    }

    if (dropped) {
      await writeIndex(kept);
    }
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
    const baseId = snapshotId(at, reason);

    try {
      await mkdir(rootDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });
    } catch (error) {
      throw new SnapshotError(
        "unavailable",
        `Cannot use the snapshot directory ${rootDir}: ${errorMessage(error)}`,
      );
    }

    // A snapshot id only has second precision, so two takes within the same
    // second (a double-clicked button, two DERP map files whose basenames slug
    // to the same reason, or a sync run landing on the same tick) used to
    // resolve to the same directory. `mkdir(..., { recursive: true })` then
    // succeeded silently, the files and meta.json were overwritten, and the
    // earlier restore point was destroyed. Allocate a fresh directory instead.
    let id = baseId;
    let dir = join(rootDir, id);
    let created = false;
    for (let attempt = 1; attempt <= 50 && !created; attempt += 1) {
      id = attempt === 1 ? baseId : `${baseId}-${attempt}`;
      dir = join(rootDir, id);
      try {
        await mkdir(dir, { mode: SNAPSHOT_DIR_MODE });
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new SnapshotError(
            "unavailable",
            `Cannot use the snapshot directory ${rootDir}: ${errorMessage(error)}`,
          );
        }
      }
    }

    if (!created) {
      throw new SnapshotError("unavailable", `Cannot allocate a snapshot directory in ${rootDir}`);
    }

    // The metadata file is written into this same directory, so its name is
    // reserved before the copies are named: a copied file called `meta.json`
    // must never be overwritten by the metadata that describes it.
    const used = new Set<string>([SNAPSHOT_META_FILE]);
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
        const destination = join(dir, name);
        await copyFile(source, destination);
        // `copyFile` keeps the source's mode minus the umask, so a secret-bearing
        // config could land in the snapshot world-readable. The snapshot is only
        // ever read back by Headplane, so make it owner-only.
        await chmod(destination, SNAPSHOT_FILE_MODE);
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
      await writeFile(join(dir, SNAPSHOT_META_FILE), `${JSON.stringify(meta, null, 2)}\n`, {
        encoding: "utf8",
        mode: SNAPSHOT_FILE_MODE,
      });
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

    try {
      await prune(id);
    } catch (error) {
      // Retention is housekeeping: an unreadable index must not fail the
      // snapshot the caller asked for.
      log.warn("config", "Cannot prune old snapshots: %s", errorMessage(error));
    }

    return meta;
  }

  /**
   * Reads one file out of a snapshot directory. The id and the file name cannot
   * carry a path separator, but a symlink placed inside the snapshots directory
   * would still point anywhere, and the download route hands these bytes back to
   * the browser while `restore` writes them over the live configuration. Both
   * `realpath` (which also catches the junctions Windows reports as directories)
   * and `O_NOFOLLOW` are needed: resolving first refuses a link, and opening with
   * `O_NOFOLLOW` refuses one swapped in between the two calls.
   */
  async function readSnapshotFile(snapshot: SnapshotMeta, name: string): Promise<Buffer> {
    const path = join(rootDir, snapshot.id, name);
    if (!isInside(rootDir, path)) {
      throw new SnapshotError("unexpectedPath", `Refusing to read ${path}`);
    }

    if (!isInside(await realpath(rootDir), await realpath(path))) {
      throw new SnapshotError("unexpectedPath", `Refusing to read ${path}`);
    }

    const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
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

    try {
      return { snapshot, file, content: await readSnapshotFile(snapshot, file.name) };
    } catch (error) {
      if (isSnapshotError(error)) {
        throw error;
      }

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

    // Restoring overwrites the live configuration, so keep a copy of what is on
    // disk right now. Without it a restore is a one-way door: the UI reports
    // success, Headscale reloads, and the previous state is gone for good.
    try {
      await take("pre-restore", overrideTargets);
    } catch (error) {
      log.warn("config", "Cannot snapshot before restoring %s: %s", id, errorMessage(error));
    }

    const restored: string[] = [];
    for (const { file, target } of plan) {
      const content = await readSnapshotFile(snapshot, file.name);
      await atomicWriteFile(target, content);
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
