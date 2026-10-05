import { data } from "react-router";

import { authContext, requestApiContext } from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import type { PolicyApi } from "~/server/headscale/api/resources/policy";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import { POLICY_CHECK_ACTION_ID } from "./should-revalidate";

/** Machine-readable failure codes the ACL editor knows how to localize. */
export type AclActionErrorCode = "policyRejected";

/**
 * Every payload the action returns shares this shape so the page can read
 * `fetcher.data` without narrowing the union of React Router responses.
 */
export interface AclActionData {
  success: boolean;
  /** Localized-able raw error text from Headscale (save failures). */
  error?: string;
  errorCode?: AclActionErrorCode;
  /** Headscale's own message for a policy it refused to accept. */
  detail?: string;
  policy?: string;
  updatedAt?: Date;
}

/**
 * Headscale's own message for a failed request. The gRPC gateway carries the
 * parser's text in `message`, and some releases nest it under `rpcStatus`;
 * when the body is not JSON at all the raw body is the only thing left, so it
 * is used verbatim rather than swallowing the reason.
 */
function apiMessage(error: unknown): string | null {
  if (!isDataWithApiError(error)) {
    return null;
  }

  const { data: payload, rawData } = error.data;
  if (payload != null) {
    const message = payload.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }

    const rpcStatus = payload.rpcStatus;
    if (rpcStatus != null && typeof rpcStatus === "object" && "message" in rpcStatus) {
      const nested = (rpcStatus as { message?: unknown }).message;
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested.trim();
      }
    }
  }

  const raw = rawData.trim();
  return raw.length > 0 ? raw : null;
}

// Headscale's parser reports an unusable policy with one of two message
// prefixes: HuJSON syntax errors and structural unmarshal errors.
// https://github.com/juanfont/headscale/blob/c4600346f9c29b514dc9725ac103efb9d0381f23/hscontrol/types/policy.go#L11
const POLICY_PARSE_PREFIXES = ["parsing HuJSON:", "parsing policy from bytes:"];

function isPolicyParseError(detail: string): boolean {
  return POLICY_PARSE_PREFIXES.some((prefix) => detail.includes(prefix));
}

type PolicyCheckOutcome =
  /** Headscale parsed the policy. */
  | { kind: "valid" }
  /** Headscale answered with an API error; `detail` is its own text. */
  | { kind: "rejected"; detail: string; parseError: boolean }
  /** The check could not run at all (network, transport, ...). */
  | { kind: "unavailable"; error: unknown };

/**
 * Ask Headscale to parse a policy without storing it. Every failure is
 * classified so callers can tell a verdict on the policy apart from the check
 * endpoint being unusable, which must never block a save that works today.
 */
async function runPolicyCheck(policy: PolicyApi, text: string): Promise<PolicyCheckOutcome> {
  try {
    await policy.check(text);
    return { kind: "valid" };
  } catch (error) {
    const detail = apiMessage(error);
    if (detail == null) {
      return { kind: "unavailable", error };
    }

    return { kind: "rejected", detail, parseError: isPolicyParseError(detail) };
  }
}

// We only check capabilities here and assume it is writable
// If it isn't, it'll gracefully error anyways, since this means some
// fishy client manipulation is happening.
export async function aclAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.write_policy);
  if (!check) {
    throw data(
      { localized: { key: "errors.permission.writePolicy" } },
      {
        status: 403,
      },
    );
  }

  // Try to write to the ACL policy via the API or via config file (TODO).
  const formData = await request.formData();
  const policyData = formData.get("policy")?.toString();
  if (!policyData) {
    throw data("Missing `policy` in the form data.", {
      status: 400,
    });
  }

  const { api } = await getRequestApi(request);

  // The explicit validate request: report whatever Headscale says about the
  // policy without touching the stored one.
  if (formData.get("action_id")?.toString() === POLICY_CHECK_ACTION_ID) {
    const outcome = await runPolicyCheck(api.policy, policyData);
    if (outcome.kind === "rejected") {
      return data<AclActionData>(
        {
          success: false,
          errorCode: "policyRejected",
          detail: outcome.detail,
        },
        { status: 400 },
      );
    }

    if (outcome.kind === "unavailable") {
      // Nothing was checked, so this is not a verdict on the policy.
      throw outcome.error;
    }

    return data<AclActionData>({ success: true, error: undefined });
  }

  // Validate before saving so a rejected policy is never stored halfway. Only
  // Headscale's own parse errors stop the save; an unsupported check endpoint,
  // file mode, auth problems or a transport failure are logged and skipped so
  // saving keeps working exactly as it did before.
  const outcome = await runPolicyCheck(api.policy, policyData);
  if (outcome.kind === "rejected") {
    if (outcome.parseError) {
      return data<AclActionData>(
        {
          success: false,
          errorCode: "policyRejected",
          detail: outcome.detail,
        },
        { status: 400 },
      );
    }

    log.debug(
      "api",
      "Policy check failed without a parse error, saving anyway: %s",
      outcome.detail,
    );
  } else if (outcome.kind === "unavailable") {
    log.debug("api", "Policy check unavailable, saving without it: %s", String(outcome.error));
  }

  try {
    const { policy, updatedAt } = await api.policy.set(policyData);
    return data<AclActionData>({
      success: true,
      error: undefined,
      policy,
      updatedAt,
    });
  } catch (error) {
    if (isDataWithApiError(error)) {
      const rawData = error.data.rawData;
      // https://github.com/juanfont/headscale/blob/c4600346f9c29b514dc9725ac103efb9d0381f23/hscontrol/types/policy.go#L11
      if (rawData.includes("update is disabled")) {
        throw data({ localized: { key: "errors.policyNotWritable" } }, { status: 403 });
      }

      const message = apiMessage(error);
      if (message == null) {
        throw error;
      }

      // Policy parse errors carry one of two prefixes (HuJSON syntax vs.
      // structural unmarshal). Headscale 0.27.0+ uses these forms; older
      // releases are no longer supported.
      const prefix = POLICY_PARSE_PREFIXES.find((candidate) => message.includes(candidate));
      if (prefix != null) {
        const cutIndex = message.indexOf(prefix);
        const trimmed = `Syntax error: ${message.slice(cutIndex + prefix.length).trim()}`;

        return data<AclActionData>(
          { success: false, error: trimmed, policy: undefined, updatedAt: undefined },
          400,
        );
      }
    }

    // Otherwise, this is a Headscale error that we can just propagate.
    throw error;
  }
}
