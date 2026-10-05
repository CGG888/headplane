import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { appConfigContext, authContext, headscaleConfigContext } from "~/server/context";
import { RELAY_DNS_SERVERS_FILE, writeRelayDnsServers } from "~/server/relay-dns-store";
import { Capabilities } from "~/server/web/roles";

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

interface MockPermissions {
  read?: boolean;
  write?: boolean;
}

function mockFormData(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return formData;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

/**
 * A relay host that is already a literal, so the lookup behind the card never
 * touches the network while the rest of the route runs for real.
 */
function createMockContext(dataPath: string, permissions: MockPermissions = {}) {
  const read = permissions.read ?? true;
  const write = permissions.write ?? true;

  return {
    get: (context: unknown) => {
      if (context === authContext) {
        return {
          require: () => Promise.resolve({ id: 1 }),
          can: (_principal: unknown, capability: number) =>
            capability === Capabilities.configure_iam ? write : read,
        };
      }

      if (context === appConfigContext) {
        return { server: { data_path: dataPath } };
      }

      if (context === headscaleConfigContext) {
        return {
          readable: () => true,
          getDERPSettings: () => ({ serverUrl: "https://[2001:db8::1]:8443" }),
        };
      }

      return undefined;
    },
  };
}

async function load(dataPath: string, permissions?: MockPermissions) {
  const { loader } = await import("~/routes/settings/headscale/relay-dns");

  try {
    return (await loader({
      request: mockRequest(mockFormData({})),
      context: createMockContext(dataPath, permissions),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    return thrown as ActionResult;
  }
}

async function submit(
  dataPath: string,
  entries: Record<string, string>,
  permissions?: MockPermissions,
) {
  const { action } = await import("~/routes/settings/headscale/relay-dns");

  try {
    return (await action({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(dataPath, permissions),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // Rejections come back as thrown data() payloads with the same shape.
    return thrown as ActionResult;
  }
}

function dataOf<T>(result: ActionResult): T {
  return result.data as T;
}

describe("relay DNS resource route", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-relay-dns-route-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the loader reports the stored list, the permission and the relay host", async () => {
    await writeRelayDnsServers(dir, ["1.1.1.1"]);

    const result = await load(dir);
    const data = dataOf<{ canEdit: boolean; servers: string[]; maxServers: number }>(result);

    expect(data.canEdit).toBe(true);
    expect(data.servers).toEqual(["1.1.1.1"]);
    expect(data.maxServers).toBeGreaterThan(0);
    expect(dataOf<{ endpoint?: { host: string; port: number } }>(result).endpoint).toEqual({
      host: "[2001:db8::1]",
      port: 8443,
    });
  });

  test("a viewer who may not write still sees the list", async () => {
    await writeRelayDnsServers(dir, ["9.9.9.9"]);

    const data = dataOf<{ canEdit: boolean; servers: string[] }>(await load(dir, { write: false }));
    expect(data.canEdit).toBe(false);
    expect(data.servers).toEqual(["9.9.9.9"]);
  });

  test("a viewer without read access is refused", async () => {
    const refused = await load(dir, { read: false });

    expect(refused.init?.status).toBe(403);
    expect(dataOf<{ localized: { key: string } }>(refused).localized.key).toBe(
      "errors.permission.viewIam",
    );
  });

  test("adding a server writes it after the ones already stored", async () => {
    await writeRelayDnsServers(dir, ["1.1.1.1"]);

    const result = await submit(dir, { action_id: "add_relay_dns_server", server: "9.9.9.9" });
    const data = dataOf<{ ok: boolean; servers: string[] }>(result);

    expect(data.ok).toBe(true);
    expect(data.servers).toEqual(["1.1.1.1", "9.9.9.9"]);
    expect(JSON.parse(await readFile(join(dir, RELAY_DNS_SERVERS_FILE), "utf8"))).toEqual({
      servers: ["1.1.1.1", "9.9.9.9"],
    });
  });

  test("garbage, duplicates and a full list are rejected with a code", async () => {
    await writeRelayDnsServers(dir, ["1.1.1.1"]);

    const garbage = dataOf<{ ok: boolean; errorCode: string }>(
      await submit(dir, { action_id: "add_relay_dns_server", server: "not-an-ip" }),
    );
    expect(garbage).toEqual({ ok: false, errorCode: "invalidRelayDnsServer" });

    const duplicate = dataOf<{ ok: boolean; errorCode: string }>(
      await submit(dir, { action_id: "add_relay_dns_server", server: "1.1.1.1" }),
    );
    expect(duplicate).toEqual({ ok: false, errorCode: "duplicateRelayDnsServer" });

    await writeRelayDnsServers(dir, ["1.1.1.1", "9.9.9.9", "8.8.8.8", "8.8.4.4", "1.0.0.1"]);
    const full = dataOf<{ ok: boolean; errorCode: string }>(
      await submit(dir, { action_id: "add_relay_dns_server", server: "2.2.2.2" }),
    );
    expect(full).toEqual({ ok: false, errorCode: "relayDnsServerLimit" });
  });

  test("removing a server rewrites the list and reports a missing one", async () => {
    await writeRelayDnsServers(dir, ["1.1.1.1", "9.9.9.9"]);

    const removed = dataOf<{ ok: boolean; servers: string[] }>(
      await submit(dir, { action_id: "remove_relay_dns_server", server: "1.1.1.1" }),
    );
    expect(removed).toEqual(expect.objectContaining({ ok: true, servers: ["9.9.9.9"] }));

    const missing = dataOf<{ ok: boolean; errorCode: string }>(
      await submit(dir, { action_id: "remove_relay_dns_server", server: "1.1.1.1" }),
    );
    expect(missing).toEqual({ ok: false, errorCode: "relayDnsServerNotFound" });
  });

  test("re-resolving answers with a fresh lookup", async () => {
    const result = await submit(dir, { action_id: "refresh_relay_dns" });
    const data = dataOf<{ ok: boolean; resolution?: { kind: string } }>(result);

    expect(data.ok).toBe(true);
    expect(data.resolution?.kind).toBe("literal");
  });

  test("an unknown action and a refused write are reported", async () => {
    const unknown = dataOf<{ ok: boolean; errorCode: string }>(
      await submit(dir, { action_id: "nonsense" }),
    );
    expect(unknown).toEqual({ ok: false, errorCode: "invalidAction" });

    const refused = await submit(dir, { action_id: "refresh_relay_dns" }, { write: false });
    expect(refused.init?.status).toBe(403);
    expect(dataOf<{ localized: { key: string } }>(refused).localized.key).toBe(
      "errors.permission.modifyIam",
    );
  });

  test("an unwritable data directory is a localized failure, not a crash", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    const result = await submit(blocker, {
      action_id: "add_relay_dns_server",
      server: "1.1.1.1",
    });
    expect(dataOf<{ ok: boolean; errorCode: string }>(result)).toEqual({
      ok: false,
      errorCode: "relayDnsWriteFailed",
    });
  });
});
