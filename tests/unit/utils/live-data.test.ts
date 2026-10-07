import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createIdleRevalidator,
  createLiveSubscription,
  isTextEntryElement,
  parseLiveUpdatesPreference,
  shouldRevalidateForLiveChange,
  type LiveEventSource,
} from "~/utils/live-data";

class FakeEventSource implements LiveEventSource {
  static created: FakeEventSource[] = [];

  url: string;
  closed = false;
  onerror: ((event: unknown) => void) | null = null;
  private listeners = new Map<string, (event: { data: string }) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.created.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }

  /** Sends the frame verbatim, for the payloads `JSON.stringify` cannot make. */
  emitRaw(type: string, data: string) {
    this.listeners.get(type)?.({ data });
  }
}

function createSource(url: string): LiveEventSource {
  return new FakeEventSource(url);
}

function setup(options: { paused: boolean; visible?: boolean }) {
  const revalidate = vi.fn();
  const markDirty = vi.fn();
  const subscription = createLiveSubscription({
    url: "/events/live",
    paused: options.paused,
    isVisible: () => options.visible ?? true,
    revalidate,
    markDirty,
    createSource,
  });

  return { subscription, revalidate, markDirty };
}

describe("live updates preference", () => {
  test("defaults to off and only an explicit on enables it", () => {
    expect(parseLiveUpdatesPreference(null)).toBe(false);
    expect(parseLiveUpdatesPreference(undefined)).toBe(false);
    expect(parseLiveUpdatesPreference("")).toBe(false);
    expect(parseLiveUpdatesPreference("off")).toBe(false);
    expect(parseLiveUpdatesPreference("yes")).toBe(false);
    expect(parseLiveUpdatesPreference("on")).toBe(true);
  });
});

describe("live change gate", () => {
  test("stays closed while live updates are paused", () => {
    expect(
      shouldRevalidateForLiveChange({ paused: true, visible: true, revalidatorState: "idle" }),
    ).toBe(false);
    expect(
      shouldRevalidateForLiveChange({ paused: true, visible: true, revalidatorState: "loading" }),
    ).toBe(false);
  });

  test("stays closed for a hidden tab or a pending mutation", () => {
    expect(
      shouldRevalidateForLiveChange({ paused: false, visible: false, revalidatorState: "idle" }),
    ).toBe(false);
    expect(
      shouldRevalidateForLiveChange({ paused: false, visible: true, revalidatorState: "loading" }),
    ).toBe(false);
    expect(
      shouldRevalidateForLiveChange({
        paused: false,
        visible: true,
        revalidatorState: "submitting",
      }),
    ).toBe(false);
  });

  test("opens only for a visible, idle page with live updates on", () => {
    expect(
      shouldRevalidateForLiveChange({ paused: false, visible: true, revalidatorState: "idle" }),
    ).toBe(true);
  });
});

function idleSetup(
  initial: { canRevalidate?: boolean; active?: { tagName?: string } | null } = {},
) {
  let canRevalidate = initial.canRevalidate ?? true;
  let active: { tagName?: string } | null = initial.active ?? null;
  const revalidate = vi.fn();
  const listeners: Array<() => void> = [];
  const scheduled: Array<() => void> = [];

  const idle = createIdleRevalidator({
    revalidate,
    canRevalidate: () => canRevalidate,
    activeElement: () => active,
    onFocusOut: (listener) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
    schedule: (listener) => {
      scheduled.push(listener);
    },
  });

  return {
    idle,
    revalidate,
    focus: (element: { tagName?: string } | null) => {
      active = element;
    },
    /**
     * Focus leaving a field. `next` is what the browser reports as the active
     * element by the time the replay runs; it defaults to nothing being focused.
     */
    blur: (next: { tagName?: string } | null = null) => {
      active = next;
      for (const listener of listeners) {
        listener();
      }
    },
    flush: () => {
      for (const listener of scheduled.splice(0)) {
        listener();
      }
    },
    setCanRevalidate: (next: boolean) => {
      canRevalidate = next;
    },
    listenerCount: () => listeners.length,
  };
}

