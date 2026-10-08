import { data } from "react-router";

import { authContext, headscaleContext, integrationContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import type { SystemErrorCode, SystemFailure, SystemSuccess } from "./error-keys";

const PROCESS_ACTION = "process_config_change";
const RESTART_ACTION = "restart_headscale";

/**
 * Asks the configured integration to reload or restart Headscale.
 *
 * `process_config_change` is the same hook Headplane runs after it rewrites
 * Headscale's configuration file, which is all an integration can do in place
 * today: SIGHUP for a native install, a container restart for Docker. A native
 * install has no such hook at all, so `restart_headscale` is the separate,
 * opt-in path: it stops Headscale and waits for the supervisor to start it
 * again, reporting the step it stopped at rather than a bare failure.
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
  const action = formData.get("action_id")?.toString();
  if (action !== PROCESS_ACTION && action !== RESTART_ACTION) {
    return failure("invalidAction", 400);
  }

  if (!integration) {
    return failure("notAvailable", 409);
  }

  if (action === RESTART_ACTION) {
    if (!integration.canRestart()) {
      return failure("notRestartable", 409);
    }

    // A restart does not throw: it answers with the step it reached, because
    // "the process is gone and nothing started it again" is a different problem
    // from "it is up but not healthy", and the operator has to be told which.
    const result = await integration.restart(headscale);
    if (!result.ok) {
      log.error("server", "Restarting Headscale stopped at %s", result.stage);
      return data(
        { success: false, errorCode: "restartFailed", stage: result.stage } satisfies SystemFailure,
        { status: 502 },
      );
    }

    log.info("server", "Headscale restarted (PID %s)", result.pid ?? "?");
    return data({ success: true, restart: { stage: result.stage } } satisfies SystemSuccess);
  }

  try {
    // A refused reload must not be reported as a success: the integration knows
    // it could not reach Headscale, and the operator needs to know as well.
    const reloaded = await integration.onConfigChange(headscale);
    if (!reloaded) {
      return failure("failed", 502);
    }

    return data({ success: true } satisfies SystemSuccess);
  } catch (error) {
    log.error("server", "Integration %s failed to reach Headscale: %s", integration.name, error);
    return failure("failed", 502);
  }
}

function failure(errorCode: SystemErrorCode, status: number) {
  return data({ success: false, errorCode } satisfies SystemFailure, { status });
}
