import { afterEach, describe, expect, test, vi } from "vitest";

interface FakeScript {
  src: string;
  crossOrigin: string;
  onload: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  remove: () => void;
}

/**
 * Installs a fake `document` whose script elements are driven by the test. Each
 * appended script is queued with its own behaviour so a failed load can be
 * followed by a successful retry.
 */
function installFakeDocument(behaviour: (script: FakeScript, attempt: number) => void) {
  const scripts: FakeScript[] = [];

  vi.stubGlobal("document", {
    createElement: () => {
      const script: FakeScript = {
        src: "",
        crossOrigin: "",
        onload: null,
        onerror: null,
        remove: vi.fn(),
      };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: (script: FakeScript) => {
        behaviour(script, scripts.length);
        return script;
      },
    },
  });

  return scripts;
}

function fakeFetchResponse(options: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  bytes?: ArrayBuffer;
}) {
  const bytes = options.bytes ?? new ArrayBuffer(8);
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.ok === false ? "Bad Gateway" : "OK",
    headers: { get: () => options.contentType ?? "application/wasm" },
    arrayBuffer: vi.fn().mockResolvedValue(bytes),
    clone: () => ({
      arrayBuffer: vi.fn().mockResolvedValue(bytes),
    }),
  };

  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

describe("Go WASM helper loading", () => {
  test("retries after a failed load instead of caching the rejection", async () => {
    vi.stubGlobal("Go", undefined);
    const scripts = installFakeDocument((script, attempt) => {
      // The first script fails; the retry must be allowed to load.
      queueMicrotask(() => {
        if (attempt === 1) {
          script.onerror?.(new Error("network"));
        } else {
          script.onload?.();
        }
      });
    });

    const { loadGoHelper } = await import("~/routes/ssh/wasm.client");

    await expect(loadGoHelper()).rejects.toThrow("Failed to load Go WASM helper");
    await expect(loadGoHelper()).resolves.toBeUndefined();

    expect(scripts).toHaveLength(2);
    expect(scripts[0].remove).toHaveBeenCalledOnce();
  });

  test("uses the already-present helper without loading a script", async () => {
    vi.stubGlobal("Go", class {});
    const scripts = installFakeDocument(() => {});

    const { loadGoHelper } = await import("~/routes/ssh/wasm.client");

    await expect(loadGoHelper()).resolves.toBeUndefined();
    expect(scripts).toHaveLength(0);
  });
});

