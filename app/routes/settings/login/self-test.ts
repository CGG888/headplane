// MARK: HeadplaneCN console-login OIDC self-test
//
// The evaluator behind the "Test console login" card on /settings/login. It
// checks the `oidc:` block that signs people in to HeadplaneCN *itself* — not
// the `oidc:` block Headscale uses for its own clients, which has its own test
// on the Headscale settings page.
//
// Everything here is a pure function over values that were already collected,
// so the unit tests need no network. The only impure pieces are `probeIssuer`,
// which performs the discovery fetch, and `supportsEs384Verification`, which
// asks the runtime whether it can verify a P-384 (ES384) signature. The client
// secret is never part of any input or output: only whether one is configured
// is ever reported.

import type { TranslationKey } from "~/i18n";

/** Short enough that an unreachable provider cannot stall the settings page. */
export const LOGIN_SELF_TEST_TIMEOUT_MS = 5_000;

export type LoginSelfTestStatus = "pass" | "warn" | "fail" | "skip";

/** Stable identity of a check; also the suffix of its label key. */
export type LoginSelfTestCheckId =
  | "discovery"
  | "issuer"
  | "scopes"
  | "signingAlg"
  | "endSession"
  | "tokenAuth";

export interface LoginSelfTestCheck {
  id: LoginSelfTestCheckId;
  status: LoginSelfTestStatus;
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
  /** The concrete value the check saw, shown verbatim under the message. */
  detail?: string;
  /** The exact line to paste into the config file, for the failures that have one. */
  fix?: string;
}

export interface LoginSelfTestNote {
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
}

export interface LoginSelfTestReport {
  checks: LoginSelfTestCheck[];
  /** Checks that passed, out of the ones that could run at all. */
  passed: number;
  total: number;
  skipped: number;
  /** All checks passed, at least one warned, or at least one failed. */
  verdict: "good" | "warn" | "fail";
  notes: LoginSelfTestNote[];
}

/**
 * The values the checks compare against. They come straight from HeadplaneCN's
 * own config file; `unknown` is avoided by coercing in the caller, which is why
 * every field is optional — a missing `oidc:` block is a valid state to test.
 */
export interface LoginSelfTestConfig {
  issuer?: string;
  scope?: string;
  /** `oidc.end_session_endpoint`, which overrides the discovered value. */
  endSessionEndpoint?: string;
  postLogoutRedirectUri?: string;
  /** `logout_idp` or its older spelling, already resolved by the caller. */
  idpLogoutEnabled: boolean;
  tokenEndpointAuthMethod?: string;
  baseUrl?: string;
}

/** What reading the discovery document produced, success or failure. */
export interface LoginSelfTestProbe {
  url?: string;
  ok: boolean;
  /** The HTTP status, when a response arrived at all. */
  status?: number;
  /** The fetch, DNS, or certificate error, when no response arrived. */
  error?: string;
  document?: Record<string, unknown>;
}

export interface LoginSelfTestRuntime {
  /** Whether this runtime can verify an ES384 (ECDSA P-384) signature. */
  es384: boolean;
}

export interface LoginSelfTestInput {
  config: LoginSelfTestConfig;
  probe: LoginSelfTestProbe;
  runtime: LoginSelfTestRuntime;
}

/** Scopes HeadplaneCN needs beyond `openid` for the claims it displays. */
export const CLAIM_SCOPES = ["profile", "email"] as const;

/** The method the app tries first when the config does not pin one. */
export const DEFAULT_TOKEN_AUTH_METHOD = "client_secret_post";

/** Signatures Node's WebCrypto can verify without the P-384 probe. */
const ALWAYS_VERIFIABLE_ALGS = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES512",
  "EdDSA",
]);

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

