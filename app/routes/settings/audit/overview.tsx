import { ListFilter, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import {
  SettingsActions,
  SettingsCollapsible,
  SettingsCollapsibleGroup,
  SettingsPage,
  SettingsStatus,
} from "~/components/settings-nav";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import Title from "~/components/title";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { AUDIT_ACTIONS } from "~/server/audit/actions";
import { AUDIT_EXPORT_LIMIT, MAX_AUDIT_ENTRIES } from "~/server/audit/constants";
import type { AuditActorType, AuditEntry } from "~/server/audit/types";
import { auditContext, authContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RANGES,
  auditExportHref,
  auditQueryString,
  auditRangeSince,
  parseAuditFilters,
  type AuditFilters,
  type AuditRange,
} from "./filters";

const ACTION_KEYS: Record<string, TranslationKey> = {
  [AUDIT_ACTIONS.apiKeyCreate]: "settings.audit.actions.apiKeyCreate",
  [AUDIT_ACTIONS.apiKeyExpire]: "settings.audit.actions.apiKeyExpire",
  [AUDIT_ACTIONS.apiKeyDelete]: "settings.audit.actions.apiKeyDelete",
  [AUDIT_ACTIONS.preAuthKeyCreate]: "settings.audit.actions.preAuthKeyCreate",
  [AUDIT_ACTIONS.preAuthKeyExpire]: "settings.audit.actions.preAuthKeyExpire",
  [AUDIT_ACTIONS.preAuthKeyDelete]: "settings.audit.actions.preAuthKeyDelete",
  [AUDIT_ACTIONS.userCreate]: "settings.audit.actions.userCreate",
  [AUDIT_ACTIONS.userDelete]: "settings.audit.actions.userDelete",
  [AUDIT_ACTIONS.userRename]: "settings.audit.actions.userRename",
  [AUDIT_ACTIONS.userRoleChange]: "settings.audit.actions.userRoleChange",
  [AUDIT_ACTIONS.userOwnershipTransfer]: "settings.audit.actions.userOwnershipTransfer",
  [AUDIT_ACTIONS.userLink]: "settings.audit.actions.userLink",
  [AUDIT_ACTIONS.restrictionAddDomain]: "settings.audit.actions.restrictionAddDomain",
  [AUDIT_ACTIONS.restrictionRemoveDomain]: "settings.audit.actions.restrictionRemoveDomain",
  [AUDIT_ACTIONS.restrictionAddGroup]: "settings.audit.actions.restrictionAddGroup",
  [AUDIT_ACTIONS.restrictionRemoveGroup]: "settings.audit.actions.restrictionRemoveGroup",
  [AUDIT_ACTIONS.restrictionAddUser]: "settings.audit.actions.restrictionAddUser",
  [AUDIT_ACTIONS.restrictionRemoveUser]: "settings.audit.actions.restrictionRemoveUser",
  [AUDIT_ACTIONS.registrationReject]: "settings.audit.actions.registrationReject",
  [AUDIT_ACTIONS.nodeBackfillIps]: "settings.audit.actions.nodeBackfillIps",
  [AUDIT_ACTIONS.nodeDebugCreate]: "settings.audit.actions.nodeDebugCreate",
  [AUDIT_ACTIONS.agentSync]: "settings.audit.actions.agentSync",
  [AUDIT_ACTIONS.derpAddressSync]: "settings.audit.actions.derpAddressSync",
  [AUDIT_ACTIONS.snapshotCreate]: "settings.audit.actions.snapshotCreate",
  [AUDIT_ACTIONS.snapshotRestore]: "settings.audit.actions.snapshotRestore",
  [AUDIT_ACTIONS.loginOidcUpdate]: "settings.audit.actions.loginOidcUpdate",
  [AUDIT_ACTIONS.loginOidcChangeBlocked]: "settings.audit.actions.loginOidcChangeBlocked",
  [AUDIT_ACTIONS.loginSuccess]: "settings.audit.actions.loginSuccess",
  [AUDIT_ACTIONS.loginFailure]: "settings.audit.actions.loginFailure",
  [AUDIT_ACTIONS.loginLocked]: "settings.audit.actions.loginLocked",
};

const ACTOR_TYPE_KEYS: Record<AuditActorType, TranslationKey> = {
  user: "settings.audit.actorType.user",
  api_key: "settings.audit.actorType.apiKey",
  system: "settings.audit.actorType.system",
};

const RANGE_KEYS: Record<AuditRange, TranslationKey> = {
  "1h": "settings.audit.range1h",
  "24h": "settings.audit.range24h",
  "7d": "settings.audit.range7d",
  "30d": "settings.audit.range30d",
  all: "settings.audit.rangeAll",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const audit = context.get(auditContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  const filters = parseAuditFilters(new URL(request.url).searchParams);
  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const { entries, total } = await audit.list({
    actor: filters.actor || undefined,
    action: filters.action || undefined,
    since: auditRangeSince(filters.range),
    limit: AUDIT_PAGE_SIZE,
    offset,
  });

  // The page is where the chain matters, so it is the place that checks it. A
  // mismatch means the stored log no longer lines up with itself.
  const chain = await audit.verify();
  if (chain.broken.length > 0) {
    log.warn(
      "server",
      "Audit chain: %d of %d checked entries do not match (%s)",
      chain.broken.length,
      chain.checked,
      chain.broken.slice(0, 5).join(", "),
    );
  }

  return {
    entries,
    total,
    filters,
    hasMore: offset + entries.length < total,
    maxEntries: audit.maxEntries ?? MAX_AUDIT_ENTRIES,
    dropped: audit.dropped ?? 0,
    brokenChain: chain.broken.length,
  };
}

/** The pages a fetcher has appended below the page the loader returned. */
interface AppendedAuditPages {
  /** Which filter selection the appended rows belong to. */
  key: string;
  /** The highest page the visible list includes. */
  page: number;
  /** The rows of the pages after the loader's own page, oldest first. */
  entries: AuditEntry[];
  /** Whether the newest page has a successor left to fetch. */
  hasMore: boolean;
}

/** The filter selection alone, so a new selection replaces the visible rows. */
function auditSelectionKey(filters: AuditFilters): string {
  return auditQueryString({ ...filters, page: 1 });
}

/**
 * Appends one fetched page to the rows already shown. Anything that is not the
 * page right after the last one — a duplicate delivery, or a response that
 * raced a filter change — is ignored, so the list can neither double up nor go
 * backwards.
 */
export function appendAuditPage(
  current: AppendedAuditPages,
  fetched: { filters: AuditFilters; entries: AuditEntry[]; hasMore: boolean },
): AppendedAuditPages {
  if (fetched.filters.page !== current.page + 1) {
    return current;
  }

  return {
    ...current,
    page: fetched.filters.page,
    entries: [...current.entries, ...fetched.entries],
    hasMore: fetched.hasMore,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t } = useI18n();
  const { entries, total, filters, hasMore, maxEntries, dropped, brokenChain } = loaderData;

  // The loader returns one page at a time. "Load more" asks a fetcher for the
  // next page and appends its rows here, so the entries already on screen stay
  // there; the old `<Link>` replaced them and offered no way back.
  const fetcher = useFetcher<typeof loader>();
  const selectionKey = auditSelectionKey(filters);
  const [appended, setAppended] = useState<AppendedAuditPages>({
    key: selectionKey,
    page: filters.page,
    entries: [],
    hasMore,
  });

  // Applying a filter (or landing on a different page) starts the list over.
  // Adjusting state during render is React's documented way to reset state on
  // an input change, and it happens before the stale list can be drawn.
  if (appended.key !== selectionKey) {
    setAppended({ key: selectionKey, page: filters.page, entries: [], hasMore });
  }

  const fetched = fetcher.data;
  useEffect(() => {
    if (fetcher.state !== "idle" || fetched === undefined) {
      return;
    }

    // A response for a selection the user has already left behind.
    if (auditSelectionKey(fetched.filters) !== selectionKey) {
      return;
    }

    setAppended((current) => appendAuditPage(current, fetched));
  }, [fetcher.state, fetched, selectionKey]);

  const rows = appended.entries.length > 0 ? [...entries, ...appended.entries] : entries;

  return (
    <SettingsPage
      breadcrumb={
        <>
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.audit.breadcrumb")}
        </>
      }
      description={t("settings.audit.body")}
      notices={
        <>
          <Notice title={t("settings.audit.retentionTitle")}>
            {t("settings.audit.retentionBody", { count: maxEntries })}
          </Notice>
          {brokenChain > 0 ? (
            <Notice variant="warning" title={t("settings.audit.chainBrokenTitle")}>
              {t("settings.audit.chainBrokenBody", { count: brokenChain })}
            </Notice>
          ) : undefined}
          {dropped > 0 ? (
            <Notice variant="warning" title={t("settings.audit.droppedTitle")}>
              {t("settings.audit.droppedBody", { count: dropped })}
            </Notice>
          ) : undefined}
        </>
      }
      title={t("settings.audit.title")}
    >
      <SettingsCollapsibleGroup>
        <AuditFiltersSection filters={filters} total={total} />

        <SettingsCollapsible
          description={t("settings.audit.listBody")}
          icon={ScrollText}
          status={{
            tone: "neutral",
            label: t("settings.audit.showingCount", { shown: rows.length, total }),
          }}
          title={t("settings.audit.listTitle")}
        >
          <TableList className="border-0">
            {rows.length === 0 ? (
              <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
                <ScrollText />
                <p className="font-semibold">{t("settings.audit.empty")}</p>
              </TableList.Item>
            ) : (
              rows.map((entry) => <AuditEntryRow entry={entry} key={entry.id} />)
            )}
          </TableList>

          {appended.hasMore ? (
            <SettingsActions>
              <button
                className="text-sm font-medium text-indigo-600 disabled:opacity-50 dark:text-indigo-400"
                disabled={fetcher.state !== "idle"}
                onClick={() => {
                  void fetcher.load(
                    `/settings/audit${auditQueryString({ ...filters, page: appended.page + 1 })}`,
                  );
                }}
                type="button"
              >
                {t("settings.audit.loadMore")}
              </button>
            </SettingsActions>
          ) : undefined}
        </SettingsCollapsible>
      </SettingsCollapsibleGroup>
    </SettingsPage>
  );
}

/** The filters live behind one row so the list of operations stays the page. */
function AuditFiltersSection({ filters, total }: { filters: AuditFilters; total: number }) {
  const { t } = useI18n();

  const action = filters.action
    ? ACTION_KEYS[filters.action]
      ? t(ACTION_KEYS[filters.action])
      : filters.action
    : undefined;

  const isUnfiltered = filters.range === "all" && !filters.actor && !filters.action;
  const summary = isUnfiltered
    ? t("settings.audit.summaryAll")
    : [
        t(RANGE_KEYS[filters.range]),
        filters.actor ? t("settings.audit.summaryActor", { actor: filters.actor }) : undefined,
        action ? t("settings.audit.summaryAction", { action }) : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join(" · ");

  return (
    <SettingsCollapsible
      description={t("settings.audit.filtersDescription")}
      icon={ListFilter}
      status={{ tone: "neutral", label: t(RANGE_KEYS[filters.range]) }}
      summary={summary}
      title={t("settings.audit.filtersTitle")}
    >
      <AuditFilterForm filters={filters} total={total} />
    </SettingsCollapsible>
  );
}

/** The page's action button style, shared by the submit button and the exports. */
const ACTION_BUTTON =
  "w-fit rounded-md border border-mist-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-mist-50 dark:border-mist-700 dark:bg-mist-800/50 dark:hover:bg-mist-700/50";

function AuditFilterForm({ filters, total }: { filters: AuditFilters; total: number }) {
  const { t } = useI18n();
  const reachesExportLimit = total >= AUDIT_EXPORT_LIMIT;

  return (
    <Form className="flex w-full flex-col gap-3" method="get">
      {/* Three short filters sit side by side on a wide page instead of
          stacking into one long column. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Input
          defaultValue={filters.actor}
          label={t("settings.audit.filterActor")}
          name="actor"
          placeholder={t("settings.audit.filterActorPlaceholder")}
          type="search"
        />
        <FilterSelect
          label={t("settings.audit.filterAction")}
          name="action"
          options={[
            { value: "", label: t("settings.audit.filterAll") },
            ...Object.values(AUDIT_ACTIONS).map((code) => ({
              value: code,
              label: ACTION_KEYS[code] ? t(ACTION_KEYS[code]) : code,
            })),
          ]}
          value={filters.action}
        />
        <FilterSelect
          label={t("settings.audit.filterRange")}
          name="range"
          options={AUDIT_RANGES.map((range) => ({
            value: range,
            label: t(RANGE_KEYS[range]),
          }))}
          value={filters.range}
        />
      </div>
      {reachesExportLimit ? (
        <p className="text-right text-xs opacity-70">
          {t("settings.audit.exportLimitNotice", { count: AUDIT_EXPORT_LIMIT })}
        </p>
      ) : undefined}
      <SettingsActions>
        <a className={ACTION_BUTTON} download href={auditExportHref(filters, "csv")}>
          {t("settings.audit.exportCsv")}
        </a>
        <a className={ACTION_BUTTON} download href={auditExportHref(filters, "json")}>
          {t("settings.audit.exportJson")}
        </a>
        <button className={ACTION_BUTTON} type="submit">
          {t("settings.audit.filterApply")}
        </button>
        <Link
          className="flex items-center text-sm font-medium text-indigo-600 dark:text-indigo-400"
          to="/settings/audit"
        >
          {t("settings.audit.filterReset")}
        </Link>
      </SettingsActions>
    </Form>
  );
}

/** One operation: the row stays terse, the dialog holds everything recorded. */
function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const { t, locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const action = ACTION_KEYS[entry.action] ? t(ACTION_KEYS[entry.action]) : entry.action;
  const result =
    entry.result === "success"
      ? t("settings.audit.resultSuccess")
      : t("settings.audit.resultFailure");
  // The log records an instant, so show it in the reader's own time zone and
  // name that zone. Server and browser run in different zones, so the first
  // paint disagrees; `suppressHydrationWarning` keeps React from calling that
  // expected difference a hydration error.
  const takenAt = new Date(entry.at).toLocaleString(locale, { timeZoneName: "short" });

  return (
    <TableList.Item className="p-0">
      <button
        className="flex w-full items-start justify-between gap-4 p-3 text-left hover:bg-mist-50 dark:hover:bg-mist-800/50"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{action}</span>
            <SettingsStatus tone={entry.result === "success" ? "ok" : "error"}>
              {result}
            </SettingsStatus>
          </span>
          {entry.target ? (
            <span className="truncate text-sm opacity-80">{entry.target}</span>
          ) : undefined}
          {entry.detail ? <span className="text-xs opacity-60">{entry.detail}</span> : undefined}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
          <span suppressHydrationWarning>{takenAt}</span>
          <span className="opacity-80">{entry.actor}</span>
          <span className="text-xs opacity-60">{t(ACTOR_TYPE_KEYS[entry.actorType])}</span>
        </span>
      </button>

      <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
        <DialogPanel onSubmit={(event) => event.preventDefault()} variant="unactionable">
          <Title>{t("settings.audit.entryTitle")}</Title>
          <Text>{t("settings.audit.entryDescription")}</Text>
          <dl className="flex flex-col gap-4">
            <DetailRow label={t("settings.audit.detailAction")} value={action} />
            <DetailRow label={t("settings.audit.detailResult")} value={result} />
            <DetailRow label={t("settings.audit.detailTime")} value={takenAt} isLocalTime />
            <DetailRow label={t("settings.audit.detailActor")} value={entry.actor} />
            <DetailRow
              label={t("settings.audit.detailActorType")}
              value={t(ACTOR_TYPE_KEYS[entry.actorType])}
            />
            <DetailRow
              label={t("settings.audit.detailTarget")}
              value={entry.target || t("settings.audit.detailMissing")}
            />
            <DetailRow
              label={t("settings.audit.detailNote")}
              value={entry.detail ?? t("settings.audit.detailMissing")}
            />
          </dl>
        </DialogPanel>
      </Dialog>
    </TableList.Item>
  );
}

function DetailRow({
  label,
  value,
  isLocalTime,
}: {
  label: string;
  value: string;
  isLocalTime?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide uppercase opacity-60">{label}</dt>
      <dd
        className="text-sm break-words whitespace-pre-wrap"
        suppressHydrationWarning={isLocalTime}
      >
        {value}
      </dd>
    </div>
  );
}

function FilterSelect({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex w-full flex-col gap-1">
      <span className="text-sm font-medium text-mist-700 dark:text-mist-200">{label}</span>
      <select
        className="rounded-md border border-mist-200 bg-white px-3 py-2 text-sm dark:border-mist-800 dark:bg-mist-900"
        defaultValue={value}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
