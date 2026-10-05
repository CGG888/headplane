// MARK: Relay cards, prepared for the browser
//
// The relay rules live in `~/server/relay-dns`, but that module imports
// `node:dns/promises` and `~/utils/log` (pino) at module scope. Route modules
// are shared by both environments, and a client import that evaluates those
// throws (`ReferenceError: process is not defined`), which React Router answers
// with `window.location.reload()` - a hover or click on the machines list then
// reloaded the whole page.
//
// The relay cards therefore take plain, serializable values that their loaders
// prepare here. This module is **loader-only**: importing its functions from a
// component would drag the server relay module back into the client bundle.
// Components import the `RelayFamilyVerdict` *type* only, which is erased.

import {
  relayResolutionSuggestsConfiguredResolver,
  relayVerdictIsNoteworthy,
  type RelayAddressComparison,
  type RelayAddressFamily,
  type RelayAddressVerdict,
  type RelayResolution,
} from "~/server/relay-dns";

/** One family's declared-versus-resolved verdict, as a card prints it. */
export interface RelayFamilyVerdict {
  family: RelayAddressFamily;
  /**
   * The verdict, or `undefined` when printing it would only repeat the address
   * row it sits under (see `relayVerdictIsNoteworthy`).
   */
  verdict?: RelayAddressVerdict;
  /** The declared address the verdict was reached from, trimmed. */
  declared?: string;
}

/**
 * The display form of both families, in the order the cards list them: IPv4
 * then IPv6, with the verdicts that would say nothing dropped.
 */
export function relayFamilyVerdicts(
  comparisons: readonly RelayAddressComparison[],
): RelayFamilyVerdict[] {
  return comparisons.map((comparison) => ({
    family: comparison.family,
    ...(relayVerdictIsNoteworthy(comparison) ? { verdict: comparison.verdict } : {}),
    ...(comparison.declared === undefined ? {} : { declared: comparison.declared }),
  }));
}

/**
 * Whether an empty family is only the host's own resolver speaking, so the
 * cards can point at the configured resolver list. Either family is enough:
 * the hint is about the lookup, not about one address family.
 */
export function relayResolutionBlamesSystemResolver(
  resolution: RelayResolution | undefined,
): boolean {
  return (
    relayResolutionSuggestsConfiguredResolver(resolution, "ipv4") ||
    relayResolutionSuggestsConfiguredResolver(resolution, "ipv6")
  );
}
