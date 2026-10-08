import { createHash } from "node:crypto";

import { redirect } from "react-router";

import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditActorType,
  type AuditResult,
  type AuditService,
} from "~/server/audit";
import { appConfigContext, auditContext, authContext, headscaleContext } from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import { createLoginThrottle } from "~/server/web/login-throttle";
import log from "~/utils/log";

import type { Route } from "./+types/page";

/**
 * Stable error codes returned to the login page. The UI maps these onto
 * localized messages so the server never emits user-facing English text.
 *
 * Every reason an API key can be rejected collapses into `invalid`: telling a
 * caller that a key exists but is expired, or that it exists but is malformed,
 * answers the only question a guessing attacker is asking. The precise reason
 * is still logged and audited server-side.
 */
export type LoginErrorCode =
  | "missingKey"
  | "emptyKey"
  | "invalid"
  | "rateLimited"
  | "disabled"
  | "unknown";

export interface LoginFailure {
  success: false;
  error: LoginErrorCode;
  /** Only set for `rateLimited`: how long the caller should wait. */
  retryAfterSeconds?: number;
}

/** Why a submitted key was rejected. Recorded, never returned to the client. */
type LoginRejection = "notFound" | "malformed" | "expired" | "invalid" | "unknown";

// One throttle per server process, shared by every login attempt. It is keyed
// by client address, so a fresh server starts with a clean slate.
const loginThrottle = createLoginThrottle();

/**
 * The throttle key. The client address is preferred; when the address cannot
 * be resolved (no socket peer, which should not happen in production) the
 * submitted key's hash is used so that one caller cannot spend the whole
 * budget for everybody else.
 */
