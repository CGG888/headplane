import { data, redirect } from "react-router";

import { AUDIT_ACTIONS, auditActorOf, type AuditService } from "~/server/audit";
import {
  auditContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import { nodesResource } from "~/server/headscale/live-store";
import { Capabilities } from "~/server/web/roles";
import { normalizeRegistrationKey } from "~/utils/register-key";

import type { Route } from "./+types/machine";

/**
 * Stable error codes returned to the machine expiry dialog. The UI maps these
 * onto localized messages so the server never emits user-facing English text.
 */
export type MachineExpiryErrorCode = "invalidExpiry" | "expiryInPast";

/**
 * Stable error codes returned to the bulk machine dialogs. Like the expiry
 * codes above the UI maps these onto localized messages.
 */
export type MachineBulkErrorCode =
  | "noMachinesSelected"
  | "tooManyMachines"
  | "missingTags"
  | "missingUserId"
  | "ownerUnsupported";

/**
 * Stable error codes returned to the registration-rejection dialog. Rejecting
 * addresses a *pending* auth request, never a machine, so these are the only
 * outcomes that dialog has to tell apart.
 */
export type MachineRejectErrorCode = "missingKey" | "invalidKey" | "unsupported" | "failed";

/**
 * The client this action needs for a rejection, taken structurally: the method
 * is owned by the API module (and is optional there, because only Headscale
 * 0.29+ can reject an auth request), so the action declares the one shape it
 * calls and treats anything else as "this server cannot do that".
 */
export interface RegistrationRejectApi {
  auth: { reject?: (authId: string) => Promise<void> };
}

/** The client's rejection method, or undefined on a Headscale that lacks it. */
export function registrationRejector(
  api: RegistrationRejectApi,
): ((authId: string) => Promise<void>) | undefined {
  return api.auth.reject;
}

/**
 * Upper bound on the machines one bulk request may touch. The list allows
 * selecting every visible row, so a cap keeps a stray selection from turning
 * into an unbounded sequence of API calls.
 */
export const MAX_BULK_NODES = 500;

const BULK_ACTIONS = new Set(["bulk_set_tags", "bulk_set_expiry", "bulk_reassign", "bulk_delete"]);

function bulkError(errorCode: MachineBulkErrorCode | MachineExpiryErrorCode) {
  return data({ success: false as const, errorCode }, { status: 400 });
}

/** One rejection outcome, as the dialog reads it. */
function rejectError(errorCode: MachineRejectErrorCode, status = 400) {
  return data({ success: false as const, errorCode }, { status });
}

/** A thrown value as one short line the audit log can keep. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  const text = typeof error === "string" ? error.trim() : "";
  return text.length > 0 ? text : "unknown error";
}

/** Reads the selected node ids, dropping blanks and duplicates. */
function readBulkNodeIds(formData: FormData): string[] {
  const ids = new Set<string>();
  for (const value of formData.getAll("node_ids")) {
    const id = value.toString().trim();
    if (id.length > 0) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

export async function machineAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const audit: AuditService | undefined = context.get(auditContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const { principal, api } = await getRequestApi(request);

  const formData = await request.formData();

  const action = formData.get("action_id")?.toString();
  if (!action) {
    throw data("Missing `action_id` in the form data.", {
      status: 400,
    });
  }

  // Fast track register since it doesn't require an existing machine
  if (action === "register") {
    if (!auth.can(principal, Capabilities.write_machines)) {
      throw data(
        { localized: { key: "errors.permission.manageMachines" } },
        {
          status: 403,
        },
      );
    }

    const registrationKeyInput = formData.get("register_key")?.toString();
    if (!registrationKeyInput) {
      throw data("Missing `register_key` in the form data.", {
        status: 400,
      });
    }

    const registrationKey = normalizeRegistrationKey(registrationKeyInput);
    if (!registrationKey) {
      throw data("Invalid `register_key` in the form data.", {
        status: 400,
      });
    }

    const user = formData.get("user")?.toString();
    if (!user) {
      throw data("Missing `user` in the form data.", {
        status: 400,
      });
    }

    const node = await api.nodes.register(user, registrationKey);
    await headscaleLiveStore.refresh(nodesResource, api);
    return redirect(`/machines/${node.id}`);
  }

  // Rejecting a pending registration, the mirror of `register` above: it
  // addresses the auth request a device is waiting on, never an existing node,
  // so it is handled here — before any `node_id` lookup — and can never be
  // confused with deleting a machine.
  if (action === "reject_registration") {
    if (!auth.can(principal, Capabilities.write_machines)) {
      throw data(
        { localized: { key: "errors.permission.manageMachines" } },
        {
          status: 403,
        },
      );
    }

    const registrationKeyInput = formData.get("register_key")?.toString() ?? "";
    if (registrationKeyInput.trim().length === 0) {
      return rejectError("missingKey");
    }

    const authId = normalizeRegistrationKey(registrationKeyInput);
    if (!authId) {
      return rejectError("invalidKey");
    }

    // Only Headscale 0.29+ can turn a request down; on anything older the
    // client has no method at all and the dialog says so.
    const reject = registrationRejector(api);
    if (reject === undefined) {
      return rejectError("unsupported", 501);
    }

    try {
      await reject(authId);
    } catch (error) {
      // A failed rejection is worth recording: it is the one path where a
      // device's pending request may still be sitting on the server.
      await audit?.record({
        ...auditActorOf(principal),
        action: AUDIT_ACTIONS.registrationReject,
        target: authId,
        detail: describeError(error),
        result: "failure",
      });

      return rejectError("failed", 502);
    }

    await audit?.record({
      ...auditActorOf(principal),
      action: AUDIT_ACTIONS.registrationReject,
      target: authId,
      result: "success",
    });

    // The request is gone from Headscale now, so the list is re-read rather
    // than patched: a rejection that raced a registration still shows the
    // machine that was created, and never a full page reload.
    await headscaleLiveStore.refresh(nodesResource, api);
    return { success: true as const };
  }

  // Bulk actions run against a list of machines instead of the single node the
  // remaining cases target, so they are handled before the `node_id` lookup.
  if (BULK_ACTIONS.has(action)) {
    // Selection is only offered to users who can write machines, and the same
    // capability gates the mutations themselves.
    if (!auth.can(principal, Capabilities.write_machines)) {
      throw data(
        { localized: { key: "errors.permission.manageMachines" } },
        {
          status: 403,
        },
      );
    }

    const nodeIds = readBulkNodeIds(formData);
    if (nodeIds.length === 0) {
      return bulkError("noMachinesSelected");
    }

    if (nodeIds.length > MAX_BULK_NODES) {
      return bulkError("tooManyMachines");
    }

    // Bulk runs are best-effort: one machine that Headscale rejects (or that
    // disappears mid-run) must not abort the machines behind it.
    let updated = 0;
    let failed = 0;

    switch (action) {
      case "bulk_set_tags": {
        const rawTags = formData.get("tags")?.toString();
        if (rawTags === undefined) {
          return bulkError("missingTags");
        }

        // An empty value clears the tags, matching the single-machine dialog.
        const tags = rawTags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== "");

        for (const id of nodeIds) {
          try {
            await api.nodes.setTags(id, tags);
            updated++;
          } catch {
            failed++;
          }
        }
        break;
      }

      case "bulk_set_expiry": {
        // Mirrors the single-machine modes: "never" disables key expiry,
        // "default" restores Headscale's expiry-now behaviour, and "custom"
        // pins an explicit timestamp.
        const mode = formData.get("expiry_mode")?.toString();
        let apply: (id: string) => Promise<void>;

        if (mode === "never" || mode === "default") {
          const disableExpiry = mode === "never";
          apply = (id) => api.nodes.toggleExpiry(id, disableExpiry);
        } else if (mode === "custom") {
          const raw = formData.get("expiry")?.toString();
          const expiry = raw ? new Date(raw) : new Date(Number.NaN);
          if (!raw || Number.isNaN(expiry.getTime())) {
            return bulkError("invalidExpiry");
          }

          if (expiry.getTime() <= Date.now()) {
            return bulkError("expiryInPast");
          }

          apply = (id) => api.nodes.setExpiry(id, expiry);
        } else {
          return bulkError("invalidExpiry");
        }

        for (const id of nodeIds) {
          try {
            await apply(id);
            updated++;
          } catch {
            failed++;
          }
        }
        break;
      }

      case "bulk_reassign": {
        const user = formData.get("user_id")?.toString();
        if (!user) {
          return bulkError("missingUserId");
        }

        if (!api.nodes.reassignUser) {
          return bulkError("ownerUnsupported");
        }

        for (const id of nodeIds) {
          try {
            await api.nodes.reassignUser(id, user);
            updated++;
          } catch {
            failed++;
          }
        }
        break;
      }

      case "bulk_delete": {
        for (const id of nodeIds) {
          try {
            await api.nodes.delete(id);
            updated++;
          } catch {
            failed++;
          }
        }
        break;
      }

      default: {
        throw data("Invalid action", {
          status: 400,
        });
      }
    }

    // One refresh at the end covers the whole run.
    await headscaleLiveStore.refresh(nodesResource, api);
    return { success: true as const, updated, failed };
  }

  // Check if the user has permission to manage this machine
  const nodeId = formData.get("node_id")?.toString();
  if (!nodeId) {
    throw data("Missing `node_id` in the form data.", {
      status: 400,
    });
  }

  const node = await api.nodes.get(nodeId);
  if (!node) {
    throw data(`Machine with ID ${nodeId} not found`, {
      status: 404,
    });
  }

  if (!auth.canManageNode(principal, node)) {
    throw data(
      { localized: { key: "errors.permission.actOnMachine" } },
      {
        status: 403,
      },
    );
  }

  switch (action) {
    case "rename": {
      const newName = formData.get("name")?.toString();
      if (!newName) {
        throw data("Missing `name` in the form data.", {
          status: 400,
        });
      }

      const name = String(formData.get("name"));
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name.toLowerCase())) {
        throw data(
          "Machine names must be valid DNS labels: lowercase letters, numbers, and hyphens only, and must start and end with a letter or number.",
          { status: 400 },
        );
      }

      await api.nodes.rename(nodeId, name);
      await headscaleLiveStore.refresh(nodesResource, api);
      return { message: "Machine renamed" };
    }

    case "delete": {
      await api.nodes.delete(nodeId);
      await headscaleLiveStore.refresh(nodesResource, api);
      return redirect("/machines");
    }

    case "expire": {
      await api.nodes.expire(nodeId);
      await headscaleLiveStore.refresh(nodesResource, api);
      return { message: "Machine expired" };
    }

    case "toggle_expiry": {
      const disableExpiry = String(formData.get("disableExpiry")) === "true";
      await api.nodes.toggleExpiry(nodeId, disableExpiry);
      await headscaleLiveStore.refresh(nodesResource, api);
      return { message: "Machine expired" };
    }

    case "set_expiry": {
      // Three modes: "never" disables key expiry, "default" restores the
      // Headscale default (a key that expires now), and "custom" pins an
      // explicit timestamp chosen by the user.
      const mode = formData.get("expiry_mode")?.toString();

      if (mode === "never") {
        await api.nodes.toggleExpiry(nodeId, true);
      } else if (mode === "default") {
        await api.nodes.toggleExpiry(nodeId, false);
      } else if (mode === "custom") {
        const raw = formData.get("expiry")?.toString();
        const expiry = raw ? new Date(raw) : new Date(Number.NaN);
        if (!raw || Number.isNaN(expiry.getTime())) {
          return data(
            { success: false as const, errorCode: "invalidExpiry" as const },
            {
              status: 400,
            },
          );
        }

        if (expiry.getTime() <= Date.now()) {
          return data(
            { success: false as const, errorCode: "expiryInPast" as const },
            {
              status: 400,
            },
          );
        }

        await api.nodes.setExpiry(nodeId, expiry);
      } else {
        return data(
          { success: false as const, errorCode: "invalidExpiry" as const },
          {
            status: 400,
          },
        );
      }

      await headscaleLiveStore.refresh(nodesResource, api);
      return { success: true as const, message: "Machine expiry updated" };
    }

    case "update_tags": {
      const tags = formData.get("tags")?.toString().split(",") ?? [];
      if (tags.length === 0) {
        throw data("Missing `tags` in the form data.", {
          status: 400,
        });
      }

      try {
        await api.nodes.setTags(
          nodeId,
          tags.map((tag) => tag.trim()).filter((tag) => tag !== ""),
        );

        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Tags updated" };
      } catch (error) {
        if (isDataWithApiError(error) && error.data.statusCode === 400) {
          // The API message is passed through; when there is none, the UI
          // translates `tagsNotInPolicy` itself.
          const apiMessage = extractApiErrorMessage(error.data);
          return data(
            {
              success: false as const,
              ...(apiMessage !== undefined
                ? { error: apiMessage }
                : { errorCode: "tagsNotInPolicy" as const }),
            },
            { status: 400 },
          );
        }

        throw error;
      }
    }

    case "update_routes": {
      const newApproved = node.approvedRoutes;
      const routes = formData.get("routes")?.toString();
      if (!routes) {
        throw data("Missing `routes` in the form data.", {
          status: 400,
        });
      }

      const allRoutes = routes.split(",").map((route) => route.trim());
      if (allRoutes.length === 0) {
        throw data("No routes provided to update", {
          status: 400,
        });
      }

      const enabled = formData.get("enabled")?.toString();
      if (enabled === undefined) {
        throw data("Missing `enabled` in the form data.", {
          status: 400,
        });
      }

      if (enabled === "true") {
        for (const route of allRoutes) {
          // If already approved, skip, otherwise add to approved
          if (newApproved.includes(route)) {
            continue;
          }

          newApproved.push(route);
        }
      } else {
        for (const route of allRoutes) {
          // If not approved, skip, otherwise remove from approved
          if (!newApproved.includes(route)) {
            continue;
          }

          const index = newApproved.indexOf(route);
          if (index > -1) {
            newApproved.splice(index, 1);
          }
        }
      }

      await api.nodes.approveRoutes(nodeId, newApproved);
      await headscaleLiveStore.refresh(nodesResource, api);
      return { message: "Routes updated" };
    }

    case "reassign": {
      const user = formData.get("user_id")?.toString();
      if (!user) {
        throw data("Missing `user_id` in the form data.", {
          status: 400,
        });
      }

      if (!api.nodes.reassignUser) {
        throw data("Reassigning a node owner is no longer supported on this Headscale version.", {
          status: 400,
        });
      }
      await api.nodes.reassignUser(nodeId, user);
      await headscaleLiveStore.refresh(nodesResource, api);
      return { message: "Machine reassigned" };
    }

    default:
      throw data("Invalid action", {
        status: 400,
      });
  }
}

function extractApiErrorMessage(error: { data?: unknown; rawData: string }) {
  if (error.data != null && typeof error.data === "object" && "message" in error.data) {
    const message = (error.data as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return error.rawData.length > 0 ? error.rawData : undefined;
}
