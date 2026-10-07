/**
 * Read, validate, and write the local DERP map files Headscale loads from
 * `derp.paths`.
 *
 * Headscale reads those files at startup and merges them into the relay map it
 * hands to clients, so Headplane only ever touches a path the operator has
 * already listed in Headscale's own configuration. Every rule is enforced here
 * rather than in the browser: the path has to be one of the configured entries,
 * the content has to be a valid DERP map, the size is capped, and the write is a
 * temp file plus rename in the same directory so a crash can never leave a
 * half-written map behind. A successful save is always preceded by a snapshot of
 * the file it replaces.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { MAX_DERP_MAP_BYTES } from "~/routes/settings/headscale/derp-map-limits";
import { validateDerpMap, type DerpMapIssue } from "~/routes/settings/headscale/derp-map-schema";
import { isAbsoluteFilePath } from "~/routes/settings/headscale/derp-settings";
import { samePath, resolveTargetPath } from "~/server/snapshots/paths";
import { SNAPSHOT_REASONS } from "~/server/snapshots/reasons";
import type { SnapshotService } from "~/server/snapshots/service.server";
import type { SnapshotMeta, SnapshotTarget } from "~/server/snapshots/types";
import log from "~/utils/log";

export { MAX_DERP_MAP_BYTES };

/** Mode a brand new map file is created with, matching a plain `umask 022` file. */
export const DEFAULT_DERP_MAP_MODE = 0o644;

/**
 * Reason prefix for the snapshot taken right before a write. The file's own name
 * is appended, so the snapshots page lists one readable entry per edited file.
 */
export const DERP_MAP_SNAPSHOT_REASON = `${SNAPSHOT_REASONS.derpMap}: `;

/**
 * Reason prefix for the copy taken before a rollback writes the old content
 * back. It is deliberately different from the edit prefix: rolling back must not
 * move the target the "roll back" button points at, or a second click would undo
 * the rollback instead of repeating it.
 */
export const DERP_MAP_ROLLBACK_REASON = `${SNAPSHOT_REASONS.derpMap} rollback: `;

/** Paths the browser may act on, resolved and checked before any filesystem use. */
export type DerpMapPathCode = "invalidDerpMapPath" | "derpMapPathNotConfigured";

export type DerpMapPathGuard = { ok: true; path: string } | { ok: false; code: DerpMapPathCode };

/** A `..` segment would let a request name a file the operator never listed. */
function hasTraversal(path: string): boolean {
  return path.split(/[\\/]+/).includes("..");
}

/**
 * Matches a path from a request against the entries configured in
 * `derp.paths`. Headscale's configuration is the allow-list: a request can only
 * ever address one of those entries, it must be absolute, and it may not contain
 * a parent segment. The configured entry's resolved path is returned, so the
 * rest of the module never works with a path the browser supplied.
 */
export function guardDerpMapPath(
  configured: readonly string[],
  requested: string,
  baseDir?: string,
): DerpMapPathGuard {
  const submitted = requested.trim();
  if (submitted.length === 0 || !isAbsoluteFilePath(submitted) || hasTraversal(submitted)) {
    return { ok: false, code: "invalidDerpMapPath" };
  }

  for (const entry of configured) {
    const configuredEntry = entry.trim();
    if (configuredEntry.length === 0) {
      continue;
    }

    const resolved = resolveTargetPath(configuredEntry, baseDir);
    if (submitted === configuredEntry || samePath(resolved, submitted)) {
      return { ok: true, path: resolved };
    }
  }

  return { ok: false, code: "derpMapPathNotConfigured" };
}

