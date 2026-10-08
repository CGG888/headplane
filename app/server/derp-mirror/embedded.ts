// MARK: The deployment's own relay
//
// Headscale's embedded DERP server is a region of *this* deployment, not one of
// Tailscale's: Headscale adds it to the map it serves, under
// `derp.server.region_id` (999 by default) and the address `server_url` names.
// A mirror source can still describe it — the deployment's own local map served
// back over HTTP, a hand-written copy of that map, or a pasted body — and
// mirroring it writes a second copy of the same relay into the 900s. Both copies
// then compete for the same clients, and the copy the mirror writes is the one
// that usually loses the port, so clients pick it and fail to connect through
// it. The mirror therefore never writes the relay the deployment already serves
// itself, whatever the selection says.
//
// The settings loader and the browser-side region table use the same rule, so
// this module stays pure: it imports the shared host/port reader and types only.

import { splitHostPort } from "~/utils/derp-host-port";

import type { OfficialRegion } from "./types";

/**
 * What identifies the embedded relay inside a fetched map. Every field is what
 * the deployment's configuration says about it; a caller that only knows some of
 * them passes those, and the rule matches on what it has.
 */
export interface EmbeddedRelayIdentity {
  /** `derp.server.region_id`. */
  regionId?: number;
  /** `derp.server.region_code`. */
  regionCode?: string;
  /** The host `server_url` names, without its port. */
  hostname?: string;
}

/** The identity of the embedded relay, from the DERP settings the panel reads. */
export function embeddedRelayIdentity(settings: {
  serverUrl?: string | undefined;
  server?: { regionId?: number; regionCode?: string } | undefined;
}): EmbeddedRelayIdentity | undefined {
  const regionCode = settings.server?.regionCode?.trim();
  const hostname = hostnameFromServerUrl(settings.serverUrl);
  const regionId = settings.server?.regionId;

  if (regionId === undefined && hostname === undefined && (regionCode?.length ?? 0) === 0) {
    return undefined;
  }

  return {
    ...(regionId === undefined ? {} : { regionId }),
    ...(regionCode === undefined || regionCode.length === 0 ? {} : { regionCode }),
    ...(hostname === undefined ? {} : { hostname }),
  };
}

/**
 * Whether a region a source describes is the relay this deployment serves
 * itself. The id is Headscale's own, the code is what the operator set, and the
 * hostname is the address clients reach: any one of them matching is enough,
 * because a copy of that relay is a copy however it was labelled.
 */
export function isEmbeddedRelayRegion(
  region: OfficialRegion,
  identity: EmbeddedRelayIdentity | undefined,
): boolean {
  if (identity === undefined) {
    return false;
  }

  if (identity.regionId !== undefined && region.regionId === identity.regionId) {
    return true;
  }

  if (
    identity.regionCode !== undefined &&
    region.code.trim().toLowerCase() === identity.regionCode.toLowerCase()
  ) {
    return true;
  }

  if (identity.hostname === undefined) {
    return false;
  }

  const wanted = identity.hostname.toLowerCase();
  return region.nodes.some((node) => {
    // A node that carries its port in the hostname is compared by its host.
    const host = splitHostPort(node.hostname)?.host ?? node.hostname.trim();
    return host.toLowerCase() === wanted;
  });
}

/**
 * The host `server_url` names, without a port, with IPv6 literals kept
 * bracketed.
 *
 * `app/server/derp-sync/addresses.ts` has the same rule for the address sync, but
 * it reaches `node:fs`/`node:os` through `host-addresses`, so the settings route
 * — which is also built for the browser — cannot import it.
 */
function hostnameFromServerUrl(serverUrl: string | undefined): string | undefined {
  const trimmed = (serverUrl ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.hostname.length > 0 ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}
