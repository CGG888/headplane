import type { Key } from "~/types";

import type { Capabilities } from "../capabilities";
import type { Transport } from "../transport";

export interface ApiKeyApi {
  list(): Promise<Key[]>;

  /**
   * Create a new API key that expires at `expiration`. Headscale returns the
   * full key exactly once; it can never be read back afterwards.
   */
  create(expiration: Date): Promise<{ apiKey: string }>;

  /**
   * Expire an existing API key. `prefix` must be the raw prefix stored by
   * Headscale (12 characters for 0.28+ keys) — the masked prefix returned by
   * {@link list} is not accepted by the API.
   */
  expire(prefix: string): Promise<void>;

  /**
   * Permanently delete an API key's record. `prefix` is the same raw prefix
   * {@link expire} takes; the endpoint also declares an optional `id` query
   * parameter, but the spec does not say which identifier wins when both are
   * present, so only the required path segment is sent.
   */
  delete(prefix: string): Promise<void>;
}

export function makeApiKeyApi(
  transport: Transport,
  _capabilities: Capabilities,
  apiKey: string,
): ApiKeyApi {
  return {
    list: async () => {
      const { apiKeys } = await transport.request<{ apiKeys: Key[] }>({
        method: "GET",
        path: "v1/apikey",
        apiKey,
      });
      return apiKeys;
    },

    create: async (expiration) => {
      // POST /api/v1/apikey { expiration } -> { apiKey }
      return transport.request<{ apiKey: string }>({
        method: "POST",
        path: "v1/apikey",
        apiKey,
        body: { expiration: expiration.toISOString() },
      });
    },

    expire: async (prefix) => {
      // POST /api/v1/apikey/expire { prefix }
      await transport.request({
        method: "POST",
        path: "v1/apikey/expire",
        apiKey,
        body: { prefix },
      });
    },

    delete: async (prefix) => {
      // DELETE /api/v1/apikey/{prefix}
      await transport.request({
        method: "DELETE",
        path: `v1/apikey/${encodeURIComponent(prefix)}`,
        apiKey,
      });
    },
  };
}
