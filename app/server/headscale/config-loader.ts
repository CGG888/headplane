import { randomUUID } from "node:crypto";
import {
  constants,
  access,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import * as v from "valibot";
import { Document, parseDocument } from "yaml";

import { deriveHeadscaleDataDirectory } from "~/server/derp-mirror/target-path";
import log from "~/utils/log";

import { DNSRecord, HeadscaleDNSConfig, loadHeadscaleDNS } from "./config-dns";

interface PatchConfig {
  path: string;
  value: unknown;
}

interface DNSConfigView {
  magicDns: boolean;
  baseDomain: string;
  nameservers: string[];
  splitDns: Record<string, string[]>;
  searchDomains: string[];
  overrideDns: boolean;
  extraRecords: DNSRecord[];
}

interface OIDCConfigView {
  issuer: string;
  allowedDomains: string[];
  allowedGroups: string[];
  allowedUsers: string[];
}

interface ParsedDNSConfig {
  magic_dns: boolean;
  base_domain: string;
  nameservers: {
    global: string[];
    split: Record<string, string[]>;
  };
  search_domains: string[];
  override_local_dns: boolean;
  extra_records: DNSRecord[];
  extra_records_path?: string;
}

const DNS_CONFIG_DEFAULTS: ParsedDNSConfig = {
  magic_dns: true,
  base_domain: "",
  nameservers: {
    global: [],
    split: {},
  },
  search_domains: [],
  override_local_dns: true,
  extra_records: [],
};

const stringSchema = v.string();
const stringArraySchema = v.array(v.string());
const stringArrayRecordSchema = v.record(v.string(), stringArraySchema);
const goBooleanSchema = v.pipe(
  v.union([v.boolean(), v.picklist(["true", "false"])]),
  v.transform((value) => value === true || value === "true"),
);
const dnsRecordsSchema = v.array(
  v.object({
    name: v.string(),
    type: v.string(),
    value: v.string(),
  }),
);
const nameserversSchema = v.object({
  global: v.optional(v.fallback(stringArraySchema, []), []),
  split: v.optional(v.fallback(stringArrayRecordSchema, {}), {}),
});
const dnsConfigSchema = v.object({
  magic_dns: v.optional(
    v.fallback(goBooleanSchema, DNS_CONFIG_DEFAULTS.magic_dns),
    DNS_CONFIG_DEFAULTS.magic_dns,
  ),
  base_domain: v.optional(
    v.fallback(stringSchema, DNS_CONFIG_DEFAULTS.base_domain),
    DNS_CONFIG_DEFAULTS.base_domain,
  ),
  nameservers: v.optional(
    v.fallback(nameserversSchema, DNS_CONFIG_DEFAULTS.nameservers),
    DNS_CONFIG_DEFAULTS.nameservers,
  ),
  search_domains: v.optional(
    v.fallback(stringArraySchema, DNS_CONFIG_DEFAULTS.search_domains),
    DNS_CONFIG_DEFAULTS.search_domains,
  ),
  override_local_dns: v.optional(
    v.fallback(goBooleanSchema, DNS_CONFIG_DEFAULTS.override_local_dns),
    DNS_CONFIG_DEFAULTS.override_local_dns,
  ),
  extra_records: v.optional(
    v.fallback(dnsRecordsSchema, DNS_CONFIG_DEFAULTS.extra_records),
    DNS_CONFIG_DEFAULTS.extra_records,
  ),
  extra_records_path: v.optional(v.string()),
});
const headscaleConfigSchema = v.fallback(
  v.object({
    dns: v.optional(v.fallback(dnsConfigSchema, DNS_CONFIG_DEFAULTS), DNS_CONFIG_DEFAULTS),
  }),
  { dns: DNS_CONFIG_DEFAULTS },
);
const oidcConfigSchema = v.object({
  issuer: v.string(),
  allowed_domains: v.optional(v.fallback(stringArraySchema, []), []),
  allowed_groups: v.optional(v.fallback(stringArraySchema, []), []),
  allowed_users: v.optional(v.fallback(stringArraySchema, []), []),
});
const rawOIDCConfigSchema = v.fallback(
  v.object({
    oidc: v.optional(v.unknown()),
  }),
  {},
);
const extraRecordsConflictSchema = v.object({
  dns: v.optional(
    v.object({
      extra_records: v.optional(v.array(v.unknown())),
      extra_records_path: v.optional(v.string()),
    }),
  ),
});

export interface OIDCSettingsView {
  issuer: string;
  clientId: string;
  // The secret itself is never returned to the browser; the page only needs to
  // know whether one is configured.
  hasClientSecret: boolean;
  // Whether an inline `client_secret` is stored. Headscale's own
  // config-example.yaml calls this key and `client_secret_path` mutually
  // exclusive, so the page warns when both are present without blocking it.
  hasInlineClientSecret: boolean;
  // The file Headscale reads the secret from, or an empty string when unset.
  clientSecretPath: string;
  // Extra key/value pairs sent to the identity provider's authorization
  // endpoint, kept as a plain string map so the page can edit it as rows.
  extraParams: Record<string, string>;
  scope: string[];
  emailVerifiedRequired: boolean;
  useExpiryFromToken: boolean;
  onlyStartIfOIDCIsAvailable: boolean;
  pkceEnabled: boolean;
  pkceMethod: string;
  allowedDomains: string[];
  allowedGroups: string[];
  allowedUsers: string[];
}

export interface TailnetSettingsView {
  policyMode: "file" | "database";
  policyPath: string;
  trustedProxies: string[];
}

/**
 * Headscale settings that live outside `dns`, `oidc` and `policy`. Durations
 * stay Headscale duration strings (`0`, `720h`, `30d`) because Headplane writes
 * them back verbatim; only the format is narrowed to the two values Headscale
 * understands.
 */
export interface AdvancedSettingsView {
  nodeExpiry: string;
  ephemeralInactivityTimeout: string;
  // Headscale accepts the full zerolog level set, but Headplane only writes the
  // four below `LOG_LEVELS`. The raw string is kept so a config with e.g.
  // `trace` is shown as it is instead of being silently replaced.
  logLevel: string;
  logFormat: "text" | "json";
  taildropEnabled: boolean;
  autoUpdateEnabled: boolean;
  logtailEnabled: boolean;
  disableCheckUpdates: boolean;
  // HA subnet-router health probing (Headscale 0.29). Both are Headscale
  // duration strings; `probe_interval: 0` disables probing entirely.
  haProbeInterval: string;
  haProbeTimeout: string;
}

/**
 * The optional DERP server embedded in Headscale. `region_id`, `region_code`,
 * `region_name`, `stun_listen_addr`, `private_key_path`, `ipv4` and `ipv6` have
 * no viper default in `hscontrol/types/config.go` (they read the Go zero
 * value), so the values below are the ones Headscale's own
 * `config-example.yaml` documents.
 */
export interface DERPEmbeddedServerView {
  enabled: boolean;
  regionId: number;
  regionCode: string;
  regionName: string;
  stunListenAddr: string;
  // The configured key path, or an empty string when none is set. It is not a
  // secret (Headscale reads the key file itself), and the embedded-server
  // preset dialog prefills the field with it.
  privateKeyPath: string;
  // Whether a path is configured at all; the page shows it as a status line.
  hasPrivateKey: boolean;
  // Public addresses Headscale advertises for the relay, so clients can reach
  // it without resolving a hostname. Empty means the key is unset.
  ipv4: string;
  ipv6: string;
  verifyClients: boolean;
  automaticallyAddEmbeddedDerpRegion: boolean;
}

export interface DERPSettingsView {
  /**
   * Headscale's `server_url`. The embedded DERP server is served on the same
   * HTTPS endpoint as Headscale itself, so this URL is what tells clients which
   * public port to use; Headscale's own listen address is irrelevant for DERP.
   */
  serverUrl: string;
  urls: string[];
  paths: string[];
  /**
   * Headscale's data directory, derived from the file paths its configuration
   * names (`noise.private_key_path`, `database.sqlite.path`, the embedded DERP
   * key, `unix_socket`). The DERP region mirror places the map file it maintains
   * here when `derp.paths` lists nothing yet, which is what makes the same
   * default work for a native Headscale and for a container beside the panel.
   * Empty when the configuration names none of those paths.
   */
  dataDirectory: string;
  autoUpdateEnabled: boolean;
  updateFrequency: string;
  server: DERPEmbeddedServerView;
}

/**
 * Settings Headplane deliberately never writes, surfaced read-only so looking
 * one up does not mean opening Headscale's config file on the host. Strings
 * stay empty when the key is absent (the page renders those as `—`); the few
 * booleans Headscale defaults to `true` keep that default so the page cannot
 * show the opposite of what Headscale actually runs.
 */
export interface ServerOverviewView {
  serverUrl: string;
  listenAddr: string;
  prefixesV4: string;
  prefixesV6: string;
  prefixAllocation: string;
  databaseType: string;
  sqlitePath: string;
  sqliteWriteAheadLog: boolean;
  metricsListenAddr: string;
  grpcListenAddr: string;
  grpcAllowInsecure: boolean;
  unixSocket: string;
  unixSocketPermission: string;
  noisePrivateKeyPath: string;
  tlsLetsencryptHostname: string;
  acmeEmail: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  tuningConfigured: boolean;
}

interface HeadscaleConfigState {
  document?: Document;
  config: unknown;
  access: "rw" | "ro" | "no";
  path?: string;
  writeQueue: Promise<void>;
  dns?: HeadscaleDNSConfig;
}

interface HeadscaleConfig {
  readable: () => boolean;
  writable: () => boolean;
  getDNSConfig: () => DNSConfigView;
  getMagicDNSBaseDomain: () => string | undefined;
  getOIDCConfig: () => OIDCConfigView | undefined;
  hasOIDCConfig: () => boolean;
  getOIDCSettings: () => OIDCSettingsView | undefined;
  getTailnetSettings: () => TailnetSettingsView;
  getAdvancedSettings: () => AdvancedSettingsView;
  getDERPSettings: () => DERPSettingsView;
  getServerOverview: () => ServerOverviewView;
  dnsRecords: () => DNSRecord[];
  patch: (patches: PatchConfig[]) => Promise<void>;
  mutate: (build: () => PatchConfig[] | Promise<PatchConfig[]>) => Promise<void>;
  addDNS: (record: DNSRecord) => Promise<boolean | void>;
  removeDNS: (record: DNSRecord) => Promise<boolean | void>;
}

function createHeadscaleConfig(
  access: "rw" | "ro" | "no",
  dns?: HeadscaleDNSConfig,
  document?: Document,
  path?: string,
): HeadscaleConfig {
  const state: HeadscaleConfigState = {
    access,
    config: document?.toJSON() ?? {},
    document,
    path,
    writeQueue: Promise.resolve(),
    dns,
  };

  return {
    readable: () => readable(state),
    writable: () => writable(state),
    getDNSConfig: () => getDNSConfig(state),
    getMagicDNSBaseDomain: () => getMagicDNSBaseDomain(state),
    getOIDCConfig: () => getOIDCConfig(state),
    hasOIDCConfig: () => hasOIDCConfig(state),
    getOIDCSettings: () => getOIDCSettings(state),
    getTailnetSettings: () => getTailnetSettings(state),
    getAdvancedSettings: () => getAdvancedSettings(state),
    getDERPSettings: () => getDERPSettings(state),
    getServerOverview: () => getServerOverview(state),
    dnsRecords: () => dnsRecords(state),
    patch: (patches) => patchHeadscaleConfig(state, patches),
    mutate: (build) => mutateHeadscaleConfig(state, build),
    addDNS: (record) => addDNS(state, record),
    removeDNS: (record) => removeDNS(state, record),
  };
}

function readable(config: HeadscaleConfigState) {
  return config.access !== "no";
}

function writable(config: HeadscaleConfigState) {
  return config.access === "rw";
}

function getDNSConfig(config: HeadscaleConfigState): DNSConfigView {
  const dns = v.parse(headscaleConfigSchema, config.config).dns;

  return {
    magicDns: dns.magic_dns,
    baseDomain: dns.base_domain,
    nameservers: dns.nameservers.global,
    splitDns: dns.nameservers.split ?? {},
    searchDomains: dns.search_domains,
    overrideDns: dns.override_local_dns,
    extraRecords: dnsRecords(config),
  };
}

function getMagicDNSBaseDomain(config: HeadscaleConfigState) {
  if (!readable(config)) return;
  const dns = getDNSConfig(config);
  return dns.magicDns && dns.baseDomain ? dns.baseDomain : undefined;
}

function getOIDCConfig(config: HeadscaleConfigState): OIDCConfigView | undefined {
  const oidc = v.safeParse(oidcConfigSchema, v.parse(rawOIDCConfigSchema, config.config).oidc);
  if (!oidc.success) return;

  return {
    issuer: oidc.output.issuer,
    allowedDomains: oidc.output.allowed_domains,
    allowedGroups: oidc.output.allowed_groups,
    allowedUsers: oidc.output.allowed_users,
  };
}

function hasOIDCConfig(config: HeadscaleConfigState) {
  return getOIDCConfig(config) !== undefined;
}

// The full OIDC block, for the settings page. Values are read defensively so a
// hand-written config with unexpected types cannot break the page.
function getOIDCSettings(config: HeadscaleConfigState): OIDCSettingsView | undefined {
  const root = readObject(config.config);
  const oidc = root ? readObject(root.oidc) : undefined;
  if (!oidc) {
    return undefined;
  }

  const pkce = readObject(oidc.pkce);
  const scope = readStringList(oidc.scope);
  const inlineClientSecret = readString(oidc.client_secret);
  const clientSecretPath = readString(oidc.client_secret_path);
  return {
    issuer: readString(oidc.issuer),
    clientId: readString(oidc.client_id),
    hasClientSecret: inlineClientSecret.length > 0 || clientSecretPath.length > 0,
    hasInlineClientSecret: inlineClientSecret.length > 0,
    clientSecretPath,
    extraParams: readStringRecord(oidc.extra_params),
    // Headscale defaults these to the OIDC standard scopes.
    scope: scope.length > 0 ? scope : ["openid", "profile", "email"],
    emailVerifiedRequired: readBoolean(oidc.email_verified_required, true),
    useExpiryFromToken: readBoolean(oidc.use_expiry_from_token, false),
    // Headscale defaults `only_start_if_oidc_is_available` to true.
    onlyStartIfOIDCIsAvailable: readBoolean(oidc.only_start_if_oidc_is_available, true),
    pkceEnabled: pkce ? readBoolean(pkce.enabled, false) : false,
    pkceMethod: pkce ? readString(pkce.method, "S256") : "S256",
    allowedDomains: readStringList(oidc.allowed_domains),
    allowedGroups: readStringList(oidc.allowed_groups),
    allowedUsers: readStringList(oidc.allowed_users),
  };
}

// Tailnet-wide settings that live outside `dns` and `oidc`.
function getTailnetSettings(config: HeadscaleConfigState): TailnetSettingsView {
  const root = readObject(config.config) ?? {};
  const policy = readObject(root.policy) ?? {};

  return {
    policyMode: readString(policy.mode, "file") === "database" ? "database" : "file",
    policyPath: readString(policy.path),
    trustedProxies: readStringList(root.trusted_proxies),
  };
}

/**
 * Headscale's documented defaults for the advanced settings, matching
 * `hscontrol/types/config.go`'s `viper.SetDefault` calls in v0.29.2. They are
 * shown (and written back) when the key is absent from the file.
 */
const ADVANCED_SETTINGS_DEFAULTS = {
  nodeExpiry: "0",
  // Headscale's `viper.SetDefault` is 120s; its config-example.yaml ships 30m.
  // The default below is what Headscale actually uses when the key is unset.
  ephemeralInactivityTimeout: "120s",
  logLevel: "info",
  logFormat: "text" as const,
  taildropEnabled: true,
  autoUpdateEnabled: false,
  logtailEnabled: false,
  disableCheckUpdates: false,
  // Headscale's config-example.yaml documents 10s + 5s as the defaults for the
  // HA subnet-router probing ("worst-case detection time ... 15s default").
  haProbeInterval: "10s",
  haProbeTimeout: "5s",
};

// Advanced Headscale settings that live outside `dns`, `oidc` and `policy`.
// Every value is read defensively so a hand-written config with unexpected
// types falls back to Headscale's default instead of breaking the page.
function getAdvancedSettings(config: HeadscaleConfigState): AdvancedSettingsView {
  const root = readObject(config.config) ?? {};
  const node = readObject(root.node) ?? {};
  const ephemeral = readObject(node.ephemeral) ?? {};
  const log = readObject(root.log) ?? {};
  const taildrop = readObject(root.taildrop) ?? {};
  const autoUpdate = readObject(root.auto_update) ?? {};
  const logtail = readObject(root.logtail) ?? {};
  const routes = readObject(node.routes) ?? {};
  const ha = readObject(routes.ha) ?? {};

  return {
    nodeExpiry: readString(node.expiry, ADVANCED_SETTINGS_DEFAULTS.nodeExpiry),
    ephemeralInactivityTimeout: readString(
      ephemeral.inactivity_timeout,
      ADVANCED_SETTINGS_DEFAULTS.ephemeralInactivityTimeout,
    ),
    // An empty level cannot be shown in the picker, so it falls back to the
    // documented default just like an unset value.
    logLevel:
      readString(log.level, ADVANCED_SETTINGS_DEFAULTS.logLevel) ||
      ADVANCED_SETTINGS_DEFAULTS.logLevel,
    // Headscale only understands these two and falls back to `text` for
    // anything else, so the view mirrors that instead of showing a value the
    // page could never write.
    logFormat:
      readString(log.format, ADVANCED_SETTINGS_DEFAULTS.logFormat) === "json" ? "json" : "text",
    taildropEnabled: readBoolean(taildrop.enabled, ADVANCED_SETTINGS_DEFAULTS.taildropEnabled),
    autoUpdateEnabled: readBoolean(
      autoUpdate.enabled,
      ADVANCED_SETTINGS_DEFAULTS.autoUpdateEnabled,
    ),
    logtailEnabled: readBoolean(logtail.enabled, ADVANCED_SETTINGS_DEFAULTS.logtailEnabled),
    disableCheckUpdates: readBoolean(
      root.disable_check_updates,
      ADVANCED_SETTINGS_DEFAULTS.disableCheckUpdates,
    ),
    // `probe_interval: 0` is a bare YAML number and disables probing, so it has
    // to be read back as "0" instead of falling back to the textual default.
    haProbeInterval: readDuration(ha.probe_interval, ADVANCED_SETTINGS_DEFAULTS.haProbeInterval),
    haProbeTimeout: readDuration(ha.probe_timeout, ADVANCED_SETTINGS_DEFAULTS.haProbeTimeout),
  };
}

/**
 * DERP defaults, matching Headscale v0.29.2. `derp.server.verify_clients`,
 * `derp.server.automatically_add_embedded_derp_region` and
 * `derp.update_frequency` are `viper.SetDefault` values from
 * `hscontrol/types/config.go`; the remaining embedded-server values have no
 * viper default and fall back to what `config-example.yaml` documents.
 */
const DERP_SETTINGS_DEFAULTS = {
  urls: [] as string[],
  paths: [] as string[],
  autoUpdateEnabled: false,
  updateFrequency: "3h",
  server: {
    enabled: false,
    regionId: 999,
    regionCode: "headscale",
    regionName: "Headscale Embedded DERP",
    stunListenAddr: "0.0.0.0:3478",
    ipv4: "",
    ipv6: "",
    verifyClients: true,
    automaticallyAddEmbeddedDerpRegion: true,
  },
};

// DERP settings live at the top level (`derp.*`, not under `node`). Every value
// is read defensively so a hand-written config with unexpected types falls back
// to Headscale's default instead of breaking the page.
function getDERPSettings(config: HeadscaleConfigState): DERPSettingsView {
  const root = readObject(config.config) ?? {};
  const derp = readObject(root.derp) ?? {};
  const server = readObject(derp.server) ?? {};
  const noise = readObject(root.noise) ?? {};
  const database = readObject(root.database) ?? {};
  const sqlite = readObject(database.sqlite) ?? {};
  const defaults = DERP_SETTINGS_DEFAULTS;

  return {
    serverUrl: readString(root.server_url),
    urls: readStringList(derp.urls),
    paths: readStringList(derp.paths),
    dataDirectory: deriveHeadscaleDataDirectory({
      noisePrivateKeyPath: readString(noise.private_key_path),
      sqlitePath: readString(sqlite.path),
      derpPrivateKeyPath: readString(server.private_key_path),
      unixSocket: readString(root.unix_socket),
    }),
    autoUpdateEnabled: readBoolean(derp.auto_update_enabled, defaults.autoUpdateEnabled),
    updateFrequency: readString(derp.update_frequency, defaults.updateFrequency),
    server: {
      enabled: readBoolean(server.enabled, defaults.server.enabled),
      regionId: readNumber(server.region_id, defaults.server.regionId),
      regionCode: readString(server.region_code, defaults.server.regionCode),
      regionName: readString(server.region_name, defaults.server.regionName),
      stunListenAddr: readString(server.stun_listen_addr, defaults.server.stunListenAddr),
      privateKeyPath: readString(server.private_key_path),
      // Headscale generates the key file when the path is missing, so the page
      // only needs to know whether a path is configured at all.
      hasPrivateKey: readString(server.private_key_path).length > 0,
      ipv4: readString(server.ipv4, defaults.server.ipv4),
      ipv6: readString(server.ipv6, defaults.server.ipv6),
      verifyClients: readBoolean(server.verify_clients, defaults.server.verifyClients),
      automaticallyAddEmbeddedDerpRegion: readBoolean(
        server.automatically_add_embedded_derp_region,
        defaults.server.automaticallyAddEmbeddedDerpRegion,
      ),
    },
  };
}

/**
 * Headscale's own fallbacks for the settings the read-only overview shows.
 * Only values Headscale resolves itself are listed; everything else stays
 * empty so the page can render `—` for a key that is not in the file.
 */
const SERVER_OVERVIEW_DEFAULTS = {
  databaseType: "sqlite",
  sqliteWriteAheadLog: true,
  // Headscale's config-example.yaml documents sequential as the default
  // allocation strategy.
  prefixAllocation: "sequential",
};

/**
 * The settings Headplane deliberately does not write, read straight from the
 * file so operators can look them up without opening it on the host. Every
 * value is read defensively: a hand-written config with unexpected types must
 * never break the settings page.
 */
function getServerOverview(config: HeadscaleConfigState): ServerOverviewView {
  const root = readObject(config.config) ?? {};
  const prefixes = readObject(root.prefixes) ?? {};
  const database = readObject(root.database) ?? {};
  const sqlite = readObject(database.sqlite) ?? {};
  const noise = readObject(root.noise) ?? {};
  const tuning = readObject(root.tuning);

  return {
    serverUrl: readString(root.server_url),
    listenAddr: readString(root.listen_addr),
    prefixesV4: readString(prefixes.v4),
    prefixesV6: readString(prefixes.v6),
    prefixAllocation: readString(prefixes.allocation, SERVER_OVERVIEW_DEFAULTS.prefixAllocation),
    databaseType: readString(database.type, SERVER_OVERVIEW_DEFAULTS.databaseType),
    sqlitePath: readString(sqlite.path),
    sqliteWriteAheadLog: readBoolean(
      sqlite.write_ahead_log,
      SERVER_OVERVIEW_DEFAULTS.sqliteWriteAheadLog,
    ),
    metricsListenAddr: readString(root.metrics_listen_addr),
    grpcListenAddr: readString(root.grpc_listen_addr),
    grpcAllowInsecure: readBoolean(root.grpc_allow_insecure, false),
    unixSocket: readString(root.unix_socket),
    unixSocketPermission: readString(root.unix_socket_permission),
    noisePrivateKeyPath: readString(noise.private_key_path),
    tlsLetsencryptHostname: readString(root.tls_letsencrypt_hostname),
    acmeEmail: readString(root.acme_email),
    tlsCertPath: readString(root.tls_cert_path),
    tlsKeyPath: readString(root.tls_key_path),
    // `tuning` carries Headscale's performance knobs. Any key in it counts as
    // configured; an empty or non-map value does not.
    tuningConfigured: tuning !== undefined && Object.keys(tuning).length > 0,
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Durations are normally YAML strings (`10s`), but `probe_interval: 0` is a
 * bare number that disables probing. Reading it back as the textual default
 * would silently re-enable probing the next time the form is saved.
 */
function readDuration(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

/** A string map with non-string entries dropped, e.g. `oidc.extra_params`. */
function readStringRecord(value: unknown): Record<string, string> {
  const object = readObject(value);
  if (!object) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry === "string") {
      out[key] = entry;
    }
  }
  return out;
}

function dnsRecords(config: HeadscaleConfigState) {
  if (config.dns) {
    return config.dns.r;
  }

  return v.parse(headscaleConfigSchema, config.config).dns.extra_records;
}

async function patchHeadscaleConfig(config: HeadscaleConfigState, patches: PatchConfig[]) {
  if (!config.path || !config.document || !readable(config) || !writable(config)) {
    return;
  }

  const write = config.writeQueue.then(() => writePatches(config, patches));
  config.writeQueue = write.catch(() => undefined);
  await write;
}

/**
 * Runs `build` inside the write queue so that reading the current value and
 * computing the patches happens after every earlier write settled.
 *
 * `patch()` only serializes the write itself; callers that read a list from
 * the in-memory config and then append to it (trusted proxies, DERP URLs and
 * paths, extra DNS records, OIDC allow-lists) compute their new value before
 * they enqueue, so two concurrent requests both started from the same list and
 * the later write silently dropped the earlier one.
 */
async function mutateHeadscaleConfig(
  config: HeadscaleConfigState,
  build: () => PatchConfig[] | Promise<PatchConfig[]>,
) {
  if (!config.path || !config.document || !readable(config) || !writable(config)) {
    return;
  }

  const write = config.writeQueue.then(async () => {
    const patches = await build();
    if (patches.length === 0) {
      return;
    }

    await writePatches(config, patches);
  });

  config.writeQueue = write.catch(() => undefined);
  await write;
}

async function writePatches(config: HeadscaleConfigState, patches: PatchConfig[]) {
  if (!config.path || !config.document) return;

  log.debug("config", "Patching Headscale configuration");
  for (const patch of patches) {
    const { path, value } = patch;
    log.debug("config", "Patching %s with %o", path, value);

    const key = splitPatchPath(path);
    if (value === null) {
      config.document.deleteIn(key);
      continue;
    }

    config.document.setIn(key, value);
  }

  log.debug("config", "Writing updated Headscale configuration to %s", config.path);
  await atomicWriteFile(config.path, config.document.toString());
  config.config = config.document.toJSON();
}

/**
 * Writes `data` next to `path` and renames it into place.
 *
 * A plain `writeFile` opens with `"w"`, which truncates first: a crash, a full
 * disk, or a container restart between the truncate and the write leaves
 * Headscale's own config.yaml half-written or empty. The rename is atomic, and
 * the file mode of the existing file is preserved.
 */
async function atomicWriteFile(path: string, data: string) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    const existing = await stat(path).catch(() => undefined);
    await writeFile(temp, data, {
      encoding: "utf8",
      ...(existing === undefined ? {} : { mode: existing.mode }),
    });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function splitPatchPath(path: string) {
  const key = [];
  let current = "";
  let quote = false;

  for (const char of path) {
    if (char === '"') {
      quote = !quote;
      continue;
    }

    if (char === "." && !quote) {
      key.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  key.push(current);
  return key;
}

async function addDNS(config: HeadscaleConfigState, record: DNSRecord) {
  if (config.dns) {
    if (!config.dns.readable() || !config.dns.writable()) {
      log.debug("config", "DNS config is not writable");
      return;
    }

    const records = config.dns.r;
    if (records.some((i) => i.name === record.name && i.type === record.type)) {
      log.debug("config", "DNS record already exists");
      return;
    }

    return config.dns.patch([...records, record]);
  }

  const existing = dnsRecords(config);
  if (existing.some((i) => i.name === record.name && i.type === record.type)) {
    log.debug("config", "DNS record already exists");
    return;
  }

  await mutateHeadscaleConfig(config, () => {
    const current = dnsRecords(config);
    if (current.some((i) => i.name === record.name && i.type === record.type)) {
      log.debug("config", "DNS record already exists");
      return [];
    }

    return [
      {
        path: "dns.extra_records",
        value: [...current, record],
      },
    ];
  });

  return true;
}

async function removeDNS(config: HeadscaleConfigState, record: DNSRecord) {
  if (config.dns) {
    if (!config.dns.readable() || !config.dns.writable()) {
      log.debug("config", "DNS config is not writable");
      return;
    }

    const records = config.dns.r.filter((i) => i.name !== record.name || i.type !== record.type);
    return config.dns.patch(records);
  }

  const existing = dnsRecords(config);
  const filtered = existing.filter((i) => i.name !== record.name || i.type !== record.type);
  if (existing.length === filtered.length) {
    return;
  }

  await mutateHeadscaleConfig(config, () => {
    const current = dnsRecords(config);
    const next = current.filter((i) => i.name !== record.name || i.type !== record.type);
    if (current.length === next.length) {
      return [];
    }

    return [
      {
        path: "dns.extra_records",
        value: next,
      },
    ];
  });

  return true;
}

export async function loadHeadscaleConfig(path?: string, dnsPath?: string) {
  if (!path) {
    log.debug("config", "No Headscale configuration file was provided");
    return createHeadscaleConfig("no");
  }

  log.debug("config", "Loading Headscale configuration file: %s", path);
  const { r, w } = await validateConfigPath(path);
  if (!r) {
    return createHeadscaleConfig("no");
  }

  const document = await loadConfigFile(path);
  if (!document) {
    return createHeadscaleConfig("no");
  }

  const rawConfig = document.toJSON();
  const parsedConfig = v.parse(headscaleConfigSchema, rawConfig);
  const conflict = v.safeParse(extraRecordsConflictSchema, rawConfig);
  const extraRecordsPath = parsedConfig.dns.extra_records_path;

  if (conflict.success && conflict.output.dns?.extra_records && extraRecordsPath) {
    log.warn(
      "config",
      "Both dns.extra_records and dns.extra_records_path are set; Headplane will use the JSON records file",
    );
  }

  const dns = await loadHeadscaleDNS(dnsPath ?? extraRecordsPath);
  if (dns && !extraRecordsPath) {
    log.error(
      "config",
      "Using separate DNS config file but dns.extra_records_path is not set in Headscale config",
    );
    log.error("config", "Please set `dns.extra_records_path` in the Headscale config");
    log.error("config", "Or remove `headscale.dns_records_path` from the Headplane config");

    // A caller asking for a separate DNS file while Headscale is not configured
    // to read one is a configuration mistake, not a reason to stop the process:
    // the error reaches the caller, which decides what to do with it.
    throw new Error(
      "Using separate DNS config file but dns.extra_records_path is not set in Headscale config. " +
        "Please set `dns.extra_records_path` in the Headscale config, or remove `headscale.dns_records_path` from the Headplane config",
    );
  }

  return createHeadscaleConfig(w ? "rw" : "ro", dns, document, path);
}

async function validateConfigPath(path: string) {
  let resolved: string;

  try {
    // Resolve symlinks first. A symlink is accepted, but the target has to be a
    // regular file: a directory (or a symlink to one) where a configuration
    // file is required must be rejected instead of reaching `readFile`.
    resolved = await realpath(path);
    const info = await stat(resolved);
    if (!info.isFile()) {
      log.error("config", "Unable to read a Headscale configuration file at %s", path);
      log.error("config", "The path is not a regular file: %s", resolved);
      return { w: false, r: false };
    }

    await access(resolved, constants.F_OK | constants.R_OK);
    log.info("config", "Found a valid Headscale configuration file at %s", path);
  } catch (error) {
    log.error("config", "Unable to read a Headscale configuration file at %s", path);
    log.error("config", "%s", error);
    return { w: false, r: false };
  }

  try {
    await access(resolved, constants.F_OK | constants.W_OK);
    return { w: true, r: true };
  } catch {
    log.warn("config", "Headscale configuration file at %s is not writable", path);
    return { w: false, r: true };
  }
}

async function loadConfigFile(path: string) {
  log.debug("config", "Reading Headscale configuration file at %s", path);
  try {
    const data = await readFile(path, "utf8");
    const configYaml = parseDocument(data);
    if (configYaml.errors.length > 0) {
      log.error("config", "Cannot parse Headscale configuration file at %s", path);
      for (const error of configYaml.errors) {
        log.error("config", ` - ${error.toString()}`);
      }

      return false;
    }

    return configYaml;
  } catch (e) {
    log.error("config", "Error reading Headscale configuration file at %s", path);
    log.error("config", "%s", e);
    return false;
  }
}
