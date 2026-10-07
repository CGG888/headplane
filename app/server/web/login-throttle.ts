/**
 * A small in-memory throttle for the API-key login form.
 *
 * The form accepts a Headscale API key, and until now an unauthenticated
 * caller could submit candidates as fast as the network allowed: a wrong key
 * was only written to stdout. This counts failures per key (the client
 * address, falling back to the submitted key's hash) and refuses further
 * attempts once too many arrive inside a window, doubling the lockout for each
 * extra failure so a persistent attacker is pushed out to an hour.
 *
 * The state is deliberately per-process and bounded: it is a speed bump in
 * front of a database-backed credential check, not a durable ban list, and a
 * restart forgetting the counters is acceptable. The entry map is capped so a
 * spray of distinct addresses cannot grow it without limit.
 */

export interface LoginThrottleOptions {
  /** Failures inside the window that are allowed before a lockout starts. */
  maxAttempts?: number;
  /** How long a failure is still counted. */
  windowMs?: number;
  /** First lockout length; it doubles with every failure past the limit. */
  lockoutMs?: number;
  /** Hard cap on tracked keys. */
  maxEntries?: number;
  now?: () => number;
}

export interface LoginThrottleDecision {
  allowed: boolean;
  /** How much longer the caller must wait. Zero when `allowed` is true. */
  retryAfterMs: number;
}

interface ThrottleEntry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_LOCKOUT_MS = 15 * 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const MAX_LOCKOUT_MS = 60 * 60_000;
/** Caps the exponent so the doubling never overflows. */
const MAX_LOCKOUT_DOUBLINGS = 6;

export function createLoginThrottle(options: LoginThrottleOptions = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, ThrottleEntry>();

  function lockoutFor(failures: number): number {
    const over = failures - maxAttempts;
    if (over < 0) {
      return 0;
    }

    return Math.min(lockoutMs * 2 ** Math.min(over, MAX_LOCKOUT_DOUBLINGS), MAX_LOCKOUT_MS);
  }

  function prune(): void {
    if (entries.size <= maxEntries) {
      return;
    }

    // `Map` iterates in insertion order, so this drops the keys that were
    // touched first.
    for (const key of entries.keys()) {
      if (entries.size <= maxEntries) {
        break;
      }

      entries.delete(key);
    }
  }

  function decisionFor(entry: ThrottleEntry | undefined, at: number): LoginThrottleDecision {
    if (entry && entry.lockedUntil > at) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - at };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    /** Whether the caller may attempt a login. Never mutates the counters. */
    check(key: string): LoginThrottleDecision {
      return decisionFor(entries.get(key), now());
    },

    /** Counts one failed attempt and returns the resulting decision. */
    recordFailure(key: string): LoginThrottleDecision {
      const at = now();
      const existing = entries.get(key);
      const decision = decisionFor(existing, at);
      if (!decision.allowed) {
        // Already locked: leave the entry alone rather than extending it on
        // every probe, which would let an attacker keep themselves out (and
        // nobody else) forever.
        return decision;
      }

      const stale = !existing || at - existing.windowStart >= windowMs;
      const failures = stale ? 1 : existing.failures + 1;
      const lockedUntil = failures >= maxAttempts ? at + lockoutFor(failures) : 0;
      const entry: ThrottleEntry = {
        failures,
        windowStart: stale ? at : existing.windowStart,
        lockedUntil,
      };

      // Re-inserting moves the key to the end of the insertion order so the
      // prune below evicts genuinely idle keys first.
      entries.delete(key);
      entries.set(key, entry);
      prune();

      return decisionFor(entry, at);
    },

    /** Forgets the counters for a key after a successful login. */
    recordSuccess(key: string): void {
      entries.delete(key);
    },

    /** Number of tracked keys. Exposed for tests and diagnostics. */
    size(): number {
      return entries.size;
    },
  };
}

export type LoginThrottle = ReturnType<typeof createLoginThrottle>;
