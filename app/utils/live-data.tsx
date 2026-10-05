import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useRevalidator } from "react-router";

/**
 * Where the user's live-updates preference is persisted. It is read after mount
 * (never during render) so the server and the first client render agree on the
 * default.
 */
export const LIVE_UPDATES_STORAGE_KEY = "headplane.live-updates";

type Versions = Record<string, string>;

interface ChangedEvent {
  resource: string;
  version: string;
}

/**
 * Live updates are off unless the stored value is exactly "on". Defaulting to
 * off means an upgrade stops the reload storm for everyone, and turning it on
 * stays an explicit choice.
 */
export function parseLiveUpdatesPreference(raw: string | null | undefined): boolean {
  return raw === "on";
}

function readStoredPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return parseLiveUpdatesPreference(window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); off is the
    // safe answer and nothing else depends on it.
    return false;
  }
}

function writeStoredPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LIVE_UPDATES_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Ignored: the toggle still governs this session.
  }
}

/**
 * Whether a live change may revalidate the open page. This is the single gate
 * the client uses: paused live updates revalidate nothing at all, a pending
 * mutation is never interrupted, and a hidden tab is only marked dirty.
 */
export function shouldRevalidateForLiveChange(input: {
  paused: boolean;
  visible: boolean;
  revalidatorState: "idle" | "loading" | "submitting";
}): boolean {
  return !input.paused && input.visible && input.revalidatorState === "idle";
}

/**
 * The slice of `EventSource` the live stream needs. Narrowing it keeps the
 * subscription testable without a browser.
 */
export interface LiveEventSource {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
}

export interface LiveSubscriptionOptions {
  url: string;
  /** Start paused: nothing connects and nothing revalidates. */
  paused: boolean;
  /** Revalidate the page after a change that arrived while it was visible. */
  revalidate: () => void;
  /** A change arrived while the tab was hidden; remember it for later. */
  markDirty: () => void;
  isVisible: () => boolean;
  /** Injectable for tests. */
  createSource?: (url: string) => LiveEventSource;
}

export interface LiveSubscription {
  /**
   * Suspends the subscription entirely. Resuming reconnects and revalidates
   * once, because a fresh connection only reports the current versions and the
   * page would otherwise stay stale.
   */
  setPaused(paused: boolean): void;
  close(): void;
}

function browserEventSource(url: string): LiveEventSource {
  const sse = new EventSource(url);
  const source: LiveEventSource = {
    addEventListener: (type, listener) => {
      sse.addEventListener(type, listener as unknown as (event: Event) => void);
    },
    close: () => sse.close(),
    onerror: null,
  };

  sse.onerror = (event) => source.onerror?.(event);
  return source;
}

/**
 * The live change stream as a plain controller: it owns the SSE connection, the
 * reconnect backoff and the "did this version actually change" bookkeeping, so
 * the provider is only wiring.
 */
