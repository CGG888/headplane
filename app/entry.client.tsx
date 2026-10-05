import { StrictMode, startTransition } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { StaleShellNotice } from "~/components/stale-shell-guard";
import {
  browserGuardStorage,
  createChunkReloadGuard,
  shouldSkipAutoReloadOnBoot,
  watchChunkFailures,
  type ChunkReloadGuard,
} from "~/utils/chunk-reload-guard";
import { DEFAULT_LOCALE, isLocale, type Locale } from "~/utils/locale";

// MARK: Stale shell guard, boot half
//
// React Router answers a failed route-module import with `window.location.reload()`
// and nothing can intercept that call. The guard component in the app tree only
// installs itself after the first commit, which is exactly the commit such a
// failure never reaches, so without a check before hydration a reverse proxy
// serving one cached stale shell reloads the document into itself forever.
//
// `browserGuardStorage()` is `null` on the server, in development and HMR (which
// reload on purpose), and when the browser refuses sessionStorage, so all of the
// below stays out of the way in those cases.
const storage = browserGuardStorage();

if (storage !== null && shouldSkipAutoReloadOnBoot(storage) && isOnline()) {
  // The previous boot already spent this window's automatic reload on a chunk
  // that never arrived. Hydrating would hand React Router another failing
  // import and another reload of the same stale shell, so the notice takes over
  // and the operator's manual reload is what clears the guard.
  showStaleShell(createChunkReloadGuard({ storage }));
} else {
  if (storage !== null) {
    // Registered before hydration: a route chunk that fails while the router
    // boots is otherwise never seen by anything, because React Router handles
    // the rejection itself (it reloads instead of letting it bubble). Recording
    // it here is what lets the next boot stop instead of looping.
    const guard = createChunkReloadGuard({ storage });
    watchChunkFailures(() => {
      if (guard.registerFailure() === "reload") {
        window.location.reload();
      }
    });
  }

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    );
  });
}

/** Being offline fails every request; that is the offline path's problem. */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Replaces the document with the stale shell notice. Hydration never starts,
 * so the server-rendered markup — which belongs to the router that would only
 * fail again — is removed instead of being left behind the notice.
 */
function showStaleShell(guard: ChunkReloadGuard): void {
  const container = document.createElement("div");
  document.body.replaceChildren(container);

  createRoot(container).render(
    <StaleShellNotice
      locale={pageLocale()}
      onReload={() => {
        // The operator asked for this reload, so the record is forgotten and
        // the next boot is allowed to try the automatic path again.
        guard.reset();
        window.location.reload();
      }}
    />,
  );
}

/** The locale the server rendered into `<html lang>`, which needs no provider. */
function pageLocale(): Locale {
  const lang = document.documentElement.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}
