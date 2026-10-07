// MARK: Console-login settings loader and action
//
// Kept out of the route module so the unit tests can drive the action without
// importing React. The two entry points are re-exported by `overview.tsx`.
//
// Every rejection is a stable code, never an English sentence, so the form maps
// it onto a localized message; and no result ever carries a value, only field
// names — which is what keeps the client secret out of the browser, the audit
// log and any error text.

import { data } from "react-router";

import { AUDIT_ACTIONS, auditActorOf } from "~/server/audit";
import {
  appConfigContext,
  auditContext,
  authContext,
  oidcContext,
  type AppContext,
} from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import {
  isLoginOidcBooleanField,
  type LoginLockoutReason,
  type LoginOidcActionErrorCode,
  type LoginOidcErrorCode,
  type LoginSignInPaths,
} from "./login-oidc";
import {
  readLoginOidcSnapshot,
  saveLoginOidcSettings,
  type LoginOidcEdit,
} from "./overrides.server";
import type { LoginActionData, LoginActionFailure } from "./result";
import {
  evaluateLoginSelfTest,
  loginSelfTestConfigFrom,
  probeIssuer,
  supportsEs384Verification,
} from "./self-test";

/** The editable fields the form can post, in the order it renders them. */
const POSTED_FIELDS = [
  "enabled",
  "issuer",
  "client_id",
  "scope",
  "use_pkce",
  "default_role",
  "logout_idp",
  "end_session_endpoint",
  "post_logout_redirect_uri",
] as const;

/** What "a way in" means for this deployment: the same context the rail uses. */
function signInContext(appConfig: AppContext["config"]) {
  return {
    disableApiKeyLogin: appConfig.oidc?.disable_api_key_login === true,
    proxyAuthEnabled: appConfig.server.proxy_auth?.enabled === true,
  };
}

export async function loginOidcLoader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const oidc = context.get(oidcContext);
  const appConfig = context.get(appConfigContext);
  const principal = await auth.require(request);

  const canEdit = auth.can(principal, Capabilities.configure_iam);
  // The checks read the configuration file, so they are worth running even
  // while sign-in is switched off; the notice just explains that state.
  const oidcEnabled = oidc.state === "enabled";
  const disabledReason = oidcEnabled ? null : oidc.reason;

  if (!canEdit) {
    // The page always renders the values that would be read at the next start:
    // the config file, the overrides saved here and the environment, merged.
    // That snapshot names the issuer, the client id, the scopes, which
    // environment variables pin a field and whether a client secret is stored —
    // IAM configuration the rest of the rail already gates behind
    // `configure_iam`. The action below refuses to *write* without it; the
    // loader used to hand the same account the values, so the check happens
    // before the config file is even read.
    return { canEdit: false as const, oidcEnabled, disabledReason, view: null };
  }

  const snapshot = await readLoginOidcSnapshot({
    dataPath: appConfig.server.data_path,
    runningOidc: appConfig.oidc,
    context: signInContext(appConfig),
  });

  return { canEdit: true as const, oidcEnabled, disabledReason, view: snapshot.view };
}

export async function loginOidcAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const appConfig = context.get(appConfigContext);
  const audit = context.get(auditContext);
  const principal = await auth.require(request);

  if (!auth.can(principal, Capabilities.configure_iam)) {
    return data({ success: false, errorCode: "forbidden" } satisfies LoginActionFailure, {
      status: 403,
    });
  }

  const formData = await request.formData();
  const actionId = formData.get("action_id")?.toString();

  if (actionId === "save") {
    const result = await saveLoginOidcSettings({
      dataPath: appConfig.server.data_path,
      context: signInContext(appConfig),
      edit: readEdit(formData),
    });

    switch (result.state) {
      case "saved": {
        if (result.changed.length > 0) {
          // Only field names ever reach the log; the client secret is never in
          // a value position here.
          await audit.record({
            ...auditActorOf(principal),
            action: AUDIT_ACTIONS.loginOidcUpdate,
            target: "console_login",
            detail: `changed: ${result.changed.join(", ")}`,
            result: "success",
          });
        }

        return data({
          success: true,
          kind: "save",
          changed: result.changed,
        } satisfies LoginActionData);
      }

      case "invalid": {
        return failure(result.errors[0] ?? "invalidType", { errors: result.errors }, 400);
      }

      case "confirm": {
        return failure(
          "confirmationRequired",
          { reasons: result.reasons, remaining: result.remaining },
          400,
        );
      }

      case "refused": {
        // A refusal is a security decision, so it is recorded even though the
        // stored document did not change.
        await audit.record({
          ...auditActorOf(principal),
          action: AUDIT_ACTIONS.loginOidcChangeBlocked,
          target: "console_login",
          detail: `refused: ${result.reasons.join(", ")}`,
          result: "failure",
        });

        return failure("noWayIn", { reasons: result.reasons, remaining: result.remaining }, 400);
      }

      default: {
        return failure("writeFailed", {}, 500);
      }
    }
  }

  if (actionId === "self_test") {
    // The self-test evaluates the *effective* configuration, so a change saved
    // a moment ago is checked before a restart puts it to work.
    const snapshot = await readLoginOidcSnapshot({
      dataPath: appConfig.server.data_path,
      runningOidc: appConfig.oidc,
      context: signInContext(appConfig),
    });

    const [probe, es384] = await Promise.all([
      probeIssuer(snapshot.merged.issuer),
      supportsEs384Verification(),
    ]);

    const report = evaluateLoginSelfTest({
      config: loginSelfTestConfigFrom({
        settings: snapshot.merged,
        tokenEndpointAuthMethod: appConfig.oidc?.token_endpoint_auth_method,
        baseUrl: appConfig.server.base_url,
      }),
      probe,
      runtime: { es384 },
    });

    // Only the report crosses the wire: the client secret never does.
    return data({ success: true, kind: "self_test", report } satisfies LoginActionData);
  }

  return failure("invalidAction", {}, 400);
}

function failure(
  errorCode: LoginOidcActionErrorCode,
  extra: {
    errors?: LoginOidcErrorCode[];
    reasons?: LoginLockoutReason[];
    remaining?: LoginSignInPaths;
  },
  status: number,
) {
  return data({ success: false, errorCode, ...extra } satisfies LoginActionFailure, { status });
}

/** Reads the posted field values; an emptied text field means "clear". */
function readEdit(formData: FormData): LoginOidcEdit {
  const values: LoginOidcEdit["values"] = {};
  const posted: LoginOidcEdit["posted"] = [];

  for (const id of POSTED_FIELDS) {
    if (!formData.has(id)) {
      continue;
    }

    posted.push(id);
    if (isLoginOidcBooleanField(id)) {
      values[id] = formData.get(id)?.toString() === "true";
      continue;
    }

    const text = formData.get(id)?.toString().trim() ?? "";
    if (text.length > 0) {
      values[id] = text;
    }
  }

  // An empty field keeps the stored secret; only a value or the explicit clear
  // switch changes it.
  const postedSecret = formData.get("client_secret")?.toString() ?? "";
  const clearSecret = formData.get("clear_client_secret")?.toString() === "true";

  return {
    posted,
    values,
    secret: clearSecret
      ? { kind: "clear" }
      : postedSecret.trim().length > 0
        ? { kind: "replace", value: postedSecret.trim() }
        : { kind: "keep" },
    confirm: formData.get("confirm")?.toString() === "true",
  };
}
