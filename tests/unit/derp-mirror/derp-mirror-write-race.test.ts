import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createDerpMirrorService } from "~/server/derp-mirror/service.server";
import { derpMirrorPath, parseDerpMirrorDocument } from "~/server/derp-mirror/store";
import type { OfficialRegion } from "~/server/derp-mirror/types";
import type { Headscale } from "~/server/headscale/api";

const held = vi.hoisted(() => ({
  onRead: undefined as (() => void) | undefined,
  wait: undefined as Promise<void> | undefined,
}));

vi.mock("~/server/derp-mirror/store", async () => {
  const actual = await vi.importActual<typeof import("~/server/derp-mirror/store")>(
    "~/server/derp-mirror/store",
  );

  return {
    ...actual,
    // Held once, so a test can attempt a settings save inside the window
    // between a finished run's read of the document and its write back.
    readDerpMirrorDocument: async (dataPath: string) => {
      const document = await actual.readDerpMirrorDocument(dataPath);
      if (held.onRead !== undefined) {
        const arrived = held.onRead;
        const wait = held.wait;
        held.onRead = undefined;
        held.wait = undefined;
        arrived();
        if (wait !== undefined) {
          await wait;
        }
      }

      return document;
    },
  };
});

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const DEFAULT_INTERVAL_HOURS = 24;
const HKG = "20";
const SIN = "3";

function region(regionId: string, code: string, name: string): OfficialRegion {
  return {
    regionId: Number(regionId),
    code,
    name,
    nodes: [
      {
        name: `${code}1`,
        hostname: `${code}1.example.com`,
        derpPort: 443,
        stunPort: 3478,
        stunOnly: false,
        ipv4: "1.2.3.4",
        ipv6: "2001:db8::1",
      },
    ],
  };
}

const OFFICIAL: OfficialRegion[] = [
  region(HKG, "hkg", "Hong Kong"),
  region(SIN, "sin", "Singapore"),
];

describe("DERP region mirror settings save", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-mirror-race-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function storedIntervalHours(): Promise<number> {
    const raw = await readFile(derpMirrorPath(dir), "utf8");
    return parseDerpMirrorDocument(raw).settings.intervalHours;
  }

  test("a save waits for the run that is writing the document", async () => {
    let releaseRead = (): void => undefined;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let releaseFetch = (): void => undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let reachedFetch = (): void => undefined;
    const atFetch = new Promise<void>((resolve) => {
      reachedFetch = resolve;
    });
    let readStarted = (): void => undefined;
    const atRead = new Promise<void>((resolve) => {
      readStarted = resolve;
    });

    const service = createDerpMirrorService({
      dataPath: dir,
      config: {
        getDERPSettings: () => ({ urls: [], autoUpdateEnabled: true, updateFrequency: "3h" }),
      },
      headscale: {} as unknown as Headscale,
      loadOfficialRegions: async () => {
        reachedFetch();
        await fetchGate;
        return { regions: OFFICIAL, attempts: [] };
      },
      now: () => new Date(BASE),
    });

    try {
      const target = join(dir, "mirror.yaml");
      await service.update({
        enabled: true,
        targetPath: target,
        officialRegionIds: [HKG, SIN],
        autoReload: false,
      });

      const run = service.runNow();
      // The run is parked on its map download, so arming the hold here catches
      // the read of its own write, not anything the setup did.
      await atFetch;
      held.onRead = readStarted;
      held.wait = readGate;
      releaseFetch();
      await atRead;

      let saveSettled = false;
      const saving = service.update({ intervalHours: 6 });
      void saving.then(() => {
        saveSettled = true;
      });

      // The save is behind the run's write, so the document still holds the
      // value the run started from. A save that wrote on its own would have
      // replaced it with 6 by now, and the run would then write 24 back.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(saveSettled).toBe(false);
      expect(await storedIntervalHours()).toBe(DEFAULT_INTERVAL_HOURS);

      releaseRead();
      await run;
      await saving;

      expect(await storedIntervalHours()).toBe(6);
      expect(service.settings().intervalHours).toBe(6);
      expect(service.last()?.outcome).toBe("changed");
    } finally {
      service.dispose();
    }
  });
});
