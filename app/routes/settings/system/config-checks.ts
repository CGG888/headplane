// MARK: Headscale configuration file checks
//
// The web version of `headscale configtest`: the rules that decide whether
// Headscale starts and behaves, computed from Headscale's parsed `config.yaml`
// plus a small set of filesystem probes. Exactly like `computeDiagnostics`,
// this module is pure and performs no I/O: the route loader reads the file and
// probes the paths, then hands both in as plain values. That keeps every rule
// unit testable without touching the disk, and the module only produces
// translation *keys* that the page resolves in the caller's locale.

import type { TranslationKey } from "~/i18n";
import { deriveDerpPublicEndpoint } from "~/routes/settings/headscale/derp-settings";
import {
  compareRelayAddress,
  type RelayAddressFamily,
  type RelayResolution,
} from "~/server/relay-dns";

import type { DiagnosticLink, DiagnosticStatus } from "./diagnostics";

export type ConfigCheckId =
  | "configOidcKeys"
  | "configTrustedProxies"
  | "configTls"
  | "configDatabase"
  | "configPolicy"
  | "configDnsRecords"
  | "configOidc"
  | "configNoiseKey"
  | "configDerpIpv4Resolvable"
  | "configDerpIpv6Resolvable";

/** The same row shape as `Diagnostic`, rendered by the same list component. */
export interface ConfigCheck {
  id: ConfigCheckId;
  status: DiagnosticStatus;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** Values for `{placeholders}` in the localized body. */
  vars?: Record<string, string | number>;
  link?: DiagnosticLink;
}

/**
 * The OIDC keys Headscale 0.29 dropped from its configuration schema. A
 * configuration that still contains any of them makes Headscale refuse to
 * start; `oidc.expiry` was replaced by the top-level `node.expiry`.
 */
const FATAL_OIDC_KEYS = ["expiry", "strip_email_domain", "map_legacy_users"] as const;

/** The PKCE methods Headscale accepts; anything else fails validation. */
const PKCE_METHODS = ["plain", "S256"];

/**
 * Headscale's own default when `database.sqlite.path` is not set. Resolving it
 * here keeps every probed path in one place so the explanations can name them.
 */
export const DEFAULT_SQLITE_PATH = "/var/lib/headscale/db.sqlite";

/**
 * Headscale's own configuration file holds the policy mode, the OIDC block,
 * the trusted proxies, and the DNS records, so every fixable config check
 * points at the page that edits them.
 */
const SETTINGS_LINK: DiagnosticLink = {
  to: "/settings/headscale",
  labelKey: "settings.system.reviewSettings",
};

const DNS_LINK: DiagnosticLink = {
  to: "/dns",
  labelKey: "settings.system.configChecks.dns.review",
};

const TITLES: Record<ConfigCheckId, TranslationKey> = {
  configOidcKeys: "settings.system.configChecks.oidcKeys.title",
  configTrustedProxies: "settings.system.configChecks.trustedProxies.title",
  configTls: "settings.system.configChecks.tls.title",
  configDatabase: "settings.system.configChecks.database.title",
  configPolicy: "settings.system.configChecks.policy.title",
  configDnsRecords: "settings.system.configChecks.dns.title",
  configOidc: "settings.system.configChecks.oidc.title",
  configNoiseKey: "settings.system.configChecks.noise.title",
  configDerpIpv4Resolvable: "settings.system.configChecks.derpIpv4.title",
  configDerpIpv6Resolvable: "settings.system.configChecks.derpIpv6.title",
};

/**
 * The result of touching one path on disk. Every field the checks read is a
 * plain value, so the engine never depends on `node:fs`.
 */
export interface ConfigProbe {
  /** The path that was probed, echoed in the explanation. */
  path: string;
  exists: boolean;
  readable: boolean;
  /** Whether the path can be written to; only probed for directories. */
  writable?: boolean;
  /** Whether an existing path is a regular file; directories are `false`. */
  isFile?: boolean;
  /** Size in bytes of a regular file, used to spot an empty policy. */
  size?: number;
  /**
   * The path (or its parent) is not visible to this process at all, which is
   * what a container without that host directory mounted looks like. A missing
   * path cannot be told apart from an unmounted one, so these are reported as
   * unverifiable instead of as a failure.
   */
  unavailable?: boolean;
}

export interface ConfigProbeResults {
  tlsCert?: ConfigProbe;
  tlsKey?: ConfigProbe;
  policyFile?: ConfigProbe;
  databaseDir?: ConfigProbe;
  databaseFile?: ConfigProbe;
  noiseKey?: ConfigProbe;
}

