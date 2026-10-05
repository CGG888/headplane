import { describe, expect, test } from "vitest";

import {
  AUTO_RELOAD_WINDOW_MS,
  browserGuardStorage,
  CHUNK_RELOAD_STORAGE_KEY,
  clearReloadAttempt,
  createBrowserChunkReloadGuard,
  createChunkReloadGuard,
  isChunkAssetUrl,
  isChunkLoadErrorMessage,
  readReloadAttempt,
  recordReloadAttempt,
  shouldAutoReload,
  shouldSkipAutoReloadOnBoot,
  type GuardStorage,
} from "~/utils/chunk-reload-guard";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  } satisfies GuardStorage & { values: Map<string, string> };
}

describe("shouldAutoReload", () => {
  test("allows the first reload when nothing was recorded", () => {
    expect(shouldAutoReload(null, 1_000)).toBe(true);
  });

  test("forbids a second reload inside the window", () => {
    expect(shouldAutoReload(1_000, 1_000)).toBe(false);
    expect(shouldAutoReload(1_000, 1_000 + AUTO_RELOAD_WINDOW_MS - 1)).toBe(false);
  });

  test("allows a reload once the window has elapsed", () => {
    expect(shouldAutoReload(1_000, 1_000 + AUTO_RELOAD_WINDOW_MS)).toBe(true);
    expect(shouldAutoReload(1_000, 1_000 + AUTO_RELOAD_WINDOW_MS * 10)).toBe(true);
  });

  test("honours a custom window", () => {
    expect(shouldAutoReload(1_000, 1_500, 500)).toBe(true);
    expect(shouldAutoReload(1_000, 1_499, 500)).toBe(false);
  });

  test("ignores unparsable timestamps", () => {
    expect(shouldAutoReload(Number.NaN, 1_000)).toBe(true);
    expect(shouldAutoReload(Number.POSITIVE_INFINITY, 1_000)).toBe(true);
  });

  test("treats a future timestamp as recent so a skewed clock cannot re-arm the loop", () => {
    expect(shouldAutoReload(2_000, 1_000)).toBe(false);
  });
});

describe("storage helpers", () => {
  test("round trips an attempt under the guard key", () => {
    const storage = memoryStorage();

    recordReloadAttempt(storage, 42);
    expect(storage.values.get(CHUNK_RELOAD_STORAGE_KEY)).toBe("42");
    expect(readReloadAttempt(storage)).toBe(42);

    clearReloadAttempt(storage);
    expect(readReloadAttempt(storage)).toBeNull();
  });

  test("treats missing or malformed records as no attempt", () => {
    expect(readReloadAttempt(memoryStorage())).toBeNull();
    expect(
      readReloadAttempt(memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "yesterday" })),
    ).toBeNull();
  });

  test("survives storage that refuses access", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } satisfies GuardStorage;

    expect(readReloadAttempt(hostile)).toBeNull();
    expect(() => recordReloadAttempt(hostile, 1)).not.toThrow();
    expect(() => clearReloadAttempt(hostile)).not.toThrow();
  });
});

describe("shouldSkipAutoReloadOnBoot", () => {
  test("stops a boot that follows a failure inside the window", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "10000" });

    expect(shouldSkipAutoReloadOnBoot(storage, 10_000)).toBe(true);
    expect(shouldSkipAutoReloadOnBoot(storage, 10_000 + AUTO_RELOAD_WINDOW_MS - 1)).toBe(true);
  });

  test("lets a boot hydrate when nothing was recorded", () => {
    expect(shouldSkipAutoReloadOnBoot(memoryStorage(), 10_000)).toBe(false);
  });

  test("re-arms once the window has elapsed", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "10000" });

    expect(shouldSkipAutoReloadOnBoot(storage, 10_000 + AUTO_RELOAD_WINDOW_MS)).toBe(false);
    expect(shouldSkipAutoReloadOnBoot(storage, 10_000 + AUTO_RELOAD_WINDOW_MS * 10)).toBe(false);
  });

  test("ignores a malformed record and honours a custom window", () => {
    expect(
      shouldSkipAutoReloadOnBoot(memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "yesterday" }), 1_000),
    ).toBe(false);
    expect(shouldSkipAutoReloadOnBoot(memoryStorage(), 1_000, 500)).toBe(false);
  });

  test("keeps a timestamp from the future recent, so a skewed clock cannot re-arm", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "20000" });

    expect(shouldSkipAutoReloadOnBoot(storage, 10_000)).toBe(true);
  });

  test("stays out of the way when storage refuses access", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } satisfies GuardStorage;

    expect(shouldSkipAutoReloadOnBoot(hostile, 1_000)).toBe(false);
  });
});

