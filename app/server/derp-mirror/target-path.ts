// MARK: Where the mirrored DERP map belongs
//
// The mirror writes a map file that Headscale loads through `derp.paths`, so the
// file has to live where *Headscale* can read it — not where Headplane's own
// container happens to see the disk. The path therefore cannot be a constant:
// the same panel runs beside a native Headscale (fnOS, systemd) and beside a
// Headscale container, and the two deployments keep their data in different
// directories that are mounted differently.
//
// Everything here is derived from Headscale's own configuration, which is the
// only source that knows where the deployment actually put its files: the first
// absolute entry of `derp.paths` names the directory the operator already reads
// maps from, and the file paths Headscale configures (`noise.private_key_path`,
// `database.sqlite.path`, `derp.server.private_key_path`, `unix_socket`) name its
// data directory. No I/O lives here; this module is pure so the service, the
// page loaders and the tests can share one rule.

import { dirname, isAbsolute, join } from "node:path";

/** The map file Headplane maintains inside whatever directory Headscale reads. */
export const DERP_MIRROR_FILE_NAME = "official-mirror.yaml";

/**
 * The subdirectory of Headscale's data directory the map files are kept in. Only
 * used when `derp.paths` lists nothing yet, which is the state of a fresh
 * install: Headscale's own example keeps its maps in `derp-maps/` next to the
 * rest of its data.
 */
export const DERP_MIRROR_MAPS_DIRECTORY = "derp-maps";

/**
 * The path Headplane used before the target was derived from Headscale's
 * configuration: the data directory of the fnOS package this panel grew up on.
 *
 * It survives as the last resort of `resolveDerpMirrorTargetPath`, and a stored
 * value equal to it counts as "never chosen by hand" — that is what lets an
 * install migrate from native Headscale to two containers without keeping a path
 * its panel container cannot see.
 */
export const LEGACY_DERP_MIRROR_TARGET_PATH =
  "/vol1/@appdata/headscale/derp-maps/official-mirror.yaml";

/** The Headscale configuration a target path is derived from. */
export interface DerpMirrorTargetInput {
  /** `derp.paths`, in the order Headscale's configuration lists them. */
  paths?: readonly string[];
  /** Headscale's data directory, as `deriveHeadscaleDataDirectory` returns it. */
  dataDirectory?: string;
}

/**
 * The Headscale keys that name a file inside its data directory. Any of them is
 * enough to locate the directory; the first one that is set wins.
 */
export interface HeadscaleDataPaths {
  /** `noise.private_key_path`; Headscale's own default is inside its data dir. */
  noisePrivateKeyPath?: string;
  /** `database.sqlite.path`. */
  sqlitePath?: string;
  /** `derp.server.private_key_path`. */
  derpPrivateKeyPath?: string;
  /** `unix_socket`, the last resort: its own default directory is not the data. */
  unixSocket?: string;
}

function absoluteOrUndefined(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  return text.length > 0 && isAbsolute(text) ? text : undefined;
}

/**
 * Headscale's data directory, from the files its configuration names. Empty when
 * the configuration names none of them — a relative path is ignored on purpose:
 * it resolves against Headscale's working directory, which says nothing about
 * where it keeps its keys and database.
 */
export function deriveHeadscaleDataDirectory(paths: HeadscaleDataPaths): string {
  const candidates = [
    paths.noisePrivateKeyPath,
    paths.sqlitePath,
    paths.derpPrivateKeyPath,
    paths.unixSocket,
  ];

  for (const candidate of candidates) {
    const absolute = absoluteOrUndefined(candidate);
    if (absolute !== undefined) {
      return dirname(absolute);
    }
  }

  return "";
}

/**
 * Where the mirrored map belongs, from Headscale's own configuration: beside the
 * first map `derp.paths` lists — where an operator who added the mirror by hand
 * put it — or, with an empty list, in `derp-maps/` under Headscale's data
 * directory. `undefined` when the configuration names neither, so the caller
 * keeps its own last-resort fallback.
 */
export function deriveDerpMirrorTargetPath(input: DerpMirrorTargetInput): string | undefined {
  for (const entry of input.paths ?? []) {
    const absolute = absoluteOrUndefined(entry);
    if (absolute !== undefined) {
      return join(dirname(absolute), DERP_MIRROR_FILE_NAME);
    }
  }

  const directory = absoluteOrUndefined(input.dataDirectory);
  return directory === undefined
    ? undefined
    : join(directory, DERP_MIRROR_MAPS_DIRECTORY, DERP_MIRROR_FILE_NAME);
}

/** Whether a stored value is the legacy constant, i.e. never chosen by hand. */
export function isLegacyDerpMirrorTargetPath(value: unknown): boolean {
  return typeof value === "string" && value.trim() === LEGACY_DERP_MIRROR_TARGET_PATH;
}

/**
 * The target path to work with: the operator's own choice when they made one,
 * the derived default when the stored value is missing or is still the legacy
 * constant, and the legacy constant as the very last resort (a configuration
 * that names no directory at all, on the one deployment that used it).
 *
 * The stored value is never rewritten by this function: the store keeps whatever
 * it held, so the derivation keeps following the deployment instead of freezing
 * on the first read.
 */
export function resolveDerpMirrorTargetPath(stored: unknown, input: DerpMirrorTargetInput): string {
  const text = typeof stored === "string" ? stored.trim() : "";
  if (text.length > 0 && isAbsolute(text) && !isLegacyDerpMirrorTargetPath(text)) {
    return text;
  }

  return deriveDerpMirrorTargetPath(input) ?? LEGACY_DERP_MIRROR_TARGET_PATH;
}
