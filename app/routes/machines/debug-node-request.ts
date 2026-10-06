/**
 * The machine detail page's debug-node dialog: what it submits, which routes it
 * accepts, and where the created node can be found.
 *
 * This module has no imports so the client dialog can use it without pulling
 * server code into the browser bundle, and so the unit tests can cover the
 * submission gate, the route validation and the created-node link in a plain
 * node environment.
 */

/** `action_id` the machines action switches on for a fabricated debug node. */
export const DEBUG_NODE_ACTION = "debug_create_node";

/** The node Headscale reported back, reduced to what the dialog shows. */
export interface DebugNodeSummary {
  id: string;
  name: string;
  /** Where the operator deals with it again. */
  href: string;
}

/**
 * What one debug creation answers with: the node it created, or a stable error
 * code plus the server's own message when it refused.
 */
export type DebugNodeResult =
  | { success: true; node: DebugNodeSummary }
  | { success: false; errorCode?: string; error?: string };

/**
 * Where a fabricated node is dealt with again: the machines list, which is the
 * one place that can delete it.
 *
 * The dialog never links to the node's own page, because the id in the response
 * cannot be trusted: `DebugCreateNode` echoes a synthetic node it never
 * assigned an id to (upstream v0.29.4 builds it by hand from the request), so
 * the created node is found by the name below instead.
 */
export const MACHINES_LIST_HREF = "/machines";

/**
 * Reduces the response's node to what the dialog reports: the name the operator
 * has to look for in the list, and the list itself. `givenName` is the name
 * Headplane displays; `name` is Headscale's own hostname field.
 */
export function debugNodeSummary(node: {
  id?: string;
  givenName?: string;
  name?: string;
}): DebugNodeSummary {
  const name = (node.givenName ?? "").trim() || (node.name ?? "").trim();
  return { href: MACHINES_LIST_HREF, id: (node.id ?? "").trim(), name };
}

/** The optional fields the dialog collects, exactly as the spec declares them. */
export interface DebugNodeFields {
  user?: string;
  key?: string;
  name?: string;
  routes?: string[];
}

/**
 * Builds the request the machines action expects, or nothing at all.
 *
 * `confirmed` is the dialog's own confirmation: it is only true once the
 * operator has submitted the open dialog, which is what makes the destructive
 * confirm the single path a node can be fabricated through. Fields the operator
 * left empty are omitted rather than sent blank, so Headscale sees precisely
 * what was filled in.
 */
export function confirmedDebugNodeRequest(
  confirmed: boolean,
  fields: DebugNodeFields,
): FormData | null {
  if (!confirmed) {
    return null;
  }

  const form = new FormData();
  form.set("action_id", DEBUG_NODE_ACTION);

  for (const name of ["user", "key", "name"] as const) {
    const value = fields[name]?.trim() ?? "";
    if (value.length > 0) {
      form.set(name, value);
    }
  }

  if (fields.routes !== undefined && fields.routes.length > 0) {
    form.set("routes", fields.routes.join(","));
  }

  return form;
}

/** Splits the dialog's route field on commas and whitespace. */
export function parseRouteList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * True for an address with an explicit prefix length, which is what Headscale
 * parses the routes with (`netip.ParsePrefix`): a bare address, a malformed
 * address and a prefix length outside the family's range are all rejected
 * before the request is sent.
 */
export function isCidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length !== 2) {
    return false;
  }

  const [address, prefix] = parts;
  if (!/^\d{1,3}$/.test(prefix)) {
    return false;
  }

  const length = Number(prefix);
  if (address.includes(":")) {
    return length <= 128 && isIpv6(address);
  }

  return length <= 32 && isIpv4(address);
}

function isIpv4(address: string): boolean {
  const octets = address.split(".");
  if (octets.length !== 4) {
    return false;
  }

  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function isIpv6(address: string): boolean {
  // One `::` at most, hex groups only, and an optional IPv4 tail.
  if (address.includes(":::")) {
    return false;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return false;
  }

  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));
  const valid = groups.every((group, index) => {
    if (index === groups.length - 1 && group.includes(".")) {
      return isIpv4(group);
    }

    return /^[0-9a-f]{1,4}$/i.test(group);
  });

  if (!valid) {
    return false;
  }

  // A full address has all eight groups; `::` stands for at least one elided
  // group, which is also how the all-zero address (`::`) is written.
  return halves.length === 1 ? groups.length === 8 : groups.length <= 7;
}
