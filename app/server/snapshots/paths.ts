import { isAbsolute, relative, resolve } from "node:path";

/**
 * Pure path and naming helpers for snapshots. Kept free of filesystem access so
 * the naming rules and the traversal guards can be unit tested directly.
 */

export const SNAPSHOTS_DIR = "snapshots";

/** `<data_path>/snapshots` — where every snapshot directory lives. */
export function snapshotsRoot(dataPath: string): string {
  return resolve(dataPath, SNAPSHOTS_DIR);
}

/** Compact UTC stamp used in snapshot directory names: `20261005T013000Z`. */
export function timestampSlug(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** Reason slug used in snapshot directory names, e.g. `oidc-restrictions`. */
export function reasonSlug(reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");

  return slug.length > 0 ? slug : "snapshot";
}

/** `<timestamp>-<reason>` directory name for a snapshot. */
export function snapshotId(at: Date, reason: string): string {
  return `${timestampSlug(at)}-${reasonSlug(reason)}`;
}

/** Rejects anything that could escape the snapshots root. */
export function isSafeSnapshotId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

/** Snapshot files are plain names: no separators, no parent traversal. */
export function isSafeFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 160 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/** Whether `child` resolves to a path strictly below `parent`. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Resolves a configured path, treating relative entries as relative to `baseDir`. */
export function resolveTargetPath(path: string, baseDir?: string): string {
  if (isAbsolute(path) || !baseDir) {
    return resolve(path);
  }

  return resolve(baseDir, path);
}

/** Path equality that tolerates the case-insensitive filesystems Windows uses. */
export function samePath(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  if (left === right) {
    return true;
  }

  return process.platform === "win32" && left.toLowerCase() === right.toLowerCase();
}

/** Collision-free file name for a snapshot directory. */
export function uniqueFileName(name: string, used: ReadonlySet<string>): string {
  const safe = isSafeFileName(name) ? name : "file";
  if (!used.has(safe)) {
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";

  let counter = 2;
  let candidate = `${stem}-${counter}${extension}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${extension}`;
  }

  return candidate;
}
