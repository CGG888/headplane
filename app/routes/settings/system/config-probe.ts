// MARK: Headscale configuration file probes
//
// The I/O half of the configuration checks: it reads Headscale's `config.yaml`
// and probes the paths inside it, then hands the parsed document and the probe
// results to the pure engine in `config-checks.ts`.
//
// `headscaleConfig` keeps its parsed document private and exposes no raw
// accessor, so this reads the same file Headplane was configured with. Every
// failure is best effort: a missing, unreadable, or unparseable file, and any
// path that cannot be probed, degrade to "nothing to report" rather than
// breaking the status page.

import { access, constants, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { parseDocument } from "yaml";

import {
  computeConfigChecks,
  configProbeTargets,
  type ConfigCheck,
  type ConfigProbe,
} from "./config-checks";

/**
 * Computes the configuration checks for the Headscale config file at `path`.
 * Returns an empty list when there is nothing readable to check.
 */
export async function loadConfigChecks(path: string | undefined): Promise<ConfigCheck[]> {
  const config = await readConfig(path);
  if (config === undefined) {
    return [];
  }

  const targets = configProbeTargets(config);
  const [tlsCert, tlsKey, policyFile, databaseFile, noiseKey] = await Promise.all([
    probeOptional(targets.tlsCert),
    probeOptional(targets.tlsKey),
    probeOptional(targets.policyFile),
    probeOptional(targets.databaseFile),
    probeOptional(targets.noiseKey),
  ]);

  return computeConfigChecks({
    config,
    probes: {
      tlsCert,
      tlsKey,
      policyFile,
      databaseFile,
      // The database directory is only interesting for SQLite, and its path is
      // derived from the file Headscale would create.
      databaseDir: databaseFile
        ? await probePath(dirname(databaseFile.path), { writable: true })
        : undefined,
      noiseKey,
    },
  });
}

/** Reads and parses the file, or `undefined` when that is not possible. */
async function readConfig(path: string | undefined): Promise<unknown> {
  if (!path) {
    return undefined;
  }

  try {
    const document = parseDocument(await readFile(path, "utf8"));
    if (document.errors.length > 0) {
      return undefined;
    }

    return document.toJSON() ?? undefined;
  } catch {
    return undefined;
  }
}

async function probeOptional(path: string | undefined): Promise<ConfigProbe | undefined> {
  return path ? probePath(path) : undefined;
}

/**
 * Inspects one path without ever throwing. `stat` separates a missing path
 * from one that exists but is a directory instead of a regular file, and the
 * `access` calls report readability and, for directories, writability.
 */
async function probePath(path: string, options: { writable?: boolean } = {}): Promise<ConfigProbe> {
  try {
    const info = await stat(path);
    const probe: ConfigProbe = {
      path,
      exists: true,
      readable: await canAccess(path, constants.R_OK),
      isFile: info.isFile(),
    };

    if (info.isFile()) {
      probe.size = info.size;
    }

    if (options.writable) {
      probe.writable = await canAccess(path, constants.W_OK);
    }

    return probe;
  } catch {
    // A failing `stat` cannot be told apart from a path this process simply
    // cannot see: a container running Headplane is usually given the config file
    // but not the host directories the file points at. When the directory that
    // would hold the path is invisible too, say "unverifiable" rather than
    // claiming a healthy server is missing its database.
    return {
      path,
      exists: false,
      readable: false,
      ...(options.writable ? { writable: false } : {}),
      ...((await parentVisible(path)) ? {} : { unavailable: true }),
    };
  }
}

/** Whether the directory that would contain `path` can be inspected at all. */
async function parentVisible(path: string): Promise<boolean> {
  try {
    await stat(dirname(path));
    return true;
  } catch {
    return false;
  }
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