/** `oidc.scope` is a single space-separated string. */
export function coerceScopeList(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Whether this runtime could verify a token signed with `alg`. */
export function canVerifyAlgorithm(alg: string, runtime: LoginSelfTestRuntime): boolean {
  if (alg === "ES384") {
    return runtime.es384;
  }

  return ALWAYS_VERIFIABLE_ALGS.has(alg);
}

/** Passed/total/skipped and the single overall verdict. */
export function summarizeChecks(
  checks: LoginSelfTestCheck[],
): Pick<LoginSelfTestReport, "passed" | "total" | "skipped" | "verdict"> {
  const skipped = checks.filter((check) => check.status === "skip").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.some((check) => check.status === "fail");
  const warned = checks.some((check) => check.status === "warn");

  return {
    passed,
    total: checks.length - skipped,
    skipped,
    verdict: failed ? "fail" : warned ? "warn" : "good",
  };
}

/**
 * Asks the runtime for a P-384 key pair and verifies one SHA-384 signature with
 * it — the same operation `jose` performs for an ES384 ID token. A runtime that
 * cannot do this cannot sign anyone in against a provider that only offers
 * ES384. Fail-soft: any error means "no".
 */
export async function supportsEs384Verification(): Promise<boolean> {
  try {
    const keyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-384" },
      false,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const payload = new TextEncoder().encode("headplanecn-es384-probe");
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-384" },
      keyPair.privateKey,
      payload,
    );

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      keyPair.publicKey,
      signature,
      payload,
    );
  } catch {
    return false;
  }
}

/** `/.well-known/openid-configuration`, resolved the way the login flow does. */
export function buildDiscoveryUrl(issuer: string | undefined): string | undefined {
  const value = coerceString(issuer);
  if (value === undefined) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  if (url.pathname === "/" || url.pathname === "") {
    return new URL("/.well-known/openid-configuration", url).href;
  }

  return new URL(`${url.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`, url).href;
}

/**
 * Reads the discovery document, turning every failure mode into a probe result.
 * The HTTP status is kept separately from the error text so the panel can show
 * both "what came back" and "what went wrong".
 */
