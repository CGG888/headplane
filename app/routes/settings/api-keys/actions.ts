import { data } from "react-router";

import {
  AUDIT_ACTIONS,
  apiKeyPrefix,
  auditActorOf,
  type AuditService,
  type AuditResult,
} from "~/server/audit";
import { auditContext, authContext, requestApiContext } from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import type { Principal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import type { ApiKeyErrorCode } from "./error-keys";

export interface ApiKeyFailure {
  success: false;
  errorCode: ApiKeyErrorCode;
}

export interface ApiKeyCreateSuccess {
  success: true;
  apiKey: string;
}

export interface ApiKeyExpireSuccess {
  success: true;
}

export interface ApiKeyDeleteSuccess {
  success: true;
}

export type ApiKeyActionResult =
  | ApiKeyCreateSuccess
  | ApiKeyExpireSuccess
  | ApiKeyDeleteSuccess
  | ApiKeyFailure;

/** Highest number of days Headplane lets an API key live for. */
const MAX_EXPIRATION_DAYS = 3650;

/**
 * Records one API key operation. Never throws, so a broken audit log cannot
 * break the mutation it is describing.
 */
async function recordApiKeyOperation(
  audit: AuditService | undefined,
  principal: Principal,
  action: string,
  target: string,
  result: AuditResult,
  detail?: string,
) {
  await audit?.record({
    ...auditActorOf(principal),
    action,
    target,
    detail: detail ?? null,
    result,
  });
}

/**
 * Headscale 0.28+ masks the prefix of API keys in list responses
 * (`hskey-api-<prefix>-***`, or `<prefix>***` for legacy keys), but the
 * expire endpoint looks the key up by the raw prefix stored in the database.
 * Strip the display decoration so both formats round-trip.
 */
export function normalizeApiKeyPrefix(prefix: string): string {
  const unmasked = prefix.replaceAll("*", "");
  const match = /^hskey-api-([A-Za-z0-9_-]{12})/.exec(unmasked);
  if (match) {
    return match[1];
  }

  return unmasked.replace(/-+$/, "");
}

export async function apiKeysAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const audit: AuditService | undefined = context.get(auditContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  if (!check) {
    throw data(
      { localized: { key: "errors.permission.modifyIam" } },
      {
        status: 403,
      },
    );
  }

  const { api } = await getRequestApi(request);

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();
  if (!action) {
    return data({ success: false, errorCode: "invalidAction" } satisfies ApiKeyFailure, {
      status: 400,
    });
  }

  switch (action) {
    case "create_api_key": {
      // The form submits a whole number of days. Reject anything that is not a
      // plain integer so locales that group digits cannot silently truncate the
      // expiration (same guard as the pre-auth key dialog).
      const raw = formData.get("expiration")?.toString().trim() ?? "";
      const days = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRATION_DAYS) {
        await recordApiKeyOperation(
          audit,
          principal,
          AUDIT_ACTIONS.apiKeyCreate,
          "",
          "failure",
          "invalidExpiration",
        );

        return data({ success: false, errorCode: "invalidExpiration" } satisfies ApiKeyFailure, {
          status: 400,
        });
      }

      const expiration = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const { apiKey } = await api.apiKeys.create(expiration);
      await recordApiKeyOperation(
        audit,
        principal,
        AUDIT_ACTIONS.apiKeyCreate,
        `hskey-api-${apiKeyPrefix(apiKey)}`,
        "success",
      );

      return data({ success: true, apiKey } satisfies ApiKeyCreateSuccess);
    }

    case "expire_api_key": {
      const rawPrefix = formData.get("prefix")?.toString().trim() ?? "";
      const prefix = normalizeApiKeyPrefix(rawPrefix);
      if (prefix.length === 0) {
        await recordApiKeyOperation(
          audit,
          principal,
          AUDIT_ACTIONS.apiKeyExpire,
          "",
          "failure",
          "invalidPrefix",
        );

        return data({ success: false, errorCode: "invalidPrefix" } satisfies ApiKeyFailure, {
          status: 400,
        });
      }

      try {
        await api.apiKeys.expire(prefix);
      } catch (error) {
        if (isDataWithApiError(error) && error.data.statusCode === 404) {
          await recordApiKeyOperation(
            audit,
            principal,
            AUDIT_ACTIONS.apiKeyExpire,
            `hskey-api-${prefix}`,
            "failure",
            "notFound",
          );

          return data({ success: false, errorCode: "notFound" } satisfies ApiKeyFailure, {
            status: 404,
          });
        }

        throw error;
      }

      await recordApiKeyOperation(
        audit,
        principal,
        AUDIT_ACTIONS.apiKeyExpire,
        `hskey-api-${prefix}`,
        "success",
      );

      return data({ success: true } satisfies ApiKeyExpireSuccess);
    }

    case "delete_api_key": {
      const rawPrefix = formData.get("prefix")?.toString().trim() ?? "";
      const prefix = normalizeApiKeyPrefix(rawPrefix);
      if (prefix.length === 0) {
        await recordApiKeyOperation(
          audit,
          principal,
          AUDIT_ACTIONS.apiKeyDelete,
          "",
          "failure",
          "invalidPrefix",
        );

        return data({ success: false, errorCode: "invalidPrefix" } satisfies ApiKeyFailure, {
          status: 400,
        });
      }

      try {
        await api.apiKeys.delete(prefix);
      } catch (error) {
        // The key is already gone (someone else deleted it, or the list was
        // stale). That is the outcome the operator asked for, so report it as
        // a message instead of failing the page.
        if (isDataWithApiError(error) && error.data.statusCode === 404) {
          await recordApiKeyOperation(
            audit,
            principal,
            AUDIT_ACTIONS.apiKeyDelete,
            `hskey-api-${prefix}`,
            "failure",
            "notFound",
          );

          return data({ success: false, errorCode: "notFound" } satisfies ApiKeyFailure, {
            status: 404,
          });
        }

        throw error;
      }

      await recordApiKeyOperation(
        audit,
        principal,
        AUDIT_ACTIONS.apiKeyDelete,
        `hskey-api-${prefix}`,
        "success",
      );

      return data({ success: true } satisfies ApiKeyDeleteSuccess);
    }

    default: {
      return data({ success: false, errorCode: "invalidAction" } satisfies ApiKeyFailure, {
        status: 400,
      });
    }
  }
}
