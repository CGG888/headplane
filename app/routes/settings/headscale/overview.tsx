import { data } from "react-router";

import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import { useI18n } from "~/i18n/provider";
import { appConfigContext, authContext, headscaleConfigContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { headscaleSettingsAction } from "./actions";
import AdvancedSettings from "./components/advanced-settings";
import OidcSettings from "./components/oidc-settings";
import PolicyModeSettings from "./components/policy-mode";
import TrustedProxies from "./components/trusted-proxies";
import { findFatalOidcKeys } from "./config-warnings";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const appConfig = context.get(appConfigContext);

  if (!headscaleConfig.readable()) {
    throw new Error("No configuration is available");
  }

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.read_users);
  if (!check) {
    // Not authorized to view this page
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  const { policyMode, policyPath, trustedProxies } = headscaleConfig.getTailnetSettings();
  return {
    access: auth.can(principal, Capabilities.configure_iam),
    writable: headscaleConfig.writable(),
    oidc: headscaleConfig.getOIDCSettings() ?? null,
    advanced: headscaleConfig.getAdvancedSettings(),
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
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
