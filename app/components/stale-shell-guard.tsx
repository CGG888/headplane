import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "~/i18n/provider";
import {
  createBrowserChunkReloadGuard,
  isChunkAssetUrl,
  isChunkLoadErrorMessage,
} from "~/utils/chunk-reload-guard";

import Button from "./button";
import Card from "./card";

interface StaleShellGuardProps {
  readonly children: ReactNode;
}

/**
 * Bounds React Router's "a route chunk failed to load, reload the document"
 * behaviour. A reverse proxy that caches the HTML shell serves the same stale
 * document back after the reload, so that behaviour normally loops forever.
 *
 * The guard allows one automatic reload per window (recorded in
 * `sessionStorage`). When a chunk fails again inside that window, or when this
 * boot follows such a reload, the app is replaced by a message with a manual
 * reload button: with nothing rendered there is nothing left to prefetch, so
 * the loop cannot continue on its own.
 */
export default function StaleShellGuard({ children }: StaleShellGuardProps) {
  const { t } = useI18n();
  const guard = useMemo(() => createBrowserChunkReloadGuard(), []);
  const [staleShell, setStaleShell] = useState(false);

  useEffect(() => {
    // `null` in dev/HMR, on the server, and when storage is unavailable.
    if (guard === null) return;

    // A recent automatic reload that did not fix the page means the shell we
    // are booting from is still the stale one; do not spend another reload.
    if (guard.beginSession() === "trip") {
      setStaleShell(true);
      return;
    }

    // Only the first failure of a boot is acted on: a burst of 404s from the
    // same stale shell must not queue up reloads or flash the notice over a
    // reload that is already on its way.
    let handled = false;
    const onFailure = () => {
      if (handled) return;

      // Being offline fails every request; that is the offline path's problem,
      // not evidence of a stale shell.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      handled = true;

      if (guard.registerFailure() === "reload") {
        window.location.reload();
      } else {
        setStaleShell(true);
      }
    };

    // A `<script>` or `<link rel="modulepreload">` pointing at a missing chunk
    // reports through a capture-phase error event. React Router's bare
    // prefetch `import()` has no handler at all, so it arrives as an unhandled
    // rejection instead.
    const onResourceError = (event: Event) => {
      const target = event.target;
      const url =
        target instanceof HTMLScriptElement
          ? target.src
          : target instanceof HTMLLinkElement
            ? target.href
            : null;

      if (isChunkAssetUrl(url)) onFailure();
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      if (isChunkLoadErrorMessage(message)) onFailure();
    };

    window.addEventListener("error", onResourceError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onResourceError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [guard]);

  if (staleShell) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-4">
        <Card className="max-w-2xl" variant="flat">
          <div className="flex items-center justify-between gap-4">
            <Card.Title>{t("errors.staleShell.title")}</Card.Title>
            <TriangleAlert className="mb-2 h-6 w-6 text-yellow-500" />
          </div>
          <Card.Text>{t("errors.staleShell.body")}</Card.Text>
          <Card.Text className="mt-2 text-sm text-mist-500 dark:text-mist-400">
            {t("errors.staleShell.hint")}
          </Card.Text>
          <Button
            className="mt-6"
            variant="heavy"
            onClick={() => {
              guard?.reset();
              window.location.reload();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t("errors.staleShell.reload")}
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
