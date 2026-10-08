import { Loader2, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, type ShouldRevalidateFunction } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Code from "~/components/code";
import StatusBanner from "~/components/status-banner";
import type { TranslationKey } from "~/i18n";
import { useI18n, type I18nValue } from "~/i18n/provider";
import {
  agentsContext,
  appConfigContext,
  authContext,
  headscaleContext,
  requestApiContext,
} from "~/server/context";
import { assetProbeOrigins } from "~/server/self-origin";
import { findHeadscaleUserBySubject } from "~/server/web/headscale-identity";

import type { Route } from "./+types/page";
import { isSshErrorPayload, SSHErrorBoundary, sshError, sshErrorMessageKey } from "./errors";
import Ghostty from "./ghostty.client";
import type { ConsoleKeyPayload } from "./key";
import UserPrompt from "./user-prompt";
import { connectTailnet, stopTailnet } from "./wasm.client";

const WASM_MODULE_URL = `${__PREFIX__}/hp_ssh.wasm`;
const WASM_HELPER_URL = `${__PREFIX__}/wasm_exec.js`;

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request, params, context, url }: Route.LoaderArgs) {
  const agents = context.get(agentsContext);
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);
  const headscale = context.get(headscaleContext);
  const getRequestApi = context.get(requestApiContext);
  const compatibilityWarning = getBrowserSSHCompatibilityWarning(headscale.version);

  // The WASM bundle is served by this process, so probe the listener rather
  // than the origin the request reports: behind a TLS-terminating proxy that
  // origin is cleartext at the public hostname, and asking its TLS port for the
  // file resets the connection. A rejected fetch is not a Response, so it would
  // reach the router as a generic "Unexpected Server Error" instead of the
  // localized `wasmMissing` card below.
  const assets = [WASM_HELPER_URL, WASM_MODULE_URL];
  let assetsReachable = false;

  for (const origin of assetProbeOrigins(config.server, url.origin)) {
    const results = await Promise.all(
      assets.map(async (file) => {
        try {
          const res = await fetch(`${origin}${file}`, { method: "HEAD" });
          return res.ok;
        } catch {
          return false;
        }
      }),
    );

    if (results.every(Boolean)) {
      assetsReachable = true;
      break;
    }
  }

  if (!assetsReachable) {
    throw data(sshError("wasmMissing"), 405);
  }

  if (agents.state !== "enabled") {
    throw data(sshError("agentRequired"), 400);
  }

  const { principal, api } = await getRequestApi(request);
  if (principal.kind === "api_key") {
    throw data(sshError("oidcRequired"), 403);
  }

  const hostname = params.id;
  const username = url.searchParams.get("user") || undefined;

  const nodes = await api.nodes.list();
  const node = nodes.find((n) => n.givenName === hostname);
  if (!node) {
    throw data(sshError("nodeNotFound", { hostname }), 404);
  }

  // A console mints a pre-auth key for the signed-in user and connects to the
  // machine, so it is limited to machines that user owns (or to an account with
  // broader machine rights). Without this, any signed-in account could open a
  // shell on any machine by guessing its hostname.
  if (!auth.canManageNode(principal, node)) {
    throw data({ localized: { key: "errors.permission.actOnMachine" } }, { status: 403 });
  }

  if (!node.online) {
    return { hostname, username, offline: true, node: undefined, compatibilityWarning };
  }

  if (!username) {
    return {
      hostname,
      username: undefined,
      offline: false,
      node: undefined,
      compatibilityWarning,
    };
  }

  // The user must exist within Headscale to generate a pre-auth key. The key
  // itself is minted by the `/ssh/:id/key` action so it never lands in the
  // server-rendered document.
  const users = await api.users.list();
  const hsUser = principal.user.headscaleUserId
    ? users.find((u) => u.id === principal.user.headscaleUserId)
    : findHeadscaleUserBySubject(users, principal.user.subject, principal.profile.email);

  if (!hsUser) {
    throw data(sshError("userNotLinked"), 404);
  }

  const controlURL = config.headscale.public_url ?? config.headscale.url;
  return {
    hostname,
    username,
    offline: false,
    node: {
      ipAddress: node.ipAddresses[0],
      controlURL,
    },
    compatibilityWarning,
  };
}

function getBrowserSSHCompatibilityWarning(version: {
  unknown: boolean;
  major: number;
  minor: number;
  patch: number;
  raw: string;
}) {
  if (version.unknown) return null;
  if (version.major === 0 && version.minor === 29 && version.patch < 2) {
    return { version: version.raw };
  }
  return null;
}

function consoleKeyUrl(hostname: string) {
  return `${__PREFIX__}/ssh/${encodeURIComponent(hostname)}/key`;
}

/**
 * Turns a failed key request into something the status overlay can show. The
 * action answers with the same payloads the error boundary understands, so the
 * message stays localized.
 */
async function readConsoleKeyError(response: Response, t: I18nValue["t"]): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);

  if (isSshErrorPayload(payload)) {
    return t(sshErrorMessageKey(payload.sshError), payload.params);
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "localized" in payload &&
    typeof (payload as { localized?: { key?: unknown } }).localized?.key === "string"
  ) {
    return t((payload as { localized: { key: TranslationKey } }).localized.key);
  }

  return `${response.status} ${response.statusText}`;
}

