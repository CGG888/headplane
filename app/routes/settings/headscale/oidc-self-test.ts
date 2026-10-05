// MARK: OIDC self-test
//
// The read-only half of the "Test OIDC configuration" button. It checks what
// Headscale itself compares against the identity provider: the issuer URL, the
// discovery document at `/.well-known/openid-configuration`, the endpoints the
// document advertises, and the client credentials in the `oidc:` block.
//
// Nothing here logs in and nothing is written to disk. Every network read is
// fail-soft: a timeout, a DNS failure, or a document that does not parse is a
// *result* the panel renders, never an error thrown out of the action. The
// client secret is never read at all, only whether one is configured.

import type { TranslationKey } from "~/i18n";

/** Short enough that an unreachable provider cannot stall the settings page. */
export const OIDC_SELF_TEST_TIMEOUT_MS = 5_000;

export type OidcSelfTestStatus = "pass" | "warn" | "fail" | "skip";

/** Stable identity of a check; also the suffix of its label key. */
export type OidcSelfTestCheckId =
  | "issuer"
  | "discovery"
  | "endpoints"
  | "jwks"
  | "scopes"
  | "pkce"
  | "credentials"
  | "access"
  | "callback";

export interface OidcSelfTestCheck {
  id: OidcSelfTestCheckId;
  status: OidcSelfTestStatus;
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
  /** A URL or a raw provider error, shown verbatim under the message. */
  detail?: string;
}

export interface OidcSelfTestReport {
  checks: OidcSelfTestCheck[];
  /** Checks that passed, out of the ones that could run at all. */
  passed: number;
  total: number;
  skipped: number;
}

/**
 * The `oidc:` block plus Headplane's own `server.base_url`. Values are `unknown`
 * because a hand-written config file can put anything in them; the coercers
 * below decide what counts, so a malformed file produces a failed check instead
 * of a crash.
 */
export interface OidcSelfTestConfig {
  issuer: unknown;
  clientId: unknown;
  hasInlineClientSecret: boolean;
  clientSecretPath: unknown;
  scope: unknown;
  pkceEnabled: boolean;
  pkceMethod: unknown;
  allowedDomains: unknown;
  allowedGroups: unknown;
  allowedUsers: unknown;
  baseUrl: unknown;
}

export interface OidcSelfTestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** The three endpoints Headscale's sign-in flow cannot work without. */
export const REQUIRED_ENDPOINTS = ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const;

/** Scopes Headplane needs beyond `openid` to read the claims it displays. */
export const OPTIONAL_CLAIM_SCOPES = ["email", "profile"] as const;

/** A non-empty, trimmed string, or `undefined` for anything else. */
export function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A list of non-empty strings; every other JSON shape collapses to `[]`. */
export function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];
  for (const entry of value) {
    const text = coerceString(entry);
    if (text !== undefined) {
      out.push(text);
    }
  }

  return out;
}

/** `scope` may be an array or a single space/comma separated string. */
export function coerceScopeList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return coerceStringList(value);
}

/** How many signing keys a JWKS body carries; a malformed body counts as none. */
export function countSigningKeys(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Headscale builds its discovery URL from the issuer with a trailing slash
 * trimmed, and compares the issuer in the document the same way.
 */
export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

/** Any absolute URL, including schemes OIDC cannot use. */
export function parseAbsoluteUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** The issuer as a URL, or `undefined` when it is not an absolute http(s) URL. */
export function parseIssuerUrl(issuer: string): URL | undefined {
  const url = parseAbsoluteUrl(issuer);
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return undefined;
  }

  return url;
}

/**
 * `/.well-known/openid-configuration`, resolved the way Headscale's OIDC
 * library does it: an issuer with a path keeps that path as the prefix.
 */
export function buildDiscoveryUrl(issuer: URL | string): string | undefined {
  const url = typeof issuer === "string" ? parseIssuerUrl(issuer) : issuer;
  if (url === undefined) {
    return undefined;
  }

  if (url.pathname === "/" || url.pathname === "") {
    return new URL("/.well-known/openid-configuration", url).href;
  }

  return new URL(`${url.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`, url).href;
}

