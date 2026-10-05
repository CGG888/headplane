import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createLiveSubscription,
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
});
