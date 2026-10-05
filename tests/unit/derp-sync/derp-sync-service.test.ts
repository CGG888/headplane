import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createDerpSyncService,
  derpSyncFailureReason,
  type DerpSyncService,
} from "~/server/derp-sync/service.server";
import { readDerpSyncDocument, writeDerpSyncDocument } from "~/server/derp-sync/store";
import type { DerpSyncRun, DerpSyncSettings } from "~/server/derp-sync/types";
import type { Headscale } from "~/server/headscale/api";
import type { HostIpv6Addresses } from "~/server/host-addresses";
import type { HostEchoResult } from "~/server/host-echo";
import type { RelayResolution } from "~/server/relay-dns";
import type { SnapshotService } from "~/server/snapshots/service.server";

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const RELAY_HOST = "relay.example.com";
const HOST_IPV6 = "2606:4700::1111";
const PRIVACY_IPV6 = "2606:4700:0:0:152f:808e:9eb1:31c9";
const ECHO_IPV6 = "240e:3b3:4030:1510::1";
const PUBLIC_IPV4 = "8.8.8.8";

function resolution(ipv4: string[], overrides: Partial<RelayResolution> = {}): RelayResolution {
  return { host: RELAY_HOST, kind: "hostname", ipv4, ipv6: [], ...overrides };
}

function hostAddresses(overrides: Partial<HostIpv6Addresses> = {}): HostIpv6Addresses {
  return {
    namespace: "host",
    candidates: [{ address: HOST_IPV6, interfaceName: "eth0" }],
    ...overrides,
  };
}

interface Harness {
  service: DerpSyncService;
  patches: Array<{ path: string; value: unknown }>;
  current(): { ipv4: string; ipv6: string };
  setServerUrl(url: string): void;
  snapshot: ReturnType<typeof vi.fn>;
  audit: Array<Record<string, unknown>>;
  reload: ReturnType<typeof vi.fn>;
  /** Every report the service handed to the notification service. */
  alerts: Array<{ failed: boolean; reason?: string }>;
}

interface HarnessOptions {
  initial?: { ipv4?: string; ipv6?: string };
  writable?: boolean;
  resolve?: (host: string) => Promise<RelayResolution | undefined>;
  host?: () => Promise<HostIpv6Addresses>;
  echo?: () => Promise<HostEchoResult>;
  withIntegration?: boolean;
  withSnapshots?: boolean;
  withAlerts?: boolean;
  intervalMs?: number;
}

