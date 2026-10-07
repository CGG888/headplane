import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestAuth } from "./create-auth";

// Session pruning is housekeeping: it must not be what keeps a short-lived
// process alive, and the shutdown disposer must still clear it.

describe("the session prune timer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("is unref'ed on start and cleared on stop", () => {
    const { auth } = createTestAuth();

    const unref = vi.fn();
    const set = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});

    auth.start();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000);
    expect(unref).toHaveBeenCalledTimes(1);

    auth.stop();
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ unref }));

    // A second stop has nothing left to clear.
    auth.stop();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
