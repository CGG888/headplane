import { describe, expect, test } from "vitest";

import { createLoginThrottle, type LoginThrottleOptions } from "~/server/web/login-throttle";

/** A throttle with a controllable clock and small, readable numbers. */
function makeThrottle(overrides: LoginThrottleOptions = {}) {
  let now = 0;
  const throttle = createLoginThrottle({
    maxAttempts: 3,
    windowMs: 1000,
    lockoutMs: 100,
    ...overrides,
    now: () => now,
  });

  return {
    throttle,
    advance(ms: number) {
      now += ms;
    },
    at: () => now,
  };
}

describe("login throttle", () => {
  test("allows attempts until the limit is reached", () => {
    const { throttle } = makeThrottle();

    expect(throttle.check("a")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(throttle.recordFailure("a").allowed).toBe(true);
    expect(throttle.recordFailure("a").allowed).toBe(true);

    const third = throttle.recordFailure("a");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(100);
  });

  test("a lockout applies to that key only", () => {
    const { throttle } = makeThrottle();

    for (let index = 0; index < 3; index += 1) {
      throttle.recordFailure("a");
    }

    expect(throttle.check("a").allowed).toBe(false);
    expect(throttle.check("b").allowed).toBe(true);
  });

  test("probing during a lockout does not extend it", () => {
    const { throttle, advance } = makeThrottle();

    for (let index = 0; index < 3; index += 1) {
      throttle.recordFailure("a");
    }

    advance(50);
    expect(throttle.check("a")).toEqual({ allowed: false, retryAfterMs: 50 });

    // A failure recorded while the lock is active must report the same wait.
    expect(throttle.recordFailure("a")).toEqual({ allowed: false, retryAfterMs: 50 });
    expect(throttle.check("a")).toEqual({ allowed: false, retryAfterMs: 50 });
  });

  test("each further failure after the lockout doubles the wait", () => {
    const { throttle, advance } = makeThrottle();

    for (let index = 0; index < 3; index += 1) {
      throttle.recordFailure("a");
    }

    expect(throttle.check("a").retryAfterMs).toBe(100);

    advance(100); // the lock has expired
    expect(throttle.check("a").allowed).toBe(true);

    // Fourth failure: the same window, so the count keeps climbing.
    expect(throttle.recordFailure("a").retryAfterMs).toBe(200);
  });

  test("the wait is capped", () => {
    const { throttle, advance } = makeThrottle({
      maxAttempts: 1,
      windowMs: 60 * 60_000,
      lockoutMs: 600_000,
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const decision = throttle.recordFailure("a");
      expect(decision.retryAfterMs).toBeLessThanOrEqual(60 * 60_000);
      advance(decision.retryAfterMs); // wait out the lock before failing again
    }
  });

  test("a success forgets the failures for that key", () => {
    const { throttle } = makeThrottle();

    throttle.recordFailure("a");
    throttle.recordFailure("a");
    throttle.recordSuccess("a");

    expect(throttle.recordFailure("a").allowed).toBe(true);
    expect(throttle.recordFailure("a").allowed).toBe(true);
    expect(throttle.recordFailure("a").allowed).toBe(false);
  });

  test("failures older than the window are not counted", () => {
    const { throttle, advance } = makeThrottle();

    throttle.recordFailure("a");
    throttle.recordFailure("a");
    advance(1000);

    // A new window: the count restarts rather than locking on this attempt.
    expect(throttle.recordFailure("a").allowed).toBe(true);
  });

  test("the tracked-key map stays bounded", () => {
    const { throttle, advance } = makeThrottle({ maxEntries: 2 });

    throttle.recordFailure("a");
    advance(1);
    throttle.recordFailure("b");
    advance(1);
    throttle.recordFailure("c");

    expect(throttle.size()).toBe(2);
    // The oldest key was evicted, so it starts over.
    expect(throttle.check("a").allowed).toBe(true);
  });
});