describe("WASM module instantiation", () => {
  test("streams the module when it is served as application/wasm", async () => {
    const imports: WebAssembly.Imports = {};
    const instance = { exports: {} } as unknown as WebAssembly.Instance;
    const response = fakeFetchResponse({ contentType: "application/wasm" });
    const instantiateStreaming = vi.fn().mockResolvedValue({ instance });
    const instantiate = vi.fn();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    vi.stubGlobal("WebAssembly", { instantiateStreaming, instantiate });

    const { instantiateWasmModule } = await import("~/routes/ssh/wasm.client");

    await expect(instantiateWasmModule(imports)).resolves.toBe(instance);
    expect(instantiateStreaming).toHaveBeenCalledWith(response, imports);
    expect(instantiate).not.toHaveBeenCalled();
  });

  test("falls back to buffering when streaming rejects", async () => {
    const imports: WebAssembly.Imports = {};
    const instance = { exports: {} } as unknown as WebAssembly.Instance;
    const response = fakeFetchResponse({ contentType: "application/wasm" });
    const instantiateStreaming = vi
      .fn()
      .mockRejectedValue(new Error("Incorrect response MIME type. Expected 'application/wasm'"));
    const instantiate = vi.fn().mockResolvedValue({ instance });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    vi.stubGlobal("WebAssembly", { instantiateStreaming, instantiate });

    const { instantiateWasmModule } = await import("~/routes/ssh/wasm.client");

    await expect(instantiateWasmModule(imports)).resolves.toBe(instance);
    expect(instantiate).toHaveBeenCalledOnce();
    expect(await instantiate.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
  });

  test("buffers without streaming when the server guesses another content type", async () => {
    const imports: WebAssembly.Imports = {};
    const instance = { exports: {} } as unknown as WebAssembly.Instance;
    const response = fakeFetchResponse({ contentType: "application/octet-stream" });
    const instantiateStreaming = vi.fn();
    const instantiate = vi.fn().mockResolvedValue({ instance });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    vi.stubGlobal("WebAssembly", { instantiateStreaming, instantiate });

    const { instantiateWasmModule } = await import("~/routes/ssh/wasm.client");

    await expect(instantiateWasmModule(imports)).resolves.toBe(instance);
    expect(instantiateStreaming).not.toHaveBeenCalled();
    expect(instantiate).toHaveBeenCalledOnce();
  });

  test("reports the status when the module cannot be fetched", async () => {
    const response = fakeFetchResponse({ ok: false, status: 502 });
    const instantiateStreaming = vi.fn();
    const instantiate = vi.fn();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    vi.stubGlobal("WebAssembly", { instantiateStreaming, instantiate });

    const { instantiateWasmModule } = await import("~/routes/ssh/wasm.client");

    await expect(instantiateWasmModule({})).rejects.toThrow(
      "Failed to load the browser SSH module (HTTP 502)",
    );
    expect(instantiate).not.toHaveBeenCalled();
  });
});

describe("Tailnet node lifecycle", () => {
  function stubRuntime(run: () => Promise<void>, drive?: (callbacks: IPNCallbacks) => void) {
    const ipn = {
      run: (callbacks: IPNCallbacks) => {
        if (drive) {
          drive(callbacks);
          return;
        }

        callbacks.notifyState("Running");
      },
      login: vi.fn(),
      logout: vi.fn(),
      ssh: vi.fn(),
      fetch: vi.fn(),
    };

    vi.stubGlobal(
      "Go",
      class {
        importObject: WebAssembly.Imports = {};
        run = run;
      },
    );
    vi.stubGlobal("newIPN", () => ipn);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeFetchResponse({})));
    vi.stubGlobal("WebAssembly", {
      instantiateStreaming: vi.fn(),
      instantiate: vi.fn().mockResolvedValue({ instance: { exports: {} } }),
    });

    return ipn;
  }

  test("reports a rejecting Go runtime instead of leaking the rejection", async () => {
    stubRuntime(() => Promise.reject(new Error("runtime panic")));
    const onPanic = vi.fn();
    const { connectTailnet } = await import("~/routes/ssh/wasm.client");

    const ipn = await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic,
    });

    expect(ipn).toBeDefined();
    await vi.waitFor(() => expect(onPanic).toHaveBeenCalledWith("runtime panic"));
  });

  test("reports a clean shutdown as an unexpected exit", async () => {
    stubRuntime(() => Promise.resolve());
    const onPanic = vi.fn();
    const { connectTailnet } = await import("~/routes/ssh/wasm.client");

    await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic,
    });

    await vi.waitFor(() => expect(onPanic).toHaveBeenCalledWith("Unexpected shutdown"));
  });

  test("logs the node out on teardown and survives a runtime that refuses", async () => {
    const ipn = stubRuntime(() => new Promise<void>(() => {}));
    const { stopTailnet } = await import("~/routes/ssh/wasm.client");

    stopTailnet(ipn as unknown as IPN);
    expect(ipn.logout).toHaveBeenCalledOnce();

    (ipn.logout as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("node already stopped");
    });
    expect(() => stopTailnet(ipn as unknown as IPN)).not.toThrow();

    expect(() => stopTailnet(null)).not.toThrow();
  });

  test("consumes the auth key when the backend asks for a login", async () => {
    const ipn = stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => {
        callbacks.notifyState("NeedsLogin");
        callbacks.notifyState("Running");
      },
    );
    const { connectTailnet } = await import("~/routes/ssh/wasm.client");

    await expect(
      connectTailnet({
        controlURL: "https://headscale.example.com",
        authKey: "key",
        hostname: "ssh-1-alice",
        onPanic: vi.fn(),
      }),
    ).resolves.toBe(ipn);
    expect(ipn.login).toHaveBeenCalledOnce();
  });

  test("reports every state change so the console is not a silent spinner", async () => {
    stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => {
        callbacks.notifyState("NoState");
        callbacks.notifyState("NeedsLogin");
        callbacks.notifyState("Running");
      },
    );
    const onState = vi.fn();
    const { connectTailnet } = await import("~/routes/ssh/wasm.client");

    await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
      onState,
    });

    expect(onState.mock.calls.map(([state]) => state)).toEqual([
      "NoState",
      "NeedsLogin",
      "Running",
    ]);
  });

  test("fails when the control server wants the machine approved", async () => {
    stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => callbacks.notifyState("NeedsMachineAuth"),
    );
    const { connectTailnet, TailnetJoinError } = await import("~/routes/ssh/wasm.client");

    const error: unknown = await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TailnetJoinError);
    expect((error as InstanceType<typeof TailnetJoinError>).reason).toBe("machine-auth");
  });

  test("fails when the node stops after the login started", async () => {
    stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => {
        callbacks.notifyState("NeedsLogin");
        callbacks.notifyState("Stopped");
      },
    );
    const { connectTailnet, TailnetJoinError } = await import("~/routes/ssh/wasm.client");

    const error: unknown = await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TailnetJoinError);
    expect((error as InstanceType<typeof TailnetJoinError>).reason).toBe("stopped");
  });

  test("gives up on a join that never reaches Running", async () => {
    vi.useFakeTimers();
    stubRuntime(
      () => new Promise<void>(() => {}),
      () => {},
    );
    const { connectTailnet, TailnetJoinError, TAILNET_JOIN_TIMEOUT_SECONDS } =
      await import("~/routes/ssh/wasm.client");

    const settled = connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
      timeoutMs: TAILNET_JOIN_TIMEOUT_SECONDS * 1000,
    }).catch((reason: unknown) => reason);

    await vi.advanceTimersByTimeAsync(TAILNET_JOIN_TIMEOUT_SECONDS * 1000);

    const error = await settled;
    expect(error).toBeInstanceOf(TailnetJoinError);
    expect((error as InstanceType<typeof TailnetJoinError>).reason).toBe("timeout");
    expect((error as Error).message).toContain(String(TAILNET_JOIN_TIMEOUT_SECONDS));
  });

  test("treats a refused key as terminal and ignores later chatter", async () => {
    stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => {
        callbacks.notifyBrowseToURL("https://headscale.example.com/register/nodekey");
        // The session is over; a late state or panic must not settle it again.
        callbacks.notifyState("Running");
        callbacks.notifyPanicRecover("late panic");
      },
    );
    const { connectTailnet, TailnetJoinError } = await import("~/routes/ssh/wasm.client");

    const error: unknown = await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TailnetJoinError);
    expect((error as InstanceType<typeof TailnetJoinError>).reason).toBe("rejected");
  });

  test("reports a dropped session from the notify callback", async () => {
    stubRuntime(
      () => new Promise<void>(() => {}),
      (callbacks) => callbacks.notifyPanicRecover("boom"),
    );
    const { connectTailnet, TailnetJoinError } = await import("~/routes/ssh/wasm.client");

    const error: unknown = await connectTailnet({
      controlURL: "https://headscale.example.com",
      authKey: "key",
      hostname: "ssh-1-alice",
      onPanic: vi.fn(),
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TailnetJoinError);
    expect((error as InstanceType<typeof TailnetJoinError>).reason).toBe("panic");
    expect((error as Error).message).toBe("boom");
  });
});
