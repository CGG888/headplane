import { readFile } from "node:fs/promises";

import { parseDocument } from "yaml";

/**
 * OIDC keys that Headscale 0.29 refuses to start with. They were dropped from
 * Headscale's configuration schema, and `oidc.expiry` was replaced by the
 * top-level `node.expiry`.
 */
const FATAL_OIDC_KEYS = ["expiry", "strip_email_domain", "map_legacy_users"] as const;

/**
 * `headscaleConfig` keeps its parsed document private and exposes no raw
 * accessor, so this reads the same file from the path Headplane was configured
 * with. Detection is best effort: a missing or unreadable file must never break
 * the settings page, so every failure degrades to "nothing to warn about".
 */
export async function findFatalOidcKeys(path: string | undefined): Promise<string[]> {
  if (!path) {
    return [];
  }

  try {
    const document = parseDocument(await readFile(path, "utf8"));
    if (document.errors.length > 0) {
      return [];
    }

    const config: unknown = document.toJSON();
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      return [];
    }

    const oidc = (config as Record<string, unknown>).oidc;
    if (oidc === null || typeof oidc !== "object" || Array.isArray(oidc)) {
      return [];
    }

    const keys = oidc as Record<string, unknown>;
    return FATAL_OIDC_KEYS.filter((key) => key in keys).map((key) => `oidc.${key}`);
  } catch {
    return [];
  }
}
