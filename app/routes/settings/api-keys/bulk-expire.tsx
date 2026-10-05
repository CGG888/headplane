import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { Key } from "~/types";
import cn from "~/utils/cn";
import toast from "~/utils/toast";

import type { ApiKeyActionResult } from "./actions";
import { API_KEY_ERROR_KEYS, type ApiKeyErrorCode } from "./error-keys";

interface ExpireRequestProps {
  prefix: string;
  onSettled: (prefix: string, errorCode: ApiKeyErrorCode | null) => void;
}

/**
 * Sends one expire request through the page's existing single-key action and
 * reports the result. One instance per selected key, each with its own
 * fetcher, so requests do not cancel each other the way repeated submits on a
 * single fetcher would.
 */
function ExpireRequest({ prefix, onSettled }: ExpireRequestProps) {
  const fetcher = useFetcher<ApiKeyActionResult>();
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current) {
      return;
    }

    submitted.current = true;
    const form = new FormData();
    form.set("action_id", "expire_api_key");
    form.set("prefix", prefix);
    fetcher.submit(form, { method: "POST" });
  }, [fetcher, prefix]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }

    onSettled(prefix, fetcher.data.success ? null : fetcher.data.errorCode);
  }, [fetcher.state, fetcher.data, onSettled, prefix]);

  return null;
}

interface BulkExpireApiKeysProps {
  /** Selected keys that are still expirable; already-expired keys are dropped. */
  keys: Key[];
  onClearSelection: () => void;
}

/**
 * Selection toolbar and confirm dialog for expiring several API keys at once.
 * Each request goes through the same action, permission check and error codes
 * as the single-key dialog; an expired key never reaches the queue because the
 * page filters the selection before passing it here.
 */
export default function BulkExpireApiKeys({ keys, onClearSelection }: BulkExpireApiKeysProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [results, setResults] = useState<Map<string, ApiKeyErrorCode | null>>(new Map());

  const isRunning = queue !== null && results.size < queue.length;
  const failedPrefix = queue?.find((prefix) => results.get(prefix) != null) ?? null;
  const error = failedPrefix
    ? t(API_KEY_ERROR_KEYS[results.get(failedPrefix) as ApiKeyErrorCode])
    : null;

  const handleSettled = useCallback((prefix: string, errorCode: ApiKeyErrorCode | null) => {
    setResults((current) => {
      if (current.has(prefix)) {
        return current;
      }

      const next = new Map(current);
      next.set(prefix, errorCode);
      return next;
    });
  }, []);

  // Fires once every queued request has reported back. Failures keep the
  // dialog open with the message the single-key dialog would have shown.
  useEffect(() => {
    if (queue === null || results.size !== queue.length) {
      return;
    }

    if ([...results.values()].some((errorCode) => errorCode !== null)) {
      return;
    }

    toast(t("settings.apiKeys.bulkSummary", { count: queue.length }));
    onClearSelection();
    setIsOpen(false);
  }, [queue, results, onClearSelection, t]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && isRunning) {
        return;
      }

      setIsOpen(open);
      if (!open) {
        setQueue(null);
        setResults(new Map());
      }
    },
    [isRunning],
  );

  return (
    <>
      <div
        aria-label={t("settings.apiKeys.bulkActionsLabel")}
        className={cn(
          "mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
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
            {t("settings.apiKeys.bulkSelected", { count: keys.length })}
          </span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button disabled={keys.length === 0} onClick={() => setIsOpen(true)} variant="danger">
            {t("settings.apiKeys.bulkExpire")}
          </Button>
          <Button
            aria-label={t("settings.apiKeys.bulkClearSelection")}
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
            setQueue(keys.map((key) => key.prefix));
          }}
          variant="destructive"
        >
          <Title>{t("settings.apiKeys.bulkTitle", { count: queue?.length ?? keys.length })}</Title>
          <Text>{t("settings.apiKeys.bulkBody")}</Text>
          {isRunning ? (
            <p className="text-sm text-mist-600 dark:text-mist-300">
              {t("settings.apiKeys.bulkProgress", {
                done: results.size,
                total: queue?.length ?? 0,
              })}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : null}
          {queue?.map((prefix) => (
            <ExpireRequest key={prefix} onSettled={handleSettled} prefix={prefix} />
          ))}
        </DialogPanel>
      </Dialog>
    </>
  );
}
