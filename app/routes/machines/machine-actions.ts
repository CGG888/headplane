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
import type { Machine } from "~/types";
import log from "~/utils/log";
import { normalizeRegistrationKey } from "~/utils/register-key";

import type { Route } from "./+types/machine";
import { BACKFILL_ACTION, backfillSummary } from "./backfill-request";
import { DEBUG_NODE_ACTION, debugNodeSummary, isCidr } from "./debug-node-request";

/**
 * Stable error codes returned to the machine expiry dialog. The UI maps these
 * onto localized messages so the server never emits user-facing English text.
 */
export type MachineExpiryErrorCode = "invalidExpiry" | "expiryInPast" | "failed";

/**
 * Stable error code for the single-node dialogs (rename, delete, move, tag and
 * route edits). Headscale refusing the call is normal - the node may have been
 * deleted in another tab - and it must reach the dialog as data rather than as
 * a thrown response, which would replace the machines page with an error page.
 */
export type MachineActionErrorCode = "failed";

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
 * Stable error codes for the two node-wide operations the machines pages offer
 * outside the per-node flow: the list's address backfill and the detail page's
 * debug-node dialog. As above, the UI maps these onto localized messages.
 */
export type MachineMaintenanceErrorCode = "failed" | "invalidRoutes";

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

/**
 * One maintenance outcome, as its dialog reads it. The server's own message
 * travels beside the code whenever Headscale explained itself, so the dialog
 * can show what the server said instead of a generic line.
 */
function maintenanceError(
  errorCode: MachineMaintenanceErrorCode | MachineActionErrorCode,
  options: { message?: string; status?: number } = {},
) {
  return data(
    {
      success: false as const,
      errorCode,
      ...(options.message !== undefined ? { error: options.message } : {}),
    },
    { status: options.status ?? 502 },
  );
}

/**
 * One single-node dialog outcome for a failed Headscale call. Throwing here
 * would hand the response to the nearest ErrorBoundary, which replaces the
 * whole machines page (and with it the list the user was working in) because
 * the transport layer turns every 4xx/5xx into a 502. Returning the failure
 * instead lets the dialog stay open and say what Headscale said.
 */
function actionError(error: unknown) {
  return maintenanceError("failed", { message: apiErrorMessage(error) });
}

/** Headscale's own explanation of a failed call, when it gave one. */
function apiErrorMessage(error: unknown): string | undefined {
  if (isDataWithApiError(error)) {
    return extractApiErrorMessage(error.data);
  }

  const message = describeError(error);
  return message === "unknown error" ? undefined : message;
}

/** A thrown value as one short line the audit log can keep. */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  const text = typeof error === "string" ? error.trim() : "";
  return text.length > 0 ? text : "unknown error";
}

/** Headscale node ids are decimal `uint64` values; nothing else is valid. */
const NODE_ID_PATTERN = /^\d{1,20}$/;