export interface ConfigChecksInput {
  /** Headscale's parsed `config.yaml`, or whatever the loader managed to read. */
  config: unknown;
  probes: ConfigProbeResults;
  /**
   * The relay hostname's DNS answer, when the embedded server declares an
   * address and the loader looked it up. `undefined` means no lookup ran, which
   * the relay checks report as "cannot check" instead of as a mismatch.
   */
  relayResolution?: RelayResolution;
}

/**
 * Which probes back which check, so a verdict that is only "bad" because nobody
 * could look at the path can be downgraded in one place instead of in every
 * rule.
 */
const PROBES_FOR_CHECK: Partial<
  Record<ConfigCheck["id"], (probes: ConfigProbeResults) => (ConfigProbe | undefined)[]>
> = {
  configTls: (probes) => [probes.tlsCert, probes.tlsKey],
  // Only the directory decides: a missing database file inside a directory this
  // process *can* see is a real "not created yet", and its own probe is
  // "unavailable" whenever the directory is missing.
  configDatabase: (probes) => [probes.databaseDir],
  configPolicy: (probes) => [probes.policyFile],
  // The noise key verdict also reads the database file ("first start creates
  // it"), so an invisible database file makes that conclusion unsound too.
  configNoiseKey: (probes) => [probes.noiseKey, probes.databaseFile],
};

export function computeConfigChecks({
  config,
  probes,
  relayResolution,
}: ConfigChecksInput): ConfigCheck[] {
  // A missing or unparseable file leaves nothing to check. The page already
  // reports that through the `configAccess` diagnostic, so degrading to an
  // empty section is better than inventing failures from a file nobody read.
  if (!readObject(config)) {
    return [];
  }

  const checks = [
    oidcKeysCheck(config),
    trustedProxiesCheck(config),
    tlsCheck(config, probes),
    databaseCheck(config, probes),
    policyCheck(config, probes),
    dnsRecordsCheck(config),
    oidcCheck(config),
    noiseKeyCheck(config, probes),
    derpResolvableCheck(config, "ipv4", relayResolution),
    derpResolvableCheck(config, "ipv6", relayResolution),
  ];

  // A container that mounts Headscale's config file but not the directories the
  // file points at sees those paths as missing. Reporting that as a failure —
  // or as "Headscale has not created it yet" — would be a false alarm about a
  // healthy server, so anything an unverifiable path contributed to is replaced
  // with "cannot check this". Verdicts that do not read such a path (a passing
  // check, the OIDC rules, the trusted-proxy rules) are left alone.
  return checks.map((entry) => {
    if (entry.status === "pass") {
      return entry;
    }

    const invisible = firstUnavailable(...(PROBES_FOR_CHECK[entry.id]?.(probes) ?? []));
    return invisible ? unavailableCheck(entry.id, invisible.path) : entry;
  });
}

/**
 * Which paths the loader has to probe for `config`. Pure as well, so the path
 * resolution -- including Headscale's SQLite default -- is unit tested without
 * a filesystem.
 */
export interface ConfigProbeTargets {
  tlsCert?: string;
  tlsKey?: string;
  policyFile?: string;
  databaseFile?: string;
  noiseKey?: string;
}

export function configProbeTargets(config: unknown): ConfigProbeTargets {
  const root = readObject(config);
  if (!root) {
    return {};
  }

  const targets: ConfigProbeTargets = {};

  const tlsCert = readText(root.tls_cert_path);
  const tlsKey = readText(root.tls_key_path);
  if (tlsCert) targets.tlsCert = tlsCert;
  if (tlsKey) targets.tlsKey = tlsKey;

  const noiseKey = readText(readObject(root.noise)?.private_key_path);
  if (noiseKey) targets.noiseKey = noiseKey;

  const policy = readObject(root.policy);
  const policyPath = readText(policy?.path);
  if (readText(policy?.mode) !== "database" && policyPath) {
    targets.policyFile = policyPath;
  }

  const database = readObject(root.database);
  const databaseType = readText(database?.type) || "sqlite";
  if (databaseType === "sqlite") {
    targets.databaseFile = readText(readObject(database?.sqlite)?.path) || DEFAULT_SQLITE_PATH;
  }

  return targets;
}

/**
 * Headscale parses every `trusted_proxies` entry with Go's `netip.ParsePrefix`,
 * then rejects the unspecified ranges: `0.0.0.0/0` and `::/0` are
 * configuration errors, because trusting every address would defeat the
 * setting. IPv6 has many spellings of the zero address (`::`, `::0`, `0::`,
 * `0:0:0:0:0:0:0:0`), so the address part is matched by shape.
 */
