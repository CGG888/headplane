import type { Machine } from "~/types";

import type { Capabilities } from "../capabilities";
import type { Transport } from "../transport";

interface RawMachine extends Omit<Machine, "tags"> {
  tags?: string[];
  forcedTags?: string[];
  validTags?: string[];
  invalidTags?: string[];
}

/**
 * Body of `POST /api/v1/debug/node`, which fabricates a node server-side
 * instead of reading one. Every field the spec declares is optional there, so
 * they are optional here too; Headscale still needs at least a user and a key
 * to create anything.
 */
export interface DebugNodeOptions {
  /** Name of the owning user. */
  user?: string;
  /** Machine key to register the fabricated node under. */
  key?: string;
  /** Name to give the fabricated node. */
  name?: string;
  /** Subnet routes the fabricated node advertises. */
  routes?: string[];
}

export interface NodeApi {
  list(): Promise<Machine[]>;
  get(id: string): Promise<Machine>;
  delete(id: string): Promise<void>;
  register(user: string, key: string): Promise<Machine>;
  approveRoutes(id: string, routes: string[]): Promise<void>;
  expire(id: string): Promise<void>;
  rename(id: string, newName: string): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
  toggleExpiry(nodeId: string, disableExpiry: boolean): Promise<void>;
  /**
   * Set an explicit expiry timestamp for a node. The `expiry` field exists on
   * `POST /api/v1/node/{node_id}/expire` in every Headscale release Headplane
   * supports (0.27.0+).
   */
  setExpiry(nodeId: string, expiry: Date): Promise<void>;
  /**
   * Backfill the IP addresses of nodes that are missing one, via
   * `POST /api/v1/node/backfillips?confirmed=true`.
   *
   * `confirmed` is not a dry-run switch and not optional in practice: the
   * handler in every Headscale release Headplane supports (0.26.0-0.29.4,
   * `headscaleV1APIServer.BackfillNodeIPs`) aborts with "not confirmed,
   * aborting" unless it is true, so this client always sends it. The response's
   * `changes` is a list of human-readable lines — one per address assigned or
   * removed (`assigned IPv4 "100.64.0.1" to Node(3) "host"`) — which is why the
   * method answers with the raw list. A missing `changes` field is treated as
   * "nothing to do" rather than as an error.
   */
  backfillIps(): Promise<string[]>;
  /**
   * Create a debug node via `POST /api/v1/debug/node`.
   *
   * This is *not* a per-node debug-info endpoint: the spec
   * (`HeadscaleService_DebugCreateNode`, verified against the live
   * `swagger/v1/openapiv2.json` and upstream v0.27.0-v0.29.0) takes no node ID,
   * takes `{ user, key, name, routes }` in the body and answers with the node
   * it created. The response is normalized like {@link get}, so the raw fields
   * Headscale returned are still on the object.
   */
  debug(opts: DebugNodeOptions): Promise<Machine>;
  /**
   * Reassign a node to a different user. Only present when
   * `capabilities.nodeOwnerIsImmutable` is false (Headscale < 0.28).
   */
  reassignUser?: (id: string, user: string) => Promise<void>;
}

/**
 * A headscale node ID as it appears in the REST path: a decimal `uint64`
 * written by Headscale itself. Nothing else is a node ID.
 */
export const NODE_ID_PATTERN = /^\d{1,20}$/;

/**
 * Build a `v1/node/<id>...` path, refusing anything that is not a plain
 * decimal ID.
 *
 * The IDs on this API come from request bodies, and `new URL(url, baseUrl)`
 * (see `transport.ts`) collapses `..` segments. Interpolating `../user/42`
 * therefore used to turn `DELETE /api/v1/node/../user/42` into
 * `DELETE /api/v1/user/42`, i.e. any node-scoped endpoint could be re-pointed
 * at a sibling endpoint while still riding on the panel's own API key. Pair
 * this with the `..` backstop in `Transport.request`.
 */
function nodePath(id: string, suffix = ""): `v1/node/${string}` {
  const value = String(id).trim();
  if (!NODE_ID_PATTERN.test(value)) {
    throw new Error(`Invalid node ID: ${JSON.stringify(String(id))}`);
  }
  return `v1/node/${value}${suffix}`;
}

