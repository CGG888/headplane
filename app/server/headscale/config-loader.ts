import { constants, access, readFile, writeFile } from "node:fs/promises";
import { exit } from "node:process";

import * as v from "valibot";
import { Document, parseDocument } from "yaml";

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
  dnsRecords: () => DNSRecord[];
  patch: (patches: PatchConfig[]) => Promise<void>;
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
    dnsRecords: () => dnsRecords(state),
    patch: (patches) => patchHeadscaleConfig(state, patches),
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
  return {
    issuer: readString(oidc.issuer),
    clientId: readString(oidc.client_id),
    hasClientSecret:
      readString(oidc.client_secret).length > 0 || readString(oidc.client_secret_path).length > 0,
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
  await writeFile(config.path, config.document.toString(), "utf8");
  config.config = config.document.toJSON();
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

  await patchHeadscaleConfig(config, [
    {
      path: "dns.extra_records",
      value: [...existing, record],
    },
  ]);

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

  await patchHeadscaleConfig(config, [
    {
      path: "dns.extra_records",
      value: filtered,
    },
  ]);

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

    exit(1);
  }

  return createHeadscaleConfig(w ? "rw" : "ro", dns, document, path);
}

async function validateConfigPath(path: string) {
  try {
    await access(path, constants.F_OK | constants.R_OK);
    log.info("config", "Found a valid Headscale configuration file at %s", path);
  } catch (error) {
    log.error("config", "Unable to read a Headscale configuration file at %s", path);
    log.error("config", "%s", error);
    return { w: false, r: false };
  }

  try {
    await access(path, constants.F_OK | constants.W_OK);
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
