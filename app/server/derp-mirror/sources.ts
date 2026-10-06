// MARK: The official map's sources
//
// Where a mirror run reads the official map from, and how a body an operator
// pasted is turned into the same regions a fetched one yields.
//
// The order is the whole policy, and it is deliberately one function: a run
// reads a pasted map when one is stored, otherwise it walks the configured
// source URLs, otherwise — an empty list — the built-in chain of Headscale's own
// `derp.urls` followed by the official address. Nothing here touches the network
// or the filesystem, so the rules are unit tested directly, and the service, the
// settings loader and the card all read the same answer.
//
// A pasted body is read with exactly the readers the remote fetcher uses
// (`readAnyDerpMapRegions` and `readAnyDerpMapNodes`), so a body that arrives by
// paste and the same body served over HTTPS produce the same regions — and
// therefore, downstream, the same file. The only body this module refuses by
// size is one over the cap the fetcher enforces too, so neither path can smuggle
// in a document the other would reject.

import { readAnyDerpMapRegions } from "~/routes/settings/headscale/derp-map-schema";
import { readAnyDerpMapNodes } from "~/server/headscale/derp-map-nodes";

import type { DerpMirrorSettings } from "./settings";
import { DERP_MIRROR_PASTE_MAX_BYTES } from "./settings";
import type {
  DerpMirrorSourceAttempt,
  DerpMirrorSourceFailure,
  DerpMirrorSourceKind,
  OfficialRegion,
} from "./types";

/** The official map Tailscale serves, used when `derp.urls` lists nothing. */
export const OFFICIAL_DERP_MAP_URL = "https://controlplane.tailscale.com/derpmap/default";

/** One source a run may read the official map from. */
export interface MirrorSource {
  url: string;
  kind: Exclude<DerpMirrorSourceKind, "paste">;
}

/** What one read of the official map found, and every source it tried. */
export interface OfficialMapReport {
  /** The regions the first usable source returned; absent when none was usable. */
  regions?: OfficialRegion[];
  /** The URL that answered; absent for a pasted map, which has no URL. */
  source?: string;
  /** Where the map came from; absent when nothing answered. */
  sourceKind?: DerpMirrorSourceKind;
  /** Every source tried, in order, with the reason each failed. */
  attempts: DerpMirrorSourceAttempt[];
}

/** The marker a pasted map is reported under in a source list. */
export const PASTED_MAP_SOURCE = "paste";

/**
 * The URLs a run reads, in order: the operator's own sources when any are
 * configured, otherwise Headscale's `derp.urls` followed by the built-in
 * official address. Blank entries are dropped and duplicates collapse into their
 * first position, so a repeated URL is never dialled twice in one run.
 *
 * An operator-configured list replaces the built-in chain rather than extending
 * it: the point of naming sources is to control exactly which endpoint is
 * reached, including when the official one cannot be reached at all.
 */
export function resolveMirrorSourceChain(
  settings: Pick<DerpMirrorSettings, "sourceUrls">,
  derpUrls: readonly string[],
): MirrorSource[] {
  const configured = settings.sourceUrls;
  const candidates: MirrorSource[] =
    configured.length > 0
      ? configured.map((url) => ({ url, kind: "custom" as const }))
      : [
          ...derpUrls.map((url) => ({ url, kind: "headscale" as const })),
          // The current behaviour, unchanged: with no configured sources the
          // official map is what an install without `derp.urls` falls back to,
          // and it stays the last resort when those URLs all fail.
          { url: OFFICIAL_DERP_MAP_URL, kind: "official" as const },
        ];

  const seen = new Set<string>();
  const chain: MirrorSource[] = [];
  for (const source of candidates) {
    const url = source.url.trim();
    if (url.length === 0 || seen.has(url)) {
      continue;
    }

    seen.add(url);
    chain.push({ url, kind: source.kind });
  }

  return chain;
}

/**
 * Why a pasted body is not usable, as the code the card localizes; absent when
 * it is.
 */
export type PastedMapProblem = DerpMirrorSourceFailure;

/** What reading one pasted body found. */
export interface PastedMapRead {
  regions?: OfficialRegion[];
  reason?: PastedMapProblem;
}

/**
 * Reads an operator-pasted body with the reader a fetched one goes through. The
 * size cap and the "is it a DERP map at all" rule are the fetcher's own, so a
 * paste and a download accept exactly the same documents; the reason code is the
 * one the card already words.
 */
export function parseDerpMapBody(body: string): PastedMapRead {
  if (Buffer.byteLength(body, "utf8") > DERP_MIRROR_PASTE_MAX_BYTES) {
    return { reason: "too-large" };
  }

  const regions = readAnyDerpMapRegions(body);
  const nodes = readAnyDerpMapNodes(body);
  if (!nodes.ok || regions.length === 0) {
    return { reason: "unreadable" };
  }

  return {
    regions: regions.map((entry) => ({
      regionId: entry.regionId,
      code: entry.code,
      name: entry.name,
      nodes: nodes.nodes.get(entry.regionId) ?? [],
    })),
  };
}

/**
 * The pasted map as a one-source report, so the service treats it exactly like a
 * fetched map: the same regions, the same attempts list shape, and a failure
 * that carries the reader's reason instead of throwing.
 */
export function readPastedMap(pasted: { body: string }): OfficialMapReport {
  const read = parseDerpMapBody(pasted.body);
  if (read.regions === undefined) {
    return {
      sourceKind: "paste",
      attempts: [{ url: PASTED_MAP_SOURCE, reason: read.reason ?? "unreadable" }],
    };
  }

  return {
    regions: read.regions,
    sourceKind: "paste",
    attempts: [{ url: PASTED_MAP_SOURCE }],
  };
}
