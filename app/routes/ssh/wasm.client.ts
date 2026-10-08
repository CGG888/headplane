const WASM_MODULE_URL = `${__PREFIX__}/hp_ssh.wasm`;
const WASM_HELPER_URL = `${__PREFIX__}/wasm_exec.js`;

/** The only content type `instantiateStreaming` accepts. */
const WASM_CONTENT_TYPE = "application/wasm";

/** How long a console session may spend joining the Tailnet before giving up. */
export const TAILNET_JOIN_TIMEOUT_SECONDS = 60;
const TAILNET_JOIN_TIMEOUT_MS = TAILNET_JOIN_TIMEOUT_SECONDS * 1000;

/**
 * Why a console session never reached `Running`.
 *
 * The backend only reports "Running" once the node is up, so a join that stalls
 * (an unreachable control URL, a key that needs machine approval) used to leave
 * the console spinning on "Joining Tailnet…" forever. Every terminal state is
 * mapped to one of these reasons, which the console turns into a localized
 * message with a retry button.
 */
export type TailnetJoinFailure = "timeout" | "machine-auth" | "stopped" | "rejected" | "panic";

export class TailnetJoinError extends Error {
  readonly reason: TailnetJoinFailure;

  constructor(reason: TailnetJoinFailure, message: string) {
    super(message);
    this.name = "TailnetJoinError";
    this.reason = reason;
  }
}

export interface TailnetConfig {
  controlURL: string;
  authKey: string;
  hostname: string;
  onPanic: (error: string) => void;
  /** Reports every backend state transition so the console can show progress. */
  onState?: (state: IPNState) => void;
  /** Overrides the join deadline; only tests should need this. */
  timeoutMs?: number;
}

let goHelper: Promise<void> | null = null;

/**
 * Loads the Go WASM helper script.
 *
 * A failed attempt must not poison the module: the promise used to be cached
 * with its rejection, so a single dropped request (or a proxy answering 5xx)
 * made every later connection attempt fail instantly until the page was fully
 * reloaded. The cache is cleared on failure so the next call tries again.
 */
export function loadGoHelper(): Promise<void> {
  if (typeof globalThis.Go !== "undefined") {
    return Promise.resolve();
  }

  goHelper ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WASM_HELPER_URL;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => {
      // Drop the dead tag so the retry is not shadowed by a script element
      // that already failed to load.
      script.remove();
      reject(new Error("Failed to load Go WASM helper"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    goHelper = null;
    throw error;
  });

  return goHelper;
}

/**
 * Fetches and instantiates the Tailscale WASM module.
 *
 * `instantiateStreaming` requires the response to be served as
 * `application/wasm`; when a proxy or static host labels it
 * `application/octet-stream` the browser rejects it with an "Incorrect
 * response MIME type" error and the console was unusable. Fall back to
 * buffering the bytes, which accepts any content type.
 */
export async function instantiateWasmModule(
  imports: WebAssembly.Imports,
): Promise<WebAssembly.Instance> {
  const response = await fetch(WASM_MODULE_URL);
  if (!response.ok) {
    throw new Error(`Failed to load the browser SSH module (HTTP ${response.status})`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (
    typeof WebAssembly.instantiateStreaming === "function" &&
    contentType.includes(WASM_CONTENT_TYPE)
  ) {
    // Clone before streaming: a rejected streaming call has consumed the body,
    // and the fallback still needs the bytes.
    const buffered = response.clone();
    try {
      const { instance } = await WebAssembly.instantiateStreaming(response, imports);
      return instance;
    } catch {
      // Truncated or mis-encoded body: retry from the buffered copy.
      const { instance } = await WebAssembly.instantiate(await buffered.arrayBuffer(), imports);
      return instance;
    }
  }

  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
  return instance;
}

/**
 * Boots the Tailscale WASM node and resolves once it has joined the Tailnet.
 * Rejects with a `TailnetJoinError` if the pre-auth key is refused, the control
 * server asks for machine approval, the node stops, the Go runtime panics, or
 * the join does not finish within the deadline.
 */
export async function connectTailnet(config: TailnetConfig): Promise<IPN> {
  await loadGoHelper();

  const go = new Go();
  const instance = await instantiateWasmModule(go.importObject);

  // The Go process parks on a channel forever, so settling means it died:
  // `run` resolves on a clean exit and rejects when the runtime panics. Both
  // are reported instead of leaving an unhandled rejection behind.
  void go.run(instance).then(
    () => config.onPanic("Unexpected shutdown"),
    (error: unknown) => config.onPanic(error instanceof Error ? error.message : String(error)),
  );

  const ipn = newIPN({
    controlURL: config.controlURL,
    authKey: config.authKey,
    hostname: config.hostname,
  });

  let loginStarted = false;

  return new Promise((resolve, reject) => {
    let settled = false;

    // Every terminal path goes through `settle` so the deadline cannot fire
    // after the promise already resolved (and so a late panic or state change
    // from a torn-down session cannot reject a promise nobody is listening to).
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };

    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new TailnetJoinError(
              "timeout",
              `Joining the Tailnet did not finish within ${TAILNET_JOIN_TIMEOUT_SECONDS} seconds`,
            ),
          ),
        ),
      config.timeoutMs ?? TAILNET_JOIN_TIMEOUT_MS,
    );

    ipn.run({
      notifyState: (state) => {
        if (settled) return;

        config.onState?.(state);

        // The backend parks at NeedsLogin until login starts. With an auth key
        // set this consumes it rather than opening an interactive flow.
        if (state === "NeedsLogin" && !loginStarted) {
          loginStarted = true;
          ipn.login();
          return;
        }

        if (state === "Running") {
          settle(() => resolve(ipn));
          return;
        }

        // A pre-auth key session must never need a human, so these states end
        // the session instead of leaving the spinner running forever.
        if (state === "NeedsMachineAuth") {
          settle(() =>
            reject(
              new TailnetJoinError(
                "machine-auth",
                "The control server is waiting for this machine to be approved",
              ),
            ),
          );
          return;
        }

        if (state === "Stopped" && loginStarted) {
          settle(() => reject(new TailnetJoinError("stopped", "The Tailnet node stopped")));
        }
      },
      notifyNetMap: () => {},
      // Only reached when the auth key was refused and the node wants a human.
      notifyBrowseToURL: () =>
        settle(() =>
          reject(new TailnetJoinError("rejected", "Headscale rejected the pre-auth key")),
        ),
      notifyPanicRecover: (error) => settle(() => reject(new TailnetJoinError("panic", error))),
    });
  });
}

/**
 * Tears a console session down.
 *
 * The vendored IPN exposes no `close()`, so logging out is the only way to
 * stop a node that was started by this page: it shuts the backend down and
 * drops the session state, which lets the ephemeral machine record expire. The
 * Go runtime itself only goes away with the page.
 */
export function stopTailnet(ipn: IPN | null | undefined): void {
  if (!ipn) {
    return;
  }

  try {
    ipn.logout();
  } catch {
    // Nothing to clean up if the node already stopped.
  }
}
