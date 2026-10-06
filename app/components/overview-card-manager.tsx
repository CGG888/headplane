import { ChevronDown, EyeOff, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import Button from "~/components/button";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import {
  browserOverviewCardStorage,
  clearHiddenOverviewCards,
  isAlertOverviewCard,
  type OverviewCardId,
  OVERVIEW_CARD_IDS,
  readHiddenOverviewCards,
  withOverviewCardHidden,
  writeHiddenOverviewCards,
} from "~/utils/overview-cards";

/**
 * The Overview page's card visibility controls.
 *
 * Hiding a card is presentation only: the route's loader is untouched, so the
 * page loads exactly what it loaded before and hiding one costs no request. The
 * stored choice lives in `localStorage`, scoped to the signed-in person and to
 * this build by {@link ~/utils/overview-cards}, and is read after mount so the
 * server render and the first client render both agree on "everything visible".
 *
 * The page binds its own user and alert set once with
 * {@link useOverviewCardsScope}; the cards and the manager then read the same
 * small store, which is what lets each card carry its own control without the
 * page growing a second component tree around it.
 */

/** Each card's own title, so the panel and the card can never disagree. */
const CARD_LABEL_KEYS: Record<OverviewCardId, TranslationKey> = {
  "versions-headplane": "overview.versions.headplaneTitle",
  "versions-headscale": "overview.versions.headscaleTitle",
  "versions-agent": "overview.versions.agentTitle",
  "derp-region": "overview.derp.regionTitle",
  "derp-relay": "overview.derp.publicTitle",
  "derp-nodes": "overview.derp.nodesTitle",
  "service-server": "overview.service.title",
  "service-dns": "overview.service.dnsTitle",
  "service-metrics": "overview.service.metricsTitle",
  "counts-tailnet": "overview.counts.tailnetTitle",
  "counts-headplane": "overview.counts.headplaneTitle",
  "counts-history": "overview.history.title",
  "health-summary": "overview.health.title",
};

/**
 * The one card that needs a sentence of its own in the panel: the health summary
 * may be hidden while it is not perfectly healthy, because hiding it hides the
 * summary, not the alert — a failing check is still delivered through the
 * notification webhooks. Every other card either says nothing or is protected.
 */
const CARD_NOTE_KEYS: Partial<Record<OverviewCardId, TranslationKey>> = {
  "health-summary": "overview.cards.healthHideableNote",
};

interface OverviewCardsState {
  /** False until the page binds its scope, so a stray card renders no control. */
  bound: boolean;
  userKey: string;
  /**
   * The cards that are an active alert right now and may therefore be
   * protected from being hidden. The health summary never reaches this set.
   */
  alerting: ReadonlySet<OverviewCardId>;
  hidden: readonly OverviewCardId[];
}

const EMPTY_ALERTS: ReadonlySet<OverviewCardId> = new Set();

/** What the server and the first client render agree on: everything visible. */
const INITIAL_OVERVIEW_CARDS_STATE: OverviewCardsState = {
  bound: false,
  userKey: "",
  alerting: EMPTY_ALERTS,
  hidden: [],
};

let overviewCardsState = INITIAL_OVERVIEW_CARDS_STATE;
const overviewCardsListeners = new Set<() => void>();

function setOverviewCardsState(next: OverviewCardsState): void {
  overviewCardsState = next;
  for (const listener of overviewCardsListeners) {
    listener();
  }
}

function subscribeOverviewCards(listener: () => void): () => void {
  overviewCardsListeners.add(listener);
  return () => {
    overviewCardsListeners.delete(listener);
  };
}

function getOverviewCardsSnapshot(): OverviewCardsState {
  return overviewCardsState;
}

function getOverviewCardsServerSnapshot(): OverviewCardsState {
  return INITIAL_OVERVIEW_CARDS_STATE;
}

function useOverviewCardsState(): OverviewCardsState {
  return useSyncExternalStore(
    subscribeOverviewCards,
    getOverviewCardsSnapshot,
    getOverviewCardsServerSnapshot,
  );
}

/**
 * Binds this page's user and alert set to the shared visibility store. The
 * stored set is read here, once, and the protection rule is applied on the way
 * in — so a card that is an alert in its own right (see
 * {@link ~/utils/overview-cards}, `isAlertOverviewCard`) is visible no matter
 * what storage says, and its stored preference returns by itself once it stops
 * reporting a problem. The health summary is filtered out here, alongside the
 * reader, so its checkbox is never disabled and never shows as protected.
 */
export function useOverviewCardsScope(userKey: string, alerting: readonly OverviewCardId[]): void {
  // The alert set is rebuilt on every render of the page, so its contents — not
  // the array identity — decide whether the stored set has to be read again.
  const alertingKey = [...alerting].filter(isAlertOverviewCard).join(",");
  const alertingIds = useMemo<ReadonlySet<OverviewCardId>>(
    () => new Set(alertingKey.length === 0 ? [] : (alertingKey.split(",") as OverviewCardId[])),
    [alertingKey],
  );

  useEffect(() => {
    const hidden = readHiddenOverviewCards(browserOverviewCardStorage(), userKey, [...alertingIds]);
    setOverviewCardsState({ bound: true, userKey, alerting: alertingIds, hidden });
  }, [userKey, alertingIds]);
}

/** Hides or shows one card for the user this page is bound to. */
function setCardHidden(id: OverviewCardId, isHidden: boolean): void {
  const current = overviewCardsState;
  const hidden = withOverviewCardHidden(current.hidden, id, isHidden);
  writeHiddenOverviewCards(browserOverviewCardStorage(), current.userKey, hidden);
  setOverviewCardsState({ ...current, hidden });
}

/** Forgets the stored choice, which is what "restore defaults" means. */
function restoreCardDefaults(): void {
  const current = overviewCardsState;
  clearHiddenOverviewCards(browserOverviewCardStorage(), current.userKey);
  setOverviewCardsState({ ...current, hidden: [] });
}

/** Whether the card itself renders right now; an alerting card always does. */
export function useOverviewCardVisible(cardId: OverviewCardId): boolean {
  const { alerting, hidden } = useOverviewCardsState();
  return alerting.has(cardId) || !hidden.includes(cardId);
}

/**
 * Whether any card of one group renders right now, so a group whose cards are
 * all hidden takes its heading with it instead of leaving an empty section.
 */
export function useOverviewCardsVisible(cardIds: readonly OverviewCardId[]): boolean {
  const { alerting, hidden } = useOverviewCardsState();
  return cardIds.some((id) => alerting.has(id) || !hidden.includes(id));
}

/**
 * The hide control in one card's header. It is absent for a card that reports a
 * problem and before the page has bound its scope, so nothing renders a control
 * that cannot work.
 */
export function OverviewCardHideButton({ cardId }: { cardId: OverviewCardId }) {
  const { t } = useI18n();
  const { bound, alerting } = useOverviewCardsState();
  if (!bound || alerting.has(cardId)) {
    return undefined;
  }

  const label = t("overview.cards.hideCard");

  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        "text-mist-400 transition-colors duration-100",
        "hover:bg-mist-100 hover:text-mist-700",
        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:text-mist-500 dark:hover:bg-mist-800 dark:hover:text-mist-200",
        "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
      )}
      onClick={() => setCardHidden(cardId, true)}
      title={label}
      type="button"
    >
      <EyeOff className="h-4 w-4" />
    </button>
  );
}