export function makeNodeApi(
  transport: Transport,
  capabilities: Capabilities,
  apiKey: string,
): NodeApi {
  function normalize(raw: RawMachine): Machine {
    if (capabilities.nodeTagsAreFlat) {
      return { ...raw, tags: raw.tags ?? [] } as Machine;
    }
    const tags = Array.from(new Set([...(raw.forcedTags ?? []), ...(raw.validTags ?? [])]));
    return { ...raw, tags } as Machine;
  }

  const api: NodeApi = {
    list: async () => {
      const result = await transport.request<{ nodes?: RawMachine[] }>({
        method: "GET",
        path: "v1/node",
        apiKey,
      });
      const nodes = result?.nodes;
      if (!Array.isArray(nodes)) {
        throw new Error(
          "Headscale returned an unexpected node list: the response has no `nodes` array",
        );
      }

      return nodes.map(normalize);
    },
    get: async (id) => {
      const result = await transport.request<{ node?: RawMachine }>({
        method: "GET",
        path: nodePath(id),
        apiKey,
      });
      const node = result?.node;
      if (node === undefined || node === null || typeof node !== "object") {
        throw new Error(
          `Headscale returned an unexpected node response for ${id}: the response has no \`node\` object`,
        );
      }

      return normalize(node);
    },
    delete: async (id) => {
      await transport.request({ method: "DELETE", path: nodePath(id), apiKey });
    },
    register: async (user, key) => {
      // Headscale's node-register endpoint expects the registration
      // params as both query string and body — preserved as-is.
      // Pre-0.29 expects the raw 24-char registration ID; 0.29+ expects
      // the full `hskey-authreq-<id>` AuthID.
      const registerKey = capabilities.registerKeyIncludesAuthReqPrefix
        ? key
        : key.replace(/^hskey-authreq-/, "");
      const qp = new URLSearchParams();
      qp.append("user", user);
      qp.append("key", registerKey);
      const { node } = await transport.request<{ node: RawMachine }>({
        method: "POST",
        path: `v1/node/register?${qp.toString()}`,
        apiKey,
        body: { user, key: registerKey },
      });
      return normalize(node);
    },
    approveRoutes: async (id, routes) => {
      await transport.request({
        method: "POST",
        path: nodePath(id, "/approve_routes"),
        apiKey,
        body: { routes },
      });
    },
    expire: async (id) => {
      await transport.request({ method: "POST", path: nodePath(id, "/expire"), apiKey });
    },
    rename: async (id, newName) => {
      await transport.request({
        method: "POST",
        path: nodePath(id, `/rename/${encodeURIComponent(newName)}`),
        apiKey,
      });
    },
    setTags: async (id, tags) => {
      await transport.request({
        method: "POST",
        path: nodePath(id, "/tags"),
        apiKey,
        body: { tags },
      });
    },
    toggleExpiry: async (nodeId, disableExpiry) => {
      await transport.request({
        method: "POST",
        path: nodePath(nodeId, `/expire?disableExpiry=${disableExpiry ? "true" : "false"}`),
        apiKey,
      });
    },
    setExpiry: async (nodeId, expiry) => {
      // Headscale's REST gateway binds `expiry` as a query parameter for this
      // endpoint (the proto request has no `body` annotation), so it travels in
      // the path like `disableExpiry` above rather than as a JSON body.
      // https://github.com/juanfont/headscale/blob/v0.29.4/gen/openapiv2/headscale/v1/headscale.swagger.json
      await transport.request({
        method: "POST",
        path: nodePath(nodeId, `/expire?expiry=${encodeURIComponent(expiry.toISOString())}`),
        apiKey,
      });
    },
    backfillIps: async () => {
      // `confirmed=true` is the whole request: the gateway binds it as a query
      // parameter (the proto request has no `body` annotation) and the handler
      // refuses to run without it. There is no dry-run form of this call.
      const result = await transport.request<{ changes?: string[] } | undefined>({
        method: "POST",
        path: "v1/node/backfillips?confirmed=true",
        apiKey,
      });
      return result?.changes ?? [];
    },
    debug: async ({ user, key, name, routes }) => {
      // POST /api/v1/debug/node { user, key, name, routes } -> { node }
      const body: Record<string, unknown> = {};
      if (user !== undefined) body.user = user;
      if (key !== undefined) body.key = key;
      if (name !== undefined) body.name = name;
      if (routes !== undefined) body.routes = routes;

      const { node } = await transport.request<{ node: RawMachine }>({
        method: "POST",
        path: "v1/debug/node",
        apiKey,
        body,
      });
      return normalize(node);
    },
  };

  if (!capabilities.nodeOwnerIsImmutable) {
    api.reassignUser = async (id, user) => {
      await transport.request({
        method: "POST",
        path: nodePath(id, "/user"),
        apiKey,
        body: { user },
      });
    };
  }

  return api;
}
