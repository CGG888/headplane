import { data } from "react-router";

import { AUDIT_ACTIONS, auditActorOf, type AuditResult, type AuditService } from "~/server/audit";
import { auditContext, authContext, requestApiContext } from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import type { Principal } from "~/server/web/auth";
import { isUserPrincipal } from "~/server/web/auth";
import { getOidcSubject } from "~/server/web/headscale-identity";
import { Capabilities } from "~/server/web/roles";
import type { PreAuthKey } from "~/types";

import type { Route } from "./+types/overview";
import {
  type AuthKeyDeleteFailure,
  type AuthKeyDeleteSuccess,
  PRE_AUTH_KEY_EXPIRED,
} from "./result";

/**
 * Records one pre-auth key deletion. Never throws, so a broken audit log cannot
 * break the mutation it is describing. The key's own string is a credential, so
 * the log stores the stable id instead.
 */
async function recordPreAuthKeyDeletion(
  audit: AuditService | undefined,
  principal: Principal,
  keyId: string,
  result: AuditResult,
  detail?: string,
) {
  await audit?.record({
    ...auditActorOf(principal),
    action: AUDIT_ACTIONS.preAuthKeyDelete,
    target: keyId ? `preauthkey:${keyId}` : "",
    detail: detail ?? null,
    result,
  });
}

export async function authKeysAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const audit: AuditService | undefined = context.get(auditContext);

  const { principal, api } = await getRequestApi(request);

  const canGenerateAny = auth.can(principal, Capabilities.generate_authkeys);
  const canGenerateOwn = auth.can(principal, Capabilities.generate_own_authkeys);

  if (!canGenerateAny && !canGenerateOwn) {
    throw data(
      { localized: { key: "errors.permission.managePreAuthKeys" } },
      {
        status: 403,
      },
    );
  }

  async function checkSelfServiceOwnership(userId: string) {
    if (canGenerateAny || !canGenerateOwn) return;
    const [targetUser] = await api.users.list({ id: userId });
    if (!targetUser) {
      throw data("User not found.", { status: 404 });
    }
    const targetSubject = getOidcSubject(targetUser);
    const ownsTarget =
      isUserPrincipal(principal) &&
      (principal.user.headscaleUserId === userId || targetSubject === principal.user.subject);
    if (!ownsTarget) {
      throw data(
        { localized: { key: "errors.permission.manageUserPreAuthKeys" } },
        {
          status: 403,
        },
      );
    }
  }

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();
  if (!action) {
    throw data("Missing `action_id` in the form data.", {
      status: 400,
    });
  }

  switch (action) {
    case "add_preauthkey": {
      const user = formData.get("user_id")?.toString() || null;
      const aclTagsRaw = formData.get("acl_tags")?.toString() || "";
      const aclTags = aclTagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (!user && aclTags.length === 0) {
        return data("Must specify either a user or ACL tags.", {
          status: 400,
        });
      }

      if (user) {
        await checkSelfServiceOwnership(user);
      }

      const expiry = formData.get("expiry")?.toString();
      if (!expiry) {
        return data("Missing `expiry` in the form data.", {
          status: 400,
        });
      }

      const reusable = formData.get("reusable")?.toString();
      if (!reusable) {
        return data("Missing `reusable` in the form data.", {
          status: 400,
        });
      }

      const ephemeral = formData.get("ephemeral")?.toString();
      if (!ephemeral) {
        return data("Missing `ephemeral` in the form data.", {
          status: 400,
        });
      }

      // The form submits the raw, unformatted value of the number input, so
      // anything that is not a plain integer (grouping separators from
      // `Intl.NumberFormat`, unit suffixes, ...) is malformed input. Parsing it
      // leniently either produces an Invalid Date (500) or, for dot-grouping
      // locales, a silently truncated expiry.
      const day = /^\d+$/.test(expiry.trim()) ? Number(expiry.trim()) : Number.NaN;
      const date = new Date();
      date.setDate(date.getDate() + day);

      if (day < 1 || Number.isNaN(date.getTime())) {
        return data("`expiry` must be a whole number of days.", {
          status: 400,
        });
      }

      const key = await api.preAuthKeys.create({
        user,
        ephemeral: ephemeral === "on",
        reusable: reusable === "on",
        expiration: date,
        aclTags: aclTags.length > 0 ? aclTags : null,
      });

      return data({ success: true as const, key: key.key });
    }

    case "expire_preauthkey": {
      const keyId = formData.get("key_id")?.toString();
      const key = formData.get("key")?.toString();
      if (!keyId || !key) {
        return data("Missing `key_id` or `key` in the form data.", {
          status: 400,
        });
      }

      const user = formData.get("user_id")?.toString();
      if (!user) {
        return data("Missing `user_id` in the form data.", {
          status: 400,
        });
      }

      await checkSelfServiceOwnership(user);
      // `user` here is the Headscale numeric user id (form field is wired
      // from User.id). Pre-0.28 expire posts a uint64 `user` field, which
      // the API layer reads from `key.user?.id`. Headscale 0.28+ only
      // looks at `key.id` (the stable preauthkey id).
      await api.preAuthKeys.expire({
        id: keyId,
        key,
        user: { id: user },
      } as unknown as PreAuthKey);
      return data(PRE_AUTH_KEY_EXPIRED);
    }

    case "delete_preauthkey": {
      const keyId = formData.get("key_id")?.toString().trim() ?? "";
      if (keyId.length === 0) {
        await recordPreAuthKeyDeletion(audit, principal, "", "failure", "invalidKeyId");

        return data({ success: false, errorCode: "invalidKeyId" } satisfies AuthKeyDeleteFailure, {
          status: 400,
        });
      }

      // A self-service account may only delete a key it owns. The expire path
      // proves ownership from the submitted user id; without one (a tag-only
      // key) there is nothing a self-service account could own, so it is
      // refused rather than trusted.
      const userId = formData.get("user_id")?.toString() ?? "";
      if (!canGenerateAny && userId.length === 0) {
        throw data(
          { localized: { key: "errors.permission.manageUserPreAuthKeys" } },
          {
            status: 403,
          },
        );
      }

      await checkSelfServiceOwnership(userId);

      // The delete endpoint and the stable key id it addresses both start at
      // Headscale 0.28, so the client leaves the method off below that.
      if (!api.preAuthKeys.delete) {
        await recordPreAuthKeyDeletion(audit, principal, keyId, "failure", "unsupported");

        return data({ success: false, errorCode: "unsupported" } satisfies AuthKeyDeleteFailure, {
          status: 400,
        });
      }

      try {
        await api.preAuthKeys.delete(keyId);
      } catch (error) {
        // Already gone: the operator's goal is met, so report it as a message
        // instead of failing the page.
        if (isDataWithApiError(error) && error.data.statusCode === 404) {
          await recordPreAuthKeyDeletion(audit, principal, keyId, "failure", "notFound");

          return data({ success: false, errorCode: "notFound" } satisfies AuthKeyDeleteFailure, {
            status: 404,
          });
        }

        await recordPreAuthKeyDeletion(audit, principal, keyId, "failure");
        throw error;
      }

      await recordPreAuthKeyDeletion(audit, principal, keyId, "success");

      return data({ success: true } satisfies AuthKeyDeleteSuccess);
    }

    default:
      return data("Invalid action", {
        status: 400,
      });
  }
}
