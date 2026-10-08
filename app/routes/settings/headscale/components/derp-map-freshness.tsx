import { RefreshCw } from "lucide-react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import { SettingsActions, SettingsCollapsible, SettingsStatus } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type {
  RemoteDerpMapCacheStatus,
  RemoteDerpMapFailure,
} from "~/server/headscale/derp-map-remote";
import { formatTimeDelta } from "~/utils/time";

import type { HeadscaleSettingsResult } from "../error-keys";

/** Why the last fetch failed, in the panel's own words. */
const FAILURE_KEYS: Record<RemoteDerpMapFailure, TranslationKey> = {
  timeout: "settings.headscale.derp.mapFreshness.failureTimeout",
  network: "settings.headscale.derp.mapFreshness.failureNetwork",
  status: "settings.headscale.derp.mapFreshness.failureStatus",
  "too-large": "settings.headscale.derp.mapFreshness.failureTooLarge",
  unreadable: "settings.headscale.derp.mapFreshness.failureUnreadable",
};

/**
 * One remote map URL with what this process remembers about it. The status is
 * absent until something fetched the URL, which is also what a write leaves
 * behind: invalidation drops the answer and the next lookup fills it in again.
 */
export interface DerpMapFreshnessEntry {
  url: string;
  cache?: RemoteDerpMapCacheStatus;
}

interface DerpMapFreshnessProps {
  entries: DerpMapFreshnessEntry[];
  isDisabled: boolean;
}

/**
 * When every configured remote DERP map was fetched, and when it is fetched
 * again.
 *
 * The region table cannot say this on its own: a map answered an hour ago and a
 * map answered at startup render the same rows, and a source that failed looks
 * the same as one that is simply not in use. "Refresh now" clears the cached
 * answers and dials every configured URL again, which is what picks up a changed
 * map without waiting for the updater's interval or restarting Headscale.
 */
export default function DerpMapFreshness({ entries, isDisabled }: DerpMapFreshnessProps) {
  const { t, locale } = useI18n();
  const fetcher = useFetcher<HeadscaleSettingsResult>();
  const refreshing = fetcher.state !== "idle";
  const failed = entries.some((entry) => entry.cache?.reason !== undefined);

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.mapFreshness.body")}
      hasError={failed}
      icon={RefreshCw}
      status={{
        label: t("settings.headscale.derp.mapFreshness.status", { count: entries.length }),
        tone: failed ? "warn" : "ok",
      }}
      title={t("settings.headscale.derp.mapFreshness.title")}
    >
      <section className="flex w-full flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-mist-500 dark:text-mist-400">
            {t("settings.headscale.derp.mapFreshness.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => {
              const cache = entry.cache;
              const at = cache === undefined ? undefined : new Date(cache.fetchedAt);

              return (
                <li
                  className="flex flex-col gap-1 rounded-lg border border-mist-200 p-3 dark:border-mist-800"
                  key={entry.url}
                >
                  <span className="font-mono text-xs break-all">{entry.url}</span>
                  {cache === undefined || at === undefined ? (
                    <span className="text-sm text-mist-500 dark:text-mist-400">
                      {t("settings.headscale.derp.mapFreshness.never")}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {cache.reason === undefined ? (
                        <SettingsStatus tone="ok">
                          {t("settings.headscale.derp.mapFreshness.regions", {
                            count: cache.regionCount ?? 0,
                          })}
                        </SettingsStatus>
                      ) : (
                        <SettingsStatus tone="error">
                          {t(FAILURE_KEYS[cache.reason])}
                        </SettingsStatus>
                      )}
                      <span className="text-mist-600 dark:text-mist-400">
                        {t(
                          cache.reason === undefined
                            ? "settings.headscale.derp.mapFreshness.fetchedAt"
                            : "settings.headscale.derp.mapFreshness.attemptedAt",
                          {
                            at: at.toLocaleString(locale),
                            ago: formatTimeDelta(at, locale),
                          },
                        )}
                      </span>
                      <span className="text-mist-600 dark:text-mist-400">
                        {cache.fresh
                          ? t("settings.headscale.derp.mapFreshness.nextRefresh", {
                              in: formatTimeDelta(new Date(cache.expiresAt), locale),
                            })
                          : t("settings.headscale.derp.mapFreshness.stale")}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <fetcher.Form method="post">
          <input name="action_id" type="hidden" value="refresh_derp_maps" />
          <SettingsActions>
            <Button disabled={isDisabled || refreshing} type="submit" variant="heavy">
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {refreshing
                ? t("settings.headscale.derp.mapFreshness.refreshing")
                : t("settings.headscale.derp.mapFreshness.refreshNow")}
            </Button>
          </SettingsActions>
        </fetcher.Form>
      </section>
    </SettingsCollapsible>
  );
}