/** The part of `node:fs/promises` the atomic write needs. */
export interface AtomicWriteFs {
  stat: (path: string) => Promise<{ mode: number }>;
  writeFile: (
    path: string,
    data: string | Uint8Array,
    options: { encoding?: BufferEncoding; mode?: number },
  ) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

const nodeFs: AtomicWriteFs = {
  stat: async (path) => {
    const info = await stat(path);
    return { mode: info.mode };
  },
  writeFile: async (path, data, options) => {
    await writeFile(path, data, options);
  },
  chmod: async (path, mode) => {
    await chmod(path, mode);
  },
  rename: async (from, to) => {
    await rename(from, to);
  },
  unlink: async (path) => {
    await unlink(path);
  },
};

/**
 * Writes `content` so readers only ever see the old or the new file, never a
 * partial one: a uniquely named temp file in the same directory receives the
 * bytes, then a rename replaces the target. The existing file's mode is carried
 * over (a `chmod` defeats the process umask), and a failure anywhere removes the
 * temp file instead of leaving litter next to the map.
 */
export async function atomicWriteFile(
  path: string,
  content: string | Uint8Array,
  fs: AtomicWriteFs = nodeFs,
): Promise<void> {
  const directory = dirname(path);
  const temp = join(directory, `${basename(path)}.headplane-${randomUUID()}.tmp`);

  let mode = DEFAULT_DERP_MAP_MODE;
  try {
    const info = await fs.stat(path);
    mode = info.mode & 0o777;
  } catch {
    // A file that does not exist yet is created with the default mode.
  }

  try {
    await fs.writeFile(temp, content, { encoding: "utf8", mode });
    await fs.chmod(temp, mode);
    await fs.rename(temp, path);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Everything the page needs to render one configured path. */
export interface DerpMapFileView {
  /** The path exactly as it is written in `derp.paths`. */
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  isFile: boolean;
  size: number;
  tooLarge: boolean;
  /** Neither the file nor anything above it can be seen from this process. */
  unavailable: boolean;
  /** Present only when the file was read and fits in the size cap. */
  content?: string;
  issues: DerpMapIssue[];
  /** The snapshot taken before the most recent write, when one exists. */
  snapshotId?: string;
}

export interface InspectDerpMapOptions {
  /** Directory relative `derp.paths` entries resolve against. */
  baseDir?: string;
  snapshots?: Pick<SnapshotService, "list">;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the directory tree holding `path` exists at all. Mirrors the
 * configuration checks: a path whose whole tree is missing is a host directory
 * this container was never given, which is reported as "cannot check" instead of
 * as a broken configuration.
 */
async function parentVisible(path: string): Promise<boolean> {
  let current = dirname(path);

  for (let depth = 0; depth < 64; depth++) {
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }

    if (await canAccess(current, constants.F_OK)) {
      return true;
    }

    current = parent;
  }

  return false;
}

/** Newest snapshot that holds this exact file and was taken right before a write. */
function latestEditSnapshot(
  entries: readonly SnapshotMeta[] | undefined,
  path: string,
): string | undefined {
  for (const entry of entries ?? []) {
    if (!entry.reason.startsWith(DERP_MAP_SNAPSHOT_REASON)) {
      continue;
    }

    if (entry.files.some((file) => samePath(file.sourcePath, path))) {
      return entry.id;
    }
  }

  return undefined;
}

/** The snapshot list, or `undefined` when it cannot be read at all. */
async function readSnapshotList(
  snapshots: Pick<SnapshotService, "list"> | undefined,
): Promise<SnapshotMeta[] | undefined> {
  if (!snapshots) {
    return undefined;
  }

  try {
    return await snapshots.list();
  } catch (error) {
    log.warn("config", "Cannot read the snapshot list: %s", String(error));
    return undefined;
  }
}

/** One configured path, inspected without ever throwing. */
async function inspectOne(
  configured: string,
  resolved: string,
  snapshotId?: string,
): Promise<DerpMapFileView> {
  const view: DerpMapFileView = {
    path: configured,
    exists: false,
    readable: false,
    writable: false,
    isFile: false,
    size: 0,
    tooLarge: false,
    unavailable: false,
    issues: [],
    snapshotId,
  };

  try {
    const info = await stat(resolved);
    view.exists = true;
    view.isFile = info.isFile();
    view.size = info.isFile() ? info.size : 0;
    view.readable = view.isFile && (await canAccess(resolved, constants.R_OK));
    view.writable = view.isFile && (await canAccess(resolved, constants.W_OK));
  } catch {
    // A missing file can be created, so what matters is whether its directory is
    // writable, and whether this process can see that directory at all.
    view.unavailable = !(await parentVisible(resolved));
    view.writable = !view.unavailable && (await canAccess(dirname(resolved), constants.W_OK));
    return view;
  }

  if (view.size > MAX_DERP_MAP_BYTES) {
    view.tooLarge = true;
    return view;
  }

  if (view.readable) {
    try {
      const content = await readFile(resolved, "utf8");

      // The size was measured before the file was opened, so a file that kept
      // growing in between would have been read past the ceiling that check
      // approved. Re-stat after reading and refuse the answer when it moved.
      const after = await stat(resolved);
      if (!after.isFile() || after.size !== view.size) {
        log.warn(
          "config",
          "The DERP map file at %s changed while it was being read; it was not inspected",
          resolved,
        );
        view.readable = false;
        view.size = after.isFile() ? after.size : view.size;
        view.tooLarge = view.size > MAX_DERP_MAP_BYTES;
        return view;
      }

      view.content = content;
      view.issues = validateDerpMap(content);
    } catch (error) {
      log.warn("config", "Cannot read the DERP map file at %s: %s", resolved, String(error));
      view.readable = false;
    }
  }

  return view;
}

/**
 * Inspects every configured `derp.paths` entry: whether it is there, readable,
 * writable, and whether its content is a DERP map Headscale would accept. The
 * snapshot list is read once and shared by every path.
 */
export async function inspectDerpMapFiles(
  paths: readonly string[],
  options: InspectDerpMapOptions = {},
): Promise<DerpMapFileView[]> {
  const entries = paths
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((configured) => ({
      configured,
      resolved: resolveTargetPath(configured, options.baseDir),
    }));

  const snapshotList = await readSnapshotList(options.snapshots);

  return Promise.all(
    entries.map(({ configured, resolved }) =>
      inspectOne(configured, resolved, latestEditSnapshot(snapshotList, resolved)),
    ),
  );
}

export type DerpMapWriteCode =
  | DerpMapPathCode
  | "derpMapTooLarge"
  | "derpMapInvalid"
  | "derpMapUnavailable"
  | "derpMapNotWritable"
  | "derpMapWriteFailed";

export type DerpMapSaveResult =
  | { ok: true; path: string; snapshotId?: string }
  | { ok: false; code: DerpMapWriteCode; issues?: DerpMapIssue[] };

export interface DerpMapSaveInput {
  /** `derp.paths` as Headscale's configuration currently lists it. */
  configuredPaths: readonly string[];
  baseDir?: string;
  /** The path exactly as the page submitted it; never trusted on its own. */
  requestedPath: string;
  content: string;
  snapshots?: SnapshotService;
}

/**
 * Refuses a write Headscale's container could not perform: the file has to be
 * writable when it exists, and its directory has to be writable when it does
 * not. A path this process cannot see at all is reported separately, because
 * that is a missing mount rather than a permission problem.
 */
async function assertWritable(path: string): Promise<DerpMapWriteCode | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return "derpMapNotWritable";
    }

    return (await canAccess(path, constants.W_OK)) ? undefined : "derpMapNotWritable";
  } catch {
    if (!(await parentVisible(path))) {
      return "derpMapUnavailable";
    }

    return (await canAccess(dirname(path), constants.W_OK)) ? undefined : "derpMapNotWritable";
  }
}

