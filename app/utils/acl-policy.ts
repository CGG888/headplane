import { scanHuJson } from "~/utils/node-info";

// A structured view over the Headscale ACL policy (HuJSON), which Headscale
// stores as an opaque string. What Headplane does not model is kept in `extra`.

// `action` is kept verbatim: rewriting an unknown action into `accept` would
// turn a rule we do not understand into one that allows traffic.
export interface AclRule {
  action: string;
  src: string[];
  dst: string[];
  proto?: string;
  extra: Record<string, unknown>;
}

export interface SshRule {
  action: string;
  src: string[];
  dst: string[];
  users: string[];
  checkPeriod?: string;
  extra: Record<string, unknown>;
}

// The SSH actions the editor offers; anything else is kept and shown as-is.
export const KNOWN_SSH_ACTIONS = ["accept", "check"];

// An app grant names an application served by connector nodes instead of
// opening a port range. Headscale reads `app` as a capability map; the parts
// Headplane does not model stay in `extra` so the entry still round-trips.
export interface GrantApp {
  name: string;
  connectors: string[];
  extra: Record<string, unknown>;
}

// Grants are the modern replacement for `acls`: `ip` selects the ports.
export interface GrantRule {
  src: string[];
  dst: string[];
  ip: string[];
  app?: GrantApp;
  via: string[];
  extra: Record<string, unknown>;
}

// Automatic route approval: `routes` maps a subnet to the users/tags that may
// advertise it without manual approval, `exitNode` lists the same for exit nodes.
export interface AutoApprovers {
  routes: Record<string, string[]>;
  exitNode: string[];
  extra: Record<string, unknown>;
}

export interface NodeAttr {
  target: string[];
  attr: string[];
  extra: Record<string, unknown>;
}

export interface Policy {
  groups: Record<string, string[]>;
  tagOwners: Record<string, string[]>;
  hosts: Record<string, string>;
  acls: AclRule[];
  ssh: SshRule[];
  grants: GrantRule[];
  autoApprovers: AutoApprovers;
  nodeAttrs: NodeAttr[];
  // Only set when the policy actually carried the key: an absent key means
  // "use Headscale's default" and must not turn into an explicit `false`.
  randomizeClientPort?: boolean;
  // Top-level keys Headplane does not model (postures, ipSets, ...)
  extra: Record<string, unknown>;
  // The order the top-level keys appeared in, so serializing keeps it.
  keyOrder: string[];
}

export type ParseResult =
  | { ok: true; policy: Policy; hasComments: boolean }
  | { ok: false; error: string };

export const EMPTY_POLICY: Policy = {
  groups: {},
  tagOwners: {},
  hosts: {},
  acls: [],
  ssh: [],
  grants: [],
  autoApprovers: { routes: {}, exitNode: [], extra: {} },
  nodeAttrs: [],
  extra: {},
  keyOrder: [],
};

export const KNOWN_KEYS = [
  "groups",
  "tagOwners",
  "hosts",
  "acls",
  "ssh",
  "grants",
  "autoApprovers",
  "nodeAttrs",
  "randomizeClientPort",
];

// Policy sections Tailscale accepts but Headscale does not. They are kept in
// `extra` verbatim, and the UI warns about them instead of hiding them.
export const UNSUPPORTED_POLICY_SECTIONS = ["postures", "ipSets"];

// The unsupported sections this policy actually carries, in catalog order.
export function unsupportedPolicySections(policy: Policy): string[] {
  return UNSUPPORTED_POLICY_SECTIONS.filter((key) => key in policy.extra);
}

export function parsePolicy(raw: string): ParseResult {
  if (raw.trim().length === 0) {
    return { ok: true, policy: structuredClone(EMPTY_POLICY), hasComments: false };
  }

  const { stripped, hasComments } = scanHuJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The policy is not valid HuJSON",
    };
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "The policy must be a JSON object" };
  }

  const record = parsed as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    // A `randomizeClientPort` that is not a boolean is not the key this model
    // knows, so it rides along in `extra` instead of being dropped.
    if (
      !KNOWN_KEYS.includes(key) ||
      (key === "randomizeClientPort" && typeof value !== "boolean")
    ) {
      extra[key] = value;
    }
  }

  const policy: Policy = {
    groups: toStringListMap(record.groups),
    tagOwners: toStringListMap(record.tagOwners),
    hosts: toStringMap(record.hosts),
    acls: toAclRules(record.acls),
    ssh: toSshRules(record.ssh),
    grants: toGrantRules(record.grants),
    autoApprovers: toAutoApprovers(record.autoApprovers),
    nodeAttrs: toNodeAttrs(record.nodeAttrs),
    extra,
    keyOrder: Object.keys(record),
  };

  // Only a real boolean becomes the key; anything else stayed in `extra`.
  if (typeof record.randomizeClientPort === "boolean") {
    policy.randomizeClientPort = record.randomizeClientPort;
  }

  return { ok: true, hasComments, policy };
}

