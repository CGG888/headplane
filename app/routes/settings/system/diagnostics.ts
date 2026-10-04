// MARK: System diagnostics
//
// Pure computation behind the system status page. Everything the page renders
// about the health of the Headscale server is derived here from plain values so
// the rules can be unit tested without React, the i18n provider, or a running
// Headscale instance. The module only produces translation *keys*; the page
// turns them into text in the caller's locale.

import type { TranslationKey } from "~/i18n";
import {
  formatServerVersion,
  gte,
  type ServerVersion,
} from "~/server/headscale/api/server-version";

export type DiagnosticStatus = "pass" | "warning" | "fail";

export type DiagnosticId =
  | "reachable"
  | "apiKey"
  | "version"
  | "policyMode"
  | "oidc"
  | "trustedProxies"
  | "configAccess"
  | "integration";

/** How the configured API key answered the last probe. */
export type ApiKeyStatus = "valid" | "invalid" | "unknown";

/** Whether Headscale's configuration file declares an OIDC block. */
export type OidcStatus = "configured" | "missing" | "unknown";

/** What `integration.onConfigChange` does for the configured integration. */
export type IntegrationAction = "reload" | "restart";

export interface DiagnosticLink {
  to: string;
  labelKey: TranslationKey;
}

export interface Diagnostic {
  id: DiagnosticId;
  status: DiagnosticStatus;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** Values for `{placeholders}` in the localized body. */
  vars?: Record<string, string | number>;
  link?: DiagnosticLink;
}

/**
 * The oldest Headscale that supports the features Headplane documents: the
 * agent's tag-only pre-auth keys (0.28.0) and everything built on top of it.
 */
export const MINIMUM_VERSION = "0.28.0";

/**
 * 0.29.2 is the first release whose browser SSH prerequisites actually work
 * (0.29 beta through 0.29.1 reject the Tailscale WASM WebSocket request), so
 * anything older gets a warning rather than a failure.
 */
export const RECOMMENDED_VERSION = "0.29.2";

/**
 * Every fixable check points at the page that owns the setting. Headscale's own
 * config file holds the policy mode, the OIDC block, the trusted proxies, and
 * the file's readability, so they all share one link.
 */
const SETTINGS_LINK: DiagnosticLink = {
  to: "/settings/headscale",
  labelKey: "settings.system.reviewSettings",
};

const API_KEY_BODY_KEYS: Record<ApiKeyStatus, TranslationKey> = {
  valid: "settings.system.checks.apiKey.pass",
  invalid: "settings.system.checks.apiKey.invalid",
  unknown: "settings.system.checks.apiKey.unknown",
};

export interface DiagnosticsInput {
  reachable: boolean;
  apiKey: ApiKeyStatus;
  version: ServerVersion;
  configReadable: boolean;
  configWritable: boolean;
  policyMode: "file" | "database";
  oidc: OidcStatus;
  trustedProxies: number;
  behindProxy: boolean;
  integrationName: string | undefined;
}

export function computeDiagnostics(input: DiagnosticsInput): Diagnostic[] {
  return [
    reachableCheck(input),
    apiKeyCheck(input),
    versionCheck(input),
    policyModeCheck(input),
    oidcCheck(input),
    trustedProxiesCheck(input),
    configAccessCheck(input),
    integrationCheck(input),
  ];
}

function reachableCheck({ reachable }: DiagnosticsInput): Diagnostic {
  return {
    id: "reachable",
    status: reachable ? "pass" : "fail",
    titleKey: "settings.system.checks.reachable.title",
    bodyKey: reachable
      ? "settings.system.checks.reachable.pass"
      : "settings.system.checks.reachable.fail",
  };
}

function apiKeyCheck({ apiKey }: DiagnosticsInput): Diagnostic {
  return {
    id: "apiKey",
    status: apiKey === "valid" ? "pass" : apiKey === "invalid" ? "fail" : "warning",
    titleKey: "settings.system.checks.apiKey.title",
    bodyKey: API_KEY_BODY_KEYS[apiKey],
  };
}

function versionCheck({ version }: DiagnosticsInput): Diagnostic {
  const running = formatServerVersion(version);

  if (!gte(version, MINIMUM_VERSION)) {
    return {
      id: "version",
      status: "fail",
      titleKey: "settings.system.checks.version.title",
      bodyKey: "settings.system.checks.version.tooOld",
      vars: { version: running, minimum: MINIMUM_VERSION },
    };
  }

  if (!gte(version, RECOMMENDED_VERSION)) {
    return {
      id: "version",
      status: "warning",
      titleKey: "settings.system.checks.version.title",
      bodyKey: "settings.system.checks.version.recommended",
      vars: { version: running, recommended: RECOMMENDED_VERSION },
    };
  }

  return {
    id: "version",
    status: "pass",
    titleKey: "settings.system.checks.version.title",
    bodyKey: "settings.system.checks.version.pass",
    vars: { version: running },
  };
}

