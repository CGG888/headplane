import { AlertCircle } from "lucide-react";

import Card from "~/components/card";
import Code from "~/components/code";
import { useI18n } from "~/i18n/provider";

export function OidcErrorNotice({ code }: { code: string }) {
  const { t } = useI18n();

  return (
    <Card className="m-4 mb-4 max-w-md border border-red-500 sm:m-0 sm:mb-4">
      <div className="flex items-center justify-between gap-4">
        <Card.Title className="text-red-500">{t("login.oidcNotice.title")}</Card.Title>
        <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
      </div>
      <OidcErrorMessage code={code} />
    </Card>
  );
}

function OidcErrorMessage({ code }: { code: string }) {
  const { t, tr } = useI18n();

  switch (code) {
    case "error_no_query":
      return <Card.Text>{t("login.oidcNotice.noQuery")}</Card.Text>;

    case "error_no_session":
    case "error_invalid_session":
      return <Card.Text>{t("login.oidcNotice.noSession")}</Card.Text>;

    case "error_no_sub":
      return <Card.Text>{tr("login.oidcNotice.noSub", { claim: <Code>sub</Code> })}</Card.Text>;

    case "error_auth_failed":
      return <Card.Text>{t("login.oidcNotice.authFailed")}</Card.Text>;

    default:
      return <Card.Text>{t("login.oidcNotice.unknown")}</Card.Text>;
  }
}
