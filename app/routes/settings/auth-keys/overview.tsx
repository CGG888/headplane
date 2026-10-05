import { FileKey2 } from "lucide-react";
import { useMemo, useState } from "react";

import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import Select from "~/components/select";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import {
  appConfigContext,
  authContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { usersResource } from "~/server/headscale/live-store";
import { isUserPrincipal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import type { PreAuthKey } from "~/types";
import type { User } from "~/types/User";
import log from "~/utils/log";
import { getUserDisplayName } from "~/utils/user";

import type { Route } from "./+types/overview";
import { authKeysAction } from "./actions";
import AuthKeyRow from "./auth-key-row";
import BulkExpireAuthKeys from "./bulk-expire";
import AddAuthKey from "./dialogs/add-auth-key";
import {
  ALL_USERS,
  type AuthKeyStatus,
  countExpiredPreAuthKeys,
  filterPreAuthKeyGroups,
  filterPreAuthKeysByStatus,
  selectExpirableAuthKeys,
  TAG_ONLY,
} from "./filters";
import SelectCheckbox from "./select-checkbox";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const { principal, api } = await getRequestApi(request);

  const usersSnap = await headscaleLiveStore.get(usersResource, api);
  const users = usersSnap.data;

  let keys: { user: User | null; preAuthKeys: PreAuthKey[] }[];
  let missing: { user: User; error: unknown }[] = [];

  // Try fetching all keys at once (Headscale 0.28+), fall back to per-user
  let allKeys: PreAuthKey[] | null = null;
  if (api.preAuthKeys.listAll) {
    try {
      allKeys = await api.preAuthKeys.listAll();
    } catch {
      // Treat any failure as "no global list available" and fall through.
    }
  }

  if (allKeys !== null) {
    const keysByUser = new Map<string | null, PreAuthKey[]>();
    for (const key of allKeys) {
      const userId = key.user?.id ?? null;
      const existing = keysByUser.get(userId) ?? [];
      existing.push(key);
      keysByUser.set(userId, existing);
    }

    keys = [];
    const tagOnly = keysByUser.get(null);
    if (tagOnly?.length) {
      keys.push({ preAuthKeys: tagOnly, user: null });
    }
    for (const user of users) {
      const userKeys = keysByUser.get(user.id);
      if (userKeys?.length) {
        keys.push({ preAuthKeys: userKeys, user });
      }
    }
  } else {
    type FetchResult =
      | { success: true; user: User; preAuthKeys: PreAuthKey[] }
      | { success: false; user: User; error: unknown; preAuthKeys: [] };

    const results: FetchResult[] = await Promise.all(
      users
        .filter((u) => u.id?.length > 0)
        .map(async (user) => {
          try {
            const preAuthKeys = await api.preAuthKeys.listForUser(user.id);
            return { preAuthKeys, success: true as const, user };
          } catch (error) {
            log.error("api", "GET /v1/preauthkey for %s: %o", user.name, error);
            return { error, preAuthKeys: [] as const, success: false as const, user };
          }
        }),
    );

    keys = results
      .filter(({ success }) => success)
      .map(({ user, preAuthKeys }) => ({ preAuthKeys, user }));

    missing = results
      .filter((r): r is Extract<FetchResult, { success: false }> => !r.success)
      .map(({ user, error }) => ({ error, user }));
  }

  const canGenerateAny = auth.can(principal, Capabilities.generate_authkeys);
  const canGenerateOwn = auth.can(principal, Capabilities.generate_own_authkeys);

  return {
    access: canGenerateAny || canGenerateOwn,
    currentHeadscaleUserId: isUserPrincipal(principal) ? principal.user.headscaleUserId : undefined,
    currentSubject: isUserPrincipal(principal) ? principal.user.subject : undefined,
    keys,
    missing,
    selfServiceOnly: !canGenerateAny && canGenerateOwn,
    url: config.headscale.public_url ?? config.headscale.url,
    users,
  };
}

export const action = authKeysAction;

export default function Page({
  loaderData: {
    keys,
    missing,
    users,
    url,
    access,
    selfServiceOnly,
    currentHeadscaleUserId,
    currentSubject,
  },
}: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const [selectedUser, setSelectedUser] = useState(ALL_USERS);
  // Headscale keeps used and expired keys forever, so the default shows
  // everything and the count plus the one-click filters do the tidying.
  const [status, setStatus] = useState<AuthKeyStatus>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const isDisabled = !access || keys.flatMap(({ preAuthKeys }) => preAuthKeys).length === 0;

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const resolveUserId = useMemo(
    () => (key: PreAuthKey) => (key.user ? usersById.get(key.user.id)?.id : undefined),
    [usersById],
  );

  const allKeys = useMemo(() => keys.flatMap(({ preAuthKeys }) => preAuthKeys), [keys]);
  const expiredCount = useMemo(() => countExpiredPreAuthKeys(allKeys), [allKeys]);
  const filteredKeys = useMemo(() => {
    const now = new Date();
    const visible = filterPreAuthKeyGroups(keys, selectedUser).flatMap(
      ({ preAuthKeys }) => preAuthKeys,
    );
    return filterPreAuthKeysByStatus(visible, status, now);
  }, [keys, selectedUser, status]);

  // Selection is remembered by key id, but only keys that can still be expired
  // and have an owner are ever handed to the bulk action.
  const expirableKeys = useMemo(
    () => selectExpirableAuthKeys(allKeys, selected, resolveUserId),
    [allKeys, resolveUserId, selected],
  );

  const visibleIds = useMemo(
    () =>
      selectExpirableAuthKeys(
        filteredKeys,
        filteredKeys.map((key) => key.id),
        resolveUserId,
      ).map((key) => key.id),
    [filteredKeys, resolveUserId],
  );
  const selectedVisible = visibleIds.filter((id) => selected.includes(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const toggleKey = (id: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((selected) => selected !== id),
    );
  };

  const toggleAll = (checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.includes(id)),
    );
  };

  return (
    <div className="flex flex-col md:w-2/3">
      <p className="text-md mb-8">
        <Link className="font-medium" to="/settings">
          {t("settings.overview.title")}
        </Link>
        <span className="mx-2">/</span> {t("settings.authKeys.breadcrumb")}
      </p>
      {!access ? (
        <Notice title={t("settings.authKeys.restrictedTitle")} variant="warning">
          {t("settings.authKeys.restrictedBody")}
        </Notice>
      ) : missing.length > 0 ? (
        <Notice title={t("settings.authKeys.missingTitle")} variant="error">
          {t("settings.authKeys.missingBody")}
          {missing.map(({ user }, index) => (
            <>
              <Code key={user.id}>{getUserDisplayName(user, t("machines.common.tagOwned"))}</Code>
              {index < missing.length - 1 ? ", " : ". "}
            </>
          ))}
          {t("settings.authKeys.missingFooter")}
        </Notice>
      ) : undefined}
      <h1 className="mb-2 text-2xl font-medium">{t("settings.authKeys.title")}</h1>
      <p className="mb-4">
        {tr("settings.overview.preAuthBody", {
          link: (
            <Link external styled to="https://tailscale.com/kb/1085/auth-keys/">
              {t("settings.overview.tailscaleDocs")}
            </Link>
          ),
        })}
      </p>
      <AddAuthKey
        currentHeadscaleUserId={currentHeadscaleUserId}
        currentSubject={currentSubject}
        selfServiceOnly={selfServiceOnly}
        url={url}
        users={users}
      />
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <Select
          className="w-full"
          defaultValue={ALL_USERS}
          disabled={isDisabled}
          label={t("settings.authKeys.userLabel")}
          onValueChange={(value) => setSelectedUser(value ?? "")}
          placeholder={t("settings.authKeys.userPlaceholder")}
          items={[
            { value: ALL_USERS, label: t("settings.authKeys.all") },
            ...keys
              .filter((k): k is { user: User; preAuthKeys: PreAuthKey[] } => k.user !== null)
              .map(({ user }) => ({
                value: user.id,
                label: getUserDisplayName(user, t("machines.common.tagOwned")),
              })),
            ...(keys.some(({ user }) => user === null)
              ? [{ value: TAG_ONLY, label: t("settings.authKeys.tagOnly") }]
              : []),
          ]}
        />
        <Select
          className="w-full"
          defaultValue="all"
          disabled={isDisabled}
          label={t("settings.authKeys.statusLabel")}
          onValueChange={(value) => setStatus((value ?? "all") as AuthKeyStatus)}
          placeholder={t("settings.authKeys.statusPlaceholder")}
          items={[
            { value: "all", label: t("settings.authKeys.statusAll") },
            { value: "active", label: t("settings.authKeys.statusActive") },
            { value: "expired", label: t("settings.authKeys.statusUsedExpired") },
            { value: "reusable", label: t("settings.authKeys.statusReusable") },
            { value: "ephemeral", label: t("settings.authKeys.statusEphemeral") },
          ]}
        />
        <p className="text-sm text-mist-600 dark:text-mist-300">
          {t("settings.authKeys.expiredCount", { count: expiredCount })}
        </p>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-mist-600 dark:text-mist-300">
          <SelectCheckbox
            aria-label={t("settings.authKeys.selectAll")}
            checked={allSelected}
            disabled={isDisabled || visibleIds.length === 0}
            indeterminate={selectedVisible.length > 0 && !allSelected}
            onChange={toggleAll}
          />
          {t("settings.authKeys.selectAll")}
        </label>
      </div>
      {selected.length > 0 ? (
        <BulkExpireAuthKeys keys={expirableKeys} onClearSelection={() => setSelected([])} />
      ) : null}
      <TableList className="mt-4">
        {keys.flatMap(({ preAuthKeys }) => preAuthKeys).length === 0 ? (
          <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
            <FileKey2 />
            <p className="font-semibold">{t("settings.authKeys.empty")}</p>
          </TableList.Item>
        ) : filteredKeys.length === 0 ? (
          <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
            <FileKey2 />
            <p className="font-semibold">{t("settings.authKeys.emptyFiltered")}</p>
          </TableList.Item>
        ) : (
          filteredKeys.map((key) => {
            // Tag-only keys have no user
            if (!key.user) {
              return (
                <TableList.Item key={key.id}>
                  <AuthKeyRow
                    authKey={key}
                    onSelectedChange={(checked) => toggleKey(key.id, checked)}
                    selected={selected.includes(key.id)}
                    user={null}
                  />
                </TableList.Item>
              );
            }

            // TODO: Why is Headscale using email as the user ID here?
            // https://github.com/juanfont/headscale/issues/2520
            const user = usersById.get(key.user.id);
            if (!user) {
              return null;
            }

            return (
              <TableList.Item key={key.id}>
                <AuthKeyRow
                  authKey={key}
                  onSelectedChange={(checked) => toggleKey(key.id, checked)}
                  selected={selected.includes(key.id)}
                  user={user}
                />
              </TableList.Item>
            );
          })
        )}
      </TableList>
    </div>
  );
}
