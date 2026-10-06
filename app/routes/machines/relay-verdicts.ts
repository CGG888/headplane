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
// Components import the `RelayAddressLine` *type* only, which is erased.

import {
  compareRelayAddresses,
  relayVerdictIsNoteworthy,
  type RelayAddressComparison,
  type RelayAddressFamily,
  type RelayAddressVerdict,
  type RelayDeclaredAddresses,
  type RelayResolution,
  type RelayResolutionReason,
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

/** Why a family has no address to print, including a lookup that never ran. */
export type RelayFamilyReason = RelayResolutionReason | "unavailable";

/** Which of the two sources a printed address came from. */
export type RelayAddressSource = "declared" | "resolved" | "none";

/**
 * One address family as a card prints it: a single line, from a single source.
 *
 * The two cards used to list the declared addresses and the resolved ones side
 * by side, which made an operator compare two blocks to answer one question.
 * Instead the declared address wins whenever `derp.server` sets one, and the
 * lookup answers for the families it does not; `source` is what a card needs to
 * mark the value it is showing.
 *
 * `verdict` and `reason` are mutually exclusive, and each is only set when the
 * card will print it: a verdict under an address that cannot say it itself
 * (never a bare "matches", which repeats the address it sits under), and a
 * reason as the whole line when the family has nothing to show.
 */
export interface RelayAddressLine {
  family: RelayAddressFamily;
  /** The addresses to print, in order; empty when neither source has one. */
  addresses: string[];
  source: RelayAddressSource;
  verdict?: RelayAddressVerdict;
  reason?: RelayFamilyReason;
}

/**
 * Both address families as one line each: `derp.server`'s address when it is
 * set, the hostname's own A/AAAA answer otherwise, and a short reason when
 * neither exists.
 */
export function relayAddressLines(
  declared: RelayDeclaredAddresses | undefined,
  resolution: RelayResolution | undefined,
): RelayAddressLine[] {
  return compareRelayAddresses(declared, resolution).map((comparison) => {
    // A match says nothing the address does not: the line already shows the
    // value both sources agree on. Every other verdict answers a question the
    // line cannot, so it is kept.
    const verdict =
      comparison.verdict !== "matches" && relayVerdictIsNoteworthy(comparison)
        ? comparison.verdict
        : undefined;
    const declaredValue = comparison.declared;
    const addresses = declaredValue === undefined ? [...comparison.resolved] : [declaredValue];
    const source: RelayAddressSource =
      declaredValue !== undefined
        ? "declared"
        : comparison.resolved.length > 0
          ? "resolved"
          : "none";

    if (addresses.length > 0) {
      return {
        family: comparison.family,
        addresses,
        source,
        ...(verdict === undefined ? {} : { verdict }),
      };
    }

    return {
      family: comparison.family,
      addresses: [],
      source,
      ...(verdict === undefined ? { reason: resolution?.reason ?? "unavailable" } : { verdict }),
    };
  });
}