/**
 * Copies the file into a snapshot of its own before it is replaced. Best effort,
 * exactly like every other snapshot Headplane takes: a full disk must not stop
 * the operator from fixing a broken DERP map.
 */
async function snapshotMapFile(
  snapshots: SnapshotService | undefined,
  path: string,
  reason: string,
): Promise<string | undefined> {
  if (!snapshots) {
    return undefined;
  }

  try {
    const target: SnapshotTarget = { path, kind: "derp_map" };
    const meta = await snapshots.take(`${reason}${basename(path)}`, [target]);
    return meta.id;
  } catch (error) {
    // A file that does not exist yet has nothing to snapshot.
    log.warn("config", "Cannot snapshot the DERP map file at %s: %s", path, String(error));
    return undefined;
  }
}

/**
 * Validates and writes one configured DERP map file. The server is the
 * authority: the browser's inline check uses the same validator, but nothing is
 * written before this function agrees.
 */
export async function saveDerpMapFile(input: DerpMapSaveInput): Promise<DerpMapSaveResult> {
  const guard = guardDerpMapPath(input.configuredPaths, input.requestedPath, input.baseDir);
  if (!guard.ok) {
    return { ok: false, code: guard.code };
  }

  if (Buffer.byteLength(input.content, "utf8") > MAX_DERP_MAP_BYTES) {
    return { ok: false, code: "derpMapTooLarge" };
  }

  const issues = validateDerpMap(input.content);
  if (issues.length > 0) {
    return { ok: false, code: "derpMapInvalid", issues };
  }

  const problem = await assertWritable(guard.path);
  if (problem) {
    return { ok: false, code: problem };
  }

  const snapshotId = await snapshotMapFile(input.snapshots, guard.path, DERP_MAP_SNAPSHOT_REASON);

  try {
    await atomicWriteFile(guard.path, input.content);
  } catch (error) {
    log.error("config", "Cannot write the DERP map file at %s: %s", guard.path, String(error));
    return { ok: false, code: "derpMapWriteFailed" };
  }

  log.info("config", "Wrote the DERP map file at %s", guard.path);
  return { ok: true, path: guard.path, snapshotId };
}