describe("DERP address sync service", () => {
  let dir: string;
  let harness: Harness | undefined;

  function build(options: HarnessOptions = {}): Harness {
    let current = { ipv4: options.initial?.ipv4 ?? "", ipv6: options.initial?.ipv6 ?? "" };
    let serverUrl = "https://relay.example.com";

    const patches: Array<{ path: string; value: unknown }> = [];
    const audit: Array<Record<string, unknown>> = [];
    const alerts: Array<{ failed: boolean; reason?: string }> = [];
    const snapshot = vi.fn(async () => ({ id: "snap-1" }));
    const reload = vi.fn(async () => undefined);

    const service = createDerpSyncService({
      dataPath: dir,
      config: {
        writable: () => options.writable ?? true,
        getDERPSettings: () => ({ serverUrl, server: { ...current } }),
        patch: async (next) => {
          for (const entry of next) {
            patches.push(entry);
            if (entry.path === "derp.server.ipv4") {
              current.ipv4 = String(entry.value);
            }
            if (entry.path === "derp.server.ipv6") {
              current.ipv6 = String(entry.value);
            }
          }
        },
      },
      getSnapshotTargets: () => [{ path: "/etc/headscale/config.yaml", kind: "headscale_config" }],
      ...(options.withSnapshots === false
        ? {}
        : { snapshots: { take: snapshot } as unknown as SnapshotService }),
      audit: {
        record: async (input) => {
          audit.push(input as unknown as Record<string, unknown>);
        },
      },
      ...(options.withAlerts === false
        ? {}
        : {
            alerts: {
              reportDerpSync: async (input: { failed: boolean; reason?: string }) => {
                alerts.push(input);
              },
            },
          }),
      headscale: {} as unknown as Headscale,
      ...(options.withIntegration === false ? {} : { integration: { onConfigChange: reload } }),
      resolveRelay: options.resolve ?? (async () => resolution([PUBLIC_IPV4])),
      loadHostIpv6: options.host ?? (async () => hostAddresses()),
      // The echo is off unless a test asks for it, so no test reaches the
      // network through the shared probe.
      resolveHostEcho: options.echo ?? (async () => ({ reason: "disabled", attempted: [] })),
      now: () => new Date(BASE),
      ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    });

    const next: Harness = {
      service,
      patches,
      current: () => ({ ...current }),
      setServerUrl: (url: string) => {
        serverUrl = url;
      },
      snapshot,
      audit,
      reload,
      alerts,
    };

    harness = next;
    return next;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-sync-service-"));
    harness = undefined;
  });

  afterEach(async () => {
    harness?.service.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  test("detects both families and writes only the one that changed", async () => {
    const test1 = build({ initial: { ipv4: "9.9.9.9", ipv6: HOST_IPV6 } });
    // The reload is turned off here so the write itself is the only effect.
    await test1.service.update({ enabled: true, families: "both", autoReload: false });

    const run = await test1.service.runNow();

    expect(run?.mode).toBe("run");
    expect(run?.outcome).toBe("changed");
    expect(run?.changes).toEqual([{ family: "ipv4", from: "9.9.9.9", to: PUBLIC_IPV4 }]);
    expect(run?.unchanged).toEqual(["ipv6"]);
    expect(test1.patches).toEqual([{ path: "derp.server.ipv4", value: PUBLIC_IPV4 }]);
    expect(test1.current()).toEqual({ ipv4: PUBLIC_IPV4, ipv6: HOST_IPV6 });
    expect(test1.snapshot).toHaveBeenCalledTimes(1);
    expect(test1.audit).toHaveLength(1);
    expect(test1.audit[0].action).toBe("derp.address_sync");
    expect(test1.audit[0].detail).toBe(`${PUBLIC_IPV4} (was 9.9.9.9)`);
    expect(test1.reload).not.toHaveBeenCalled();
    expect(run?.reload).toBe("manual");
    // A clean run reports success, so the notifier can clear a remembered
    // failure without sending anything.
    expect(test1.alerts).toEqual([{ failed: false }]);
  });

  test("a check reports what a run would write and writes nothing", async () => {
    const test1b = build({ initial: { ipv4: "9.9.9.9", ipv6: HOST_IPV6 } });
    await test1b.service.update({ enabled: true, families: "both", autoReload: true });

    const run = await test1b.service.checkNow();

    expect(run?.mode).toBe("check");
    expect(run?.outcome).toBe("changed");
    expect(run?.changes).toEqual([{ family: "ipv4", from: "9.9.9.9", to: PUBLIC_IPV4 }]);
    expect(run?.unchanged).toEqual(["ipv6"]);
    // Nothing was written: no patch, no snapshot, no audit entry, no reload.
    expect(test1b.patches).toEqual([]);
    expect(test1b.current()).toEqual({ ipv4: "9.9.9.9", ipv6: HOST_IPV6 });
    expect(test1b.snapshot).not.toHaveBeenCalled();
    expect(test1b.audit).toEqual([]);
    expect(test1b.reload).not.toHaveBeenCalled();
    expect(run?.reload).toBe("not-needed");
    // A check is interactive, so it is not reported to the notifier either.
    expect(test1b.alerts).toEqual([]);
  });

  test("writes nothing when every detected address already matches", async () => {
    const test2 = build({ initial: { ipv4: PUBLIC_IPV4, ipv6: HOST_IPV6 } });
    await test2.service.update({ enabled: true, families: "both", autoReload: true });

    const run = await test2.service.runNow();

    expect(run?.outcome).toBe("unchanged");
    expect(run?.unchanged).toEqual(["ipv4", "ipv6"]);
    expect(run?.failure).toBeUndefined();
    expect(test2.patches).toEqual([]);
    expect(test2.snapshot).not.toHaveBeenCalled();
    expect(test2.audit).toEqual([]);
    expect(run?.reload).toBe("not-needed");
    // A run that changed nothing reports success, so it can never alert.
    expect(test2.alerts).toEqual([{ failed: false }]);
  });

  test("a failed lookup keeps the previous value and records why", async () => {
    const test3 = build({
      initial: { ipv4: "9.9.9.9" },
      resolve: async () => resolution([], { reason: "timeout" }),
    });
    await test3.service.update({ enabled: true, families: "ipv4" });

    const run = await test3.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.skipped).toContainEqual({
      family: "ipv4",
      reason: "lookup-failed",
      detail: RELAY_HOST,
    });
    expect(test3.patches).toEqual([]);
    expect(test3.current().ipv4).toBe("9.9.9.9");
    expect(test3.snapshot).not.toHaveBeenCalled();
  });

  test("an answer that is not a public address is rejected with its value", async () => {
    const test4 = build({
      initial: { ipv4: "9.9.9.9" },
      resolve: async () => resolution(["10.0.0.5", "192.168.1.1"]),
    });
    await test4.service.update({ enabled: true, families: "ipv4" });

    const run = await test4.service.runNow();

    expect(run?.skipped).toContainEqual({
      family: "ipv4",
      reason: "not-public",
      detail: "10.0.0.5, 192.168.1.1",
    });
    expect(test4.current().ipv4).toBe("9.9.9.9");
    expect(test4.patches).toEqual([]);
  });

  test("a private answer among public ones uses the public one", async () => {
    const test5 = build({ resolve: async () => resolution(["10.0.0.5", PUBLIC_IPV4]) });
    await test5.service.update({ enabled: true, families: "ipv4" });

    await test5.service.runNow();

    expect(test5.current().ipv4).toBe(PUBLIC_IPV4);
  });

  test("a bridged container skips IPv6 instead of advertising its own address", async () => {
    // A bridge or veth is no proof of isolation, so the classifier reports
    // "unknown" rather than "isolated"; the sync must treat that exactly like
    // an unreadable namespace and keep the configured value.
    const test6 = build({
      initial: { ipv6: HOST_IPV6 },
      host: async () => hostAddresses({ namespace: "unknown" }),
    });
    await test6.service.update({ enabled: true, families: "ipv6" });

    const run = await test6.service.runNow();

    expect(run?.skipped).toContainEqual({ family: "ipv6", reason: "namespace-unavailable" });
    expect(run?.detected.ipv6).toBeUndefined();
    expect(test6.patches).toEqual([]);
    expect(test6.current().ipv6).toBe(HOST_IPV6);
  });

  test("a container-only address is never written while the namespace is unconfirmed", async () => {
    const test6e = build({
      host: async () =>
        hostAddresses({
          namespace: "unknown",
          candidates: [{ address: HOST_IPV6, interfaceName: "eth0", realNic: false }],
        }),
    });
    await test6e.service.update({ enabled: true, families: "ipv6" });

    const run = await test6e.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.detected.ipv6).toBeUndefined();
    expect(test6e.patches).toEqual([]);
    expect(test6e.current().ipv6).toBe("");
    // What the container saw is still reported, but never as chosen.
    expect(run?.candidates).toContainEqual({
      family: "ipv6",
      address: HOST_IPV6,
      source: "host",
      chosen: false,
      reason: "ranked-lower",
      interfaceName: "eth0",
    });
  });

  test("a confirmed host namespace writes the address it selected", async () => {
    const test6f = build({ host: async () => hostAddresses({ namespace: "host" }) });
    await test6f.service.update({ enabled: true, families: "ipv6" });

    const run = await test6f.service.runNow();

    expect(run?.detected.ipv6).toEqual({ address: HOST_IPV6, source: "host" });
    expect(run?.skipped).toEqual([{ family: "ipv4", reason: "family-disabled" }]);
    expect(test6f.patches).toEqual([{ path: "derp.server.ipv6", value: HOST_IPV6 }]);
    expect(test6f.current().ipv6).toBe(HOST_IPV6);
  });

  test("a rotating privacy address is never preferred over a stable one", async () => {
    const test6b = build({
      host: async () =>
        hostAddresses({
          candidates: [
            { address: PRIVACY_IPV6, interfaceName: "ens18", temporary: true, realNic: true },
            { address: HOST_IPV6, interfaceName: "ens18", temporary: false, realNic: true },
          ],
        }),
    });
    await test6b.service.update({ enabled: true, families: "ipv6" });

    const run = await test6b.service.runNow();

    expect(run?.detected.ipv6).toEqual({ address: HOST_IPV6, source: "host" });
    expect(test6b.current().ipv6).toBe(HOST_IPV6);
  });

  test("the external echo answer wins, because it is what clients reach", async () => {
    const test6c = build({
      echo: async () => ({
        address: ECHO_IPV6,
        attempted: ["https://api64.ipify.org?format=json"],
      }),
    });
    await test6c.service.update({ enabled: true, families: "ipv6" });

    const run = await test6c.service.runNow();

    expect(run?.detected.ipv6).toEqual({ address: ECHO_IPV6, source: "echo" });
    expect(test6c.current().ipv6).toBe(ECHO_IPV6);
    expect(test6c.patches).toEqual([{ path: "derp.server.ipv6", value: ECHO_IPV6 }]);
  });

  test("an unconfirmed namespace still writes the address the echo reported", async () => {
    const test6d = build({
      host: async () => hostAddresses({ namespace: "unknown", candidates: [] }),
      echo: async () => ({ address: ECHO_IPV6, attempted: [] }),
    });
    await test6d.service.update({ enabled: true, families: "ipv6" });

    const run = await test6d.service.runNow();

    // Only the family the setting left out is skipped: the echo is the
    // authority the provenance rule lets past, so it is written even though
    // every local interface belongs to the container.
    expect(run?.skipped).toEqual([{ family: "ipv4", reason: "family-disabled" }]);
    expect(test6d.current().ipv6).toBe(ECHO_IPV6);
  });

  test("a server_url with no host records why IPv4 was skipped", async () => {
    const test7 = build();
    test7.setServerUrl("");
    await test7.service.update({ enabled: true, families: "ipv4" });

    const run = await test7.service.runNow();

    expect(run?.skipped).toContainEqual({ family: "ipv4", reason: "host-missing" });
  });

  test("the detection panel lists every candidate and why it was not chosen", async () => {
    const test7b = build({
      resolve: async () => resolution(["10.0.0.5", PUBLIC_IPV4]),
      host: async () =>
        hostAddresses({
          candidates: [
            { address: PRIVACY_IPV6, interfaceName: "ens18", temporary: true, realNic: true },
            { address: HOST_IPV6, interfaceName: "ens18", temporary: false, realNic: true },
          ],
        }),
    });
    await test7b.service.update({ enabled: true, families: "both" });

    const run = await test7b.service.runNow();

    expect(run?.candidates).toEqual([
      {
        family: "ipv4",
        address: "10.0.0.5",
        source: "dns",
        chosen: false,
        reason: "not-public",
        detail: "private",
      },
      { family: "ipv4", address: PUBLIC_IPV4, source: "dns", chosen: true, reason: "selected" },
      {
        family: "ipv6",
        address: HOST_IPV6,
        source: "host",
        chosen: true,
        reason: "selected",
        interfaceName: "ens18",
      },
      {
        family: "ipv6",
        address: PRIVACY_IPV6,
        source: "host",
        chosen: false,
        reason: "temporary",
        temporary: true,
        interfaceName: "ens18",
      },
    ]);
  });

  test("a privacy address is only chosen when it is the only one, and says so", async () => {
    const test7c = build({
      host: async () =>
        hostAddresses({
          candidates: [{ address: PRIVACY_IPV6, interfaceName: "ens18", temporary: true }],
        }),
    });
    await test7c.service.update({ enabled: true, families: "ipv6" });

    const run = await test7c.service.runNow();

    // The card reads this to raise the "it rotates, prefer a stable one" hint.
    expect(run?.candidates).toEqual([
      {
        family: "ipv6",
        address: PRIVACY_IPV6,
        source: "host",
        chosen: true,
        reason: "selected",
        temporary: true,
        interfaceName: "ens18",
      },
    ]);
    expect(run?.detected.ipv6).toEqual({ address: PRIVACY_IPV6, source: "host" });
  });

  test("the external echo marks every local candidate as overridden", async () => {
    const test7d = build({
      echo: async () => ({
        address: ECHO_IPV6,
        attempted: ["https://api64.ipify.org?format=json"],
      }),
    });
    await test7d.service.update({ enabled: true, families: "ipv6" });

    const run = await test7d.service.runNow();

    expect(run?.candidates).toEqual([
      { family: "ipv6", address: ECHO_IPV6, source: "echo", chosen: true, reason: "selected" },
      {
        family: "ipv6",
        address: HOST_IPV6,
        source: "host",
        chosen: false,
        reason: "echo-wins",
        interfaceName: "eth0",
      },
    ]);
  });

  test("an address the host probe excluded is shown with its reason", async () => {
    const test7e = build({
      host: async () =>
        hostAddresses({
          excluded: [{ address: "fd00::1", interfaceName: "eth0", kind: "ula" }],
        }),
    });
    await test7e.service.update({ enabled: true, families: "ipv6" });

    const run = await test7e.service.runNow();

    expect(run?.candidates).toContainEqual({
      family: "ipv6",
      address: "fd00::1",
      source: "host",
      chosen: false,
      reason: "excluded",
      interfaceName: "eth0",
      detail: "ula",
    });
  });

  test("the families a run may touch follow the setting", async () => {
    const test8 = build({ initial: { ipv4: "9.9.9.9", ipv6: "2606:4700::9999" } });
    await test8.service.update({ enabled: true, families: "ipv4" });

    const run = await test8.service.runNow();

    expect(run?.skipped).toEqual([{ family: "ipv6", reason: "family-disabled" }]);
    expect(test8.patches).toEqual([{ path: "derp.server.ipv4", value: PUBLIC_IPV4 }]);
  });

  test("a read-only configuration is skipped instead of written", async () => {
    const test9 = build({ writable: false, initial: { ipv4: "9.9.9.9" } });
    await test9.service.update({ enabled: true, families: "ipv4" });

    const run = await test9.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.skipped).toContainEqual({ family: "ipv4", reason: "config-not-writable" });
    expect(test9.patches).toEqual([]);
    expect(test9.snapshot).not.toHaveBeenCalled();
    expect(test9.audit).toEqual([]);
  });

  test("a snapshot that cannot be taken does not block the write", async () => {
    const test10 = build({ initial: { ipv4: "9.9.9.9" } });
    test10.snapshot.mockRejectedValueOnce(new Error("no snapshot directory"));
    await test10.service.update({ enabled: true, families: "ipv4" });

    const run = await test10.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(run?.snapshotId).toBeUndefined();
    expect(test10.patches).toEqual([{ path: "derp.server.ipv4", value: PUBLIC_IPV4 }]);
  });

  test("auto-reload is on by default", async () => {
    const test10b = build({ initial: { ipv4: "9.9.9.9" } });
    await test10b.service.update({ enabled: true, families: "ipv4" });

    const run = await test10b.service.runNow();

    expect(test10b.service.settings().autoReload).toBe(true);
    expect(test10b.reload).toHaveBeenCalledTimes(1);
    expect(run?.reload).toBe("triggered");
  });

  test("turning the reload switch off reports a manual reload instead", async () => {
    const test11 = build({ initial: { ipv4: "9.9.9.9" } });
    await test11.service.update({ enabled: true, families: "ipv4", autoReload: false });

    const run = await test11.service.runNow();

    expect(test11.reload).not.toHaveBeenCalled();
    expect(run?.reload).toBe("manual");
    expect(run?.outcome).toBe("changed");
  });

  test("a check that found nothing never reloads", async () => {
    const test12 = build({ initial: { ipv4: PUBLIC_IPV4 } });
    await test12.service.update({ enabled: true, families: "ipv4", autoReload: true });

    const run = await test12.service.runNow();

    expect(test12.reload).not.toHaveBeenCalled();
    expect(run?.reload).toBe("not-needed");
  });

  test("a failed automatic reload is reported but keeps the write", async () => {
    const test13 = build({ initial: { ipv4: "9.9.9.9" } });
    test13.reload.mockRejectedValueOnce(new Error("docker is not reachable"));
    await test13.service.update({ enabled: true, families: "ipv4", autoReload: true });

    const run = await test13.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(run?.reload).toBe("failed");
    expect(test13.current().ipv4).toBe(PUBLIC_IPV4);
    // The write happened, but the address never reached Headscale, so the run
    // counts as failed and says which step broke.
    expect(run?.failure).toBe("reload-failed");
    expect(test13.alerts).toEqual([{ failed: true, reason: "reload-failed" }]);
  });

  test("a run whose detection finds nothing usable alerts on that family", async () => {
    const test13b = build({
      initial: { ipv4: "9.9.9.9" },
      resolve: async () => resolution([], { reason: "timeout" }),
    });
    await test13b.service.update({ enabled: true, families: "ipv4" });

    const run = await test13b.service.runNow();

    expect(run?.outcome).toBe("skipped");
    expect(run?.failure).toBe("detection-unusable");
    expect(test13b.alerts).toEqual([{ failed: true, reason: "detection-unusable" }]);
    expect(test13b.current().ipv4).toBe("9.9.9.9");
  });

  test("a read-only configuration is reported as a failed write", async () => {
    const test13c = build({ writable: false, initial: { ipv4: "9.9.9.9" } });
    await test13c.service.update({ enabled: true, families: "ipv4" });

    const run = await test13c.service.runNow();

    expect(run?.failure).toBe("not-writable");
    expect(test13c.alerts).toEqual([{ failed: true, reason: "not-writable" }]);
    expect(test13c.patches).toEqual([]);
  });

  test("a check never reports to the notifier, even when it fails", async () => {
    const test13d = build({
      resolve: async () => {
        throw new Error("boom");
      },
    });
    await test13d.service.update({ enabled: true, families: "ipv4" });

    const run = await test13d.service.checkNow();

    expect(run?.mode).toBe("check");
    expect(run?.outcome).toBe("failed");
    expect(run?.failure).toBeUndefined();
    expect(test13d.alerts).toEqual([]);
  });

  test("a scheduled tick does nothing while the sync is disabled", async () => {
    const test14 = build({ initial: { ipv4: "9.9.9.9" } });

    await expect(test14.service.runOnce()).resolves.toBeUndefined();
    expect(test14.patches).toEqual([]);
    expect(test14.current().ipv4).toBe("9.9.9.9");
  });

  test("a manual run works while the schedule is off", async () => {
    const test15 = build({ initial: { ipv4: "9.9.9.9" } });

    const run = await test15.service.runNow();

    expect(run?.outcome).toBe("changed");
    expect(test15.current().ipv4).toBe(PUBLIC_IPV4);
  });

  test("overlapping runs collapse into one write", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const test16 = build({
      initial: { ipv4: "9.9.9.9" },
      resolve: async () => {
        await gate;
        return resolution([PUBLIC_IPV4]);
      },
    });
    await test16.service.update({ enabled: true, families: "ipv4" });

    const first = test16.service.runNow();
    const second = test16.service.runNow();
    release();

    const [a, b] = await Promise.all([first, second]);

    expect(a?.outcome).toBe("changed");
    expect(b).toBeUndefined();
    expect(test16.patches).toHaveLength(1);
  });

  test("an unexpected failure is recorded instead of thrown", async () => {
    const test17 = build({
      resolve: async () => {
        throw new Error("boom");
      },
    });
    await test17.service.update({ enabled: true, families: "ipv4" });

    const run = await test17.service.runNow();

    expect(run?.outcome).toBe("failed");
    expect(run?.error).toContain("boom");
    expect(test17.patches).toEqual([]);
  });

  test("persists the settings and the last run", async () => {
    const test18 = build({ initial: { ipv4: "9.9.9.9" } });
    await test18.service.update({ enabled: true, intervalHours: 24, families: "ipv4" });
    await test18.service.runNow();

    const stored = await readDerpSyncDocument(dir);

    expect(stored.settings).toEqual({
      enabled: true,
      intervalHours: 24,
      families: "ipv4",
      autoReload: true,
    });
    expect(stored.last?.outcome).toBe("changed");
    expect(stored.last?.at).toBe(new Date(BASE).toISOString());
    // The temp file is renamed into place, so only the document remains.
    expect(await readdir(dir)).toEqual(["derp-sync.json"]);
  });

  test("never throws when the store cannot be written", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");
    const service = createDerpSyncService({
      dataPath: blocker,
      config: {
        writable: () => true,
        getDERPSettings: () => ({
          serverUrl: "https://relay.example.com",
          server: { ipv4: "", ipv6: "" },
        }),
        patch: async () => undefined,
      },
      getSnapshotTargets: () => [],
      headscale: {} as unknown as Headscale,
      resolveRelay: async () => resolution([PUBLIC_IPV4]),
      now: () => new Date(BASE),
    });

    harness = { ...(harness as Harness), service };

    await expect(service.runNow()).resolves.toBeDefined();

    const stored = await readDerpSyncDocument(blocker);
    expect(stored.settings.enabled).toBe(false);
    service.dispose();
  });
});

