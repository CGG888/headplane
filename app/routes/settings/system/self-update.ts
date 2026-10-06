// MARK: Headplane self-update notice
//
// The counterpart of the Headscale release check: Headplane can tell the
// operator that a newer Headplane exists, without ever depending on reaching
// the internet. The running version is the one the build baked in as
// `__VERSION__`; a custom build that reports its own version is compared
// against that value, so it is never nagged about an upstream release.

import {
  formatServerVersion,
  parseServerVersion,
  type ServerVersion,
} from "~/server/headscale/api/server-version";

import { isNewerVersion } from "./diagnostics";

/** Where an operator goes to read the release notes of the newer build. */
export const HEADPLANE_RELEASES_PAGE = "https://github.com/CGG888/headplaneCN/releases/latest";

export interface SelfUpdateNotice {
  /** The version this build reports, from the `__VERSION__` build global. */
  current: string;
  latest: string;
  url: string;
}

/**
 * Builds the notice for a running version and a looked-up release. Returns
 * `undefined` — which renders nothing at all — when the lookup failed, when
 * the running version is untagged (`dev`, a pseudo-version), or when this
 * build is already at or ahead of the newest release.
 */
export function selfUpdateNotice(
  running: string,
  latest: ServerVersion | undefined,
): SelfUpdateNotice | undefined {
  if (!latest) {
    return undefined;
  }

  const current = parseServerVersion(running);
  if (!isNewerVersion(current, latest)) {
    return undefined;
  }

  return {
    current: formatServerVersion(current),
    latest: formatServerVersion(latest),
    url: HEADPLANE_RELEASES_PAGE,
  };
}
