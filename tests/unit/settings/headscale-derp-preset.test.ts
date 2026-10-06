import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { defaultDerpPrivateKeyPath } from "~/routes/settings/headscale/derp-settings";
import {
  appConfigContext,
  auditContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import {
  DERP_REGION_NAMES_SNAPSHOT_REASON,
  readDerpRegionNames,
  writeDerpRegionNames,
} from "~/server/headscale/derp-region-names";

function mockFormData(entries: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        formData.append(key, entry);
      }
      continue;
    }

    formData.set(key, value);
  }
  return formData;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

interface SubmitOptions {
  allowed?: boolean;
  writable?: boolean;
  dataPath?: string;
  configPath?: string;
  automaticallyAddEmbeddedDerpRegion?: boolean;
  paths?: string[];
  ipv4?: string;
  ipv6?: string;
  /** The snapshot service the action takes its usual pre-mutation snapshot with. */
  snapshots?: { take: (reason: string) => Promise<unknown> };
  /** The audit log the action records a change in. */
  audit?: { record: (input: unknown) => Promise<unknown> };
}

const onConfigChange = vi.fn().mockResolvedValue(undefined);

function createMockContext(options: SubmitOptions, patch: ReturnType<typeof vi.fn>) {
  return {
    get: (context: unknown) => {
      if (context === authContext) {
        return {
          require: () =>
            Promise.resolve({
              kind: "oidc",
              sessionId: "session-1",
              user: { id: "1", subject: "tester", role: "admin", headscaleUserId: undefined },
              profile: { name: "Tester", email: "tester@example.com" },
            }),
          can: () => options.allowed ?? true,
        };
      }

      if (context === snapshotContext) {
        return options.snapshots;
      }

      if (context === auditContext) {
        return options.audit;
      }

      if (context === headscaleConfigContext) {
        return {
          writable: () => options.writable ?? true,
          patch,
          getTailnetSettings: () => ({ policyMode: "file", policyPath: "", trustedProxies: [] }),
          getDERPSettings: () => ({
            urls: [],
            paths: options.paths ?? [],
            autoUpdateEnabled: false,
            updateFrequency: "3h",
            server: {
              enabled: false,
              regionId: 999,
              regionCode: "headscale",
              regionName: "Headscale Embedded DERP",
              stunListenAddr: "0.0.0.0:3478",
              privateKeyPath: "",
              hasPrivateKey: false,
              ipv4: options.ipv4 ?? "",
              ipv6: options.ipv6 ?? "",
              verifyClients: true,
              automaticallyAddEmbeddedDerpRegion:
                options.automaticallyAddEmbeddedDerpRegion ?? true,
            },
          }),
        };
      }

      if (context === headscaleContext) {
        return { config: {} };
      }

      if (context === integrationContext) {
        return { onConfigChange };
      }

      if (context === appConfigContext) {
        return {
          server: { data_path: options.dataPath ?? "" },
          headscale: { config_path: options.configPath },
        };
      }

      return undefined;
    },
  };
}