export function isUnspecifiedTrustedProxy(entry: string): boolean {
  const value = entry.trim();
  const slash = value.lastIndexOf("/");
  if (slash === -1 || !/^0+$/.test(value.slice(slash + 1))) {
    return false;
  }

  const address = value.slice(0, slash).toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return address.split(".").every((octet) => Number(octet) === 0);
  }

  return address.includes(":") && /^[0:]+$/.test(address);
}

/**
 * The host the relay checks have to resolve, or `undefined` when they need no
 * DNS at all: the embedded server is disabled or declares no address, so there
 * is nothing a resolved record could contradict. An empty string is returned
 * for a `server_url` that names no usable host, which the resolver turns into
 * "host-missing" without touching DNS.
 *
 * Pure, so the loader can decide whether a lookup is worth running before it
 * asks the resolver anything.
 */
export function configRelayLookupTarget(config: unknown): string | undefined {
  const root = readObject(config);
  if (!root) {
    return undefined;
  }

  const server = readObject(readObject(root.derp)?.server);
  if (server?.enabled !== true) {
    return undefined;
  }

  if (readText(server.ipv4).length === 0 && readText(server.ipv6).length === 0) {
    return undefined;
  }

  return deriveDerpPublicEndpoint(readText(root.server_url))?.host ?? "";
}

function check(
  id: ConfigCheckId,
  status: DiagnosticStatus,
  bodyKey: TranslationKey,
  extra: { vars?: Record<string, string | number>; link?: DiagnosticLink } = {},
): ConfigCheck {
  return { id, status, titleKey: TITLES[id], bodyKey, ...extra };
}

/**
 * The first probe that could not be inspected from this process, if any.
 *
 * A container normally mounts Headscale's config file but not the directories it
 * points at, so `stat` fails for those host paths. A path nobody can look at
 * cannot be called missing, so the checks report it as unverifiable instead.
 */
function firstUnavailable(...probes: (ConfigProbe | undefined)[]): ConfigProbe | undefined {
  return probes.find((probe) => probe?.unavailable === true);
}

function unavailableCheck(id: ConfigCheck["id"], path: string): ConfigCheck {
  return check(id, "warning", "settings.system.configChecks.pathUnavailable", {
    vars: { path },
  });
}

function oidcKeysCheck(config: unknown): ConfigCheck {
  const oidc = readObject(readObject(config)?.oidc);
  const found = oidc
    ? FATAL_OIDC_KEYS.filter((key) => key in oidc).map((key) => `oidc.${key}`)
    : [];

  if (found.length === 0) {
    return check("configOidcKeys", "pass", "settings.system.configChecks.oidcKeys.pass");
  }

  return check("configOidcKeys", "fail", "settings.system.configChecks.oidcKeys.fail", {
    vars: { keys: found.join(", ") },
    link: SETTINGS_LINK,
  });
}

function trustedProxiesCheck(config: unknown): ConfigCheck {
  const rejected = readList(readObject(config)?.trusted_proxies).filter(isUnspecifiedTrustedProxy);
  if (rejected.length === 0) {
    return check(
      "configTrustedProxies",
      "pass",
      "settings.system.configChecks.trustedProxies.pass",
    );
  }

  return check("configTrustedProxies", "fail", "settings.system.configChecks.trustedProxies.fail", {
    vars: { proxies: rejected.join(", ") },
    link: SETTINGS_LINK,
  });
}

function tlsCheck(config: unknown, probes: ConfigProbeResults): ConfigCheck {
  const root = readObject(config) ?? {};
  const hostname = readText(root.tls_letsencrypt_hostname);
  const certPath = readText(root.tls_cert_path);
  const keyPath = readText(root.tls_key_path);

  if (!hostname && !certPath && !keyPath) {
    return check("configTls", "pass", "settings.system.configChecks.tls.none");
  }

  // A configured certificate that cannot be read stops Headscale from serving
  // TLS at all, so it outranks every warning below.
  for (const [path, probe] of [
    [certPath, probes.tlsCert],
    [keyPath, probes.tlsKey],
  ] as const) {
    if (path && probe && (!probe.exists || !probe.readable || probe.isFile === false)) {
      return check("configTls", "fail", "settings.system.configChecks.tls.missingFile", {
        vars: { path: probe.path },
      });
    }
  }

  if (hostname && (certPath || keyPath)) {
    return check("configTls", "warning", "settings.system.configChecks.tls.conflict", {
      vars: { hostname, path: certPath || keyPath },
      link: SETTINGS_LINK,
    });
  }

  // TLS terminates at the reverse proxy in this setup, so a plain HTTP
  // server_url is only a warning rather than a failure.
  const serverUrl = readText(root.server_url);
  if (serverUrl.toLowerCase().startsWith("http://")) {
    return check("configTls", "warning", "settings.system.configChecks.tls.insecure", {
      vars: { url: serverUrl },
    });
  }

  return check("configTls", "pass", "settings.system.configChecks.tls.pass");
}

