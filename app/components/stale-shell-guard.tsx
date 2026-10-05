import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { translate } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { createBrowserChunkReloadGuard, watchChunkFailures } from "~/utils/chunk-reload-guard";
import type { Locale } from "~/utils/locale";

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
 *
 * A failure that happens while React Router is still importing the matched
 * route modules never reaches this component, because React Router answers it
 * with an uninterceptable document reload. `entry.client` runs the same boot
 * check before hydration for that case.
 */
export default function StaleShellGuard({ children }: StaleShellGuardProps) {
  const { locale } = useI18n();
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
    return watchChunkFailures(() => {
      if (guard.registerFailure() === "reload") {
        window.location.reload();
      } else {
        setStaleShell(true);
      }
    });
  }, [guard]);

  if (staleShell) {
    return (
      <StaleShellNotice
        locale={locale}
        onReload={() => {
          guard?.reset();
          window.location.reload();
        }}
      />
    );
  }

  return <>{children}</>;
}

interface StaleShellNoticeProps {
  readonly locale: Locale;
  readonly onReload: () => void;
}

/**
 * The "your page is out of date" message with its manual reload button.
 *
 * Takes the locale instead of reading the i18n context so `entry.client` can
 * render it before any provider, or router, exists.
 */
export function StaleShellNotice({ locale, onReload }: StaleShellNoticeProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center p-4">
      <Card className="max-w-2xl" variant="flat">
        <div className="flex items-center justify-between gap-4">
          <Card.Title>{translate(locale, "errors.staleShell.title")}</Card.Title>
          <TriangleAlert className="mb-2 h-6 w-6 text-yellow-500" />
        </div>
        <Card.Text>{translate(locale, "errors.staleShell.body")}</Card.Text>
        <Card.Text className="mt-2 text-sm text-mist-500 dark:text-mist-400">
          {translate(locale, "errors.staleShell.hint")}
        </Card.Text>
        <Button className="mt-6" variant="heavy" onClick={onReload}>
          <RefreshCw className="h-4 w-4" />
          {translate(locale, "errors.staleShell.reload")}
        </Button>
      </Card>
    </div>
  );
}