export function serializePolicy(policy: Policy): string {
  const sections: Record<string, unknown> = {};

  // Insertion order is preserved so an edit does not reshuffle the rest.
  if (Object.keys(policy.groups).length > 0) sections.groups = policy.groups;
  if (Object.keys(policy.tagOwners).length > 0) sections.tagOwners = policy.tagOwners;
  if (Object.keys(policy.hosts).length > 0) sections.hosts = policy.hosts;
  if (policy.acls.length > 0) sections.acls = policy.acls.map(compactAclRule);
  if (policy.ssh.length > 0) sections.ssh = policy.ssh.map(compactSshRule);
  if (policy.grants.length > 0) sections.grants = policy.grants.map(compactGrantRule);
  if (hasAutoApprovers(policy.autoApprovers)) {
    sections.autoApprovers = compactAutoApprovers(policy.autoApprovers);
  }
  if (policy.nodeAttrs.length > 0) sections.nodeAttrs = policy.nodeAttrs.map(compactNodeAttr);
  // A policy that never had the key must not gain one.
  if (policy.randomizeClientPort !== undefined) {
    sections.randomizeClientPort = policy.randomizeClientPort;
  }
  for (const [key, value] of Object.entries(policy.extra)) {
    sections[key] = value;
  }

  const out: Record<string, unknown> = {};
  for (const key of policy.keyOrder) {
    if (key in sections) {
      out[key] = sections[key];
    }
  }
  // Sections that did not exist before are appended.
  for (const [key, value] of Object.entries(sections)) {
    if (!(key in out)) {
      out[key] = value;
    }
  }

  return `${format(out, 0)}\n`;
}

// MARK: Catalog helpers

export function policySources(policy: Policy, users: string[]): string[] {
  return unique([
    "*",
    "autogroup:member",
    "autogroup:admin",
    ...Object.keys(policy.groups),
    ...Object.keys(policy.tagOwners),
    ...Object.keys(policy.hosts),
    ...users.map(asUserReference),
  ]);
}

// Destinations without their port spec; the rule editor appends it.
export function policyDestinations(policy: Policy, users: string[]): string[] {
  return unique([
    "*",
    "autogroup:internet",
    "autogroup:self",
    ...Object.keys(policy.groups),
    ...Object.keys(policy.tagOwners),
    ...Object.keys(policy.hosts),
    ...users.map(asUserReference),
  ]);
}

// Headscale references users as "name@" in policies.
export function asUserReference(user: string): string {
  return user.endsWith("@") ? user : `${user}@`;
}

// `*`, a single port, a range, or a comma separated list of either.
const PORT_SPEC = /^(\*|\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*)$/;

// Headscale splits a destination on its *last* colon, so `fd7a::1:22` is
// `fd7a::1` on port 22. The tail only counts as a port when what precedes it is
// a destination in its own right, which keeps `fd7a::1` (head `fd7a:`) intact.
export function hasPortSpec(destination: string): boolean {
  const lastColon = destination.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === destination.length - 1) {
    return false;
  }

  if (!PORT_SPEC.test(destination.slice(lastColon + 1))) {
    return false;
  }

  return isCompleteDestination(destination.slice(0, lastColon));
}

const ALIAS_PREFIXES = ["tag:", "group:", "autogroup:"];

// Only a prefixed alias or an IPv6 address carries an inner colon.
function isCompleteDestination(value: string): boolean {
  if (value.length === 0 || value.endsWith(":")) {
    return false;
  }

  if (ALIAS_PREFIXES.some((prefix) => value.startsWith(prefix)) || !value.includes(":")) {
    return true;
  }

  // Headscale does not accept the bracketed form, but a hand-written policy
  // may use it and appending a port would only make it worse.
  if (value.startsWith("[") && value.endsWith("]")) {
    return isIpv6(value.slice(1, -1));
  }

  return isIpv6(value);
}