function throttleKeyFor(clientAddress: string | undefined, apiKey: string): string {
  if (clientAddress) {
    return `ip:${clientAddress}`;
  }

  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 32)}`;
}

async function recordLogin(
  audit: AuditService | undefined,
  entry: {
    action: AuditAction;
    actor: string;
    actorType: AuditActorType;
    detail: string;
    result: AuditResult;
  },
) {
  // An API key session is a credential. On success the actor is Headscale's
  // own masked key prefix; the key itself is never passed in here.
  await audit?.record({
    actor: entry.actor,
    actorType: entry.actorType,
    action: entry.action,
    target: "login",
    detail: entry.detail,
    result: entry.result,
  });
}

export async function loginAction({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const audit = context.get(auditContext);

  const formData = await request.formData();
  const apiKey = formData.has("api_key") ? String(formData.get("api_key")) : undefined;

  if (apiKey === undefined) {
    log.warn("auth", "Request made without API key");
    log.warn(
      "auth",
      "If this is unexpected, ensure your reverse proxy (if applicable) is configured correctly",
    );
    return {
      success: false,
      error: "missingKey",
    } satisfies LoginFailure;
  }

  if (apiKey.length === 0) {
    log.warn("auth", "Request made with empty API key");
    log.warn(
      "auth",
      "If this is unexpected, ensure your reverse proxy (if applicable) is configured correctly",
    );
    return {
      success: false,
      error: "emptyKey",
    } satisfies LoginFailure;
  }

  const clientAddress = auth.getClientAddress(request);
  const throttleKey = throttleKeyFor(clientAddress, apiKey);
  const identity = clientAddress ? `ip:${clientAddress}` : "unattributed";

  // The loader only redirects to the identity provider when OIDC happens to be
  // usable at that moment, so a direct POST — a stale tab, a bookmark, a script —
  // would otherwise still be accepted on a deployment that turned API key sign-in
  // off. The switch means "this instance does not accept API keys", so it is
  // enforced here too.
  const appConfig = context.get(appConfigContext);
  if (appConfig?.oidc?.disable_api_key_login === true) {
    log.warn("auth", "Refused an API key login from %s: API key sign-in is disabled", identity);
    await recordLogin(audit, {
      action: AUDIT_ACTIONS.loginFailure,
      actor: identity,
      actorType: "system",
      detail: "disabled",
      result: "failure",
    });

    return {
      success: false,
      error: "disabled",
    } satisfies LoginFailure;
  }

  // Checked before the API key is validated so a locked-out caller never
  // reaches Headscale and cannot tell a valid key from an invalid one.
  const before = loginThrottle.check(throttleKey);
  if (!before.allowed) {
    const retryAfterSeconds = Math.ceil(before.retryAfterMs / 1000);
    log.warn(
      "auth",
      "Refusing a login attempt from %s while it is locked out (%ds remaining)",
      identity,
      retryAfterSeconds,
    );
    await recordLogin(audit, {
      action: AUDIT_ACTIONS.loginLocked,
      actor: identity,
      actorType: "system",
      detail: `retry_after=${retryAfterSeconds}s`,
      result: "failure",
    });

    return {
      success: false,
      error: "rateLimited",
      retryAfterSeconds,
    } satisfies LoginFailure;
  }

  /** Counts the failure, then answers with the single `invalid` code. */
  async function reject(reason: LoginRejection, message: string): Promise<LoginFailure> {
    const after = loginThrottle.recordFailure(throttleKey);
    log.warn("auth", "Login rejected for %s: %s", identity, message);
    await recordLogin(audit, {
      action: AUDIT_ACTIONS.loginFailure,
      actor: identity,
      actorType: "system",
      detail: reason,
      result: "failure",
    });
    if (!after.allowed) {
      log.warn(
        "auth",
        "Locking out login attempts from %s for %ds",
        identity,
        Math.ceil(after.retryAfterMs / 1000),
      );
      await recordLogin(audit, {
        action: AUDIT_ACTIONS.loginLocked,
        actor: identity,
        actorType: "system",
        detail: `retry_after=${Math.ceil(after.retryAfterMs / 1000)}s`,
        result: "failure",
      });
    }

    return { success: false, error: "invalid" } satisfies LoginFailure;
  }

  // Build a client with the candidate API key the user just submitted, so the
  // GET /api/v1/apikey call below validates the key against Headscale itself.
  const api = headscale.client(apiKey);
  try {
    const apiKeys = await api.apiKeys.list();

    // We don't need to check for 0 API keys because this request cannot
    // be authenticated correctly without an API key
    //
    // 0.28.0 pointlessly added asterisks to the prefixes of API keys, which is
    // the dumbest thing I've ever seen.
    const lookup = apiKeys.find((key) => apiKey.startsWith(key.prefix.replaceAll("*", "")));
    if (!lookup) {
      return reject("notFound", "the key was not found in the Headscale database");
    }

    if (lookup.expiration === null || lookup.expiration === undefined) {
      log.error("auth", "Got an API key without an expiration");
      return reject("malformed", "the key has no expiration");
    }

    const expiry = new Date(lookup.expiration);
    // `new Date("garbage")` is an invalid date whose `getTime()` is NaN, and
    // every comparison with NaN is false — an unparseable expiration would
    // otherwise pass the expiry check and be logged as `expiry.toISOString()`
    // further down (which throws). Treat it as expired.
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() < Date.now()) {
      return reject("expired", "the key has expired");
    }

    loginThrottle.recordSuccess(throttleKey);

    // Headscale's own prefix is already masked as `...***`; it names the key
    // without exposing it, which is what the audit page shows.
    await recordLogin(audit, {
      action: AUDIT_ACTIONS.loginSuccess,
      actor: `api_key:${lookup.prefix}`,
      actorType: "api_key",
      detail: `from=${identity} expires=${expiry.toISOString()}`,
      result: "success",
    });

    return redirect("/overview", {
      headers: {
        "Set-Cookie": await auth.createApiKeySession(
          apiKey,
          `${lookup.prefix}...`,
          expiry.getTime() - Date.now(),
        ),
      },
    });
  } catch (error) {
    // Check if this is a React Router DataWithResponseInit wrapping a Headscale API error
    if (isDataWithApiError(error)) {
      const apiError = error.data;
      // TODO: What in gods name is wrong with the headscale API?
      if (
        apiError.statusCode === 401 ||
        apiError.statusCode === 403 ||
        (apiError.statusCode === 500 && apiError.detail.trim() === "Unauthorized")
      ) {
        return reject("invalid", "Headscale rejected the key");
      }
    }

    log.error("auth", "Error while validating API key: %s", error);
    log.debug("auth", "Error details: %o", error);
    return reject("unknown", "validating the key failed");
  }
}
