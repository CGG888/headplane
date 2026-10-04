import { data } from "react-router";

import { AUDIT_ACTIONS, auditActorOf, type AuditService } from "~/server/audit";
import {
  auditContext,
  authContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import { SNAPSHOT_REASONS } from "~/server/snapshots/reasons";
import { isSnapshotError } from "~/server/snapshots/types";
import type { Principal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import type { SnapshotActionErrorCode } from "./error-keys";

export interface SnapshotActionSuccess {
  success: true;
  snapshotId?: string;
  restored?: number;
}

export interface SnapshotActionFailure {
  success: false;
  errorCode: SnapshotActionErrorCode;
}

export type SnapshotActionResult = SnapshotActionSuccess | SnapshotActionFailure;

function errorCodeOf(error: unknown): SnapshotActionErrorCode {
  return isSnapshotError(error) ? error.code : "unavailable";
}

function statusOf(errorCode: SnapshotActionErrorCode): number {
  switch (errorCode) {
    case "notFound":
      return 404;
    case "unexpectedPath":
    case "noTargets":
      return 400;
    default:
      return 500;
  }
}

async function recordFailure(
  audit: AuditService | undefined,
  principal: Principal,
  action: string,
  target: string,
  detail: string,
) {
  await audit?.record({
    ...auditActorOf(principal),
    action,
    target,
    detail,
    result: "failure",
  });
}

export async function snapshotsAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const audit: AuditService | undefined = context.get(auditContext);
  const snapshots = context.get(snapshotContext);
  const headscale = context.get(headscaleContext);
  const integration = context.get(integrationContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();

  switch (action) {
    case "take_snapshot": {
      try {
        const snapshot = await snapshots.take(SNAPSHOT_REASONS.manual);
        await audit?.record({
          ...auditActorOf(principal),
          action: AUDIT_ACTIONS.snapshotCreate,
          target: snapshot.id,
          detail: snapshot.files.map((file) => file.name).join(", "),
          result: "success",
        });

        return data({ success: true, snapshotId: snapshot.id } satisfies SnapshotActionSuccess);
      } catch (error) {
        const errorCode = errorCodeOf(error);
        await recordFailure(
          audit,
          principal,
          AUDIT_ACTIONS.snapshotCreate,
          SNAPSHOT_REASONS.manual,
          errorCode,
        );

        return data({ success: false, errorCode } satisfies SnapshotActionFailure, {
          status: statusOf(errorCode),
        });
      }
    }

    case "restore_snapshot": {
      const id = formData.get("snapshot_id")?.toString().trim() ?? "";
      if (id.length === 0) {
        return data({ success: false, errorCode: "notFound" } satisfies SnapshotActionFailure, {
          status: 400,
        });
      }

      try {
        const { snapshot, restored } = await snapshots.restore(id);
        try {
          // Reloading Headscale is best-effort: the files are already restored,
          // so a failing integration must not report the restore as failed.
          await integration?.onConfigChange(headscale);
        } catch (error) {
          log.warn("config", "Failed to reload Headscale after a restore: %s", String(error));
        }

        await audit?.record({
          ...auditActorOf(principal),
          action: AUDIT_ACTIONS.snapshotRestore,
          target: snapshot.id,
          detail: restored.join(", "),
          result: "success",
        });

        return data({
          success: true,
          snapshotId: snapshot.id,
          restored: restored.length,
        } satisfies SnapshotActionSuccess);
      } catch (error) {
        const errorCode = errorCodeOf(error);
        await recordFailure(audit, principal, AUDIT_ACTIONS.snapshotRestore, id, errorCode);

        return data({ success: false, errorCode } satisfies SnapshotActionFailure, {
          status: statusOf(errorCode),
        });
      }
    }

    default: {
      return data({ success: false, errorCode: "invalidAction" } satisfies SnapshotActionFailure, {
        status: 400,
      });
    }
  }
}