describe("text entry detection", () => {
  test("matches the controls a reload would steal focus from", () => {
    expect(isTextEntryElement({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryElement({ tagName: "SELECT" })).toBe(true);
    expect(isTextEntryElement({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryElement({ tagName: "DIV" })).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
    expect(isTextEntryElement(undefined)).toBe(false);
  });
});

describe("idle revalidation", () => {
  test("revalidates straight away when nothing is focused", () => {
    const { idle, revalidate } = idleSetup();

    idle.run();
    expect(revalidate).toHaveBeenCalledTimes(1);

    idle.run();
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  test("holds a change that lands mid-typing and replays it on focusout", () => {
    const { idle, revalidate, focus, blur, flush } = idleSetup();
    focus({ tagName: "INPUT" });

    idle.run();
    expect(revalidate).not.toHaveBeenCalled();

    // `focusout` fires before the next element is focused, so the replay waits a
    // tick and checks the active element again.
    blur();
    expect(revalidate).not.toHaveBeenCalled();
    flush();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  test("does not reload when focus moves straight into another field", () => {
    const { idle, revalidate, focus, blur, flush } = idleSetup();
    focus({ tagName: "INPUT" });
    idle.run();

    focus({ tagName: "TEXTAREA" });
    blur({ tagName: "TEXTAREA" });
    flush();
    expect(revalidate).not.toHaveBeenCalled();

    blur();
    flush();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  test("keeps the request while the page is not allowed to reload", () => {
    const { idle, revalidate, blur, flush, setCanRevalidate } = idleSetup({
      canRevalidate: false,
    });

    idle.run();
    expect(revalidate).not.toHaveBeenCalled();

    blur();
    flush();
    expect(revalidate).not.toHaveBeenCalled();

    setCanRevalidate(true);
    blur();
    flush();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  test("several changes while focused collapse into one reload", () => {
    const { idle, revalidate, focus, blur, flush } = idleSetup();
    focus({ tagName: "INPUT" });
    idle.run();
    idle.run();

    blur();
    flush();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  test("close stops listening and replays nothing", () => {
    const { idle, revalidate, focus, blur, flush, listenerCount } = idleSetup();
    focus({ tagName: "INPUT" });
    idle.run();

    // A replay that was already queued must not run against a closed component.
    blur();
    idle.close();
    expect(listenerCount()).toBe(0);

    flush();
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("live subscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.created = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a paused subscription opens no stream and never revalidates", () => {
    const { subscription, revalidate } = setup({ paused: true });

    vi.advanceTimersByTime(60_000);

    expect(FakeEventSource.created).toHaveLength(0);
    expect(revalidate).not.toHaveBeenCalled();
    subscription.close();
  });

  test("resuming reconnects and revalidates once, and later changes revalidate again", () => {
    const { subscription, revalidate } = setup({ paused: true });

    subscription.setPaused(false);
    expect(FakeEventSource.created).toHaveLength(1);
    expect(revalidate).toHaveBeenCalledTimes(1);

    const source = FakeEventSource.created[0];
    source.emit("hello", { nodes: "1" });

    source.emit("changed", { resource: "nodes", version: "2" });
    expect(revalidate).toHaveBeenCalledTimes(2);

    // The same version is not a change.
    source.emit("changed", { resource: "nodes", version: "2" });
    expect(revalidate).toHaveBeenCalledTimes(2);

    // A new version is.
    source.emit("changed", { resource: "nodes", version: "3" });
    expect(revalidate).toHaveBeenCalledTimes(3);
    subscription.close();
  });

  test("pausing closes the stream and nothing revalidates afterwards", () => {
    const { subscription, revalidate } = setup({ paused: false });

    expect(FakeEventSource.created).toHaveLength(1);
    const source = FakeEventSource.created[0];

    subscription.setPaused(true);
    expect(source.closed).toBe(true);

    // No reconnect and no revalidation, however long the pause lasts.
    source.onerror?.(new Error("disconnected"));
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.created).toHaveLength(1);
    expect(revalidate).not.toHaveBeenCalled();
  });

  test("an error drops the stream and reconnects with backoff", () => {
    const { subscription } = setup({ paused: false });
    const first = FakeEventSource.created[0];

    first.onerror?.(new Error("disconnected"));
    expect(first.closed).toBe(true);
    expect(FakeEventSource.created).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.created).toHaveLength(2);
    subscription.close();
  });

  test("a change in a hidden tab marks the page dirty instead of revalidating", () => {
    const { subscription, revalidate, markDirty } = setup({ paused: false, visible: false });
    const source = FakeEventSource.created[0];

    source.emit("hello", { nodes: "1" });
    source.emit("changed", { resource: "nodes", version: "2" });

    expect(markDirty).toHaveBeenCalledTimes(1);
    expect(revalidate).not.toHaveBeenCalled();
    subscription.close();
  });

  test("a change event that is not the promised payload is ignored", () => {
    const { subscription, revalidate } = setup({ paused: false });
    const source = FakeEventSource.created[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    source.emit("changed", "not an object");
    source.emit("changed", { resource: "nodes" });
    source.emit("changed", { resource: 7, version: "2" });
    expect(revalidate).not.toHaveBeenCalled();

    // A well formed event still goes through.
    source.emit("changed", { resource: "nodes", version: "2" });
    expect(revalidate).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    subscription.close();
  });

  test("an unreadable frame is dropped and reported", () => {
    const { subscription, revalidate } = setup({ paused: false });
    const source = FakeEventSource.created[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    source.emitRaw("changed", "{not json");
    expect(revalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    subscription.close();
  });

  test("a hello event that is not a version map does not become the baseline", () => {
    const { subscription, revalidate } = setup({ paused: false });
    const source = FakeEventSource.created[0];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    source.emit("hello", ["nodes"]);
    source.emit("changed", { resource: "nodes", version: "2" });
    expect(revalidate).toHaveBeenCalledTimes(1);

    // Once the real map arrives, its versions are the ones that count.
    source.emit("hello", { nodes: "2" });
    source.emit("changed", { resource: "nodes", version: "2" });
    expect(revalidate).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    subscription.close();
  });

  test("a repeated error replaces the pending reconnect instead of adding one", () => {
    const { subscription } = setup({ paused: false });
    const first = FakeEventSource.created[0];

    // The first error schedules a retry in 1s and the second one in 2s; the
    // retry that is already pending must not open a second connection.
    first.onerror?.(new Error("disconnected"));
    first.onerror?.(new Error("still disconnected"));

    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.created).toHaveLength(2);
    subscription.close();
  });

  test("a revalidation that throws does not take the stream down", () => {
    const revalidate = vi.fn(() => {
      throw new Error("revalidate failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const subscription = createLiveSubscription({
      url: "/events/live",
      paused: false,
      isVisible: () => true,
      revalidate,
      markDirty: vi.fn(),
      createSource,
    });
    const source = FakeEventSource.created[0];

    expect(() => {
      source.emit("changed", { resource: "nodes", version: "2" });
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    // The connection survived, so the next change is still delivered.
    source.emit("changed", { resource: "nodes", version: "3" });
    expect(revalidate).toHaveBeenCalledTimes(2);

    warn.mockRestore();
    subscription.close();
  });
});