async function submit(entries: Record<string, string | string[]>, options: SubmitOptions = {}) {
  const { headscaleSettingsAction } = await import("~/routes/settings/headscale/actions");

  const patch = vi.fn().mockResolvedValue(undefined);
  onConfigChange.mockClear();

  let result: ActionResult;
  try {
    result = (await headscaleSettingsAction({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(options, patch),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    result = thrown as ActionResult;
  }

  return { result, patch };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

function errorCodeOf(result: ActionResult): string | undefined {
  if (result.data && (result.data as { success: boolean }).success) {
    return undefined;
  }

  return (result.data as { errorCode: string } | undefined)?.errorCode;
}

const PRESET_FIELDS = {
  action_id: "preset_embedded_derp",
  derp_server_region_id: "999",
  derp_server_region_code: "home",
  derp_server_region_name: "Home DERP",
  derp_server_stun_listen_addr: "0.0.0.0:3478",
  derp_server_ipv4: "",
  derp_server_ipv6: "",
  derp_server_private_key_path: "/etc/headscale/derp_server_private.key",
};

describe("embedded DERP private key default", () => {
  test("sits next to Headscale's config file", () => {
    expect(defaultDerpPrivateKeyPath("/etc/headscale/config.yaml")).toBe(
      "/etc/headscale/derp_server_private.key",
    );
    expect(defaultDerpPrivateKeyPath("/etc/headscale/")).toBe(
      "/etc/headscale/derp_server_private.key",
    );
    // Backslash paths keep their separator.
    expect(defaultDerpPrivateKeyPath("C:\\headscale\\config.yaml")).toBe(
      "C:\\headscale\\derp_server_private.key",
    );
  });

  test("falls back to Headscale's documented install path", () => {
    expect(defaultDerpPrivateKeyPath(undefined)).toBe("/var/lib/headscale/derp_server_private.key");
    expect(defaultDerpPrivateKeyPath("  ")).toBe("/var/lib/headscale/derp_server_private.key");
    expect(defaultDerpPrivateKeyPath("config.yaml")).toBe("/derp_server_private.key");
  });
});

describe("embedded DERP preset action", () => {
  test("enables the server and saves every field in one patch", async () => {
    const { result, patch } = await submit(PRESET_FIELDS);

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).toHaveBeenCalledWith([
      { path: "derp.server.enabled", value: true },
      { path: "derp.server.region_id", value: 999 },
      { path: "derp.server.region_code", value: "home" },
      { path: "derp.server.region_name", value: "Home DERP" },
      { path: "derp.server.stun_listen_addr", value: "0.0.0.0:3478" },
      { path: "derp.server.ipv4", value: null },
      { path: "derp.server.ipv6", value: null },
      { path: "derp.server.private_key_path", value: "/etc/headscale/derp_server_private.key" },
    ]);
    expect(onConfigChange).toHaveBeenCalledOnce();
  });

  test("writes the optional public addresses when they are filled in", async () => {
    const { result, patch } = await submit({
      ...PRESET_FIELDS,
      derp_server_ipv4: "198.51.100.1",
      derp_server_ipv6: "2001:db8::1",
    });

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith(
      expect.arrayContaining([
        { path: "derp.server.ipv4", value: "198.51.100.1" },
        { path: "derp.server.ipv6", value: "2001:db8::1" },
      ]),
    );
  });

  test("rejects public addresses that are not bare literals of the right family", async () => {
    for (const value of ["198.51.100.1/24", "198.51.100.1:443", "2001:db8::1", "not-an-ip"]) {
      const { result, patch } = await submit({ ...PRESET_FIELDS, derp_server_ipv4: value });
      expect(statusOf(result), value).toBe(400);
      expect(errorCodeOf(result), value).toBe("invalidDerpIpv4");
      expect(patch).not.toHaveBeenCalled();
    }

    for (const value of ["2001:db8::1/64", "[2001:db8::1]:443", "198.51.100.1", "not-an-ip"]) {
      const { result, patch } = await submit({ ...PRESET_FIELDS, derp_server_ipv6: value });
      expect(statusOf(result), value).toBe(400);
      expect(errorCodeOf(result), value).toBe("invalidDerpIpv6");
      expect(patch).not.toHaveBeenCalled();
    }
  });

  test("derives the private key path from Headscale's config path when it is empty", async () => {
    const { result, patch } = await submit(
      { ...PRESET_FIELDS, derp_server_private_key_path: "" },
      { configPath: "/etc/headscale/config.yaml" },
    );

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          path: "derp.server.private_key_path",
          value: "/etc/headscale/derp_server_private.key",
        },
      ]),
    );
  });

  test("rejects a region id outside Headscale's embedded range", async () => {
    const low = await submit({ ...PRESET_FIELDS, derp_server_region_id: "899" });
    expect(statusOf(low.result)).toBe(400);
    expect(errorCodeOf(low.result)).toBe("invalidDerpRegionId");
    expect(low.patch).not.toHaveBeenCalled();

    const high = await submit({ ...PRESET_FIELDS, derp_server_region_id: "1000" });
    expect(statusOf(high.result)).toBe(400);
    expect(errorCodeOf(high.result)).toBe("invalidDerpRegionId");
    expect(high.patch).not.toHaveBeenCalled();
  });

  test("rejects a blank region code or name", async () => {
    const blankCode = await submit({ ...PRESET_FIELDS, derp_server_region_code: "  " });
    expect(errorCodeOf(blankCode.result)).toBe("invalidDerpRegionCode");

    const blankName = await submit({ ...PRESET_FIELDS, derp_server_region_name: "" });
    expect(errorCodeOf(blankName.result)).toBe("invalidDerpRegionCode");
    expect(blankName.patch).not.toHaveBeenCalled();
  });

  test("rejects a STUN address that is not host:port", async () => {
    for (const value of ["3478", "0.0.0.0", "0.0.0.0:0", "0.0.0.0:70000", "host:port"]) {
      const { result, patch } = await submit({
        ...PRESET_FIELDS,
        derp_server_stun_listen_addr: value,
      });
      expect(statusOf(result), value).toBe(400);
      expect(errorCodeOf(result), value).toBe("invalidDerpStunAddr");
      expect(patch).not.toHaveBeenCalled();
    }

    const ipv6 = await submit({ ...PRESET_FIELDS, derp_server_stun_listen_addr: "[::]:3478" });
    expect(statusOf(ipv6.result)).toBe(200);
  });

  test("rejects a relative private key path", async () => {
    const { result, patch } = await submit({
      ...PRESET_FIELDS,
      derp_server_private_key_path: "derp_server_private.key",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidDerpPrivateKeyPath");
    expect(patch).not.toHaveBeenCalled();
  });

  test("clears derp.urls in the same patch when the public map is dropped", async () => {
    const { result, patch } = await submit({ ...PRESET_FIELDS, derp_clear_public_map: "true" });

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith(expect.arrayContaining([{ path: "derp.urls", value: [] }]));
  });

  test("leaves derp.urls alone unless the option is ticked", async () => {
    const { result, patch } = await submit({ ...PRESET_FIELDS, derp_clear_public_map: "false" });

    expect(statusOf(result)).toBe(200);
    // The preset never touches derp.urls on its own; only the option above does.
    expect(patch).toHaveBeenCalledWith(
      expect.not.arrayContaining([{ path: "derp.urls", value: [] }]),
    );
  });

  test("still requires a DERP map path when the region is not added automatically", async () => {
    const { result, patch } = await submit(PRESET_FIELDS, {
      automaticallyAddEmbeddedDerpRegion: false,
      paths: [],
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("derpPathsRequired");
    expect(patch).not.toHaveBeenCalled();

    const withPath = await submit(PRESET_FIELDS, {
      automaticallyAddEmbeddedDerpRegion: false,
      paths: ["/etc/headscale/derp.yaml"],
    });
    expect(statusOf(withPath.result)).toBe(200);
  });
});

describe("embedded DERP server action", () => {
  const SERVER_FIELDS = {
    action_id: "save_derp_server",
    derp_server_enabled: "true",
    derp_server_region_id: "999",
    derp_server_region_code: "headscale",
    derp_server_region_name: "Headscale Embedded DERP",
    derp_server_stun_listen_addr: "0.0.0.0:3478",
    derp_server_ipv4: "198.51.100.1",
    derp_server_ipv6: "2001:db8::1",
    derp_server_verify_clients: "true",
    derp_server_automatically_add_embedded_derp_region: "true",
  };

  test("saves the public addresses and clears them with an empty field", async () => {
    const set = await submit(SERVER_FIELDS);
    expect(statusOf(set.result)).toBe(200);
    expect(set.patch).toHaveBeenCalledWith(
      expect.arrayContaining([
        { path: "derp.server.ipv4", value: "198.51.100.1" },
        { path: "derp.server.ipv6", value: "2001:db8::1" },
      ]),
    );

    const cleared = await submit({ ...SERVER_FIELDS, derp_server_ipv4: "", derp_server_ipv6: "" });
    expect(statusOf(cleared.result)).toBe(200);
    expect(cleared.patch).toHaveBeenCalledWith(
      expect.arrayContaining([
        { path: "derp.server.ipv4", value: null },
        { path: "derp.server.ipv6", value: null },
      ]),
    );
  });

  test("rejects a public address that carries a prefix length or port", async () => {
    const badV4 = await submit({ ...SERVER_FIELDS, derp_server_ipv4: "198.51.100.1:443" });
    expect(statusOf(badV4.result)).toBe(400);
    expect(errorCodeOf(badV4.result)).toBe("invalidDerpIpv4");
    expect(badV4.patch).not.toHaveBeenCalled();

    const badV6 = await submit({ ...SERVER_FIELDS, derp_server_ipv6: "2001:db8::1/64" });
    expect(statusOf(badV6.result)).toBe(400);
    expect(errorCodeOf(badV6.result)).toBe("invalidDerpIpv6");
    expect(badV6.patch).not.toHaveBeenCalled();
  });
});

describe("DERP region name actions", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-region-action-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("adds a pair to Headplane's data directory", async () => {
    const { result } = await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "Amsterdam" },
      { dataPath: dir },
    );

    expect(statusOf(result)).toBe(200);
    expect(await readDerpRegionNames(dir)).toEqual({ "901": "Amsterdam" });
  });

  test("replaces an existing pair for the same id", async () => {
    await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "Amsterdam" },
      { dataPath: dir },
    );
    await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "Utrecht" },
      { dataPath: dir },
    );

    expect(await readDerpRegionNames(dir)).toEqual({ "901": "Utrecht" });
  });

  test("removes a pair and rejects an id with no name", async () => {
    await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "Amsterdam" },
      { dataPath: dir },
    );

    const removed = await submit(
      { action_id: "remove_derp_region_name", derp_region_id: "901" },
      { dataPath: dir },
    );
    expect(statusOf(removed.result)).toBe(200);
    expect(await readDerpRegionNames(dir)).toEqual({});

    const missing = await submit(
      { action_id: "remove_derp_region_name", derp_region_id: "901" },
      { dataPath: dir },
    );
    expect(statusOf(missing.result)).toBe(400);
    expect(errorCodeOf(missing.result)).toBe("derpRegionMapNotFound");
  });

  test("rejects invalid ids and blank names", async () => {
    const badId = await submit(
      { action_id: "add_derp_region_name", derp_region_id: "-1", derp_region_name: "Amsterdam" },
      { dataPath: dir },
    );
    expect(errorCodeOf(badId.result)).toBe("invalidDerpRegionMapId");

    const badName = await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "  " },
      { dataPath: dir },
    );
    expect(errorCodeOf(badName.result)).toBe("invalidDerpRegionMapName");

    expect(await readDerpRegionNames(dir)).toEqual({});
  });

  test("reports a write failure when the data directory is missing", async () => {
    const { result } = await submit(
      { action_id: "add_derp_region_name", derp_region_id: "901", derp_region_name: "Amsterdam" },
      { dataPath: "" },
    );

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("derpRegionMapWriteFailed");
  });
});

