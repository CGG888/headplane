import { ArrowRight } from "lucide-react";

import Link from "~/components/link";
import PageError from "~/components/page-error";
import { useI18n } from "~/i18n/provider";
import { headscaleConfigContext, oidcContext } from "~/server/context";

import type { Route } from "./+types/overview";

export async function loader({ context }: Route.LoaderArgs) {
  const headscaleConfig = context.get(headscaleConfigContext);
  const oidc = context.get(oidcContext);

  return {
    config: headscaleConfig.writable(),
    isOidcEnabled: oidc.state === "enabled" && oidc.value.status().state === "ready",
  };
}

export default function Page({ loaderData: { config, isOidcEnabled } }: Route.ComponentProps) {
  const { t, tr } = useI18n();

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-8">
      <div className="flex w-full flex-col sm:w-2/3">
        <h1 className="mb-4 text-2xl font-medium">{t("settings.overview.title")}</h1>
        <p>{t("settings.overview.body")}</p>
      </div>
      <div className="flex w-full flex-col sm:w-2/3">
        <h1 className="mb-4 text-2xl font-medium">{t("settings.overview.preAuthTitle")}</h1>
        <p>
          {tr("settings.overview.preAuthBody", {
            link: (
              <Link external styled to="https://tailscale.com/kb/1085/auth-keys/">
                {t("settings.overview.tailscaleDocs")}
              </Link>
            ),
          })}
        </p>
      </div>
      <Link to="/settings/auth-keys">
        <div className="flex items-center text-lg font-medium">
          {t("settings.overview.manageAuthKeys")}
          <ArrowRight className="ml-2 h-5 w-5" />
        </div>
      </Link>
      <div className="flex w-full flex-col sm:w-2/3">
        <h1 className="mb-4 text-2xl font-medium">{t("settings.overview.agentTitle")}</h1>
        <p>{t("settings.overview.agentBody")}</p>
      </div>
      <Link to="/settings/agent">
        <div className="flex items-center text-lg font-medium">
          {t("settings.overview.agentSettings")}
          <ArrowRight className="ml-2 h-5 w-5" />
        </div>
      </Link>
      {config && isOidcEnabled ? (
        <>
          <div className="flex w-full flex-col sm:w-2/3">
            <h1 className="mb-4 text-2xl font-medium">
              {t("settings.overview.restrictionsTitle")}
            </h1>
            <p>
              {tr("settings.overview.restrictionsBody", {
                link: (
                  <Link
                    external
                    styled
                    to="https://headscale.net/stable/ref/oidc/#basic-configuration"
                  >
                    {t("common.learnMore")}
                  </Link>
                ),
              })}
            </p>
          </div>
          <Link to="/settings/restrictions">
            <div className="flex items-center text-lg font-medium">
              {t("settings.overview.manageRestrictions")}
              <ArrowRight className="ml-2 h-5 w-5" />
            </div>
          </Link>
        </>
      ) : undefined}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