const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Enough to tell an address or prefix apart from an alias, not a validator.
function isIpv6(value: string): boolean {
  const [address, prefixLength, ...rest] = value.split("/");
  if (rest.length > 0 || (prefixLength !== undefined && !/^\d{1,3}$/.test(prefixLength))) {
    return false;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return false;
  }

  const groups = halves.flatMap((half) => (half.length === 0 ? [] : half.split(":")));
  if (groups.length === 0) {
    // The unspecified address, `::`.
    return halves.length === 2;
  }

  const last = groups[groups.length - 1];
  const head = IPV4.test(last) ? groups.slice(0, -1) : groups;
  if (!head.every((group) => IPV6_GROUP.test(group))) {
    return false;
  }

  // An embedded IPv4 tail fills the last two groups.
  const width = IPV4.test(last) ? head.length + 2 : groups.length;
  return halves.length === 2 ? width <= 7 : width === 8;
}

// Headscale rejects a destination without a port, so one gets `:*`.
export function withDefaultPort(destination: string): string {
  const trimmed = destination.trim();
  if (trimmed.length === 0 || hasPortSpec(trimmed)) {
    return trimmed;
  }

  return `${trimmed}:*`;
}

export function groupsForUser(policy: Policy, userName: string): string[] {
  const reference = asUserReference(userName);
  return Object.entries(policy.groups)
    .filter(([, members]) => members.includes(reference) || members.includes(userName))
    .map(([group]) => group)
    .sort();
}

export function setUserGroups(policy: Policy, userName: string, groups: string[]): Policy {
  const reference = asUserReference(userName);
  const next: Record<string, string[]> = {};

  for (const [group, members] of Object.entries(policy.groups)) {
    const isMember = members.includes(reference) || members.includes(userName);
    const shouldBeMember = groups.includes(group);

    if (isMember === shouldBeMember) {
      // Leave the member list untouched so the policy diff stays minimal.
      next[group] = members;
      continue;
    }

    next[group] = shouldBeMember
      ? [...members, reference]
      : members.filter((member) => member !== reference && member !== userName);
  }

  // Groups that don't exist yet are created with this user as the only member.
  for (const group of groups) {
    if (!(group in next)) {
      next[group] = [reference];
    }
  }

  return { ...policy, groups: next };
}

// MARK: Validation

export function isValidGroupName(name: string): boolean {
  return /^group:[a-z0-9][a-z0-9-]*$/.test(name);
}

export function isValidTagName(name: string): boolean {
  return /^tag:[a-z0-9][a-z0-9-]*$/.test(name);
}

export function isValidHostName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

// MARK: Internals

function toStringListMap(value: unknown): Record<string, string[]> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toStringList(entry);
  }
  return out;
}

function toStringMap(value: unknown): Record<string, string> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}

function toStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

const ACL_RULE_KEYS = ["action", "src", "dst", "proto"];
const SSH_RULE_KEYS = ["action", "src", "dst", "users", "checkPeriod"];

function toAclRules(value: unknown): AclRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
    .map((entry) => {
      const rule: AclRule = {
        action: typeof entry.action === "string" ? entry.action : "accept",
        src: toStringList(entry.src),
        dst: toStringList(entry.dst),
        extra: extraKeys(entry, ACL_RULE_KEYS),
      };
      if (typeof entry.proto === "string" && entry.proto.length > 0) {
        rule.proto = entry.proto;
      }
      return rule;
    });
}

function toSshRules(value: unknown): SshRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
    .map((entry) => {
      const rule: SshRule = {
        action: typeof entry.action === "string" ? entry.action : "accept",
        src: toStringList(entry.src),
        dst: toStringList(entry.dst),
        users: toStringList(entry.users),
        extra: extraKeys(entry, SSH_RULE_KEYS),
      };
      if (typeof entry.checkPeriod === "string" && entry.checkPeriod.length > 0) {
        rule.checkPeriod = entry.checkPeriod;
      }
      return rule;
    });
}

// Fields with no editor — `srcPosture`, `acceptEnv` — ride along untouched.
function extraKeys(entry: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!known.includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

const GRANT_KEYS = ["src", "dst", "ip", "app", "via"];
const GRANT_APP_KEYS = ["name", "connectors"];
const AUTO_APPROVER_KEYS = ["routes", "exitNode"];
const NODE_ATTR_KEYS = ["target", "attr"];

function toGrantRules(value: unknown): GrantRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
    .map((entry) => {
      const rule: GrantRule = {
        src: toStringList(entry.src),
        dst: toStringList(entry.dst),
        ip: toStringList(entry.ip),
        via: toStringList(entry.via),
        extra: extraKeys(entry, GRANT_KEYS),
      };

      const app = toGrantApp(entry.app);
      if (app !== undefined) {
        rule.app = app;
      }

      return rule;
    });
}