/** Reads the selected node ids, dropping blanks and duplicates. */
function readBulkNodeIds(formData: FormData): string[] {
  const ids = new Set<string>();
  for (const value of formData.getAll("node_ids")) {
    const id = value.toString().trim();
    if (id.length === 0) {
      continue;
    }
    // Reject anything that is not a plain decimal id: `new URL()` collapses
    // `..` segments, so an id like `../user/1` would otherwise be interpolated
    // into the request path and hit a different API endpoint.
    if (!NODE_ID_PATTERN.test(id)) {
      throw data(`Invalid \`node_ids\` entry: ${JSON.stringify(id)}`, { status: 400 });
    }
    ids.add(id);
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

  // Backfilling addresses is a repair across the whole server, not an action on
  // one node, so it is handled before the `node_id` lookup. It writes, so it is
  // gated on the same capability as every other machine mutation.
  if (action === BACKFILL_ACTION) {
    if (!auth.can(principal, Capabilities.write_machines)) {
      throw data(
        { localized: { key: "errors.permission.manageMachines" } },
        {
          status: 403,
        },
      );
    }

    let changes: string[];
    try {
      changes = await api.nodes.backfillIps();
    } catch (error) {
      // A failed repair is worth recording: it is the one path where a node
      // that needs an address is left without one.
      await audit?.record({
        ...auditActorOf(principal),
        action: AUDIT_ACTIONS.nodeBackfillIps,
        target: "all nodes",
        detail: describeError(error),
        result: "failure",
      });

      return maintenanceError("failed", { message: apiErrorMessage(error) });
    }

    const summary = backfillSummary(changes);
    await audit?.record({
      ...auditActorOf(principal),
      action: AUDIT_ACTIONS.nodeBackfillIps,
      target: summary.nodeIds.join(", "),
      detail: changes.length > 0 ? changes.join("; ") : "nothing was missing",
      result: "success",
    });

    // The addresses live on the nodes themselves, so the list is re-read rather
    // than patched.
    await headscaleLiveStore.refresh(nodesResource, api);
    return { success: true as const, changes };
  }

  // The debug dialog fabricates a node instead of registering a device, so like
  // `register` above it is answered before any existing node is looked up; the
  // node it reports does not exist until this call has run.
  if (action === DEBUG_NODE_ACTION) {
    if (!auth.can(principal, Capabilities.write_machines)) {
      throw data(
        { localized: { key: "errors.permission.manageMachines" } },
        {
          status: 403,
        },
      );
    }

    // Only what the operator filled in travels; an empty field is omitted so
    // Headscale chooses it rather than receiving a blank one.
    const read = (name: string) => {
      const value = formData.get(name)?.toString().trim() ?? "";
      return value.length > 0 ? value : undefined;
    };

    const user = read("user");
    const key = read("key");
    const name = read("name");
    const routes = (formData.get("routes")?.toString() ?? "")
      .split(",")
      .map((route) => route.trim())
      .filter((route) => route.length > 0);

    // The dialog validates before it submits; this is the same rule enforced
    // once more so a hand-built request cannot reach Headscale with a prefix
    // length it will reject anyway.
    if (!routes.every(isCidr)) {
      return maintenanceError("invalidRoutes", { status: 400 });
    }

    let node: Machine;
    try {
      node = await api.nodes.debug({
        user,
        key,
        name,
        routes: routes.length > 0 ? routes : undefined,
      });
    } catch (error) {
      await audit?.record({
        ...auditActorOf(principal),
        action: AUDIT_ACTIONS.nodeDebugCreate,
        target: name ?? "debug node",
        detail: describeError(error),
        result: "failure",
      });

      return maintenanceError("failed", { message: apiErrorMessage(error) });
    }

    const summary = debugNodeSummary(node);
    await audit?.record({
      ...auditActorOf(principal),
      action: AUDIT_ACTIONS.nodeDebugCreate,
      target: summary.name || summary.id,
      detail: routes.length > 0 ? routes.join(", ") : "no routes",
      result: "success",
    });

    // The node the response describes is a real entry in Headscale now, so the
    // list behind the dialog is re-read before the operator is told its name.
    await headscaleLiveStore.refresh(nodesResource, api);
    return { success: true as const, node: summary };
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
    // Why each failure happened, so the dialogs can name the machines that were
    // not changed instead of reporting only how many there were.
    const failures: Array<{ id: string; reason: string }> = [];

    const recordFailure = (id: string, error: unknown) => {
      const reason = apiErrorMessage(error) ?? describeError(error);
      failed += 1;
      failures.push({ id, reason });
      log.warn("api", "Bulk machine action %s failed for node %s: %s", action, id, reason);
    };

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
          } catch (error) {
            recordFailure(id, error);
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
          } catch (error) {
            recordFailure(id, error);
          }
        }
        break;
      }

      case "bulk_reassign": {
        // Headscale resolves the new owner by *username*: the endpoint is
        // `POST v1/node/{id}/user` with `{"user": "bob"}`. Passing the numeric
        // Headplane user id made every move fail with a 4xx.
        const user = readOwnerName(formData);
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
          } catch (error) {
            recordFailure(id, error);
          }
        }
        break;
      }

      case "bulk_delete": {
        for (const id of nodeIds) {
          try {
            await api.nodes.delete(id);
            updated++;
          } catch (error) {
            recordFailure(id, error);
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
    return { success: true as const, updated, failed, failures };
  }

  // Check if the user has permission to manage this machine
  const nodeId = formData.get("node_id")?.toString();
  if (!nodeId) {
    throw data("Missing `node_id` in the form data.", {
      status: 400,
    });
  }

  // See `readBulkNodeIds`: a non-decimal id must never reach the request path.
  if (!NODE_ID_PATTERN.test(nodeId.trim())) {
    throw data(`Invalid \`node_id\` in the form data: ${JSON.stringify(nodeId)}`, {
      status: 400,
    });
  }

  // A Headscale outage here must reach the open dialog as data, not replace
  // the page with the nearest error boundary. `get` either returns the machine
  // or throws, so a genuinely missing machine arrives through `actionError`.
  let node: Machine;
  try {
    node = await api.nodes.get(nodeId);
  } catch (error) {
    return actionError(error);
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

      // Headscale keeps node names as lowercase DNS labels, so normalise once
      // and send exactly the value that was validated.
      const name = newName.toLowerCase();
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
        throw data(
          "Machine names must be valid DNS labels: lowercase letters, numbers, and hyphens only, and must start and end with a letter or number.",
          { status: 400 },
        );
      }

      try {
        await api.nodes.rename(nodeId, name);
        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Machine renamed" };
      } catch (error) {
        return actionError(error);
      }
    }

    case "delete": {
      try {
        await api.nodes.delete(nodeId);
        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Machine removed" };
      } catch (error) {
        return actionError(error);
      }
    }

    case "expire": {
      try {
        await api.nodes.expire(nodeId);
        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Machine expired" };
      } catch (error) {
        return actionError(error);
      }
    }

    case "toggle_expiry": {
      // The menu submits the boolean as the strings "true"/"false"; anything
      // else (a missing field, "TRUE", "") must be rejected explicitly rather
      // than silently read as "restore Headscale's default".
      const rawDisableExpiry = formData.get("disableExpiry")?.toString();
      if (rawDisableExpiry !== "true" && rawDisableExpiry !== "false") {
        throw data("Missing or invalid `disableExpiry` in the form data.", {
          status: 400,
        });
      }

      const disableExpiry = rawDisableExpiry === "true";

      try {
        await api.nodes.toggleExpiry(nodeId, disableExpiry);
        await headscaleLiveStore.refresh(nodesResource, api);
        return {
          success: true as const,
          // Two distinct messages, so the caller can tell "key expiry disabled"
          // from "key expiry restored" instead of one shared string. Like every
          // other arm in this switch these are plain strings and no UI reads them.
          message: disableExpiry ? "Key expiry disabled" : "Key expiry restored",
        };
      } catch (error) {
        return actionError(error);
      }
    }

    case "set_expiry": {
      // Three modes: "never" disables key expiry, "default" restores the
      // Headscale default (a key that expires now), and "custom" pins an
      // explicit timestamp chosen by the user.
      const mode = formData.get("expiry_mode")?.toString();

      try {
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
      } catch (error) {
        return actionError(error);
      }
    }

    case "update_tags": {
      const tags = (formData.get("tags")?.toString() ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "");

      // Sanitize before the emptiness check. `"".split(",")` is `[""]`, which
      // passed the old `length === 0` guard and then filtered down to `[]` —
      // Headscale applies that as "remove every tag from the node".
      if (tags.length === 0) {
        throw data("Missing `tags` in the form data.", {
          status: 400,
        });
      }

      if (tags.length > 64) {
        throw data("Too many `tags` in the form data.", {
          status: 400,
        });
      }

      const invalidTag = tags.find((tag) => !/^tag:[^\s/]{1,127}$/.test(tag));
      if (invalidTag !== undefined) {
        throw data(`Invalid tag in the form data: ${invalidTag}`, {
          status: 400,
        });
      }

      try {
        await api.nodes.setTags(nodeId, [...new Set(tags)]);

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

        return actionError(error);
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

      const allRoutes = routes
        .split(",")
        .map((route) => route.trim())
        .filter((route) => route.length > 0);
      if (allRoutes.length === 0) {
        throw data("No routes provided to update", {
          status: 400,
        });
      }

      // The dialog only sends routes the node advertises, but the action is
      // reachable with a hand-written POST: without these checks any
      // `write_machines` holder could pre-approve `0.0.0.0/0` and `::/0` for a
      // node that never advertised them, or push arbitrary strings through.
      const invalidRoute = allRoutes.find((route) => !isCidr(route));
      if (invalidRoute !== undefined) {
        throw data(`Invalid route prefix in the form data: ${invalidRoute}`, {
          status: 400,
        });
      }

      const knownRoutes = new Set([...node.availableRoutes, ...node.approvedRoutes]);
      const unknownRoute = allRoutes.find((route) => !knownRoutes.has(route));
      if (unknownRoute !== undefined) {
        throw data(`Route ${unknownRoute} is not advertised by this machine`, {
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

      try {
        await api.nodes.approveRoutes(nodeId, newApproved);
        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Routes updated" };
      } catch (error) {
        return actionError(error);
      }
    }

    case "reassign": {
      const user = readOwnerName(formData);
      if (!user) {
        throw data("Missing `user_name` in the form data.", {
          status: 400,
        });
      }

      if (!api.nodes.reassignUser) {
        throw data("Reassigning a node owner is no longer supported on this Headscale version.", {
          status: 400,
        });
      }
      try {
        await api.nodes.reassignUser(nodeId, user);
        await headscaleLiveStore.refresh(nodesResource, api);
        return { success: true as const, message: "Machine reassigned" };
      } catch (error) {
        return actionError(error);
      }
    }

    default:
      throw data("Invalid action", {
        status: 400,
      });
  }
}

/**
 * Reads the new owner for a node move. Headscale takes a *username* here
 * (`POST v1/node/{id}/user` with `{"user": "bob"}`), not a numeric id, so the
 * dialogs send `user.name`. Anything empty, absurdly long, or containing
 * whitespace/slashes is rejected before it reaches the API.
 */
function readOwnerName(formData: FormData): string | undefined {
  const raw = formData.get("user_name")?.toString()?.trim();
  if (!raw || raw.length > 64) {
    return undefined;
  }

  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (/\s/.test(character) || character === "/" || code < 0x20 || code === 0x7f) {
      return undefined;
    }
  }

  return raw;
}

function extractApiErrorMessage(error: { data?: unknown; detail: string }) {
  if (error.data != null && typeof error.data === "object" && "message" in error.data) {
    const message = (error.data as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return error.detail.length > 0 ? error.detail : undefined;
}
