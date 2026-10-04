import { KeyRound, Network, Scale, ShieldCheck, SlidersHorizontal, Tags } from "lucide-react";
import { data } from "react-router";

import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsCollapsible,
  SettingsPage,
  SettingsPanel,
  SettingsTab,
  SettingsTabList,
  SettingsTabs,
} from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  headscaleConfigContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { readDerpRegionNames } from "~/server/headscale/derp-region-names";
import { nodesResource } from "~/server/headscale/live-store";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { headscaleSettingsAction } from "./actions";
import AdvancedSettings from "./components/advanced-settings";
import DerpRegionNames from "./components/derp-region-names";
import DerpSettings from "./components/derp-settings";
import DerpStatus from "./components/derp-status";
import OidcSettings from "./components/oidc-settings";
import PolicyModeSettings from "./components/policy-mode";
import TrustedProxies from "./components/trusted-proxies";
import { findFatalOidcKeys } from "./config-warnings";
import {
  classifyDerpRelaySource,
  defaultDerpPrivateKeyPath,
  type DerpRelaySource,
} from "./derp-settings";
import { buildDerpRelayRows, type DerpRelayRow } from "./derp-status";

/** The wording for each place the DERP relays can come from. */
const RELAY_SOURCE_KEYS: Record<DerpRelaySource, TranslationKey> = {
  "embedded-only": "settings.headscale.derp.relaySourceEmbeddedOnly",
  "embedded-and-map": "settings.headscale.derp.relaySourceEmbeddedAndMap",
  "map-only": "settings.headscale.derp.relaySourceMapOnly",
  none: "settings.headscale.derp.relaySourceNone",
};

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
    // Manual names for the regions Headscale cannot name itself, plus the
    // documented key location the embedded-server preset prefills.
    derpRegionNames: await readDerpRegionNames(appConfig.server.data_path),
    derpPrivateKeyDefault: defaultDerpPrivateKeyPath(appConfig.headscale.config_path),
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
    derpRegionNames,
    derpPrivateKeyDefault,
    derpRelay,
    agentEnabled,
    policyMode,
    policyPath,
    trustedProxies,
    fatalOidcKeys,
  } = loaderData;
  const isDisabled = writable ? !access : true;

  // Which relays clients are handed, shown above the DERP blocks so it is
  // readable without opening any of them.
  const relaySource = classifyDerpRelaySource({
    serverEnabled: derp.server.enabled,
    urls: derp.urls,
  });
  const relaySourceSummary = t("settings.headscale.derp.relaySourceLabel", {
    source: t(RELAY_SOURCE_KEYS[relaySource]),
  });
  const relaySourceStatus: { tone: "ok" | "warn"; label: string } = {
    tone: relaySource === "none" ? "warn" : "ok",
    label: t(RELAY_SOURCE_KEYS[relaySource]),
  };

  const oidcConfigured = oidc !== null && oidc.issuer.length > 0;

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.headscale.breadcrumb")}
        </>
      }
      description={t("settings.headscale.body")}
      notices={
        <>
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
        </>
      }
      title={t("settings.headscale.title")}
    >
      <SettingsTabs defaultValue="oidc" label={t("settings.headscale.title")}>
        <SettingsTabList>
          <SettingsTab className="shrink-0" icon={KeyRound} value="oidc">
            {t("settings.headscale.oidcTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={ShieldCheck} value="trusted-proxies">
            {t("settings.headscale.trustedProxiesTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Scale} value="policy">
            {t("settings.headscale.policyTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={SlidersHorizontal} value="advanced">
            {t("settings.headscale.advancedTitle")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Network} value="derp">
            {t("settings.headscale.derp.title")}
          </SettingsTab>
          <SettingsTab className="shrink-0" icon={Tags} value="derp-regions">
            {t("settings.headscale.derp.regionNamesTitle")}
          </SettingsTab>
        </SettingsTabList>

        <SettingsPanel value="oidc">
          <SettingsCollapsible
            defaultOpen
            icon={KeyRound}
            status={{
              tone: oidcConfigured ? "ok" : "warn",
              label: oidcConfigured
                ? t("settings.headscale.statusConfigured")
                : t("settings.headscale.summaryNotConfigured"),
            }}
            summary={
              oidcConfigured
                ? t("settings.headscale.summaryIssuer", { issuer: oidc?.issuer ?? "" })
                : undefined
            }
            title={t("settings.headscale.oidcTitle")}
          >
            <OidcSettings isDisabled={isDisabled} oidc={oidc} />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="trusted-proxies">
          <SettingsCollapsible
            defaultOpen
            description={t("settings.headscale.trustedProxiesBody")}
            icon={ShieldCheck}
            status={{
              tone: trustedProxies.length > 0 ? "ok" : "neutral",
              label: t("settings.headscale.trustedProxiesSummary", {
                count: trustedProxies.length,
              }),
            }}
            title={t("settings.headscale.trustedProxiesTitle")}
          >
            <TrustedProxies isDisabled={isDisabled} proxies={trustedProxies} />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="policy">
          <SettingsCollapsible
            defaultOpen
            description={t("settings.headscale.policyBody")}
            icon={Scale}
            status={{
              tone: policyMode === "database" ? "ok" : "neutral",
              label:
                policyMode === "database"
                  ? t("settings.headscale.policyModeDatabase")
                  : t("settings.headscale.policyModeFile"),
            }}
            summary={t("settings.headscale.policySummary", { mode: policyMode })}
            title={t("settings.headscale.policyTitle")}
          >
            <PolicyModeSettings isDisabled={isDisabled} mode={policyMode} path={policyPath} />
          </SettingsCollapsible>
        </SettingsPanel>

        <SettingsPanel value="advanced">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {t("settings.headscale.advancedSummary", {
                expiry: advanced.nodeExpiry,
                level: advanced.logLevel,
              })}
            </p>
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.headscale.advancedBody")}
            </p>
          </div>
          <AdvancedSettings isDisabled={isDisabled} settings={advanced} />
        </SettingsPanel>

        <SettingsPanel value="derp">
          <p className="text-sm text-mist-600 dark:text-mist-400">
            {t("settings.headscale.derp.body")}
          </p>
          <DerpSettings
            isDisabled={isDisabled}
            privateKeyDefault={derpPrivateKeyDefault}
            relaySourceStatus={relaySourceStatus}
            relaySourceSummary={relaySourceSummary}
            settings={derp}
          />
          <DerpStatus
            agentEnabled={agentEnabled}
            embedded={derp.server}
            regionNames={derpRegionNames}
            rows={derpRelay}
          />
        </SettingsPanel>

        <SettingsPanel value="derp-regions">
          <SettingsCollapsible
            defaultOpen
            description={t("settings.headscale.derp.regionNamesBody")}
            icon={Tags}
            status={{
              tone: Object.keys(derpRegionNames).length > 0 ? "ok" : "neutral",
              label: t("settings.headscale.derp.regionNamesSummary", {
                count: Object.keys(derpRegionNames).length,
              }),
            }}
            title={t("settings.headscale.derp.regionNamesTitle")}
          >
            <DerpRegionNames isDisabled={isDisabled} names={derpRegionNames} />
          </SettingsCollapsible>
        </SettingsPanel>
      </SettingsTabs>
    </SettingsPage>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
