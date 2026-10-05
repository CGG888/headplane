// MARK: Headscale configuration file probes
//
// The I/O half of the configuration checks: it reads Headscale's `config.yaml`
// and probes the paths inside it, then hands the parsed document and the probe
// results to the pure engine in `config-checks.ts`. When the embedded DERP
// server declares an address it also asks the shared relay resolver what the
// relay hostname resolves to, which is the one lookup those checks need.
//
// `headscaleConfig` keeps its parsed document private and exposes no raw
// accessor, so this reads the same file Headplane was configured with. Every
// failure is best effort: a missing, unreadable, or unparseable file, and any
// path that cannot be probed, degrade to "nothing to report" rather than
// breaking the status page.

import { access, constants, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { parseDocument } from "yaml";

import { loadSharedRelayResolution } from "~/server/relay-dns";

import {
  computeConfigChecks,
  configProbeTargets,
  configRelayLookupTarget,
  type ConfigCheck,
  type ConfigProbe,
} from "./config-checks";

/**
 * Computes the configuration checks for the Headscale config file at `path`.
 * Returns an empty list when there is nothing readable to check.
 */
export async function loadConfigChecks(path: string | undefined): Promise<ConfigCheck[]> {
  const config = await readHeadscaleConfig(path);
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

  // The relay checks compare what `derp.server` declares with what the relay
  // hostname resolves to. The lookup only runs when there is something to
  // compare, it shares the resolver both DERP cards use, and it is fail-soft:
  // no DNS answer leaves the checks saying they could not check, never failing.
  const relayHost = configRelayLookupTarget(config);
  const relayResolution =
    relayHost === undefined ? undefined : await loadSharedRelayResolution(relayHost);

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
    relayResolution,
  });
}

/**
 * Reads and parses the file, or `undefined` when that is not possible. Shared
 * with the metrics probe, which reads the same `metrics_listen_addr` key out of
 * the same document.
 */
export async function readHeadscaleConfig(path: string | undefined): Promise<unknown> {
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

/**
 * Whether the directory tree holding `path` is visible to this process at all.
 *
 * Walking up matters: a config pointing at `…/data/db.sqlite` where `data/` has
 * simply not been created yet is a genuine "not there yet" (Headscale creates
 * it), and the nearest existing ancestor proves the tree is reachable. A path
 * whose whole tree is missing all the way to the filesystem root is a host
 * directory the container was never given — the common case for a Headplane
 * container that only mounts `config.yaml`.
 */
async function parentVisible(path: string): Promise<boolean> {
  let current = dirname(path);

  for (let depth = 0; depth < 64; depth++) {
    const parent = dirname(current);
    if (parent === current) {
      // Only the filesystem root exists: nothing of this tree is visible.
      return false;
    }

    try {
      await stat(current);
      return true;
    } catch {
      current = parent;
    }
  }

  return false;
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
