import { data } from "react-router";

import { authContext, headscaleContext, integrationContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import type { SystemErrorCode, SystemFailure, SystemSuccess } from "./error-keys";

const PROCESS_ACTION = "process_config_change";

/**
 * Asks the configured integration to reload or restart Headscale. There is no
 * dedicated restart API: the integration decides, and `onConfigChange` is the
 * same hook Headplane uses after it rewrites Headscale's configuration file.
 */
export async function systemAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const integration = context.get(integrationContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  const formData = await request.formData();
  if (formData.get("action_id")?.toString() !== PROCESS_ACTION) {
    return failure("invalidAction", 400);
  }

  if (!integration) {
    return failure("notAvailable", 409);
  }

  try {
    await integration.onConfigChange(headscale);
    return data({ success: true } satisfies SystemSuccess);
  } catch (error) {
    log.error("server", "Integration %s failed to reach Headscale: %s", integration.name, error);
    return failure("failed", 502);
  }
}

function failure(errorCode: SystemErrorCode, status: number) {
  return data({ success: false, errorCode } satisfies SystemFailure, { status });
}
