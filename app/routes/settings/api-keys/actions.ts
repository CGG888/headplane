import { data } from "react-router";

import { authContext, requestApiContext } from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
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

export type ApiKeyActionResult = ApiKeyCreateSuccess | ApiKeyExpireSuccess | ApiKeyFailure;

/** Highest number of days Headplane lets an API key live for. */
const MAX_EXPIRATION_DAYS = 3650;

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
        return data({ success: false, errorCode: "invalidExpiration" } satisfies ApiKeyFailure, {
          status: 400,
        });
      }

      const expiration = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const { apiKey } = await api.apiKeys.create(expiration);
      return data({ success: true, apiKey } satisfies ApiKeyCreateSuccess);
    }

    case "expire_api_key": {
      const rawPrefix = formData.get("prefix")?.toString().trim() ?? "";
      const prefix = normalizeApiKeyPrefix(rawPrefix);
      if (prefix.length === 0) {
        return data({ success: false, errorCode: "invalidPrefix" } satisfies ApiKeyFailure, {
          status: 400,
        });
      }

      try {
        await api.apiKeys.expire(prefix);
      } catch (error) {
        if (isDataWithApiError(error) && error.data.statusCode === 404) {
          return data({ success: false, errorCode: "notFound" } satisfies ApiKeyFailure, {
            status: 404,
          });
        }

        throw error;
      }

      return data({ success: true } satisfies ApiKeyExpireSuccess);
    }

    default: {
      return data({ success: false, errorCode: "invalidAction" } satisfies ApiKeyFailure, {
        status: 400,
      });
    }
  }
}