/**
 * The "manage cards" disclosure above the dashboard. It is a button that opens
 * a panel — never a form, so it cannot nest inside one — and every card stays
 * listed inside it, including the hidden ones and the ones that can never be
 * hidden, so nothing becomes unreachable.
 */
export function OverviewCardManager() {
  const { t } = useI18n();
  const { hidden, alerting, bound } = useOverviewCardsState();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  if (!bound) {
    return undefined;
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        aria-controls={panelId}
        aria-expanded={open}
        className="px-3 py-1.5 text-xs"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {t("overview.cards.manage")}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")}
        />
      </Button>

      {open ? (
        <div
          aria-label={t("overview.cards.manage")}
          className={cn(
            "absolute right-0 z-30 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border p-3 shadow-surface",
            "border-mist-200 bg-white dark:border-mist-800 dark:bg-mist-900",
          )}
          id={panelId}
          role="group"
        >
          <p className="text-xs text-mist-600 dark:text-mist-400">{t("overview.cards.body")}</p>

          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {OVERVIEW_CARD_IDS.map((id) => {
              const isAlerting = alerting.has(id);
              const isHidden = hidden.includes(id);
              const label = t(CARD_LABEL_KEYS[id]);
              const noteKey = CARD_NOTE_KEYS[id];

              return (
                <li key={id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                      "hover:bg-mist-100/70 dark:hover:bg-mist-800/60",
                      (isHidden || isAlerting) && "text-mist-500 dark:text-mist-400",
                    )}
                  >
                    <input
                      aria-label={label}
                      checked={!isHidden || isAlerting}
                      className={cn(
                        "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-mist-300 accent-indigo-500",
                        "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        "dark:border-mist-600 dark:focus-visible:ring-indigo-400/40 dark:focus-visible:ring-offset-mist-900",
                      )}
                      disabled={isAlerting}
                      onChange={(event) => setCardHidden(id, !event.target.checked)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate" title={label}>
                      {label}
                    </span>
                    {isAlerting ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-300">
                        {t("overview.cards.protectedState")}
                      </span>
                    ) : isHidden ? (
                      <span className="rounded-full bg-mist-500/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-mist-700 dark:text-mist-300">
                        {t("overview.cards.hiddenState")}
                      </span>
                    ) : undefined}
                  </label>
                  {noteKey === undefined ? undefined : (
                    <p className="mt-0.5 pl-6 text-xs text-mist-500 dark:text-mist-400">
                      {t(noteKey)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex justify-end border-t border-mist-200 pt-2 dark:border-mist-800">
            <Button
              className="px-3 py-1.5 text-xs"
              onClick={restoreCardDefaults}
              type="button"
              variant="ghost"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("overview.cards.restoreDefault")}
            </Button>
          </div>
        </div>
      ) : undefined}
    </div>
  );
}
