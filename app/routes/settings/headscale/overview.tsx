import { data } from "react-router";

import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  headscaleConfigContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { nodesResource } from "~/server/headscale/live-store";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { headscaleSettingsAction } from "./actions";
import AdvancedSettings from "./components/advanced-settings";
import DerpSettings from "./components/derp-settings";
import DerpStatus from "./components/derp-status";
import OidcSettings from "./components/oidc-settings";
import PolicyModeSettings from "./components/policy-mode";
import TrustedProxies from "./components/trusted-proxies";
import { findFatalOidcKeys } from "./config-warnings";
import { buildDerpRelayRows, type DerpRelayRow } from "./derp-status";

export async function loader({ request, context }: Route.LoaderArgs) {
  const agentsFeature = context.get(agentsContext);
  const auth = context.get(authContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const appConfig = context.get(appConfigContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  if (!headscaleConfig.readable()) {
    throw new Error("No configuration is available");
  }

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.read_users);
  if (!check) {
    // Not authorized to view this page
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  // Relay data comes from the Headplane Agent, so it is only read when the
  // agent is running and the viewer may see machines.
  const agents = agentsFeature.state === "enabled" ? agentsFeature.value : undefined;
  let derpRelay: DerpRelayRow[] = [];
  if (agents && auth.can(principal, Capabilities.read_machines)) {
    try {
      const { api } = await getRequestApi(request);
      const nodesSnap = await headscaleLiveStore.get(nodesResource, api);
      const stats = await agents.lookup(nodesSnap.data.map((node) => node.nodeKey));
      derpRelay = buildDerpRelayRows(nodesSnap.data, stats);
    } catch {
      // Best-effort: an unreachable agent or API leaves the table empty.
      derpRelay = [];
    }
  }

  const { policyMode, policyPath, trustedProxies } = headscaleConfig.getTailnetSettings();
  return {
    access: auth.can(principal, Capabilities.configure_iam),
    writable: headscaleConfig.writable(),
    oidc: headscaleConfig.getOIDCSettings() ?? null,
    advanced: headscaleConfig.getAdvancedSettings(),
    derp: headscaleConfig.getDERPSettings(),
    derpRelay,
    agentEnabled: agents !== undefined,
    policyMode,
    policyPath,
    trustedProxies,
    fatalOidcKeys: await findFatalOidcKeys(appConfig.headscale.config_path),
  };
}

export const action = headscaleSettingsAction;

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const {
    access,
    writable,
    oidc,
    advanced,
    derp,
    derpRelay,
    agentEnabled,
    policyMode,
    policyPath,
    trustedProxies,
    fatalOidcKeys,
  } = loaderData;
  const isDisabled = writable ? !access : true;

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-4">
      <div className="flex w-full flex-col sm:w-2/3">
        <p className="text-md mb-4">
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.headscale.breadcrumb")}
        </p>
        {!writable ? (
          <Notice title={t("settings.headscale.notWritableTitle")} variant="error">
            {tr("settings.headscale.notWritableBody", { file: <Code>config.yaml</Code> })}
          </Notice>
        ) : !access ? (
          <Notice title={t("settings.headscale.readOnlyTitle")} variant="warning">
            {t("errors.permission.modifyIam")}
          </Notice>
        ) : undefined}
        {fatalOidcKeys.length > 0 ? (
          <Notice title={t("settings.headscale.fatalTitle")} variant="error">
            {tr("settings.headscale.fatalBody", {
              keys: <Code>{fatalOidcKeys.join(", ")}</Code>,
              setting: <Code>node.expiry</Code>,
            })}
          </Notice>
        ) : undefined}
        <h1 className="mt-4 mb-2 text-2xl font-medium">{t("settings.headscale.title")}</h1>
        <p>{t("settings.headscale.body")}</p>
      </div>

      <OidcSettings isDisabled={isDisabled} oidc={oidc} />
      <TrustedProxies isDisabled={isDisabled} proxies={trustedProxies} />
      <PolicyModeSettings isDisabled={isDisabled} mode={policyMode} path={policyPath} />
      <AdvancedSettings isDisabled={isDisabled} settings={advanced} />
      <DerpSettings isDisabled={isDisabled} settings={derp} />
      <DerpStatus agentEnabled={agentEnabled} rows={derpRelay} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
