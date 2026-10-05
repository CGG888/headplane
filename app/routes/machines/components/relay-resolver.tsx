import { RefreshCw } from "lucide-react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Link from "~/components/link";
import { SettingsStatus } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type {
  RelayDnsActionResult,
  RelayDnsErrorCode,
} from "~/routes/settings/headscale/relay-dns-servers";
import type { RelayResolution } from "~/server/relay-dns";
import cn from "~/utils/cn";

/** Where the configured resolver list lives; see `routes/settings/headscale/relay-dns.ts`. */
const RELAY_DNS_ROUTE = "/settings/headscale/relay-dns";

/** Where an operator edits the list the hint points at. */
const RELAY_DNS_SETTINGS_ROUTE = "/settings/headscale";

/** The one request this control makes: look the relay hostname up again. */
const REFRESH_ACTION = "refresh_relay_dns";

/** Stable codes from the resource route, rendered in the page's language. */
const REFRESH_ERROR_KEYS: Partial<Record<RelayDnsErrorCode, TranslationKey>> = {
  invalidAction: "settings.headscale.errors.invalidAction",
};

export interface RelayResolverProps {
  /** The lookup the card renders; absent when no resolver produced an answer at all. */
  resolution: RelayResolution | undefined;
  /** Whether this viewer may ask again; the lookup follows the settings page's permission. */
  canRefresh: boolean;
  /**
   * Whether an empty family is only the host's own resolver speaking, so the
   * hint below the pill is worth showing. Prepared by the loader: the rule lives
   * in `~/server/relay-dns`, which must stay out of the client bundle.
   */
  suggestsConfigured: boolean;
  className?: string;
}

/**
 * Which resolver answered the relay lookup, and the one control that asks again.
 *
 * Both relay cards show the same answer the DERP settings card does, so they say
 * which resolver produced it: the host's own resolver, whose empty answer may
 * only mean it filters the query, or the servers configured on the Headscale
 * settings page. The hint appears in exactly the first case, because it is the
 * only one where a missing record is not yet an answer about the name.
 *
 * The re-resolve request is a fetcher submission to the relay DNS resource route
 * rather than a navigation: the page keeps its place, and React Router
 * revalidates the loaders behind both cards once the fresh lookup is cached, so
 * the pill and the addresses update in place. A rejected request becomes a line
 * under the control, never an error page.
 */
export default function RelayResolver({
  resolution,
  canRefresh,
  suggestsConfigured,
  className,
}: RelayResolverProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<RelayDnsActionResult>();
  const busy = fetcher.state !== "idle";

  // A literal endpoint and a lookup that never ran carry no resolver, so the pill
  // is absent rather than blaming a resolver that did not answer.
  const answered = resolution?.resolver !== undefined;

  const result = fetcher.data;
  const rejected = result !== undefined && !result.ok ? result : undefined;
  const failure = rejected
    ? t(REFRESH_ERROR_KEYS[rejected.errorCode] ?? "errors.generic.requestFailed")
    : undefined;

  if (!answered && !canRefresh) {
    return undefined;
  }

  // A literal endpoint is its own answer: nothing was looked up, so there is no
  // resolver to name and nothing a re-resolve could change.
  if (resolution?.kind === "literal") {
    return undefined;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-mist-600 dark:text-mist-400">
          {t("settings.headscale.derp.relayDnsLookupTitle")}
          {resolution?.resolver !== undefined ? (
            <SettingsStatus tone={resolution.resolver === "configured" ? "ok" : "neutral"}>
              {resolution.resolver === "configured"
                ? t("settings.headscale.derp.relayDnsResolverConfigured", {
                    servers: (resolution.servers ?? []).join(", "),
                  })
                : t("settings.headscale.derp.relayDnsResolverSystem")}
            </SettingsStatus>
          ) : undefined}
        </span>

        {canRefresh ? (
          <Button
            aria-busy={busy}
            disabled={busy}
            onClick={() => {
              // Sent as form data, like every other action in Headplane: the
              // resource route reads its body with `request.formData()`.
              const body = new FormData();
              body.append("action_id", REFRESH_ACTION);
              fetcher.submit(body, { action: RELAY_DNS_ROUTE, method: "post" });
            }}
            type="button"
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            {busy
              ? t("settings.headscale.derp.relayDnsReResolving")
              : t("settings.headscale.derp.relayDnsReResolve")}
          </Button>
        ) : undefined}
      </div>

      {suggestsConfigured ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            {t("settings.headscale.derp.relayDnsSystemHint")}
          </p>
          <Link
            className="text-xs font-medium text-amber-900 dark:text-amber-200"
            to={RELAY_DNS_SETTINGS_ROUTE}
          >
            {t("settings.headscale.derp.relayDnsSettingsLink")}
          </Link>
        </div>
      ) : undefined}

      {failure ? <p className="text-xs text-red-600 dark:text-red-400">{failure}</p> : undefined}
    </div>
  );
}