/** The redirect URI Headplane registers with the provider. */
export function buildCallbackUrl(baseUrl: string, prefix: string = __PREFIX__): string | undefined {
  try {
    return new URL(`${prefix}/oidc/callback`, baseUrl).href;
  } catch {
    return undefined;
  }
}

/** The advertised endpoints the document is missing. */
export function missingEndpoints(document: Record<string, unknown> | undefined): string[] {
  if (document === undefined) {
    return [...REQUIRED_ENDPOINTS];
  }

  return REQUIRED_ENDPOINTS.filter((key) => coerceString(document[key]) === undefined);
}

/** Passed/total/skipped for the summary line. Skipped checks never count. */
export function summarizeChecks(
  checks: OidcSelfTestCheck[],
): Pick<OidcSelfTestReport, "passed" | "total" | "skipped"> {
  const skipped = checks.filter((check) => check.status === "skip").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  return { passed, total: checks.length - skipped, skipped };
}

interface JsonProbe {
  ok: boolean;
  error?: string;
  body?: Record<string, unknown>;
}

interface ProviderProbes {
  discovery: JsonProbe;
  jwks: JsonProbe | undefined;
}

/** Reads a JSON object, turning every failure mode into a probe result. */
async function fetchJson(url: string, options: OidcSelfTestOptions): Promise<JsonProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? OIDC_SELF_TEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "the response is not a JSON object" };
    }

    return { ok: true, body: body as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetches the discovery document and, as soon as its `jwks_uri` is known, the
 * JWKS behind it. The two requests share one `Promise.all`, so the panel waits
 * for the dependency chain once instead of once per check.
 */
export async function probeProvider(
  discoveryUrl: string,
  options: OidcSelfTestOptions = {},
): Promise<ProviderProbes> {
  const discoveryPromise = fetchJson(discoveryUrl, options);
  const jwksPromise = discoveryPromise.then((discovery) => {
    const jwksUri = coerceString(discovery.body?.jwks_uri);
    return jwksUri === undefined ? undefined : fetchJson(jwksUri, options);
  });

  const [discovery, jwks] = await Promise.all([discoveryPromise, jwksPromise]);
  return { discovery, jwks };
}

export async function runOidcSelfTest(
  config: OidcSelfTestConfig,
  options: OidcSelfTestOptions = {},
): Promise<OidcSelfTestReport> {
  const issuer = coerceString(config.issuer) ?? "";
  const issuerUrl = parseIssuerUrl(issuer);
  const discoveryUrl = issuerUrl === undefined ? undefined : buildDiscoveryUrl(issuerUrl);
  const probes =
    discoveryUrl === undefined ? undefined : await probeProvider(discoveryUrl, options);
  const discoveryDocument = probes?.discovery.ok === true ? probes.discovery.body : undefined;
  const jwksUri = coerceString(discoveryDocument?.jwks_uri);

  const checks: OidcSelfTestCheck[] = [
    checkIssuer(issuer, parseAbsoluteUrl(issuer)),
    checkDiscovery(issuer, discoveryUrl, probes?.discovery),
    checkEndpoints(probes?.discovery),
    checkJwks(probes?.jwks, jwksUri),
    checkScopes(config.scope),
    checkPkce(config, probes?.discovery),
    checkCredentials(config),
    checkAccess(config),
    checkCallback(config.baseUrl),
  ];

  return { checks, ...summarizeChecks(checks) };
}

function checkIssuer(configured: string, url: URL | undefined): OidcSelfTestCheck {
  if (configured.length === 0) {
    return {
      id: "issuer",
      status: "fail",
      messageKey: "settings.headscale.selfTestIssuerMissing",
    };
  }

  if (url === undefined) {
    return {
      id: "issuer",
      status: "fail",
      messageKey: "settings.headscale.selfTestIssuerNotAbsolute",
      detail: configured,
    };
  }

  if (url.protocol === "https:") {
    return {
      id: "issuer",
      status: "pass",
      messageKey: "settings.headscale.selfTestIssuerOk",
      detail: url.href,
    };
  }

  if (url.protocol === "http:") {
    return {
      id: "issuer",
      status: "warn",
      messageKey: "settings.headscale.selfTestIssuerInsecure",
      params: { scheme: "http" },
      detail: url.href,
    };
  }

  return {
    id: "issuer",
    status: "fail",
    messageKey: "settings.headscale.selfTestIssuerUnsupportedScheme",
    params: { scheme: url.protocol.replace(":", "") },
    detail: url.href,
  };
}

function checkDiscovery(
  configuredIssuer: string,
  discoveryUrl: string | undefined,
  probe: JsonProbe | undefined,
): OidcSelfTestCheck {
  if (discoveryUrl === undefined) {
    return {
      id: "discovery",
      status: "skip",
      messageKey: "settings.headscale.selfTestDiscoverySkipped",
    };
  }

  if (probe?.ok !== true) {
    return {
      id: "discovery",
      status: "fail",
      messageKey: "settings.headscale.selfTestDiscoveryUnreachable",
      params: { error: probe?.error ?? "unknown error" },
      detail: discoveryUrl,
    };
  }

  const documentIssuer = coerceString(probe.body?.issuer);
  if (documentIssuer === undefined) {
    return {
      id: "discovery",
      status: "fail",
      messageKey: "settings.headscale.selfTestDiscoveryNoIssuer",
      detail: discoveryUrl,
    };
  }

  if (normalizeIssuer(documentIssuer) !== normalizeIssuer(configuredIssuer)) {
    return {
      id: "discovery",
      status: "fail",
      messageKey: "settings.headscale.selfTestDiscoveryMismatch",
      params: { actual: documentIssuer, expected: configuredIssuer },
      detail: discoveryUrl,
    };
  }

  return {
    id: "discovery",
    status: "pass",
    messageKey: "settings.headscale.selfTestDiscoveryOk",
    detail: discoveryUrl,
  };
}

function checkEndpoints(probe: JsonProbe | undefined): OidcSelfTestCheck {
  if (probe?.ok !== true) {
    return {
      id: "endpoints",
      status: "skip",
      messageKey: "settings.headscale.selfTestSkippedPrerequisite",
    };
  }

  const missing = missingEndpoints(probe.body);
  if (missing.length > 0) {
    return {
      id: "endpoints",
      status: "fail",
      messageKey: "settings.headscale.selfTestEndpointsMissing",
      params: { endpoints: missing.join(", ") },
    };
  }

  return {
    id: "endpoints",
    status: "pass",
    messageKey: "settings.headscale.selfTestEndpointsOk",
  };
}

function checkJwks(probe: JsonProbe | undefined, jwksUri: string | undefined): OidcSelfTestCheck {
  if (jwksUri === undefined || probe === undefined) {
    return {
      id: "jwks",
      status: "skip",
      messageKey: "settings.headscale.selfTestSkippedPrerequisite",
    };
  }

  if (!probe.ok) {
    return {
      id: "jwks",
      status: "fail",
      messageKey: "settings.headscale.selfTestJwksUnreachable",
      params: { error: probe.error ?? "unknown error" },
      detail: jwksUri,
    };
  }

  if (countSigningKeys(probe.body?.keys) === 0) {
    return {
      id: "jwks",
      status: "fail",
      messageKey: "settings.headscale.selfTestJwksEmpty",
      detail: jwksUri,
    };
  }

  return {
    id: "jwks",
    status: "pass",
    messageKey: "settings.headscale.selfTestJwksOk",
    detail: jwksUri,
  };
}

function checkScopes(scope: unknown): OidcSelfTestCheck {
  const scopes = coerceScopeList(scope);

  if (!scopes.includes("openid")) {
    return {
      id: "scopes",
      status: "fail",
      messageKey: "settings.headscale.selfTestScopesMissingOpenid",
      detail: scopes.join(" "),
    };
  }

  const missing = OPTIONAL_CLAIM_SCOPES.filter((entry) => !scopes.includes(entry));
  if (missing.length > 0) {
    return {
      id: "scopes",
      status: "warn",
      messageKey: "settings.headscale.selfTestScopesMissingClaims",
      params: { scopes: missing.join(", ") },
      detail: scopes.join(" "),
    };
  }

  return {
    id: "scopes",
    status: "pass",
    messageKey: "settings.headscale.selfTestScopesOk",
    detail: scopes.join(" "),
  };
}

function checkPkce(config: OidcSelfTestConfig, probe: JsonProbe | undefined): OidcSelfTestCheck {
  const method = coerceString(config.pkceMethod) ?? "S256";

  if (!config.pkceEnabled) {
    return {
      id: "pkce",
      status: "skip",
      messageKey: "settings.headscale.selfTestPkceDisabled",
    };
  }

  if (probe?.ok !== true) {
    return {
      id: "pkce",
      status: "skip",
      messageKey: "settings.headscale.selfTestSkippedPrerequisite",
    };
  }

  const advertised = coerceStringList(probe.body?.code_challenge_methods_supported);
  if (advertised.length === 0) {
    return {
      id: "pkce",
      status: "warn",
      messageKey: "settings.headscale.selfTestPkceUnknown",
      params: { method },
    };
  }

  if (!advertised.includes(method)) {
    return {
      id: "pkce",
      status: "warn",
      messageKey: "settings.headscale.selfTestPkceMismatch",
      params: { advertised: advertised.join(", "), method },
    };
  }

  return {
    id: "pkce",
    status: "pass",
    messageKey: "settings.headscale.selfTestPkceOk",
    params: { method },
  };
}

function checkCredentials(config: OidcSelfTestConfig): OidcSelfTestCheck {
  const clientId = coerceString(config.clientId);
  const secretPath = coerceString(config.clientSecretPath);

  if (clientId === undefined) {
    return {
      id: "credentials",
      status: "fail",
      messageKey: "settings.headscale.selfTestCredentialsMissingClientId",
    };
  }

  if (!config.hasInlineClientSecret && secretPath === undefined) {
    return {
      id: "credentials",
      status: "fail",
      messageKey: "settings.headscale.selfTestCredentialsMissingSecret",
    };
  }

  if (config.hasInlineClientSecret && secretPath !== undefined) {
    return {
      id: "credentials",
      status: "warn",
      messageKey: "settings.headscale.selfTestCredentialsBoth",
    };
  }

  return {
    id: "credentials",
    status: "pass",
    messageKey: "settings.headscale.selfTestCredentialsOk",
  };
}

function checkAccess(config: OidcSelfTestConfig): OidcSelfTestCheck {
  // Headscale admits every authenticated account when all three allow-lists are
  // empty, which is a valid configuration and a risky one.
  const used = (
    [
      ["allowed_domains", coerceStringList(config.allowedDomains)],
      ["allowed_groups", coerceStringList(config.allowedGroups)],
      ["allowed_users", coerceStringList(config.allowedUsers)],
    ] as const
  )
    .filter(([, values]) => values.length > 0)
    .map(([name]) => name);

  if (used.length === 0) {
    return {
      id: "access",
      status: "warn",
      messageKey: "settings.headscale.selfTestAccessMissing",
    };
  }

  return {
    id: "access",
    status: "pass",
    messageKey: "settings.headscale.selfTestAccessOk",
    params: { lists: used.join(", ") },
  };
}

function checkCallback(baseUrl: unknown): OidcSelfTestCheck {
  const configured = coerceString(baseUrl);
  const callbackUrl = configured === undefined ? undefined : buildCallbackUrl(configured);

  if (callbackUrl === undefined) {
    return {
      id: "callback",
      status: "warn",
      messageKey: "settings.headscale.selfTestCallbackUnknown",
    };
  }

  return {
    id: "callback",
    status: "pass",
    messageKey: "settings.headscale.selfTestCallbackOk",
    params: { url: callbackUrl },
  };
}
