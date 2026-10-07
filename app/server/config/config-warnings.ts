import { isIP } from "node:net";

import log from "~/utils/log";

import type { HeadplaneConfig } from "./config-schema";

/**
 * Mirrors `DEFAULT_PROXY_AUTH_USER_HEADER` in `~/server/web/auth` so the warning
 * names the header the deployment actually trusts. Kept local because the auth
 * service pulls in the whole web stack, which the config loader must not.
 */
const DEFAULT_USER_HEADER = "Remote-User";

/**
 * The part of `server` these warnings reason about. Declared separately so the
 * checks can be exercised without building a whole valid configuration.
 */
export interface AuthConfigShape {
  cookie_domain?: string | undefined;
  proxy_auth?:
    | {
        enabled?: boolean | undefined;
        allowed_cidrs?: string[] | undefined;
        trusted_proxy_cidrs?: string[] | undefined;
        user_header?: string | undefined;
        ip_header?: string | undefined;
      }
    | undefined;
}

/**
 * Reads the address and prefix length out of a CIDR. Returns `undefined` when
 * the entry is not one, which the auth service treats as a startup failure.
 */
function readPrefix(value: string): { bits: number; prefix: number } | undefined {
  const parts = value.trim().split("/");
  if (parts.length > 2) {
    return undefined;
  }

  const family = isIP(parts[0] ?? "");
  if (family === 0) {
    return undefined;
  }

  const bits = family === 4 ? 32 : 128;
  const rawPrefix = parts[1];
  if (rawPrefix === undefined) {
    return { bits, prefix: bits };
  }

  const prefix = Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    return undefined;
  }

  return { bits, prefix };
}

/**
 * Describes how much of the address space a CIDR covers, or `undefined` when it
 * is a single host and therefore not worth warning about.
 */
function describeRange(range: { bits: number; prefix: number }): string | undefined {
  if (range.prefix === range.bits) {
    return undefined;
  }

  return range.prefix === 0 ? "every address" : "a whole network";
}

/**
 * Configuration that is valid but dangerous. Warnings are advisory: every one
 * of these settings has legitimate uses, so the config is still loaded.
 */
export function authConfigWarnings(server: AuthConfigShape): string[] {
  const warnings: string[] = [];

  if (server.cookie_domain !== undefined) {
    warnings.push(
      `server.cookie_domain is set to "${server.cookie_domain}": the console session cookie is sent to every host under that domain, and any service on it can read or overwrite the cookie. Leave it unset unless HeadplaneCN is the only service on that domain.`,
    );
  }

  const proxy = server.proxy_auth;
  if (proxy?.enabled !== true) {
    // The CIDR lists do nothing while proxy authentication is off.
    return warnings;
  }

  const lists = [
    {
      key: "allowed_cidrs",
      values: proxy.allowed_cidrs,
      consequence: `sign in as any user by setting the ${proxy.user_header ?? DEFAULT_USER_HEADER} header`,
    },
    {
      key: "trusted_proxy_cidrs",
      values: proxy.trusted_proxy_cidrs,
      consequence: `spoof the ${proxy.ip_header ?? "X-Forwarded-For"} header`,
    },
  ];

  for (const list of lists) {
    for (const value of list.values ?? []) {
      const range = readPrefix(value);
      if (range === undefined) {
        warnings.push(
          `server.proxy_auth.${list.key} contains "${value}", which is not a valid CIDR address and will never match a client.`,
        );
        continue;
      }

      const scope = describeRange(range);
      if (scope === undefined) {
        continue;
      }

      warnings.push(
        `server.proxy_auth.${list.key} trusts ${scope} ("${value}"): every client it covers can ${list.consequence}. Narrow it to the single address the proxy connects from.`,
      );
    }
  }

  return warnings;
}

/** Logs `authConfigWarnings` once per configuration load. */
export function warnAboutRiskyAuthConfig(config: HeadplaneConfig): void {
  for (const warning of authConfigWarnings(config.server)) {
    log.warn("config", "%s", warning);
  }
}
