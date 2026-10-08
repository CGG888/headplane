import { AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, Link as RouterLink, redirect, useSearchParams } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Code from "~/components/code";
import Input from "~/components/input";
import { LanguageSwitcher } from "~/components/language-switcher";
import Link from "~/components/link";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { appConfigContext, authContext, oidcContext } from "~/server/context";
import type { OidcError, OidcService } from "~/server/oidc/provider";
import { useLiveData } from "~/utils/live-data";
import log from "~/utils/log";

import type { Route } from "./+types/page";
import { loginAction, type LoginErrorCode } from "./action";
import { OidcConfigErrorNotice, OidcDiscoveryFailedNotice } from "./config-error";
import Logout from "./logout";
import { OidcErrorNotice } from "./oidc-error";

export async function loader({ request, context, url }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const oidc = context.get(oidcContext);

  try {
    await auth.require(request);
    return redirect("/overview");
  } catch {}

  const qp = url.searchParams;
  const urlState = qp.get("s") ?? undefined;

  const oidcService = oidc.state === "enabled" ? oidc.value : undefined;
  let oidcStatus: ReturnType<OidcService["status"]> | undefined;
  if (oidcService) {
    try {
      const result = await oidcService.discover();
      if (!result.ok) {
        logLoginOidcError("OIDC discovery failed", result.error);
      }
    } catch (error) {
      log.error("auth", "OIDC discovery failed unexpectedly: %s", String(error));
      log.debug("auth", "OIDC discovery error details: %o", error);
    }

    oidcStatus = oidcService.status();
  }

  if (
    oidcService &&
    config.oidc?.disable_api_key_login &&
    oidcStatus?.state === "ready" &&
    urlState !== "logout"
  ) {
    return redirect("/oidc/start");
  }

  const isOidcConnectorEnabled = oidcStatus?.state === "ready";
  const oidcErrorCodes = oidcStatus?.state === "error" ? [oidcStatus.error.code] : [];

  return {
    isCookieSecureEnabled: config.server.cookie_secure,
    isOidcConnectorEnabled,
    oidcErrorCodes,
    urlState,
  };
}

export const action = loginAction;

function logLoginOidcError(context: string, error: OidcError): void {
  log.error("auth", "%s [%s]: %s", context, error.code, error.message);
  if (error.hint) {
    log.error("auth", "Hint: %s", error.hint);
  }
}

const LOGIN_ERROR_KEYS: Record<LoginErrorCode, TranslationKey> = {
  missingKey: "login.errors.missingKey",
  emptyKey: "login.errors.emptyKey",
  invalid: "login.errors.invalid",
  rateLimited: "login.errors.rateLimited",
  disabled: "login.errors.disabled",
  unknown: "login.errors.unknown",
};

export default function Page({ loaderData, actionData }: Route.ComponentProps) {
  const { isCookieSecureEnabled, isOidcConnectorEnabled, oidcErrorCodes, urlState } = loaderData;

  const { t, tr } = useI18n();
  const [showCookieWarning, setShowCookieWarning] = useState(false);
  const [params] = useSearchParams();
  const { pause } = useLiveData();

  useEffect(() => {
    // This page does NOT need stale while revalidate logic
    pause();

    if (isCookieSecureEnabled && window.location.protocol !== "https:") {
      setShowCookieWarning(true);
    }
  });

  useEffect(() => {
    // State is a one time thing, we need to remove it after it has
    // Been consumed to prevent logic loops.
    // The loader reports an absent `s` parameter as `undefined` (never `null`),
    // so `null` here would have run the cleanup on every visit.
    if (urlState !== undefined) {
      const searchParams = new URLSearchParams(params);
      searchParams.delete("s");

      // Replacing because it's not a navigation, just a cleanup of the URL
      // We can't use the useSearchParams method since it revalidates
      // Which will trigger a full reload
      const newUrl = searchParams.toString()
        ? `${window.location.pathname}?${searchParams.toString()}`
        : window.location.pathname;

      window.history.replaceState(null, "", newUrl);
    }
  }, [urlState, params]);

  if (urlState === "logout") {
    return <Logout />;
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div>
        {urlState?.startsWith("error_") ? (
          <OidcErrorNotice code={urlState} />
        ) : oidcErrorCodes.includes("discovery_failed") ? (
          <OidcDiscoveryFailedNotice />
        ) : oidcErrorCodes.length > 0 ? (
          <OidcConfigErrorNotice errors={oidcErrorCodes} />
        ) : showCookieWarning ? (
          <Card className="m-4 mb-4 max-w-md border border-red-500 sm:m-0 sm:mb-4">
            <div className="flex items-center justify-between gap-4">
              <Card.Title className="text-red-500">{t("login.cookieWarning.title")}</Card.Title>
              <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
            </div>
            {showCookieWarning ? (
              <Card.Text className="text-sm">
                {tr("login.cookieWarning.body", {
                  link: (
                    <Link
                      external
                      styled
                      to="https://cgg888.github.io/headplaneCN/configuration/common-issues#登录没有反应"
                    >
                      {t("common.learnMore")}
                    </Link>
                  ),
                })}
              </Card.Text>
            ) : undefined}
          </Card>
        ) : undefined}
        <Card className="m-4 max-w-md sm:m-0">
          <Card.Title>{t("login.welcome")}</Card.Title>
          <Form method="POST">
            <Card.Text>
              {tr("login.apiKeyDescription", {
                command: <Code>headscale apikeys create</Code>,
              })}
            </Card.Text>
            <Input
              className="mt-8 mb-2"
              required
              label={t("login.apiKeyLabel")}
              labelHidden
              name="api_key"
              placeholder={t("login.apiKeyLabel")}
              type="password"
            />
            {actionData?.success === false ? (
              <Card.Text className="mb-2 text-sm text-red-600 dark:text-red-300">
                {t(LOGIN_ERROR_KEYS[actionData.error])}
              </Card.Text>
            ) : undefined}
            <Button className="w-full" type="submit" variant="heavy">
              {t("login.signIn")}
            </Button>
          </Form>
          {isOidcConnectorEnabled ? (
            <RouterLink to="/oidc/start" prefetch="none" reloadDocument>
              <Button className="mt-2 w-full" disabled={oidcErrorCodes.length > 0} variant="light">
                {t("login.sso")}
              </Button>
            </RouterLink>
          ) : undefined}
        </Card>
      </div>
    </div>
  );
}
