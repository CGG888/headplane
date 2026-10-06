import { Globe, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Input from "~/components/input";
import { SettingsActions, SettingsCollapsible, SettingsStatus } from "~/components/settings-nav";
import TableList from "~/components/table-list";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import type {
  RelayAddressFamily,
  RelayResolution,
  RelayResolutionReason,
} from "~/server/relay-dns";

import {
  MAX_RELAY_DNS_SERVERS,
  parseRelayDnsServer,
  type RelayDnsActionResult,
  type RelayDnsErrorCode,
  type RelayDnsResourceData,
} from "../relay-dns-servers";

/** Where this card reads and writes the list; see `routes/.../relay-dns.ts`. */
const RELAY_DNS_ROUTE = "/settings/headscale/relay-dns";

/** Stable codes from the resource route, rendered in the page's language. */
const RELAY_DNS_ERROR_KEYS: Record<RelayDnsErrorCode, TranslationKey> = {
  invalidRelayDnsServer: "settings.headscale.errors.invalidRelayDnsServer",
  duplicateRelayDnsServer: "settings.headscale.errors.duplicateRelayDnsServer",
  relayDnsServerLimit: "settings.headscale.errors.relayDnsServerLimit",
  relayDnsServerNotFound: "settings.headscale.errors.relayDnsServerNotFound",
  relayDnsWriteFailed: "settings.headscale.errors.relayDnsWriteFailed",
  invalidAction: "settings.headscale.errors.invalidAction",
};

/** Why a family has no address; the relay cards on the other pages say the same. */
const RELAY_REASON_KEYS: Record<RelayResolutionReason, TranslationKey> = {
  "no-records": "machines.detail.derp.relayReasonNoRecords",
  timeout: "machines.detail.derp.relayReasonTimeout",
  "resolver-error": "machines.detail.derp.relayReasonResolverError",
  "host-missing": "machines.detail.derp.relayReasonHostMissing",
  "invalid-host": "machines.detail.derp.relayReasonInvalidHost",
};

/** One family of the fresh lookup: its addresses, or why it has none. */
function AddressRow({
  family,
  resolution,
}: {
  family: RelayAddressFamily;
  resolution: RelayResolution | undefined;
}) {
  const { t } = useI18n();
  const addresses = resolution?.[family] ?? [];
  const reason = resolution?.reason;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-mist-500 dark:text-mist-400">
        {family === "ipv4"
          ? t("settings.headscale.derp.relayDnsIpv4Label")
          : t("settings.headscale.derp.relayDnsIpv6Label")}
      </span>
      {addresses.length > 0 ? (
        addresses.map((address) => (
          <span
            className="font-mono text-xs break-all text-mist-900 dark:text-mist-50"
            key={address}
          >
            {address}
          </span>
        ))
      ) : (
        <span className="text-xs text-mist-500 dark:text-mist-400">
          {reason === undefined
            ? t("machines.detail.derp.relayResolvedUnavailable")
            : t(RELAY_REASON_KEYS[reason])}
        </span>
      )}
    </div>
  );
}

/**
 * Editor for the DNS servers Headplane uses when it resolves the relay hostname.
 *
 * The setting exists because a host resolver can answer "no AAAA" for a name
 * that has one, which makes the relay cards report a missing IPv6 address that
 * is really a DNS problem. An empty list keeps today's behaviour: lookups follow
 * whatever resolver the host is configured with. The list is Headplane state and
 * lives in Headplane's data directory; the re-resolve button clears the cache so
 * the operator sees a fresh answer without waiting out or restarting anything.
 */