describe("DERP address sync scheduling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-sync-schedule-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function service(intervalMs = 60_000): DerpSyncService {
    return createDerpSyncService({
      dataPath: dir,
      config: {
        writable: () => true,
        getDERPSettings: () => ({
          serverUrl: "https://relay.example.com",
          server: { ipv4: "", ipv6: "" },
        }),
        patch: async () => undefined,
      },
      getSnapshotTargets: () => [],
      headscale: {} as unknown as Headscale,
      resolveRelay: async () => resolution([PUBLIC_IPV4]),
      loadHostIpv6: async () => hostAddresses(),
      now: () => new Date(BASE),
      intervalMs,
    });
  }

  test("start schedules nothing while the sync is disabled", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const instance = service();

    try {
      instance.start();
      await instance.ready();

      expect(instance.settings().enabled).toBe(false);
      expect(interval).not.toHaveBeenCalled();
    } finally {
      instance.dispose();
      interval.mockRestore();
    }
  });

  test("start schedules the configured interval and unrefs the timer", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const unref = vi.fn();
    interval.mockReturnValue({ unref } as never);

    await writeDerpSyncDocument(dir, {
      settings: {
        enabled: true,
        intervalHours: 24,
        families: "both",
        autoReload: false,
      } satisfies DerpSyncSettings,
    });

    const instance = service(60_000);

    try {
      instance.start();
      await instance.ready();

      expect(interval).toHaveBeenCalledTimes(1);
      expect(interval.mock.calls[0][1]).toBe(60_000);
      expect(unref).toHaveBeenCalledTimes(1);

      instance.dispose();
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      interval.mockRestore();
      clear.mockRestore();
    }
  });

  test("saving settings reschedules and disabling stops the timer", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    interval.mockReturnValue({ unref: vi.fn() } as never);

    const instance = service(60_000);

    try {
      const saved = await instance.update({ enabled: true, intervalHours: 6 });
      expect(saved.success).toBe(true);
      expect(interval).toHaveBeenCalledTimes(1);

      const disabled = await instance.update({ enabled: false });
      expect(disabled.success).toBe(true);
      // The timer from the save above is cleared and not replaced.
      expect(clear).toHaveBeenCalled();
      expect(interval).toHaveBeenCalledTimes(1);
    } finally {
      instance.dispose();
      interval.mockRestore();
      clear.mockRestore();
    }
  });
});

