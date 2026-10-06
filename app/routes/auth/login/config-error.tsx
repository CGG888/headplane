import { AlertCircle, CloudOff } from "lucide-react";

import Card from "~/components/card";
import Code from "~/components/code";
import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import type { OidcErrorCode } from "~/server/oidc/provider";

export function OidcDiscoveryFailedNotice() {
  const { t } = useI18n();

  return (
    <Card className="m-4 mb-4 max-w-md border border-yellow-500 sm:m-0 sm:mb-4">
      <div className="flex items-center justify-between gap-4">
        <Card.Title className="text-yellow-500">{t("login.oidcConfig.discoveryTitle")}</Card.Title>
        <CloudOff className="mb-2 h-6 w-6 text-yellow-500" />
      </div>
      <Card.Text className="text-sm">{t("login.oidcConfig.discoveryBody")}</Card.Text>
    </Card>
  );
}

export function OidcConfigErrorNotice({ errors }: { errors: OidcErrorCode[] }) {
  const { t } = useI18n();

  return (
    <Card className="m-4 mb-4 max-w-md border border-red-500 sm:m-0 sm:mb-4">
      <div className="flex items-center justify-between gap-4">
        <Card.Title className="text-red-500">{t("login.oidcConfig.errorTitle")}</Card.Title>
        <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
      </div>
      <Card.Text className="text-sm">
        {t("login.oidcConfig.errorIntro")}{" "}
        <ul className="mt-2 mb-1 list-inside list-disc">
          {errors.map((error) => (
            <li key={error}>
              <OidcConfigErrorMessage code={error} />
            </li>
          ))}
        </ul>{" "}
        <Link
          external
          styled
          to="https://cgg888.github.io/headplaneCN/en/features/sso#troubleshooting"
        >
          {t("common.learnMore")}
        </Link>
      </Card.Text>
    </Card>
  );
}

function OidcConfigErrorMessage({ code }: { code: OidcErrorCode }) {
  const { t, tr } = useI18n();

  switch (code) {
    case "invalid_api_key":
      return (
        <Card.Text className="inline">
          {tr("login.oidcConfig.invalidApiKey", { config: <Code>headscale.api_key</Code> })}
        </Card.Text>
      );

    case "missing_endpoints":
      return <Card.Text className="inline">{t("login.oidcConfig.missingEndpoints")}</Card.Text>;

    case "discovery_failed":
      return <Card.Text className="inline">{t("login.oidcConfig.discoveryFailed")}</Card.Text>;

    default:
      return <Card.Text className="inline">{t("login.oidcConfig.unknown")}</Card.Text>;
  }
}