async function createConsoleKey(
  hostname: string,
  username: string,
  t: I18nValue["t"],
): Promise<ConsoleKeyPayload> {
  const body = new FormData();
  body.set("intent", "create");
  body.set("user", username);

  const response = await fetch(consoleKeyUrl(hostname), {
    method: "POST",
    body,
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(await readConsoleKeyError(response, t));
  }

  return (await response.json()) as ConsoleKeyPayload;
}

function revokeConsoleKey(hostname: string, key: string): void {
  const body = new FormData();
  body.set("intent", "revoke");
  body.set("key", key);

  // `keepalive` lets the request outlive the unmount that triggers it. A
  // failure is not fatal: the key is unusable without the Tailnet session and
  // still expires on its own.
  void fetch(consoleKeyUrl(hostname), {
    method: "POST",
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {});
}

export const links: Route.LinksFunction = () => [
  {
    rel: "preload",
    href: WASM_MODULE_URL,
    as: "fetch",
    type: "application/wasm",
    crossOrigin: "anonymous",
  },
];

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const { hostname, username, offline, node, compatibilityWarning } = loaderData;

  if (offline) {
    return (
      <>
        <BrowserSSHCompatibilityBanner warning={compatibilityWarning} />
        <div className="flex h-screen w-screen items-center justify-center bg-black">
          <Card className="w-screen" variant="flat">
            <div className="flex items-center justify-between gap-4">
              <Card.Title>{t("ssh.nodeOffline.title")}</Card.Title>
              <WifiOff className="mb-2 h-6 w-6 text-red-500" />
            </div>
            <Card.Text>
              {tr("ssh.nodeOffline.body", { hostname: <Code>{hostname}</Code> })}
            </Card.Text>
            <Button className="mt-8 w-full" onClick={() => window.location.reload()}>
              {t("ssh.nodeOffline.retry")}
            </Button>
          </Card>
        </div>
      </>
    );
  }

  if (!username || !node) {
    return (
      <>
        <BrowserSSHCompatibilityBanner warning={compatibilityWarning} />
        <UserPrompt hostname={hostname} />
      </>
    );
  }

  return (
    <>
      <BrowserSSHCompatibilityBanner warning={compatibilityWarning} />
      <SSHConsole hostname={hostname} username={username} node={node} />
    </>
  );
}

function BrowserSSHCompatibilityBanner({
  warning,
}: {
  warning: { version: string } | null | undefined;
}) {
  const { t, tr } = useI18n();

  if (!warning) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-[60] mx-auto max-w-2xl">
      <StatusBanner variant="warning" title={t("ssh.compat.title", { version: warning.version })}>
        {tr("ssh.compat.body", {
          ts2021: <Code>/ts2021</Code>,
          methodNotAllowed: <Code>405 Method Not Allowed</Code>,
        })}
      </StatusBanner>
    </div>
  );
}

function SSHConsole({
  hostname,
  username,
  node,
}: {
  hostname: string;
  username: string;
  node: { ipAddress: string; controlURL: string };
}) {
  const { t } = useI18n();
  const [ipn, setIpn] = useState<IPN | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState(() => t("ssh.joining"));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: IPN | null = null;
    let issuedKey: string | null = null;

    setFailed(false);
    setStatus(t("ssh.joining"));

    const onPanic = (error: string) => {
      if (cancelled) return;
      setFailed(true);
      setStatus(t("ssh.nodeStopped", { error: String(error) }));
    };

    void (async () => {
      // The key is minted here rather than by the loader so it never reaches
      // the server-rendered document.
      const consoleKey = await createConsoleKey(hostname, username, t);
      issuedKey = consoleKey.key;

      const running = await connectTailnet({
        controlURL: node.controlURL,
        authKey: consoleKey.key,
        hostname: consoleKey.ephemeralHostname,
        onPanic,
      });

      if (cancelled) {
        stopTailnet(running);
        return;
      }

      instance = running;
      setStatus(t("ssh.connecting", { hostname }));
      setIpn(running);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setFailed(true);
      setStatus(
        t("ssh.joinFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    });

    return () => {
      cancelled = true;

      // Closing the console must not leave the ephemeral node running or its
      // pre-auth key valid. The revocation is fire-and-forget: the key is
      // unusable without this browser's Tailnet session anyway.
      if (issuedKey !== null) {
        revokeConsoleKey(hostname, issuedKey);
        issuedKey = null;
      }

      stopTailnet(instance);
      instance = null;
    };
  }, [hostname, username, node, attempt]);

  const retry = () => {
    setIpn(null);
    setConnected(false);
    setAttempt((value) => value + 1);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {!connected && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-mist-200" />
            <p className="text-sm text-mist-400">{status}</p>
            {failed && (
              <Button variant="heavy" className="mt-2" onClick={retry}>
                {t("ssh.retry")}
              </Button>
            )}
          </div>
        </div>
      )}

      {ipn && (
        <Ghostty
          ipn={ipn}
          username={username}
          ipAddress={node.ipAddress}
          onConnected={() => setConnected(true)}
        />
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const payload = isRouteErrorResponse(error) && isSshErrorPayload(error.data) ? error.data : null;
  if (payload == null) {
    // Pass through further down the tree to the global error boundary
    throw error;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <SSHErrorBoundary code={payload.sshError} params={payload.params} />
    </div>
  );
}