export default function RelayDnsResolver() {
  const { t } = useI18n();
  const stateFetcher = useFetcher<RelayDnsResourceData>();
  const editFetcher = useFetcher<RelayDnsActionResult>();

  const [server, setServer] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const requested = useRef(false);

  // The list, the permission and the current lookup come from the resource
  // route: they are Headplane state, so they are not part of the page loader.
  // The ref keeps a failing load from being retried on every render.
  useEffect(() => {
    if (requested.current) {
      return;
    }

    requested.current = true;
    stateFetcher.load(RELAY_DNS_ROUTE);
  }, [stateFetcher]);

  // A successful change replaces the loaded snapshot, so the card shows the new
  // list and the lookup that ran against it without a reload.
  const changed =
    editFetcher.data !== undefined && editFetcher.data.ok ? editFetcher.data : undefined;
  const view: RelayDnsResourceData | undefined = changed ?? stateFetcher.data;

  useEffect(() => {
    if (editFetcher.state === "idle" && editFetcher.data?.ok) {
      setServer("");
      setLocalError(undefined);
    }
  }, [editFetcher.state, editFetcher.data]);

  const isBusy = editFetcher.state !== "idle";
  const isLoading = view === undefined;
  const loadFailed = isLoading && requested.current && stateFetcher.state === "idle";
  const canEdit = view?.canEdit ?? false;
  const servers = view?.servers ?? [];
  const endpoint = view?.endpoint;
  const resolution = view?.resolution;
  const atLimit = servers.length >= MAX_RELAY_DNS_SERVERS;
  const disabled = !canEdit || isBusy;

  const editError =
    editFetcher.data !== undefined && !editFetcher.data.ok
      ? t(RELAY_DNS_ERROR_KEYS[editFetcher.data.errorCode])
      : undefined;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const value = server.trim();
    if (parseRelayDnsServer(value) === undefined) {
      event.preventDefault();
      setLocalError(t("settings.headscale.errors.invalidRelayDnsServer"));
      return;
    }

    setLocalError(undefined);
  }

  const configuredResolver = resolution?.resolver === "configured";

  return (
    <SettingsCollapsible
      description={t("settings.headscale.derp.relayDnsBody")}
      hasError={Boolean(localError ?? editError) || loadFailed}
      icon={Globe}
      status={{
        tone: servers.length > 0 ? "ok" : "neutral",
        label: t("settings.headscale.derp.relayDnsSummary", { count: servers.length }),
      }}
      title={t("settings.headscale.derp.relayDnsTitle")}
    >
      {isLoading ? (
        <p className="py-2 text-sm opacity-70">
          {loadFailed
            ? t("errors.generic.requestFailed")
            : t("settings.headscale.derp.relayDnsLoading")}
        </p>
      ) : (
        <section className="flex w-full flex-col">
          <TableList>
            {servers.length === 0 ? (
              <TableList.Item className="justify-center py-4 opacity-70">
                <p className="font-semibold">{t("settings.headscale.derp.relayDnsEmpty")}</p>
              </TableList.Item>
            ) : (
              servers.map((entry, index) => (
                <TableList.Item key={entry}>
                  <p className="font-mono text-sm">
                    {index + 1}. {entry}
                  </p>
                  <editFetcher.Form action={RELAY_DNS_ROUTE} method="post">
                    <input name="action_id" type="hidden" value="remove_relay_dns_server" />
                    <input name="server" type="hidden" value={entry} />
                    <Button
                      className="rounded-md px-2 py-1 text-red-500 dark:text-red-400"
                      disabled={disabled}
                      type="submit"
                    >
                      {t("settings.headscale.derp.relayDnsRemoveServer")}
                    </Button>
                  </editFetcher.Form>
                </TableList.Item>
              ))
            )}
          </TableList>

          <editFetcher.Form
            action={RELAY_DNS_ROUTE}
            className="mt-4 flex flex-col gap-3"
            method="post"
            onSubmit={onSubmit}
          >
            <input name="action_id" type="hidden" value="add_relay_dns_server" />
            <Input
              description={t("settings.headscale.derp.relayDnsServerDescription", {
                count: MAX_RELAY_DNS_SERVERS,
              })}
              disabled={disabled || atLimit}
              errorMessage={localError ?? editError}
              invalid={Boolean(localError ?? editError)}
              label={t("settings.headscale.derp.relayDnsServerLabel")}
              name="server"
              onChange={(next) => {
                setServer(next);
                setLocalError(undefined);
              }}
              placeholder={t("settings.headscale.derp.relayDnsServerPlaceholder")}
              value={server}
            />
            <SettingsActions>
              <Button disabled={disabled || atLimit} type="submit" variant="heavy">
                {t("settings.headscale.derp.relayDnsAddServer")}
              </Button>
            </SettingsActions>
          </editFetcher.Form>

          <p className="mt-3 text-xs text-mist-500 dark:text-mist-400">
            {t("settings.headscale.derp.relayDnsStorageNote")}
          </p>

          <div className="mt-4 flex flex-col gap-2 border-t border-mist-100 pt-3 dark:border-mist-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {t("settings.headscale.derp.relayDnsLookupTitle")}
                <SettingsStatus tone={configuredResolver ? "ok" : "neutral"}>
                  {configuredResolver
                    ? t("settings.headscale.derp.relayDnsResolverConfigured", {
                        servers: (resolution?.servers ?? []).join(", "),
                      })
                    : t("settings.headscale.derp.relayDnsResolverSystem")}
                </SettingsStatus>
              </span>
              <editFetcher.Form action={RELAY_DNS_ROUTE} method="post">
                <input name="action_id" type="hidden" value="refresh_relay_dns" />
                <Button disabled={!canEdit || isBusy} type="submit">
                  <RefreshCw className="h-4 w-4" />
                  {t("settings.headscale.derp.relayDnsReResolve")}
                </Button>
              </editFetcher.Form>
            </div>

            <p className="text-xs text-mist-500 dark:text-mist-400">
              {t("settings.headscale.derp.relayDnsLookupBody")}
            </p>

            {endpoint === undefined ? (
              <p className="text-sm opacity-70">
                {t("settings.headscale.derp.relayDnsHostMissing")}
              </p>
            ) : (
              <>
                <span className="font-mono text-xs break-all text-mist-900 dark:text-mist-50">
                  {endpoint.host}:{endpoint.port}
                </span>
                <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                  <AddressRow family="ipv4" resolution={resolution} />
                  <AddressRow family="ipv6" resolution={resolution} />
                </div>
                {resolution?.resolver === "system" &&
                resolution.ipv4.length + resolution.ipv6.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    {t("settings.headscale.derp.relayDnsSystemHint")}
                  </p>
                ) : undefined}
              </>
            )}
          </div>
        </section>
      )}
    </SettingsCollapsible>
  );
}
