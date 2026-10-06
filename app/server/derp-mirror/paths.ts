// MARK: The mirrored file in Headscale's `derp.paths`
//
// A mirrored map is only worth writing when Headscale actually loads it, and
// Headscale loads exactly the files its own `derp.paths` lists. This module owns
// both halves of that: the comparison that decides whether the mirror's target
// is already listed, and the one patch that appends a missing entry.
//
// The rules the patch follows: never remove an entry, never reorder one, never
// append a second copy of the same file, and never touch any other `derp` key.
// The comparison is the shared resolved-path one (`samePath` over
// `resolveTargetPath`), which is what the DERP map editor and the snapshot
// targets already use, so `/a/b`, `/a/b/`, `/a/./b` and a relative entry that
// resolves to the same file all count as the same path.
//
// Nothing here throws: a configuration that may not be written, or a patch that
// fails, comes back as a skip with a stable reason, so the page can keep the
// manual instruction visible instead of failing the save that triggered it.

import { stat } from "node:fs/promises";

import { resolveTargetPath, samePath } from "~/server/snapshots/paths";
import log from "~/utils/log";

import type { MirrorPathOutcome } from "./types";

/**
 * Whether `derp.paths` already lists `targetPath`.
 *
 * Each configured entry is matched verbatim first, then resolved the way
 * Headscale resolves it — a relative entry against Headscale's own config file
 * — and compared with the shared `samePath`, so the trailing-slash and `./`
 * spellings the operator may have used are the same file and never get a second
 * entry. An entry this process cannot resolve is still matched verbatim, which
 * is why a hand-written list keeps working.
 */
export function isMirrorPathListed(
  paths: readonly string[],
  targetPath: string,
  baseDir?: string,
): boolean {
  const target = targetPath.trim();
  if (target.length === 0) {
    return false;
  }

  for (const entry of paths) {
    const configured = entry.trim();
    if (configured.length === 0) {
      continue;
    }

    if (configured === target || samePath(resolveTargetPath(configured, baseDir), target)) {
      return true;
    }
  }

  return false;
}

/** The Headscale configuration surface this module writes through. */
export interface MirrorPathConfigPort {
  getDERPSettings(): { paths: string[] };
  writable(): boolean;
  patch(patches: Array<{ path: string; value: unknown }>): Promise<void>;
}

export interface EnsureMirrorPathInput {
  config: MirrorPathConfigPort;
  /** The mirror's target file, as its settings hold it. */
  targetPath: string;
  /** The directory a relative `derp.paths` entry resolves against. */
  baseDir?: string;
  /** Runs immediately before the patch, so the caller can snapshot the file. */
  beforeWrite?: () => Promise<void>;
}

/** Whether the target file exists, so a reload is only asked for what can load. */
async function targetExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Makes sure Headscale's `derp.paths` lists the mirror's target file, appending
 * it only when it is missing. Never throws: an unwritable configuration and a
 * failed patch both come back as `skipped` with the reason, so the caller can
 * say what to do by hand.
 */
export async function ensureMirrorPathInDerpPaths(
  input: EnsureMirrorPathInput,
): Promise<MirrorPathOutcome> {
  const path = input.targetPath.trim();
  if (path.length === 0) {
    return { status: "skipped", path, reason: "invalid-target" };
  }

  const { paths } = input.config.getDERPSettings();
  if (isMirrorPathListed(paths, path, input.baseDir)) {
    return { status: "present", path };
  }

  if (!input.config.writable()) {
    return { status: "skipped", path, reason: "read-only" };
  }

  // Read before the patch: a file that is not there yet must not be advertised
  // to Headscale without the page saying a run still has to write it.
  const fileExists = await targetExists(path);

  try {
    await input.beforeWrite?.();
    await input.config.patch([{ path: "derp.paths", value: [...paths, path] }]);
  } catch (error) {
    log.warn(
      "config",
      "Unable to add the DERP region mirror to derp.paths: %s",
      error instanceof Error ? error.message : String(error),
    );
    return { status: "skipped", path, reason: "write-failed" };
  }

  return { status: "added", path, fileExists };
}