function databaseCheck(config: unknown, probes: ConfigProbeResults): ConfigCheck {
  const database = readObject(readObject(config)?.database);
  const type = readText(database?.type) || "sqlite";

  if (type !== "sqlite") {
    return check("configDatabase", "pass", "settings.system.configChecks.database.external", {
      vars: { type },
    });
  }

  const dir = probes.databaseDir;
  const file = probes.databaseFile;
  const path = file?.path ?? dir?.path ?? DEFAULT_SQLITE_PATH;

  if (dir && !dir.exists) {
    return check("configDatabase", "fail", "settings.system.configChecks.database.missingDir", {
      vars: { path: dir.path },
    });
  }

  if (dir && dir.exists && dir.writable === false) {
    // Headplane's access is not Headscale's: a read-only bind mount (the
    // recommended way to let Headplane inspect the data directory) makes this
    // probe fail while Headscale itself writes there happily. Warn about what
    // cannot be verified instead of claiming the server cannot write.
    return check("configDatabase", "warning", "settings.system.configChecks.database.readOnlyDir", {
      vars: { path: dir.path },
    });
  }

  // A missing database file is the normal first start: Headscale creates it.
  if (file && !file.exists) {
    return check("configDatabase", "warning", "settings.system.configChecks.database.missingFile", {
      vars: { path: file.path },
    });
  }

  return check("configDatabase", "pass", "settings.system.configChecks.database.pass", {
    vars: { path },
  });
}

function policyCheck(config: unknown, probes: ConfigProbeResults): ConfigCheck {
  const policy = readObject(readObject(config)?.policy);
  const mode = readText(policy?.mode) || "file";

  if (mode === "database") {
    return check("configPolicy", "pass", "settings.system.configChecks.policy.database");
  }

  const path = readText(policy?.path);
  if (!path) {
    // With `mode: file` and no path Headscale loads no policy at all, which
    // allows every node.
    return check("configPolicy", "warning", "settings.system.configChecks.policy.missingPath", {
      link: SETTINGS_LINK,
    });
  }

  const probe = probes.policyFile;
  if (!probe || !probe.exists) {
    return check("configPolicy", "fail", "settings.system.configChecks.policy.missingFile", {
      vars: { path },
      link: SETTINGS_LINK,
    });
  }

  if (!probe.readable || probe.isFile === false) {
    return check("configPolicy", "fail", "settings.system.configChecks.policy.unreadable", {
      vars: { path },
      link: SETTINGS_LINK,
    });
  }

  if (probe.size === 0) {
    return check("configPolicy", "warning", "settings.system.configChecks.policy.empty", {
      vars: { path },
      link: SETTINGS_LINK,
    });
  }

  return check("configPolicy", "pass", "settings.system.configChecks.policy.pass", {
    vars: { path },
  });
}

function dnsRecordsCheck(config: unknown): ConfigCheck {
  const dns = readObject(readObject(config)?.dns);
  const inline = dns?.extra_records;
  const hasInline = Array.isArray(inline) && inline.length > 0;
  const path = readText(dns?.extra_records_path);

  if (!hasInline || !path) {
    return check("configDnsRecords", "pass", "settings.system.configChecks.dns.pass");
  }

  // Headplane itself prefers the JSON file, so the inline records silently do
  // nothing in the UI, and Headscale has to pick one of the two sources.
  return check("configDnsRecords", "warning", "settings.system.configChecks.dns.conflict", {
    vars: { path },
    link: DNS_LINK,
  });
}