function policyModeCheck({ configReadable, policyMode }: DiagnosticsInput): Diagnostic {
  if (!configReadable) {
    return {
      id: "policyMode",
      status: "warning",
      titleKey: "settings.system.checks.policyMode.title",
      bodyKey: "settings.system.checks.policyMode.unknown",
      link: SETTINGS_LINK,
    };
  }

  const isDatabase = policyMode === "database";
  return {
    id: "policyMode",
    status: isDatabase ? "pass" : "warning",
    titleKey: "settings.system.checks.policyMode.title",
    bodyKey: isDatabase
      ? "settings.system.checks.policyMode.pass"
      : "settings.system.checks.policyMode.file",
    link: isDatabase ? undefined : SETTINGS_LINK,
  };
}

function oidcCheck({ oidc }: DiagnosticsInput): Diagnostic {
  return {
    id: "oidc",
    status: oidc === "configured" ? "pass" : "warning",
    titleKey: "settings.system.checks.oidc.title",
    bodyKey:
      oidc === "configured"
        ? "settings.system.checks.oidc.pass"
        : oidc === "missing"
          ? "settings.system.checks.oidc.missing"
          : "settings.system.checks.oidc.unknown",
    link: oidc === "configured" ? undefined : SETTINGS_LINK,
  };
}

function trustedProxiesCheck({ trustedProxies, behindProxy }: DiagnosticsInput): Diagnostic {
  // Headscale only sees the real client address when the proxy in front of
  // Headplane is listed; without a proxy in front, an empty list is correct.
  const missing = behindProxy && trustedProxies === 0;
  return {
    id: "trustedProxies",
    status: missing ? "warning" : "pass",
    titleKey: "settings.system.checks.trustedProxies.title",
    bodyKey: missing
      ? "settings.system.checks.trustedProxies.missing"
      : "settings.system.checks.trustedProxies.pass",
    link: missing ? SETTINGS_LINK : undefined,
  };
}

function configAccessCheck({ configReadable, configWritable }: DiagnosticsInput): Diagnostic {
  if (!configReadable) {
    return {
      id: "configAccess",
      status: "fail",
      titleKey: "settings.system.checks.configAccess.title",
      bodyKey: "settings.system.checks.configAccess.unreadable",
      link: SETTINGS_LINK,
    };
  }

  return {
    id: "configAccess",
    status: configWritable ? "pass" : "warning",
    titleKey: "settings.system.checks.configAccess.title",
    bodyKey: configWritable
      ? "settings.system.checks.configAccess.pass"
      : "settings.system.checks.configAccess.readOnly",
    link: configWritable ? undefined : SETTINGS_LINK,
  };
}

function integrationCheck({ integrationName }: DiagnosticsInput): Diagnostic {
  return {
    id: "integration",
    status: integrationName ? "pass" : "warning",
    titleKey: "settings.system.checks.integration.title",
    bodyKey: integrationName
      ? "settings.system.checks.integration.pass"
      : "settings.system.checks.integration.missing",
    vars: integrationName ? { name: integrationName } : undefined,
  };
}

/**
 * Headplane only reloads or restarts Headscale when an integration is
 * configured, and the integration decides which of the two it can do. The
 * native `/proc` integration signals `headscale serve` with SIGHUP, which
 * reloads the configuration in place; Docker and Kubernetes restart the
 * container or pod instead. This mirrors the names in
 * `app/server/config/integration`.
 */
export function integrationAction(name: string): IntegrationAction {
  return /proc|native/i.test(name) ? "reload" : "restart";
}

/** A request carries these headers only when something proxies it. */
export function isBehindProxy(headers: { get(name: string): string | null }): boolean {
  return Boolean(
    headers.get("x-forwarded-for") ?? headers.get("x-forwarded-proto") ?? headers.get("forwarded"),
  );
}

/** True when `latest` is a strictly newer release than the running version. */
export function isNewerVersion(running: ServerVersion, latest: ServerVersion): boolean {
  // Untagged builds (`dev`, Go pseudo-versions) are never "out of date".
  if (running.unknown || latest.unknown) {
    return false;
  }

  if (latest.major !== running.major) {
    return latest.major > running.major;
  }

  if (latest.minor !== running.minor) {
    return latest.minor > running.minor;
  }

  return latest.patch > running.patch;
}