export async function probeIssuer(
  issuer: string | undefined,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LoginSelfTestProbe> {
  const url = buildDiscoveryUrl(issuer);
  if (url === undefined) {
    return {
      url: coerceString(issuer),
      ok: false,
      error: "the issuer is not an absolute http(s) URL",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? LOGIN_SELF_TEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { url, ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const body: unknown = await response.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return {
        url,
        ok: false,
        status: response.status,
        error: "the response is not a JSON object",
      };
    }

    return { url, ok: true, status: response.status, document: body as Record<string, unknown> };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function evaluateLoginSelfTest(input: LoginSelfTestInput): LoginSelfTestReport {
  const { config, probe, runtime } = input;
  const document = probe.ok ? probe.document : undefined;

  const checks: LoginSelfTestCheck[] = [
    checkDiscovery(config, probe),
    checkIssuer(config, document),
    checkScopes(config, document),
    checkSigningAlgorithm(document, runtime),
    checkEndSession(config, document, probe),
    checkTokenAuth(config, document),
  ];

  return {
    checks,
    ...summarizeChecks(checks),
    notes: [
      { messageKey: "settings.login.restartNotice" },
      { messageKey: "settings.login.selfTestSecretNote" },
    ],
  };
}

function checkDiscovery(
  config: LoginSelfTestConfig,
  probe: LoginSelfTestProbe,
): LoginSelfTestCheck {
  const issuer = coerceString(config.issuer);
  if (issuer === undefined) {
    return {
      id: "discovery",
      status: "skip",
      messageKey: "settings.login.selfTestDiscoverySkipped",
    };
  }

  if (!probe.ok) {
    return {
      id: "discovery",
      status: "fail",
      messageKey: "settings.login.selfTestDiscoveryFailed",
      params: {
        url: probe.url ?? issuer,
        status: probe.status ?? "—",
        error: probe.error ?? "unknown error",
      },
      detail: probe.url ?? issuer,
    };
  }

  return {
    id: "discovery",
    status: "pass",
    messageKey: "settings.login.selfTestDiscoveryOk",
    params: { url: probe.url ?? issuer, status: probe.status ?? 200 },
    detail: probe.url ?? issuer,
  };
}

function checkIssuer(
  config: LoginSelfTestConfig,
  document: Record<string, unknown> | undefined,
): LoginSelfTestCheck {
  if (document === undefined) {
    return {
      id: "issuer",
      status: "skip",
      messageKey: "settings.login.selfTestSkippedPrerequisite",
    };
  }

  const configured = coerceString(config.issuer);
  if (configured === undefined) {
    return {
      id: "issuer",
      status: "fail",
      messageKey: "settings.login.selfTestIssuerMissing",
      fix: "issuer: https://your-provider.example.com",
    };
  }

  const reported = coerceString(document.issuer);
  if (reported === undefined) {
    return {
      id: "issuer",
      status: "fail",
      messageKey: "settings.login.selfTestIssuerNotReported",
      params: { expected: configured },
      detail: configured,
      fix: `issuer: ${configured}`,
    };
  }

  // Character for character: `jose` compares `iss` with `oidc.issuer` exactly,
  // so a trailing slash or a different tenant path is a failed sign-in.
  if (reported !== configured) {
    return {
      id: "issuer",
      status: "fail",
      messageKey: "settings.login.selfTestIssuerMismatch",
      params: { actual: reported, expected: configured },
      detail: `iss: ${reported}`,
      fix: `issuer: ${reported}`,
    };
  }

  return {
    id: "issuer",
    status: "pass",
    messageKey: "settings.login.selfTestIssuerOk",
    params: { issuer: configured },
    detail: `iss: ${reported}`,
  };
}

function checkScopes(
  config: LoginSelfTestConfig,
  document: Record<string, unknown> | undefined,
): LoginSelfTestCheck {
  if (document === undefined) {
    return {
      id: "scopes",
      status: "skip",
      messageKey: "settings.login.selfTestSkippedPrerequisite",
    };
  }

  const configured = coerceScopeList(config.scope);
  const advertised = coerceStringList(document.scopes_supported);
  const requested = configured.join(" ");

  if (advertised.length === 0) {
    return {
      id: "scopes",
      status: "warn",
      messageKey: "settings.login.selfTestScopesUnknown",
      params: { scopes: requested || "—" },
      detail: requested,
    };
  }

  const missing = configured.filter((scope) => !advertised.includes(scope));
  if (missing.length > 0) {
    return {
      id: "scopes",
      status: "fail",
      messageKey: "settings.login.selfTestScopesMissing",
      params: { missing: missing.join(" "), advertised: advertised.join(" ") },
      detail: `scopes_supported: ${advertised.join(" ")}`,
      fix: `scope: "${[...new Set([...configured, ...missing])].join(" ")}"`,
    };
  }

  // Advertising a scope is not the same as granting it: Logto (among others)
  // lists profile and email but only returns the claims once the application
  // has been granted those user scopes.
  const claimScopes = CLAIM_SCOPES.filter((scope) => configured.includes(scope));
  if (claimScopes.length > 0) {
    return {
      id: "scopes",
      status: "warn",
      messageKey: "settings.login.selfTestScopesClaimGrant",
      params: { scopes: claimScopes.join(" ") },
      detail: `scopes_supported: ${advertised.join(" ")}`,
    };
  }

  return {
    id: "scopes",
    status: "pass",
    messageKey: "settings.login.selfTestScopesOk",
    params: { scopes: requested },
    detail: `scopes_supported: ${advertised.join(" ")}`,
  };
}

function checkSigningAlgorithm(
  document: Record<string, unknown> | undefined,
  runtime: LoginSelfTestRuntime,
): LoginSelfTestCheck {
  if (document === undefined) {
    return {
      id: "signingAlg",
      status: "skip",
      messageKey: "settings.login.selfTestSkippedPrerequisite",
    };
  }

  const advertised = coerceStringList(document.id_token_signing_alg_values_supported);
  if (advertised.length === 0) {
    return {
      id: "signingAlg",
      status: "warn",
      messageKey: "settings.login.selfTestSigningAlgUnknown",
    };
  }

  const algos = advertised.join(" ");
  const verifiable = advertised.filter((alg) => canVerifyAlgorithm(alg, runtime));
  const es384Advertised = advertised.includes("ES384");

  // ES384 first: it is the case operators actually hit, and the fix differs
  // from "none of these algorithms can be verified at all".
  if (es384Advertised && !runtime.es384) {
    return {
      id: "signingAlg",
      status: "fail",
      messageKey: "settings.login.selfTestSigningAlgEs384Unsupported",
      params: { algos },
      detail: `id_token_signing_alg_values_supported: ${algos}`,
    };
  }

  if (verifiable.length === 0) {
    return {
      id: "signingAlg",
      status: "fail",
      messageKey: "settings.login.selfTestSigningAlgUnverifiable",
      params: { algos },
      detail: `id_token_signing_alg_values_supported: ${algos}`,
    };
  }

  if (es384Advertised) {
    return {
      id: "signingAlg",
      status: "pass",
      messageKey: "settings.login.selfTestSigningAlgOkEs384",
      params: { algos },
      detail: `id_token_signing_alg_values_supported: ${algos}`,
    };
  }

  return {
    id: "signingAlg",
    status: "pass",
    messageKey: "settings.login.selfTestSigningAlgOk",
    params: { algos },
    detail: `id_token_signing_alg_values_supported: ${algos}`,
  };
}

function checkEndSession(
  config: LoginSelfTestConfig,
  document: Record<string, unknown> | undefined,
  probe: LoginSelfTestProbe,
): LoginSelfTestCheck {
  const configured = coerceString(config.endSessionEndpoint);
  const discovered = coerceString(document?.end_session_endpoint);

  const source = configured !== undefined ? "oidc.end_session_endpoint" : "end_session_endpoint";
  const endpoint = configured ?? discovered;

  if (endpoint === undefined) {
    // Without a discovery document we cannot tell whether the provider offers
    // one; with one, its absence is a definite finding.
    if (!probe.ok) {
      return {
        id: "endSession",
        status: "skip",
        messageKey: "settings.login.selfTestSkippedPrerequisite",
      };
    }

    return {
      id: "endSession",
      status: "fail",
      messageKey: "settings.login.selfTestEndSessionMissing",
      fix: "end_session_endpoint: https://your-provider.example.com/logout",
    };
  }

  let isHttps = false;
  try {
    isHttps = new URL(endpoint).protocol === "https:";
  } catch {
    isHttps = false;
  }

  if (!isHttps) {
    return {
      id: "endSession",
      status: "fail",
      messageKey: "settings.login.selfTestEndSessionInsecure",
      params: { endpoint, source },
      detail: `${source}: ${endpoint}`,
    };
  }

  if (!config.idpLogoutEnabled) {
    return {
      id: "endSession",
      status: "warn",
      messageKey: "settings.login.selfTestEndSessionDisabled",
      params: { endpoint, source, postLogout: postLogoutTarget(config) },
      detail: `${source}: ${endpoint}`,
      fix: "logout_idp: true",
    };
  }

  return {
    id: "endSession",
    status: "pass",
    messageKey: "settings.login.selfTestEndSessionOk",
    params: { endpoint, source, postLogout: postLogoutTarget(config) },
    detail: `${source}: ${endpoint}`,
  };
}

/** Where the provider is asked to send the browser after ending its session. */
function postLogoutTarget(config: LoginSelfTestConfig): string {
  return (
    coerceString(config.postLogoutRedirectUri) ??
    `${coerceString(config.baseUrl) ?? ""}${__PREFIX__}/login`
  );
}

function checkTokenAuth(
  config: LoginSelfTestConfig,
  document: Record<string, unknown> | undefined,
): LoginSelfTestCheck {
  if (document === undefined) {
    return {
      id: "tokenAuth",
      status: "skip",
      messageKey: "settings.login.selfTestSkippedPrerequisite",
    };
  }

  const pinned = coerceString(config.tokenEndpointAuthMethod);
  const used = pinned ?? DEFAULT_TOKEN_AUTH_METHOD;
  const advertised = coerceStringList(document.token_endpoint_auth_methods_supported);

  if (advertised.length === 0) {
    return {
      id: "tokenAuth",
      status: "warn",
      messageKey: "settings.login.selfTestTokenAuthUnknown",
      params: { used },
      detail: `token_endpoint_auth_method: ${pinned ?? "not set"}`,
    };
  }

  const methods = advertised.join(" ");
  if (!advertised.includes(used)) {
    return {
      id: "tokenAuth",
      status: "fail",
      messageKey: "settings.login.selfTestTokenAuthMismatch",
      params: { used, advertised: methods },
      detail: `token_endpoint_auth_methods_supported: ${methods}`,
      fix: `token_endpoint_auth_method: "${advertised[0]}"`,
    };
  }

  return {
    id: "tokenAuth",
    status: "pass",
    messageKey: "settings.login.selfTestTokenAuthOk",
    params: { used, advertised: methods },
    detail: `token_endpoint_auth_methods_supported: ${methods}`,
  };
}