describe("browser wiring", () => {
  test("has no storage and no guard outside a browser", () => {
    expect(browserGuardStorage()).toBeNull();
    expect(createBrowserChunkReloadGuard()).toBeNull();
  });
});

describe("createChunkReloadGuard", () => {
  test("allows one automatic reload, then trips", () => {
    const storage = memoryStorage();
    let now = 10_000;
    const guard = createChunkReloadGuard({ storage, now: () => now });

    expect(guard.beginSession()).toBe("ok");
    expect(guard.registerFailure()).toBe("reload");

    // The reload happens; the very next boot must not reload again.
    expect(guard.beginSession()).toBe("trip");

    now += AUTO_RELOAD_WINDOW_MS - 1;
    expect(guard.registerFailure()).toBe("trip");
    expect(readReloadAttempt(storage)).toBe(10_000);
  });

  test("re-arms after the window and clears the expired record", () => {
    const storage = memoryStorage({ [CHUNK_RELOAD_STORAGE_KEY]: "10000" });
    const guard = createChunkReloadGuard({ storage, now: () => 10_000 + AUTO_RELOAD_WINDOW_MS });

    expect(guard.beginSession()).toBe("ok");
    expect(readReloadAttempt(storage)).toBeNull();
    expect(guard.registerFailure()).toBe("reload");
  });

  test("reset re-arms immediately for a user-requested reload", () => {
    const storage = memoryStorage();
    const guard = createChunkReloadGuard({ storage, now: () => 5_000 });

    expect(guard.registerFailure()).toBe("reload");
    expect(guard.beginSession()).toBe("trip");

    guard.reset();
    expect(guard.beginSession()).toBe("ok");
  });

  test("an unwritable storage degrades to allowing one reload per boot", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    } satisfies GuardStorage;

    const guard = createChunkReloadGuard({ storage, now: () => 1_000 });
    expect(guard.beginSession()).toBe("ok");
    expect(guard.registerFailure()).toBe("reload");
  });
});

describe("chunk failure detection", () => {
  test("recognizes hashed chunk URLs", () => {
    expect(isChunkAssetUrl("/admin/assets/root-a1b2c3.js")).toBe(true);
    expect(isChunkAssetUrl("https://headplane.example/admin/assets/machine-x.js")).toBe(true);
    expect(isChunkAssetUrl("/admin/favicon.ico")).toBe(false);
    expect(isChunkAssetUrl(undefined)).toBe(false);
  });

  test("recognizes browser wordings for a failed dynamic import", () => {
    expect(
      isChunkLoadErrorMessage(
        "Failed to fetch dynamically imported module: https://headplane.example/admin/assets/machine.js",
      ),
    ).toBe(true);
    expect(isChunkLoadErrorMessage("error loading dynamically imported module")).toBe(true);
    expect(isChunkLoadErrorMessage("Importing a module script failed.")).toBe(true);
    expect(isChunkLoadErrorMessage("NetworkError when attempting to fetch resource.")).toBe(false);
    expect(isChunkLoadErrorMessage("Cannot read properties of undefined")).toBe(false);
  });
});
