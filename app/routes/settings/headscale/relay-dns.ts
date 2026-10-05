/**
 * Resource route behind the relay DNS resolver card in the DERP settings.
 *
 * The list of DNS servers used for relay lookups is Headplane state rather than
 * Headscale configuration, so it is stored in Headplane's data directory and
 * served from here instead of the Headscale settings action — which also means
 * the card keeps working when Headscale's config file is mounted read-only, and
 * that the route can answer the "re-resolve now" request with a fresh lookup.
 *
 * Writes require the same capability as the page's other writes
 * (`configure_iam`), and the response never carries English: a rejection is a
 * stable code the form maps onto a localized message.
 */

import { data } from "react-router";

import { appConfigContext, authContext, headscaleConfigContext } from "~/server/context";
import {
  clearSharedRelayDnsCache,
  loadSharedRelayResolution,
  reResolveSharedRelayHost,
} from "~/server/relay-dns";
import { readRelayDnsServers, writeRelayDnsServers } from "~/server/relay-dns-store";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/relay-dns";
import { deriveDerpPublicEndpoint } from "./derp-settings";
import {
  MAX_RELAY_DNS_SERVERS,
  parseRelayDnsServer,
  type RelayDnsActionResult,
  type RelayDnsErrorCode,
  type RelayDnsResourceData,
} from "./relay-dns-servers";

/**
 * Reads what the card renders: the stored list, whether this viewer may change
 * it, and the relay lookup the cards show. `refresh` runs the lookup again after
 * clearing the cache, which is what the card's button posts.
 */
async function buildState(
  context: Route.LoaderArgs["context"],
  canEdit: boolean,
  refresh: boolean,
): Promise<RelayDnsResourceData> {
  const appConfig = context.get(appConfigContext);
  const headscaleConfig = context.get(headscaleConfigContext);

  const servers = await readRelayDnsServers(appConfig.server.data_path);

  // Without a readable config there is no relay host to look up, but the list
  // itself is still worth showing so the operator can fix it.
  const serverUrl = headscaleConfig.readable()
    ? headscaleConfig.getDERPSettings().serverUrl
    : undefined;
  const endpoint = deriveDerpPublicEndpoint(serverUrl);
  const resolution = refresh
    ? await reResolveSharedRelayHost(endpoint?.host)
    : await loadSharedRelayResolution(endpoint?.host);

  return {
    canEdit,
    servers,
    maxServers: MAX_RELAY_DNS_SERVERS,
    ...(endpoint === undefined ? {} : { endpoint: { host: endpoint.host, port: endpoint.port } }),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.read_users)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  return data(await buildState(context, auth.can(principal, Capabilities.configure_iam), false));
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  const formData = await request.formData();
  const actionId = formData.get("action_id")?.toString();
  const dataPath = context.get(appConfigContext).server.data_path;

  switch (actionId) {
    case "add_relay_dns_server": {
      const server = parseRelayDnsServer(formData.get("server")?.toString() ?? "");
      if (server === undefined) {
        return failure("invalidRelayDnsServer");
      }

      const servers = await readRelayDnsServers(dataPath);
      if (servers.includes(server)) {
        return failure("duplicateRelayDnsServer");
      }

      if (servers.length >= MAX_RELAY_DNS_SERVERS) {
        return failure("relayDnsServerLimit");
      }

      if (!(await writeRelayDnsServers(dataPath, [...servers, server]))) {
        return failure("relayDnsWriteFailed");
      }

      // The new server changes the answer, so the lookups are re-run rather
      // than served from the previous resolver's cache.
      clearSharedRelayDnsCache();
      return success(await buildState(context, true, false));
    }

    case "remove_relay_dns_server": {
      const server = parseRelayDnsServer(formData.get("server")?.toString() ?? "");
      if (server === undefined) {
        return failure("invalidRelayDnsServer");
      }

      const servers = await readRelayDnsServers(dataPath);
      if (!servers.includes(server)) {
        return failure("relayDnsServerNotFound");
      }

      if (
        !(await writeRelayDnsServers(
          dataPath,
          servers.filter((entry) => entry !== server),
        ))
      ) {
        return failure("relayDnsWriteFailed");
      }

      clearSharedRelayDnsCache();
      return success(await buildState(context, true, false));
    }

    case "refresh_relay_dns": {
      // The whole point of the button: a name with no records is cached for five
      // minutes, so a fixed DNS server would otherwise not show up until then.
      clearSharedRelayDnsCache();
      return success(await buildState(context, true, true));
    }

    default: {
      return failure("invalidAction");
    }
  }
}

function failure(errorCode: RelayDnsErrorCode) {
  return data({ ok: false, errorCode } satisfies RelayDnsActionResult, { status: 400 });
}

function success(state: RelayDnsResourceData) {
  return data({ ok: true, ...state } satisfies RelayDnsActionResult);
}
