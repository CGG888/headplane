import { useFetcher } from "react-router";

import Button from "~/components/button";
import { SettingsStatus, type SettingsStatusTone } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

import { HEADSCALE_SETTINGS_ERROR_KEYS, type HeadscaleSettingsResult } from "../error-keys";
import type { OidcSelfTestCheckId, OidcSelfTestStatus } from "../oidc-self-test";

const STATUS_KEYS: Record<OidcSelfTestStatus, TranslationKey> = {
  pass: "settings.headscale.selfTestStatusPass",
  warn: "settings.headscale.selfTestStatusWarn",
  fail: "settings.headscale.selfTestStatusFail",
  skip: "settings.headscale.selfTestStatusSkip",
};

const STATUS_TONES: Record<OidcSelfTestStatus, SettingsStatusTone> = {
  pass: "ok",
  warn: "warn",
  fail: "error",
  skip: "neutral",
};

const CHECK_KEYS: Record<OidcSelfTestCheckId, TranslationKey> = {
  issuer: "settings.headscale.selfTestCheckIssuer",
  discovery: "settings.headscale.selfTestCheckDiscovery",
  endpoints: "settings.headscale.selfTestCheckEndpoints",
  jwks: "settings.headscale.selfTestCheckJwks",
  scopes: "settings.headscale.selfTestCheckScopes",
  pkce: "settings.headscale.selfTestCheckPkce",
  credentials: "settings.headscale.selfTestCheckCredentials",
  access: "settings.headscale.selfTestCheckAccess",
  callback: "settings.headscale.selfTestCheckCallback",
};

interface OidcSelfTestProps {
  /**
   * Running the checks only reads Headscale's configuration and the provider,
   * so it needs the IAM capability but no write access to the config file.
   */
  canTest: boolean;
}

/**
 * The "Test OIDC configuration" action. The checks run server-side and the
 * result renders in place, so an operator can compare what Headscale will do
 * against what the identity provider advertises without starting a sign-in.
 */
export default function OidcSelfTest({ canTest }: OidcSelfTestProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();
  const isBusy = fetcher.state !== "idle";

  const report = fetcher.data?.success === true ? fetcher.data.selfTest : undefined;
  const error =
    fetcher.data && !fetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[fetcher.data.errorCode])
      : undefined;

  return (
    <section className="flex w-full flex-col gap-4 border-t border-mist-200 pt-4 dark:border-mist-800">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t("settings.headscale.selfTestTitle")}</p>
        <p className="text-sm text-mist-600 dark:text-mist-400">
          {t("settings.headscale.selfTestBody")}
        </p>
      </div>

      <fetcher.Form method="post">
        <input name="action_id" type="hidden" value="test_oidc" />
        <Button disabled={!canTest || isBusy} type="submit" variant="light">
          {isBusy
            ? t("settings.headscale.selfTestRunning")
            : t("settings.headscale.selfTestButton")}
        </Button>
      </fetcher.Form>

      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      ) : undefined}

      {report ? (
        <div className="flex flex-col gap-3 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium">
              {t("settings.headscale.selfTestSummary", {
                passed: report.passed,
                total: report.total,
              })}
            </span>
            {report.skipped > 0 ? (
              <span className="text-sm text-mist-600 dark:text-mist-400">
                {t("settings.headscale.selfTestSkipped", { count: report.skipped })}
              </span>
            ) : undefined}
          </div>

          <ul className="flex flex-col gap-3">
            {report.checks.map((check) => (
              <li className="flex flex-col gap-1" key={check.id}>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <SettingsStatus tone={STATUS_TONES[check.status]}>
                    {t(STATUS_KEYS[check.status])}
                  </SettingsStatus>
                  <span className="font-medium">{t(CHECK_KEYS[check.id])}</span>
                </span>
                <span className="text-sm text-mist-600 dark:text-mist-400">
                  {t(check.messageKey, check.params)}
                </span>
                {check.detail ? (
                  <code className="block w-fit max-w-full truncate rounded bg-mist-100 px-1.5 py-0.5 font-mono text-xs text-mist-700 dark:bg-mist-800 dark:text-mist-300">
                    {check.detail}
                  </code>
                ) : undefined}
              </li>
            ))}
          </ul>
        </div>
      ) : undefined}
    </section>
  );
}
