import { data } from "react-router";

import {
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
} from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import type {
  HeadscaleSettingsErrorCode,
  HeadscaleSettingsFailure,
  HeadscaleSettingsSuccess,
} from "./error-keys";
import { validateTrustedProxyCidr } from "./trusted-proxies";

const PKCE_METHODS = new Set(["plain", "S256"]);
const POLICY_MODES = new Set(["file", "database"]);

export async function headscaleSettingsAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const integration = context.get(integrationContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  if (!check) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  if (!headscaleConfig.writable()) {
    throw data({ localized: { key: "errors.headscaleConfigNotWritable" } }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();

  switch (action) {
    case "save_oidc": {
      // Headscale treats an empty issuer as "OIDC disabled", so clearing the
      // field is a legitimate change. A configured provider, however, needs a
      // real http(s) URL and the client ID registered with it.
      const issuer = readField(formData, "issuer");
      const clientId = readField(formData, "client_id");
      if (issuer.length > 0) {
        if (!isHttpUrl(issuer)) {
          return failure("invalidIssuer");
        }

        if (clientId.length === 0) {
          return failure("invalidClientId");
        }
      }

      const scope = splitList(readField(formData, "scope"));
      if (scope.length === 0) {
        return failure("invalidScope");
      }

      const pkceMethod = readField(formData, "pkce_method");
      if (!PKCE_METHODS.has(pkceMethod)) {
        return failure("invalidPkceMethod");
      }

      const patches = [
        { path: "oidc.issuer", value: issuer },
        { path: "oidc.client_id", value: clientId },
        { path: "oidc.scope", value: scope },
        {
          path: "oidc.email_verified_required",
          value: readField(formData, "email_verified_required") === "true",
        },
        {
          path: "oidc.use_expiry_from_token",
          value: readField(formData, "use_expiry_from_token") === "true",
        },
        {
          path: "oidc.only_start_if_oidc_is_available",
          value: readField(formData, "only_start_if_oidc_is_available") === "true",
        },
        { path: "oidc.pkce.enabled", value: readField(formData, "pkce_enabled") === "true" },
        { path: "oidc.pkce.method", value: pkceMethod },
      ];

      // The secret is write-only. An empty field means "keep the stored
      // secret", so it must not be patched at all.
      const clientSecret = formData.get("client_secret")?.toString() ?? "";
      if (clientSecret.length > 0) {
        patches.push({ path: "oidc.client_secret", value: clientSecret });
      }

      await headscaleConfig.patch(patches);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "add_trusted_proxy": {
      const proxy = readField(formData, "proxy");
      const problem = validateTrustedProxyCidr(proxy);
      if (problem === "invalid") {
        return failure("invalidCidr");
      }

      if (problem === "unspecified") {
        return failure("unspecifiedCidr");
      }

      const { trustedProxies } = headscaleConfig.getTailnetSettings();
      if (trustedProxies.includes(proxy)) {
        return failure("duplicateProxy");
      }

      await headscaleConfig.patch([{ path: "trusted_proxies", value: [...trustedProxies, proxy] }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "remove_trusted_proxy": {
      const proxy = readField(formData, "proxy");
      const { trustedProxies } = headscaleConfig.getTailnetSettings();
      if (!trustedProxies.includes(proxy)) {
        return failure("proxyNotFound");
      }

      await headscaleConfig.patch([
        {
          path: "trusted_proxies",
          value: trustedProxies.filter((entry) => entry !== proxy),
        },
      ]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "set_policy_mode": {
      const mode = readField(formData, "policy_mode");
      if (!POLICY_MODES.has(mode)) {
        return failure("invalidPolicyMode");
      }

      await headscaleConfig.patch([{ path: "policy.mode", value: mode }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    default: {
      return failure("invalidAction");
    }
  }
}

function readField(formData: FormData, name: string): string {
  return formData.get(name)?.toString().trim() ?? "";
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter((entry) => entry.length > 0))];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function failure(errorCode: HeadscaleSettingsErrorCode) {
  return data({ success: false, errorCode } satisfies HeadscaleSettingsFailure, { status: 400 });
}

function success() {
  return data({ success: true } satisfies HeadscaleSettingsSuccess);
}
