import { data } from "react-router";

import { AUDIT_ACTIONS, auditActorOf, type AuditService } from "~/server/audit";
import {
  auditContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
  type AppContext,
} from "~/server/context";
import { SNAPSHOT_REASONS } from "~/server/snapshots/reasons";
import { snapshotBeforeMutation, type SnapshotService } from "~/server/snapshots/service.server";
import type { Principal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";
import { isValidRestrictionDomain, isValidRestrictionName } from "~/utils/restrictions";

import type { Route } from "./+types/overview";

interface RestrictionServices {
  audit: AuditService | undefined;
  snapshots: SnapshotService | undefined;
}

/** Records one operation; never throws, so it cannot break the mutation. */
async function recordOperation(
  services: RestrictionServices,
  principal: Principal,
  action: string,
  target: string,
  result: "success" | "failure",
  detail?: string,
) {
  await services.audit?.record({
    ...auditActorOf(principal),
    action,
    target,
    detail: detail ?? null,
    result,
  });
}

/**
 * Every restriction change rewrites Headscale's configuration file, so a
 * snapshot is taken first. A failed snapshot is logged and does not block the
 * change.
 */
async function snapshotConfig(services: RestrictionServices) {
  await snapshotBeforeMutation(services.snapshots, SNAPSHOT_REASONS.restrictionChange);
}

/**
 * Asks the configured integration to reload Headscale. The configuration is
 * already written at this point, so a failing reload is logged rather than
 * reported as a failed change.
 */
async function reloadHeadscale(
  integration: AppContext["integration"],
  headscale: AppContext["headscale"],
) {
  try {
    await integration?.onConfigChange(headscale);
  } catch (error) {
    log.warn("config", "Failed to reload Headscale after a settings change: %s", String(error));
  }
}

export async function restrictionAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const integration = context.get(integrationContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  const services: RestrictionServices = {
    audit: context.get(auditContext),
    snapshots: context.get(snapshotContext),
  };

  if (!check) {
    throw data(
      { localized: { key: "errors.permission.modifyIam" } },
      {
        status: 403,
      },
    );
  }

  if (!headscaleConfig.writable()) {
    throw data("The Headscale configuration file is not editable.", {
      status: 403,
    });
  }

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();
  if (!action) {
    throw data("No action provided.", {
      status: 400,
    });
  }

  switch (action) {
    case "add_domain": {
      const domain = formData.get("domain")?.toString()?.trim();
      if (!domain) {
        throw data("No domain provided.", {
          status: 400,
        });
      }

      if (!isValidRestrictionDomain(domain)) {
        throw data("Invalid domain provided.", {
          status: 400,
        });
      }

      if (!headscaleConfig.getOIDCConfig()) {
        // The in-memory config view is the only source for the current list.
        // Without it the old code fell back to `?? []` and rewrote
        // `oidc.allowed_domains` as a single-entry list, dropping the rest.
        throw data("OIDC is not configured.", {
          status: 409,
        });
      }

      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_domains",
            value: [...new Set([...current.allowedDomains, domain])],
          },
        ];
      });

      await reloadHeadscale(integration, headscale);
      await recordOperation(
        services,
        principal,
        AUDIT_ACTIONS.restrictionAddDomain,
        domain,
        "success",
      );
      return data("Domain added successfully.");
    }

    case "remove_domain": {
      const domain = formData.get("domain")?.toString()?.trim();
      if (!domain) {
        throw data("No domain provided.", {
          status: 400,
        });
      }

      const storedDomains = headscaleConfig.getOIDCConfig()?.allowedDomains ?? [];
      if (!storedDomains.includes(domain)) {
        // Domain not found in the list
        await recordOperation(
          services,
          principal,
          AUDIT_ACTIONS.restrictionRemoveDomain,
          domain,
          "failure",
          "notFound",
        );

        throw data(`Domain "${domain}" not found in allowed domains.`, {
          status: 400,
        });
      }

      // Filter out the domain to remove it from the list
      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_domains",
            value: current.allowedDomains.filter((d: string) => d !== domain),
          },
        ];
      });
      await reloadHeadscale(integration, headscale);
      await recordOperation(
        services,
        principal,
        AUDIT_ACTIONS.restrictionRemoveDomain,
        domain,
        "success",
      );
      return data("Domain removed successfully.");
    }

    case "add_group": {
      const group = formData.get("group")?.toString()?.trim();
      if (!group) {
        throw data("No group provided.", {
          status: 400,
        });
      }

      if (!isValidRestrictionName(group)) {
        throw data("Invalid group provided.", {
          status: 400,
        });
      }

      if (!headscaleConfig.getOIDCConfig()) {
        throw data("OIDC is not configured.", {
          status: 409,
        });
      }

      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_groups",
            value: [...new Set([...current.allowedGroups, group])],
          },
        ];
      });

      await reloadHeadscale(integration, headscale);
      await recordOperation(
        services,
        principal,
        AUDIT_ACTIONS.restrictionAddGroup,
        group,
        "success",
      );
      return data("Group added successfully.");
    }

    case "remove_group": {
      const group = formData.get("group")?.toString()?.trim();
      if (!group) {
        throw data("No group provided.", {
          status: 400,
        });
      }

      const storedGroups = headscaleConfig.getOIDCConfig()?.allowedGroups ?? [];
      if (!storedGroups.includes(group)) {
        // Group not found in the list
        await recordOperation(
          services,
          principal,
          AUDIT_ACTIONS.restrictionRemoveGroup,
          group,
          "failure",
          "notFound",
        );

        throw data(`Group "${group}" not found in allowed groups.`, {
          status: 400,
        });
      }

      // Filter out the group to remove it from the list
      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_groups",
            value: current.allowedGroups.filter((d: string) => d !== group),
          },
        ];
      });

      await reloadHeadscale(integration, headscale);
      await recordOperation(
        services,
        principal,
        AUDIT_ACTIONS.restrictionRemoveGroup,
        group,
        "success",
      );
      return data("Group removed successfully.");
    }

    case "add_user": {
      const user = formData.get("user")?.toString()?.trim();
      if (!user) {
        throw data("No user provided.", {
          status: 400,
        });
      }

      if (!isValidRestrictionName(user)) {
        throw data("Invalid user provided.", {
          status: 400,
        });
      }

      if (!headscaleConfig.getOIDCConfig()) {
        throw data("OIDC is not configured.", {
          status: 409,
        });
      }

      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_users",
            value: [...new Set([...current.allowedUsers, user])],
          },
        ];
      });

      await reloadHeadscale(integration, headscale);
      await recordOperation(services, principal, AUDIT_ACTIONS.restrictionAddUser, user, "success");
      return data("User added successfully.");
    }

    case "remove_user": {
      const user = formData.get("user")?.toString()?.trim();
      if (!user) {
        throw data("No user provided.", {
          status: 400,
        });
      }

      const storedUsers = headscaleConfig.getOIDCConfig()?.allowedUsers ?? [];
      if (!storedUsers.includes(user)) {
        // User not found in the list
        await recordOperation(
          services,
          principal,
          AUDIT_ACTIONS.restrictionRemoveUser,
          user,
          "failure",
          "notFound",
        );

        throw data(`User "${user}" not found in allowed users.`, {
          status: 400,
        });
      }

      // Filter out the user to remove it from the list
      await snapshotConfig(services);
      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getOIDCConfig();
        if (!current) {
          return [];
        }

        return [
          {
            path: "oidc.allowed_users",
            value: current.allowedUsers.filter((d: string) => d !== user),
          },
        ];
      });

      await reloadHeadscale(integration, headscale);
      await recordOperation(
        services,
        principal,
        AUDIT_ACTIONS.restrictionRemoveUser,
        user,
        "success",
      );
      return data("User removed successfully.");
    }

    default: {
      throw data("Invalid action provided.", {
        status: 400,
      });
    }
  }
}
