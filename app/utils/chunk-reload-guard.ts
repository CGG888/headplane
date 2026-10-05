// MARK: Chunk Reload Guard
//
// A reverse proxy that caches the HTML shell keeps handing out a document that
// references hashed route chunks from an older build. React Router answers a
// failed route-module import with `window.location.reload()` (see
// `react-router`'s `lib/dom/ssr/routeModules`), which fetches the same stale
// shell and reloads forever.
//
// This module bounds that loop to a single automatic reload per window and
// reports a *trip* afterwards so the UI can explain the situation instead of
// reloading again. `shouldAutoReload` is the only real logic; everything else
// is a thin `sessionStorage` wrapper so it stays unit-testable.

/** sessionStorage key holding the timestamp of the last automatic reload. */
export const CHUNK_RELOAD_STORAGE_KEY = "headplane:chunk-reload-guard";

/** How long after an automatic reload another one is forbidden. */
export const AUTO_RELOAD_WINDOW_MS = 15_000;

/** The slice of the Web Storage API the guard needs (tests pass a fake). */
export interface GuardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the caller should do after asking the guard. */
export type GuardAction = "ok" | "reload" | "trip";

/**
 * Whether an automatic reload is allowed right now. `previousAttemptAt` is the
 * timestamp of the last automatic reload (`null` when there never was one).
 * A missing, unparsable, or expired attempt allows exactly one reload; a
 * recent one forbids it. A timestamp in the future (a clock that moved
 * backwards) counts as recent so a skewed clock cannot re-arm the loop.
 */
export function shouldAutoReload(
  previousAttemptAt: number | null,
  now: number,
  windowMs: number = AUTO_RELOAD_WINDOW_MS,
): boolean {
  if (previousAttemptAt === null || !Number.isFinite(previousAttemptAt)) return true;
  return now - previousAttemptAt >= windowMs;
}

/**
 * Whether a failed resource URL points at a hashed client build chunk. Only
 * these are treated as evidence of a stale shell; any other broken subresource
 * (an icon, an avatar, a third-party script) is none of the guard's business.
 */
export function isChunkAssetUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("/assets/");
}

/**
 * Whether a thrown value looks like a failed dynamic `import()` of a route
 * chunk. React Router's own prefetch uses a bare `import()` whose rejection is
 * never handled, and browsers word that failure differently.
 */
export function isChunkLoadErrorMessage(message: string): boolean {
  return /dynamically imported module|importing a module script failed|module script failed/i.test(
    message,
  );
}

/**
 * Whether this boot has to stop instead of trying again. A failed attempt that
 * is still inside the window means the document the boot came from is the stale
 * shell, so React Router's own `location.reload()` (which cannot be
 * intercepted) would reload into itself forever. A pure read: the record is
 * only cleared by the operator's manual reload, through `reset`.
 */
export function shouldSkipAutoReloadOnBoot(
  storage: GuardStorage,
  now: number = Date.now(),
  windowMs: number = AUTO_RELOAD_WINDOW_MS,
  key: string = CHUNK_RELOAD_STORAGE_KEY,
): boolean {
  return !shouldAutoReload(readReloadAttempt(storage, key), now, windowMs);
}

/** Reads the timestamp of the last automatic reload, or `null` when absent. */
export function readReloadAttempt(
  storage: GuardStorage,
  key: string = CHUNK_RELOAD_STORAGE_KEY,
): number | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    // Storage can be blocked entirely (private mode, iframe policy).
    return null;
  }

  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function recordReloadAttempt(
  storage: GuardStorage,
  now: number,
  key: string = CHUNK_RELOAD_STORAGE_KEY,
): void {
  try {
    storage.setItem(key, String(now));
  } catch {
    // Losing the record only costs us the at-most-once guarantee.
  }
}

export function clearReloadAttempt(
  storage: GuardStorage,
  key: string = CHUNK_RELOAD_STORAGE_KEY,
): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do; the next boot simply re-evaluates the record.
  }
}

export interface ChunkReloadGuard {
  /**
   * Call once per boot. `"trip"` means the previous boot already spent this
   * window's automatic reload on a failed chunk, so the app should explain
   * itself instead of rendering (and prefetching) again.
   */
  beginSession(): GuardAction;
  /** Call when a chunk failed to load. Records the attempt it allows. */
  registerFailure(): GuardAction;
  /** Forgets the attempt, for a reload the user explicitly asked for. */
  reset(): void;
}

export interface ChunkReloadGuardOptions {
  storage: GuardStorage;
  now?: () => number;
  windowMs?: number;
  key?: string;
}

export function createChunkReloadGuard({
  storage,
  now = Date.now,
  windowMs = AUTO_RELOAD_WINDOW_MS,
  key = CHUNK_RELOAD_STORAGE_KEY,
}: ChunkReloadGuardOptions): ChunkReloadGuard {
  const allowed = () => shouldAutoReload(readReloadAttempt(storage, key), now(), windowMs);

  return {
    beginSession() {
      if (!allowed()) return "trip";

      // Drop an expired record so a later failure can reload again.
      if (readReloadAttempt(storage, key) !== null) clearReloadAttempt(storage, key);
      return "ok";
    },
    registerFailure() {
      if (!allowed()) return "trip";

      recordReloadAttempt(storage, now(), key);
      return "reload";
    },
    reset() {
      clearReloadAttempt(storage, key);
    },
  };
}

/**
 * The guard's storage in a browser, or `null` when the guard must stay out of
 * the way. That covers the server, development and HMR (which reload on
 * purpose), and browsers that refuse `sessionStorage` access.
 */
export function browserGuardStorage(): GuardStorage | null {
  if (typeof window === "undefined" || import.meta.env.DEV) return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The browser wrapper around `createChunkReloadGuard`. */
export function createBrowserChunkReloadGuard(): ChunkReloadGuard | null {
  const storage = browserGuardStorage();
  return storage === null ? null : createChunkReloadGuard({ storage });
}

/**
 * Reports the first failed chunk of this document to `onFailure`: a hashed
 * resource that did not load (a capture-phase error on a `<script>` or a
 * `<link rel="modulepreload">`) or a dynamic `import()` that rejected with no
 * handler. Later failures of the same boot are ignored, and a browser that
 * already knows it is offline is ignored too, because being offline fails
 * everything. Returns the function that removes the listeners again.
 *
 * The component wrapper calls this once React has mounted; `entry.client` calls
 * it before hydration so a route chunk that fails while the router boots is
 * still recorded.
 */
export function watchChunkFailures(onFailure: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  let handled = false;
  const fail = () => {
    if (handled) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    handled = true;
    onFailure();
  };

  const onResourceError = (event: Event) => {
    const target = event.target;
    const url =
      target instanceof HTMLScriptElement
        ? target.src
        : target instanceof HTMLLinkElement
          ? target.href
          : null;

    if (isChunkAssetUrl(url)) fail();
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (isChunkLoadErrorMessage(message)) fail();
  };

  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onResourceError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
