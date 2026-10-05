import { KeyRound } from "lucide-react";
import { useMemo, useState } from "react";
import { data, useSearchParams } from "react-router";

import Link from "~/components/link";
import Select from "~/components/select";
import {
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsPage,
} from "~/components/settings-nav";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import { authContext, requestApiContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { apiKeysAction } from "./actions";
import ApiKeyRow from "./api-key-row";
import BulkExpireApiKeys from "./bulk-expire";
import CreateApiKey from "./dialogs/create-api-key";
import {
  countExpiredApiKeys,
  filterApiKeysByStatus,
  isApiKeyStatus,
  parseApiKeyStatus,
  selectExpirableApiKeyPrefixes,
  withApiKeyStatus,
} from "./filters";
import SelectCheckbox from "./select-checkbox";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  if (!check) {
    throw data(
      { localized: { key: "errors.permission.viewIam" } },
      {
        status: 403,
      },
    );
  }

  const { api } = await getRequestApi(request);
  const keys = await api.apiKeys.list();

  return { keys };
}

export const action = apiKeysAction;

export default function Page({ loaderData: { keys } }: Route.ComponentProps) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const status = parseApiKeyStatus(searchParams);

  // Expired keys stay in Headscale's list forever, so the default filter keeps
  // them visible (nothing is hidden by accident) while the count and the
  // one-click "Active" filter keep them from being the whole page.
  const filteredKeys = useMemo(() => filterApiKeysByStatus(keys, status), [keys, status]);
  const expiredCount = useMemo(() => countExpiredApiKeys(keys), [keys]);

  // Selection is remembered by prefix, but only keys that can still be expired
  // are ever handed to the bulk action.
  const expirablePrefixes = useMemo(
    () => selectExpirableApiKeyPrefixes(keys, selected),
    [keys, selected],
  );
  const expirableKeys = useMemo(
    () => keys.filter((key) => expirablePrefixes.includes(key.prefix)),
    [keys, expirablePrefixes],
  );

  // "Select all" covers the keys the current filter shows, so a hidden key is
  // never picked up silently.
  const visiblePrefixes = useMemo(
    () =>
      selectExpirableApiKeyPrefixes(
        keys,
        filteredKeys.map((key) => key.prefix),
      ),
    [keys, filteredKeys],
  );
  const selectedVisible = visiblePrefixes.filter((prefix) => selected.includes(prefix));
  const allSelected =
    visiblePrefixes.length > 0 && selectedVisible.length === visiblePrefixes.length;

  const handleStatusChange = (value: string | null) => {
    setSearchParams(withApiKeyStatus(searchParams, isApiKeyStatus(value) ? value : "all"));
  };

  const toggleKey = (prefix: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? current.includes(prefix)
          ? current
          : [...current, prefix]
        : current.filter((selected) => selected !== prefix),
    );
  };

  const toggleAll = (checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...visiblePrefixes])]
        : current.filter((prefix) => !visiblePrefixes.includes(prefix)),
    );
  };

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.apiKeys.breadcrumb")}
        </>
      }
      description={t("settings.apiKeys.body")}
      title={t("settings.apiKeys.title")}
    >
      <SettingsCollapsibleGroup>
        <CreateApiKey />

        <SettingsCollapsible
          defaultOpen
          description={t("settings.apiKeys.listBody")}
          icon={KeyRound}
          status={{
            tone: keys.length > 0 ? "ok" : "neutral",
            label: t("settings.apiKeys.summaryCount", { count: keys.length }),
          }}
          title={t("settings.apiKeys.listTitle")}
        >
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <Select
              className="w-full sm:w-64"
              label={t("settings.apiKeys.statusLabel")}
              onValueChange={handleStatusChange}
              placeholder={t("settings.apiKeys.statusPlaceholder")}
              value={status}
              items={[
                { value: "all", label: t("settings.apiKeys.statusAll") },
                { value: "active", label: t("settings.apiKeys.statusActive") },
                { value: "expired", label: t("settings.apiKeys.statusExpired") },
              ]}
            />
            <p className="text-sm text-mist-600 dark:text-mist-300">
              {t("settings.apiKeys.expiredCount", { count: expiredCount })}
            </p>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-mist-600 dark:text-mist-300">
              <SelectCheckbox
                aria-label={t("settings.apiKeys.selectAll")}
                checked={allSelected}
                disabled={visiblePrefixes.length === 0}
                indeterminate={selectedVisible.length > 0 && !allSelected}
                onChange={toggleAll}
              />
              {t("settings.apiKeys.selectAll")}
            </label>
          </div>

          {selected.length > 0 ? (
            <BulkExpireApiKeys keys={expirableKeys} onClearSelection={() => setSelected([])} />
          ) : null}

          <TableList className="border-0">
            {keys.length === 0 ? (
              <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
                <KeyRound />
                <p className="font-semibold">{t("settings.apiKeys.empty")}</p>
              </TableList.Item>
            ) : filteredKeys.length === 0 ? (
              <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
                <KeyRound />
                <p className="font-semibold">{t("settings.apiKeys.emptyFiltered")}</p>
              </TableList.Item>
            ) : (
              filteredKeys.map((key) => (
                <TableList.Item key={key.id}>
                  <ApiKeyRow
                    apiKey={key}
                    onSelectedChange={(checked) => toggleKey(key.prefix, checked)}
                    selected={selected.includes(key.prefix)}
                  />
                </TableList.Item>
              ))
            )}
          </TableList>
        </SettingsCollapsible>
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}