describe("mirror region name action", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-mirror-names-action-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const SELECTED = {
    action_id: "add_mirror_region_names",
    mirror_region_number: ["901", "902", "903"],
    mirror_region_name: ["香港", "新加坡", "东京"],
  };

  test("writes the ticked regions under the numbers they are mirrored as", async () => {
    const { result } = await submit(SELECTED, { dataPath: dir });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { addedRegionNames: number }).addedRegionNames).toBe(3);
    expect(await readDerpRegionNames(dir)).toEqual({
      "901": "香港",
      "902": "新加坡",
      "903": "东京",
    });
  });

  test("is idempotent and never overwrites a name the operator set", async () => {
    await writeDerpRegionNames(dir, { "901": "My own name" });

    const first = await submit(SELECTED, { dataPath: dir });
    expect((first.result.data as { addedRegionNames: number }).addedRegionNames).toBe(2);
    expect(await readDerpRegionNames(dir)).toEqual({
      "901": "My own name",
      "902": "新加坡",
      "903": "东京",
    });

    const second = await submit(SELECTED, { dataPath: dir });
    expect((second.result.data as { addedRegionNames: number }).addedRegionNames).toBe(0);
    expect(await readDerpRegionNames(dir)).toEqual({
      "901": "My own name",
      "902": "新加坡",
      "903": "东京",
    });
  });

  test("ignores malformed pairs instead of failing the batch", async () => {
    const { result } = await submit(
      {
        action_id: "add_mirror_region_names",
        mirror_region_number: ["not-a-number", "902", "903"],
        mirror_region_name: ["Named", "新加坡", "   "],
      },
      { dataPath: dir },
    );

    expect(statusOf(result)).toBe(200);
    expect((result.data as { addedRegionNames: number }).addedRegionNames).toBe(1);
    expect(await readDerpRegionNames(dir)).toEqual({ "902": "新加坡" });
  });

  test("adds nothing when no region is ticked", async () => {
    const { result } = await submit({ action_id: "add_mirror_region_names" }, { dataPath: dir });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { addedRegionNames: number }).addedRegionNames).toBe(0);
    expect(await readDerpRegionNames(dir)).toEqual({});
  });

  test("takes the usual snapshot and records the change", async () => {
    const take = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const record = vi.fn().mockResolvedValue(undefined);

    const { result } = await submit(SELECTED, {
      dataPath: dir,
      snapshots: { take },
      audit: { record },
    });

    expect(statusOf(result)).toBe(200);
    expect(take).toHaveBeenCalledWith(DERP_REGION_NAMES_SNAPSHOT_REASON);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0]).toMatchObject({
      actor: "Tester",
      actorType: "user",
      action: "derp.region_mirror",
      result: "success",
    });
    expect((record.mock.calls[0][0] as { detail: string }).detail).toContain("3");
  });

  test("still writes when the snapshot service is unavailable", async () => {
    const { result } = await submit(SELECTED, { dataPath: dir, snapshots: undefined });

    expect(statusOf(result)).toBe(200);
    expect(await readDerpRegionNames(dir)).toEqual({
      "901": "香港",
      "902": "新加坡",
      "903": "东京",
    });
  });

  test("reports a write failure when the data directory is missing", async () => {
    const { result } = await submit(SELECTED, { dataPath: "" });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("derpRegionMapWriteFailed");
  });
});
