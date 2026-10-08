/**
 * Origins that reach the listener Headplane bound itself.
 *
 * Some pages fetch assets that this same process serves (browser SSH probes its
 * WASM bundle with a `HEAD` request before rendering the terminal). The URL
 * React Router derives from a request describes the *socket*, not the public
 * deployment: behind a proxy that terminates TLS, the socket is plain HTTP and
 * the `Host` header is the public one, so `${url.origin}/admin/hp_ssh.wasm`
 * asks a TLS port for a cleartext page and resets the connection. Probing the
 * configured listener first sidesteps the proxy entirely; the request origin is
 * kept as the fallback that the Vite dev server needs, where the app is served
 * from a port that `server.port` does not describe.
 */

export interface ListenerConfig {
  host: string;
  port: number;
  tls_cert_path?: string;
  tls_key_path?: string;
}

/** The URL this process actually listens on, e.g. `http://127.0.0.1:3000`. */
export function selfOrigin(server: ListenerConfig): string {
  const scheme = server.tls_cert_path || server.tls_key_path ? "https" : "http";
  const host = !server.host || WILDCARDS.has(server.host) ? "127.0.0.1" : server.host;
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${authority}:${server.port}`;
}

/**
 * The origins to try, in order, when probing a self-served asset. The request
 * origin is dropped when it is already the listener URL so the same address is
 * never probed twice.
 */
export function assetProbeOrigins(server: ListenerConfig, requestOrigin: string): string[] {
  const origin = selfOrigin(server);
  return origin === requestOrigin ? [origin] : [origin, requestOrigin];
}

/** Bind addresses that mean "every interface" rather than one to reach. */
const WILDCARDS = new Set(["0.0.0.0", "::", "[::]"]);
