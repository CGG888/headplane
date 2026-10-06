import { ShieldCheck } from "lucide-react";
import { data, useFetcher } from "react-router";

import Button from "~/components/button";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsPage,
  SettingsStatus,
  type SettingsStatusTone,
} from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { isIdpLogoutEnabled } from "~/routes/auth/end-session";
import { appConfigContext, authContext, oidcContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import {
  evaluateLoginSelfTest,
  probeIssuer,
  supportsEs384Verification,
  type LoginSelfTestCheckId,
  type LoginSelfTestReport,
  type LoginSelfTestStatus,
} from "./self-test";

const STATUS_KEYS: Record<LoginSelfTestStatus, TranslationKey> = {
  pass: "settings.login.selfTestStatusPass",
  warn: "settings.login.selfTestStatusWarn",
  fail: "settings.login.selfTestStatusFail",
  skip: "settings.login.selfTestStatusSkip",
};

const STATUS_TONES: Record<LoginSelfTestStatus, SettingsStatusTone> = {
  pass: "ok",
  warn: "warn",
  fail: "error",
  skip: "neutral",
};

const CHECK_KEYS: Record<LoginSelfTestCheckId, TranslationKey> = {
  discovery: "settings.login.selfTestCheckDiscovery",
  issuer: "settings.login.selfTestCheckIssuer",
  scopes: "settings.login.selfTestCheckScopes",
  signingAlg: "settings.login.selfTestCheckSigningAlg",
  endSession: "settings.login.selfTestCheckEndSession",
  tokenAuth: "settings.login.selfTestCheckTokenAuth",
};

const VERDICT_KEYS: Record<LoginSelfTestReport["verdict"], TranslationKey> = {
  good: "settings.login.selfTestVerdictGood",
  warn: "settings.login.selfTestVerdictWarn",
  fail: "settings.login.selfTestVerdictFail",
};

const VERDICT_TONES: Record<LoginSelfTestReport["verdict"], SettingsStatusTone> = {
  good: "ok",
  warn: "warn",
  fail: "error",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const oidc = context.get(oidcContext);
  const principal = await auth.require(request);

  return {
    canTest: auth.can(principal, Capabilities.configure_iam),
    // The checks read the configuration file, so they are worth running even
    // while sign-in is switched off; the notice just explains that state.
    oidcEnabled: oidc.state === "enabled",
    disabledReason: oidc.state === "enabled" ? null : oidc.reason,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const appConfig = context.get(appConfigContext);
  const principal = await auth.require(request);

  if (!auth.can(principal, Capabilities.configure_iam)) {
    return data({ success: false as const }, { status: 403 });
  }

  const oidc = appConfig.oidc;

  // The discovery fetch and the P-384 runtime probe are independent.
  const [probe, es384] = await Promise.all([
    probeIssuer(oidc?.issuer),
    supportsEs384Verification(),
  ]);

  const report = evaluateLoginSelfTest({
    config: {
      issuer: oidc?.issuer,
      scope: oidc?.scope,
      endSessionEndpoint: oidc?.end_session_endpoint,
      postLogoutRedirectUri: oidc?.post_logout_redirect_uri,
      idpLogoutEnabled: isIdpLogoutEnabled(oidc),
      tokenEndpointAuthMethod: oidc?.token_endpoint_auth_method,
      baseUrl: appConfig.server.base_url,
    },
    probe,
    runtime: { es384 },
  });

  // Only the report crosses the wire: the client secret never does.
  return { success: true as const, report };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<typeof action>();
  const isBusy = fetcher.state !== "idle";

  const report = fetcher.data?.success === true ? fetcher.data.report : undefined;
  const isForbidden = fetcher.data?.success === false;

  const warnCount = report?.checks.filter((check) => check.status === "warn").length ?? 0;
  const failCount = report?.checks.filter((check) => check.status === "fail").length ?? 0;

  return (
    <SettingsPage
      notices={
        <>
          {!loaderData.oidcEnabled ? (
            <Notice title={t("settings.login.disabledTitle")} variant="warning">
              {t("settings.login.disabledBody", { reason: loaderData.disabledReason ?? "—" })}
            </Notice>
          ) : undefined}
          <Notice title={t("settings.login.restartTitle")}>
            {t("settings.login.restartNotice")}
          </Notice>
        </>
      }
      title={t("settings.login.title")}
      description={t("settings.login.body")}
    >
      <SettingsCollapsibleGroup>
        <SettingsCollapsible
          description={t("settings.login.selfTestBody")}
          icon={ShieldCheck}
          status={{
            tone: report ? VERDICT_TONES[report.verdict] : "neutral",
            label: report
              ? t(VERDICT_KEYS[report.verdict], { count: warnCount + failCount })
              : t("settings.login.selfTestNotRun"),
          }}
          title={t("settings.login.selfTestTitle")}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-mist-600 dark:text-mist-400">
              {t("settings.login.headscaleHint")}
            </p>

            <fetcher.Form method="post">
              <Button disabled={!loaderData.canTest || isBusy} type="submit" variant="heavy">
                {isBusy ? t("settings.login.selfTestRunning") : t("settings.login.selfTestButton")}
              </Button>
            </fetcher.Form>

            {!loaderData.canTest ? (
              <p className="text-sm text-mist-600 dark:text-mist-400">
                {t("errors.permission.modifyIam")}
              </p>
            ) : undefined}

            {isForbidden ? (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {t("errors.permission.modifyIam")}
              </p>
            ) : undefined}

            {report ? (
              <div className="flex flex-col gap-3 rounded-lg border border-mist-200 p-3 dark:border-mist-800">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <SettingsStatus tone={VERDICT_TONES[report.verdict]}>
                    {t(VERDICT_KEYS[report.verdict], { count: warnCount + failCount })}
                  </SettingsStatus>
                  <span className="text-sm font-medium">
                    {t("settings.login.selfTestSummary", {
                      passed: report.passed,
                      total: report.total,
                    })}
                  </span>
                  {report.skipped > 0 ? (
                    <span className="text-sm text-mist-600 dark:text-mist-400">
                      {t("settings.login.selfTestSkipped", { count: report.skipped })}
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
                      {check.fix ? (
                        <span className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-mist-500 dark:text-mist-400">
                            {t("settings.login.selfTestCopyThis")}
                          </span>
                          <code className="block w-fit max-w-full truncate rounded bg-mist-100 px-1.5 py-0.5 font-mono text-xs text-mist-700 dark:bg-mist-800 dark:text-mist-300">
                            {check.fix}
                          </code>
                        </span>
                      ) : undefined}
                    </li>
                  ))}
                </ul>

                <ul className="flex flex-col gap-1 border-t border-mist-200 pt-3 dark:border-mist-800">
                  {report.notes.map((note) => (
                    <li className="text-sm text-mist-600 dark:text-mist-400" key={note.messageKey}>
                      {t(note.messageKey, note.params)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined}
          </div>
        </SettingsCollapsible>
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