export type DerpMapRestoreResult =
  | { ok: true; path: string; snapshotId: string; rollbackId?: string }
  | { ok: false; code: DerpMapWriteCode | "derpMapNoSnapshot" };

export interface DerpMapRestoreInput {
  configuredPaths: readonly string[];
  baseDir?: string;
  requestedPath: string;
  snapshots?: SnapshotService;
}

/**
 * Puts the content of the newest pre-write snapshot back. The current content is
 * snapshotted first (under the rollback reason), so a rollback is itself
 * reversible, and the target of the next rollback stays where it was.
 */
export async function restoreDerpMapFile(
  input: DerpMapRestoreInput,
): Promise<DerpMapRestoreResult> {
  const guard = guardDerpMapPath(input.configuredPaths, input.requestedPath, input.baseDir);
  if (!guard.ok) {
    return { ok: false, code: guard.code };
  }

  if (!input.snapshots) {
    return { ok: false, code: "derpMapNoSnapshot" };
  }

  const snapshotId = latestEditSnapshot(await readSnapshotList(input.snapshots), guard.path);
  if (!snapshotId) {
    return { ok: false, code: "derpMapNoSnapshot" };
  }

  const meta = await input.snapshots.get(snapshotId);
  const file = meta?.files.find((entry) => samePath(entry.sourcePath, guard.path));
  if (!meta || !file) {
    return { ok: false, code: "derpMapNoSnapshot" };
  }

  const problem = await assertWritable(guard.path);
  if (problem) {
    return { ok: false, code: problem };
  }

  let content: Buffer;
  try {
    ({ content } = await input.snapshots.read(snapshotId, file.name));
  } catch (error) {
    log.warn("config", "Cannot read the snapshot %s: %s", snapshotId, String(error));
    return { ok: false, code: "derpMapNoSnapshot" };
  }

  const rollbackId = await snapshotMapFile(input.snapshots, guard.path, DERP_MAP_ROLLBACK_REASON);

  try {
    await atomicWriteFile(guard.path, content);
  } catch (error) {
    log.error("config", "Cannot roll back the DERP map file at %s: %s", guard.path, String(error));
    return { ok: false, code: "derpMapWriteFailed" };
  }

  log.info("config", "Rolled the DERP map file at %s back to %s", guard.path, snapshotId);
  return { ok: true, path: guard.path, snapshotId, rollbackId };
}