export function createLiveSubscription(options: LiveSubscriptionOptions): LiveSubscription {
  const createSource = options.createSource ?? browserEventSource;

  let paused = options.paused;
  let source: LiveEventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  let versions: Versions = {};

  function closeSource() {
    if (source) {
      source.close();
      source = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function connect() {
    if (paused || source) {
      return;
    }

    const sse = createSource(options.url);
    source = sse;

    sse.addEventListener("hello", (event) => {
      backoff = 1000;
      try {
        versions = JSON.parse(event.data) as Versions;
      } catch {}
    });

    sse.addEventListener("changed", (event) => {
      try {
        const data = JSON.parse(event.data) as ChangedEvent;
        const current = versions[data.resource];
        if (current !== undefined && data.version === current) {
          return;
        }

        versions = { ...versions, [data.resource]: data.version };

        if (!options.isVisible()) {
          options.markDirty();
          return;
        }

        options.revalidate();
      } catch {}
    });

    sse.onerror = () => {
      sse.close();
      if (source === sse) {
        source = null;
      }

      if (paused) {
        return;
      }

      const delay = backoff;
      backoff = Math.min(delay * 2, 30_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  }

  connect();

  return {
    setPaused(next) {
      if (next === paused) {
        return;
      }

      paused = next;
      if (paused) {
        closeSource();
        return;
      }

      connect();
      if (options.isVisible()) {
        options.revalidate();
      } else {
        options.markDirty();
      }
    },

    close() {
      paused = true;
      closeSource();
    },
  };
}

// The default context is inert; it only exists so a consumer rendered outside
// the provider (the login page) still gets working, no-op controls.
function noop() {}

interface LiveDataContextValue {
  paused: boolean;
  liveUpdates: boolean;
  setPaused: (paused: boolean) => void;
  setLiveUpdates: (enabled: boolean) => void;
}

const LiveDataContext = createContext<LiveDataContextValue>({
  paused: false,
  liveUpdates: false,
  setPaused: noop,
  setLiveUpdates: noop,
});

interface LiveDataProps {
  children: React.ReactNode;
}

export function LiveDataProvider({ children }: LiveDataProps) {
  const revalidator = useRevalidator();
  const location = useLocation();
  // The persisted preference and a transient hold used by dialogs and the login
  // page. Either one being set means nothing revalidates.
  const [liveUpdates, setLiveUpdatesState] = useState(false);
  const [held, setHeld] = useState(false);
  const paused = held || !liveUpdates;

  // This ref is a bit sus but it's needed to ensure the SSE handshake does
  // not re-establish on every revalidation. The SSE stream is always stable
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const isTabDirtyRef = useRef(false);
  const subscriptionRef = useRef<LiveSubscription | null>(null);

  const revalidateIfIdle = useCallback(() => {
    // Never reload the page out from under someone who is typing or choosing
    // something: a revalidation would drop their focus and undo their input.
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")
    ) {
      return;
    }

    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    if (
      !shouldRevalidateForLiveChange({
        paused: pausedRef.current,
        visible,
        revalidatorState: revalidatorRef.current.state,
      })
    ) {
      return;
    }

    revalidatorRef.current.revalidate();
  }, []);

  // Read the persisted preference once, after hydration.
  useEffect(() => {
    setLiveUpdatesState(readStoredPreference());
  }, []);

  const setLiveUpdates = useCallback((enabled: boolean) => {
    setLiveUpdatesState(enabled);
    writeStoredPreference(enabled);
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setHeld(next);
  }, []);

  // A hold belongs to the page that took it — the login page pauses on every
  // render, and without this it would stay paused after logging in, with the
  // menu showing "on" while nothing updated.
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) {
      return;
    }

    lastPath.current = location.pathname;
    setHeld(false);
  }, [location.pathname]);

  // One subscription for the lifetime of the app. Pausing closes the stream;
  // resuming reconnects and revalidates once.
  useEffect(() => {
    const subscription = createLiveSubscription({
      url: `${__PREFIX__}/events/live`,
      paused: pausedRef.current,
      isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
      revalidate: revalidateIfIdle,
      markDirty: () => {
        isTabDirtyRef.current = true;
      },
    });

    subscriptionRef.current = subscription;
    return () => {
      subscription.close();
      subscriptionRef.current = null;
    };
  }, [revalidateIfIdle]);

  useEffect(() => {
    subscriptionRef.current?.setPaused(paused);
  }, [paused]);

  // If the tab becomes visible and is marked dirty, revalidate
  useEffect(() => {
    const visibilityCallback = () => {
      if (document.visibilityState === "visible" && isTabDirtyRef.current) {
        isTabDirtyRef.current = false;
        revalidateIfIdle();
      }
    };

    document.addEventListener("visibilitychange", visibilityCallback);
    return () => {
      document.removeEventListener("visibilitychange", visibilityCallback);
    };
  }, [revalidateIfIdle]);

  // Force a revalidation when the app comes back online
  useEffect(() => {
    window.addEventListener("online", revalidateIfIdle);
    return () => {
      window.removeEventListener("online", revalidateIfIdle);
    };
  }, [revalidateIfIdle]);

  return (
    <LiveDataContext.Provider value={{ paused, liveUpdates, setPaused, setLiveUpdates }}>
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData() {
  const context = useContext(LiveDataContext);
  return {
    pause: () => context.setPaused(true),
    resume: () => context.setPaused(false),
    paused: context.paused,
    liveUpdates: context.liveUpdates,
    setLiveUpdates: context.setLiveUpdates,
  };
}