// `app` is only a grant's application descriptor when it is an object; a
// capability map (what Headscale itself reads) has no name and its entries
// stay in `extra`, so the value survives a round trip unchanged.
function toGrantApp(value: unknown): GrantApp | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    connectors: toStringList(record.connectors),
    extra: extraKeys(record, GRANT_APP_KEYS),
  };
}

function toAutoApprovers(value: unknown): AutoApprovers {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { routes: {}, exitNode: [], extra: {} };
  }

  const record = value as Record<string, unknown>;
  return {
    routes: toStringListMap(record.routes),
    exitNode: toStringList(record.exitNode),
    extra: extraKeys(record, AUTO_APPROVER_KEYS),
  };
}

function toNodeAttrs(value: unknown): NodeAttr[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => entry != null && typeof entry === "object")
    .map((entry) => ({
      target: toStringList(entry.target),
      attr: toStringList(entry.attr),
      extra: extraKeys(entry, NODE_ATTR_KEYS),
    }));
}

function compactAclRule(rule: AclRule): Record<string, unknown> {
  const out: Record<string, unknown> = { action: rule.action, src: rule.src, dst: rule.dst };
  if (rule.proto) out.proto = rule.proto;
  return { ...out, ...rule.extra };
}

export function hasAutoApprovers(autoApprovers: AutoApprovers): boolean {
  return (
    Object.keys(autoApprovers.routes).length > 0 ||
    autoApprovers.exitNode.length > 0 ||
    Object.keys(autoApprovers.extra).length > 0
  );
}

function compactGrantRule(rule: GrantRule): Record<string, unknown> {
  const out: Record<string, unknown> = { src: rule.src, dst: rule.dst };
  if (rule.ip.length > 0) out.ip = rule.ip;
  if (rule.app !== undefined) out.app = compactGrantApp(rule.app);
  if (rule.via.length > 0) out.via = rule.via;
  return { ...out, ...rule.extra };
}

function compactGrantApp(app: GrantApp): Record<string, unknown> {
  // `app` is a capability map in Headscale, so an entry the editor never wrote
  // (a real capability key with its values) has no `name`/`connectors` at all.
  // Writing them unconditionally would inject `name` and `connectors` as bogus
  // capabilities into a policy that was otherwise untouched.
  const out: Record<string, unknown> = {};
  if (app.name.length > 0) out.name = app.name;
  if (app.connectors.length > 0) out.connectors = app.connectors;
  return { ...out, ...app.extra };
}

function compactAutoApprovers(autoApprovers: AutoApprovers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Object.keys(autoApprovers.routes).length > 0) out.routes = autoApprovers.routes;
  if (autoApprovers.exitNode.length > 0) out.exitNode = autoApprovers.exitNode;
  return { ...out, ...autoApprovers.extra };
}

function compactNodeAttr(attr: NodeAttr): Record<string, unknown> {
  return { target: attr.target, attr: attr.attr, ...attr.extra };
}

function compactSshRule(rule: SshRule): Record<string, unknown> {
  const out: Record<string, unknown> = {
    action: rule.action,
    src: rule.src,
    dst: rule.dst,
    users: rule.users,
  };
  if (rule.checkPeriod) out.checkPeriod = rule.checkPeriod;
  return { ...out, ...rule.extra };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

// Rules wider than this are broken across multiple lines.
const INLINE_WIDTH = 120;

// Keeps arrays of primitives, and short rule objects, on one line, the way
// Tailscale and Headscale policy examples are written.
function format(value: unknown, depth: number, allowInline = false): string {
  const indent = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every(isPrimitive)) {
      return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    }
    // Rules live inside arrays, and those are the objects worth inlining.
    const entries = value.map((entry) => `${inner}${format(entry, depth + 1, true)}`);
    return `[\n${entries.join(",\n")}\n${indent}]`;
  }

  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return "{}";
    }

    const inline = allowInline ? inlineObject(entries) : undefined;
    if (inline !== undefined && indent.length + inline.length <= INLINE_WIDTH) {
      return inline;
    }

    const body = entries.map(
      ([key, entry]) => `${inner}${JSON.stringify(key)}: ${format(entry, depth + 1)}`,
    );
    return `{\n${body.join(",\n")}\n${indent}}`;
  }

  return JSON.stringify(value);
}

// Returns undefined when the object has to be expanded.
function inlineObject(entries: [string, unknown][]): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of entries) {
    if (isPrimitive(value)) {
      parts.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
      continue;
    }
    if (Array.isArray(value) && value.every(isPrimitive)) {
      parts.push(
        `${JSON.stringify(key)}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`,
      );
      continue;
    }
    return undefined;
  }

  return `{ ${parts.join(", ")} }`;
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}
