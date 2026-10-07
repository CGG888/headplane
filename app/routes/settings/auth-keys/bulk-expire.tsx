import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import toast from "~/utils/toast";

import type { ExpirableAuthKey } from "./filters";
import { PRE_AUTH_KEY_EXPIRED } from "./result";

interface ExpireRequestProps {
  authKey: ExpirableAuthKey;
  onSettled: (id: string, succeeded: boolean) => void;
}

/**
 * Sends one expire request through the page's existing single-key action and
 * reports the result. One instance per selected key, each with its own
 * fetcher, so requests do not cancel each other the way repeated submits on a
 * single fetcher would.
 */
function ExpireRequest({ authKey, onSettled }: ExpireRequestProps) {
  const fetcher = useFetcher();
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) {
      return;
    }

    submitted.current = true;
    const form = new FormData();
    form.set("action_id", "expire_preauthkey");
    // Same fields the single-key dialog posts: the Headscale numeric user id,
    // the stable pre-auth key id and the key itself.
    form.set("user_id", authKey.userId);
    form.set("key_id", authKey.id);
    form.set("key", authKey.key);
    fetcher.submit(form, { method: "POST" });
  }, [fetcher, authKey]);

  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data === undefined) {
      return;
    }

    onSettled(authKey.id, fetcher.data === PRE_AUTH_KEY_EXPIRED);
  }, [fetcher.state, fetcher.data, onSettled, authKey.id]);

  return null;
}

interface BulkExpireAuthKeysProps {
  /** Selected keys that are still expirable and have a user; the rest are dropped. */
  keys: ExpirableAuthKey[];
  onClearSelection: () => void;
}

/**
 * Selection toolbar and confirm dialog for expiring several pre-auth keys at
 * once. Every request posts the same fields as the single-key dialog, so the
 * permission check and the mutation stay exactly as they are there; used or
 * expired keys are filtered out before they can queue up.
 */
export default function BulkExpireAuthKeys({ keys, onClearSelection }: BulkExpireAuthKeysProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [queue, setQueue] = useState<ExpirableAuthKey[] | null>(null);
  const [results, setResults] = useState<Map<string, boolean>>(new Map());
  /** Bumped on every submit so a retry remounts the request children. */
  const [attempt, setAttempt] = useState(0);

  const isRunning = queue !== null && results.size < queue.length;
  const failed = queue !== null && [...results.values()].some((succeeded) => !succeeded);

  const handleSettled = useCallback((id: string, succeeded: boolean) => {
    setResults((current) => {
      if (current.has(id)) {
        return current;
      }

      const next = new Map(current);
      next.set(id, succeeded);
      return next;
    });
  }, []);

  // Fires once every queued request has reported back. A failure keeps the
  // dialog open instead of claiming the keys were revoked.
  useEffect(() => {
    if (queue === null || results.size !== queue.length) {
      return;
    }

    if ([...results.values()].some((succeeded) => !succeeded)) {
      return;
    }

    toast(t("settings.authKeys.bulkSummary", { count: queue.length }));
    onClearSelection();
    setIsOpen(false);
  }, [queue, results, onClearSelection, t]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      // A run in progress is not interruptible, but a run that only produced
      // failures must be closable again; otherwise a single failed request left
      // the dialog stuck with no way out.
      if (!open && isRunning && !failed) {
        return;
      }

      setIsOpen(open);
      if (!open) {
        setQueue(null);
        setResults(new Map());
      }
    },
    [failed, isRunning],
  );

  return (
    <>
      <div
        aria-label={t("settings.authKeys.bulkActionsLabel")}
        className={cn(
          "mt-4 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
          "border-indigo-200 bg-indigo-50/70",
          "dark:border-indigo-500/30 dark:bg-indigo-500/10",
        )}
        role="toolbar"
      >
        <span className="flex items-center gap-x-2 pr-1 text-sm font-medium">
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
              "bg-indigo-600 text-xs font-semibold text-white",
              "dark:bg-indigo-500",
            )}
          >
            {keys.length}
          </span>
          <span className="whitespace-nowrap">
            {t("settings.authKeys.bulkSelected", { count: keys.length })}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button disabled={keys.length === 0} onClick={() => setIsOpen(true)} variant="danger">
            {t("settings.authKeys.bulkExpire")}
          </Button>
          <Button
            aria-label={t("settings.authKeys.bulkClearSelection")}
            onClick={onClearSelection}
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog isOpen={isOpen} onOpenChange={handleOpenChange}>
        <DialogPanel
          isDisabled={isRunning}
          onSubmit={(event) => {
            event.preventDefault();
            if (isRunning || keys.length === 0) {
              return;
            }

            setResults(new Map());
            setQueue(keys);
            // Re-queueing the same array would reuse the same child instances,
            // whose `submitted` refs are already true, so no request would be
            // sent and the dialog would spin forever on `results.size <
            // queue.length`. Bumping the key remounts them.
            setAttempt((current) => current + 1);
          }}
          variant="destructive"
        >
          <Title>{t("settings.authKeys.bulkTitle", { count: queue?.length ?? keys.length })}</Title>
          <Text>{t("settings.authKeys.bulkBody")}</Text>
          {isRunning ? (
            <p className="text-sm text-mist-600 dark:text-mist-300">
              {t("settings.authKeys.bulkProgress", {
                done: results.size,
                total: queue?.length ?? 0,
              })}
            </p>
          ) : null}
          {failed ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {t("settings.authKeys.bulkError")}
            </p>
          ) : null}
          {queue?.map((authKey) => (
            <ExpireRequest
              authKey={authKey}
              key={`${authKey.id}:${attempt}`}
              onSettled={handleSettled}
            />
          ))}
        </DialogPanel>
      </Dialog>
    </>
  );
}