describe("DERP address sync failure predicate", () => {
  function run(overrides: Partial<DerpSyncRun> = {}): DerpSyncRun {
    return {
      at: new Date(BASE).toISOString(),
      mode: "run",
      outcome: "skipped",
      detected: {},
      candidates: [],
      changes: [],
      skipped: [],
      unchanged: [],
      reload: "not-needed",
      ...overrides,
    };
  }

  test("a run that changed nothing is not a failure", () => {
    expect(derpSyncFailureReason(run({ outcome: "unchanged" }))).toBeUndefined();
    // A family the operator turned off is a setting, not a failure.
    expect(
      derpSyncFailureReason(run({ skipped: [{ family: "ipv6", reason: "family-disabled" }] })),
    ).toBeUndefined();
  });

  test("each way a run can fail gets its own code", () => {
    expect(derpSyncFailureReason(run({ outcome: "failed" }))).toBe("unexpected");
    expect(derpSyncFailureReason(run({ reload: "failed" }))).toBe("reload-failed");
    expect(
      derpSyncFailureReason(run({ skipped: [{ family: "ipv4", reason: "config-not-writable" }] })),
    ).toBe("not-writable");
    expect(
      derpSyncFailureReason(run({ skipped: [{ family: "ipv6", reason: "no-host-address" }] })),
    ).toBe("detection-unusable");
  });

  test("the most severe reason wins when a run failed in more than one way", () => {
    const worst = run({
      outcome: "failed",
      reload: "failed",
      skipped: [{ family: "ipv6", reason: "lookup-failed" }],
    });

    expect(derpSyncFailureReason(worst)).toBe("unexpected");
  });
});