function oidcCheck(config: unknown): ConfigCheck {
  const oidc = readObject(readObject(config)?.oidc);
  if (!oidc) {
    return check("configOidc", "pass", "settings.system.configChecks.oidc.pass");
  }

  const issuer = readText(oidc.issuer);
  const clientId = readText(oidc.client_id);
  if (issuer && !clientId) {
    return check("configOidc", "fail", "settings.system.configChecks.oidc.missingClientId", {
      vars: { issuer },
      link: SETTINGS_LINK,
    });
  }

  if (!issuer && clientId) {
    return check("configOidc", "fail", "settings.system.configChecks.oidc.missingIssuer", {
      vars: { clientId },
      link: SETTINGS_LINK,
    });
  }

  const method = readText(readObject(oidc.pkce)?.method) || "S256";
  if (!PKCE_METHODS.includes(method)) {
    return check("configOidc", "fail", "settings.system.configChecks.oidc.badPkce", {
      vars: { method },
      link: SETTINGS_LINK,
    });
  }

  // Headscale reads the inline secret first, so the file path is dead weight.
  if (readText(oidc.client_secret) && readText(oidc.client_secret_path)) {
    return check("configOidc", "warning", "settings.system.configChecks.oidc.secrets", {
      link: SETTINGS_LINK,
    });
  }

  return check("configOidc", "pass", "settings.system.configChecks.oidc.pass");
}

function noiseKeyCheck(config: unknown, probes: ConfigProbeResults): ConfigCheck {
  const path = readText(readObject(readObject(config)?.noise)?.private_key_path);
  if (!path) {
    return check("configNoiseKey", "pass", "settings.system.configChecks.noise.database");
  }

  const probe = probes.noiseKey;
  if (!probe || !probe.exists || !probe.readable || probe.isFile === false) {
    // On a first start the database is missing too, and Headscale generates
    // the Noise key as part of creating it, so a missing key is only a warning
    // until a database exists to generate it against.
    const firstStart = probes.databaseFile !== undefined && !probes.databaseFile.exists;
    return firstStart
      ? check("configNoiseKey", "warning", "settings.system.configChecks.noise.firstStart", {
          vars: { path },
        })
      : check("configNoiseKey", "fail", "settings.system.configChecks.noise.fail", {
          vars: { path },
        });
  }

  return check("configNoiseKey", "pass", "settings.system.configChecks.noise.pass", {
    vars: { path },
  });
}

/**
 * Whether the address `derp.server` advertises for the embedded relay is what
 * the relay hostname actually resolves to. The declared value is what Headscale
 * publishes to clients; only the DNS answer says whether they can reach it, so
 * a declared address with no matching record is a warning rather than a pass.
 *
 * Two cases are deliberately neutral passes: an embedded server that is off
 * (there is no relay address to check) and a family with nothing declared
 * (there is nothing to compare, and IPv4-only is a valid way to run the relay).
 * A lookup that did not complete is reported as "cannot check".
 */
function derpResolvableCheck(
  config: unknown,
  family: RelayAddressFamily,
  relayResolution: RelayResolution | undefined,
): ConfigCheck {
  const id: ConfigCheckId =
    family === "ipv4" ? "configDerpIpv4Resolvable" : "configDerpIpv6Resolvable";
  const prefix =
    family === "ipv4"
      ? "settings.system.configChecks.derpIpv4"
      : "settings.system.configChecks.derpIpv6";
  const root = readObject(config) ?? {};
  const server = readObject(readObject(root.derp)?.server) ?? {};
  const declared = readText(server[family]);

  if (server.enabled !== true) {
    return check(id, "pass", `${prefix}.disabled`);
  }

  if (declared.length === 0) {
    return check(id, "pass", `${prefix}.undeclared`);
  }

  // The relay endpoint's host, for the explanation. A DNS failure with no
  // usable host is reported by the verdict itself, never with an empty label.
  const host = deriveDerpPublicEndpoint(readText(root.server_url))?.host;
  const vars = { address: declared, host: host && host.length > 0 ? host : "server_url" };

  switch (compareRelayAddress(family, declared, relayResolution).verdict) {
    case "matches":
      return check(id, "pass", `${prefix}.match`, { vars });
    case "declared-but-not-resolved":
      return check(id, "warning", `${prefix}.mismatch`, { vars, link: SETTINGS_LINK });
    case "no-records":
      return check(id, "warning", `${prefix}.missingRecord`, { vars, link: SETTINGS_LINK });
    case "host-missing":
      return check(id, "warning", "settings.system.configChecks.relayHostUnusable");
    default:
      // The resolver did not answer, so nothing can be concluded about the
      // declared address. The literal case cannot be reached with a
      // declaration: a literal endpoint matches it or mismatches it.
      return check(id, "warning", "settings.system.configChecks.relayUnavailable", { vars });
  }
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readList(value: unknown): string[] {
  if (typeof value === "string") {
    return readText(value) ? [readText(value)] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
