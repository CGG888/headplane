import { sep } from "node:path";

import { describe, expect, test } from "vitest";

import {
  DERP_MIRROR_FILE_NAME,
  LEGACY_DERP_MIRROR_TARGET_PATH,
  deriveDerpMirrorTargetPath,
  deriveHeadscaleDataDirectory,
  isLegacyDerpMirrorTargetPath,
  resolveDerpMirrorTargetPath,
} from "~/server/derp-mirror/target-path";

// The module joins with `node:path`, so on Windows the derived path carries
// backslashes. Expectations stay written as deployment paths and are converted.
const p = (value: string) => value.split("/").join(sep);
const mirrorIn = (directory: string) => p(`${directory}/${DERP_MIRROR_FILE_NAME}`);

describe("the DERP mirror target path", () => {
  describe("Headscale's data directory", () => {
    test("comes from the first configured file, in order", () => {
      expect(
        deriveHeadscaleDataDirectory({
          noisePrivateKeyPath: p("/var/lib/headscale/noise_private.key"),
          sqlitePath: p("/srv/headscale/db.sqlite"),
        }),
      ).toBe(p("/var/lib/headscale"));

      expect(
        deriveHeadscaleDataDirectory({
          sqlitePath: p("/srv/headscale/db.sqlite"),
          derpPrivateKeyPath: p("/srv/headscale/derp_server_private.key"),
        }),
      ).toBe(p("/srv/headscale"));

      expect(
        deriveHeadscaleDataDirectory({
          derpPrivateKeyPath: p("/srv/headscale/derp_server_private.key"),
          unixSocket: p("/srv/headscale/headscale.sock"),
        }),
      ).toBe(p("/srv/headscale"));

      expect(deriveHeadscaleDataDirectory({ unixSocket: p("/srv/headscale/headscale.sock") })).toBe(
        p("/srv/headscale"),
      );
    });

    test("ignores relative paths and blank values", () => {
      expect(
        deriveHeadscaleDataDirectory({
          noisePrivateKeyPath: "noise_private.key",
          sqlitePath: "   ",
          derpPrivateKeyPath: p("/srv/headscale/derp_server_private.key"),
        }),
      ).toBe(p("/srv/headscale"));

      expect(deriveHeadscaleDataDirectory({})).toBe("");
    });
  });

  describe("the derived target", () => {
    test("sits beside the first absolute path Headscale reads maps from", () => {
      expect(
        deriveDerpMirrorTargetPath({
          paths: [p("/etc/headscale/derp.yaml"), p("/etc/headscale/other.yaml")],
          dataDirectory: p("/var/lib/headscale"),
        }),
      ).toBe(mirrorIn("/etc/headscale"));

      // A relative entry says nothing about the host's disk, so it is skipped
      // rather than joined onto an unknown working directory.
      expect(
        deriveDerpMirrorTargetPath({
          paths: ["derp.yaml", p("/etc/headscale/derp.yaml")],
        }),
      ).toBe(mirrorIn("/etc/headscale"));
    });

    test("falls back to derp-maps/ inside Headscale's data directory", () => {
      expect(
        deriveDerpMirrorTargetPath({
          paths: [],
          dataDirectory: p("/vol1/1000/APP/headplaneCN/headscale"),
        }),
      ).toBe(mirrorIn("/vol1/1000/APP/headplaneCN/headscale/derp-maps"));

      expect(deriveDerpMirrorTargetPath({ dataDirectory: p("/var/lib/headscale") })).toBe(
        mirrorIn("/var/lib/headscale/derp-maps"),
      );
    });

    test("is undefined when the configuration names no directory at all", () => {
      expect(deriveDerpMirrorTargetPath({})).toBeUndefined();
      expect(
        deriveDerpMirrorTargetPath({ paths: ["derp.yaml"], dataDirectory: "" }),
      ).toBeUndefined();
      expect(
        deriveDerpMirrorTargetPath({ paths: [], dataDirectory: "relative/dir" }),
      ).toBeUndefined();
    });
  });

  describe("resolving a stored value", () => {
    // The two deployments this exists for: a panel container beside a native
    // Headscale (fnOS) and the dual-image stack, whose Headscale keeps its data
    // somewhere else entirely.
    const native = { paths: [p("/etc/headscale/derp.yaml")] };
    const dualImage = { paths: [], dataDirectory: p("/vol1/1000/APP/headplaneCN/headscale") };

    test("keeps a path the operator chose", () => {
      const chosen = p("/srv/maps/my-mirror.yaml");
      expect(resolveDerpMirrorTargetPath(chosen, dualImage)).toBe(chosen);
      expect(resolveDerpMirrorTargetPath(`  ${chosen}  `, native)).toBe(chosen);
    });

    test("treats the legacy constant as never chosen and derives again", () => {
      expect(resolveDerpMirrorTargetPath(LEGACY_DERP_MIRROR_TARGET_PATH, dualImage)).toBe(
        mirrorIn("/vol1/1000/APP/headplaneCN/headscale/derp-maps"),
      );

      // Native fnOS reproduces the legacy path, because its first derp.paths
      // entry lives in the same directory the constant pointed at.
      expect(
        resolveDerpMirrorTargetPath(LEGACY_DERP_MIRROR_TARGET_PATH, {
          paths: [p("/vol1/@appdata/headscale/derp-maps/derp.yaml")],
        }),
      ).toBe(p("/vol1/@appdata/headscale/derp-maps/official-mirror.yaml"));
    });

    test("derives for missing, blank and relative stored values", () => {
      expect(resolveDerpMirrorTargetPath(undefined, dualImage)).toBe(
        mirrorIn("/vol1/1000/APP/headplaneCN/headscale/derp-maps"),
      );
      expect(resolveDerpMirrorTargetPath("", native)).toBe(mirrorIn("/etc/headscale"));
      expect(resolveDerpMirrorTargetPath("derp-maps/official-mirror.yaml", native)).toBe(
        mirrorIn("/etc/headscale"),
      );
      expect(resolveDerpMirrorTargetPath(42, native)).toBe(mirrorIn("/etc/headscale"));
    });

    test("keeps the legacy constant as the last resort", () => {
      expect(resolveDerpMirrorTargetPath(undefined, {})).toBe(LEGACY_DERP_MIRROR_TARGET_PATH);
      expect(resolveDerpMirrorTargetPath(LEGACY_DERP_MIRROR_TARGET_PATH, {})).toBe(
        LEGACY_DERP_MIRROR_TARGET_PATH,
      );
    });
  });

  test("recognises the legacy constant", () => {
    expect(isLegacyDerpMirrorTargetPath(LEGACY_DERP_MIRROR_TARGET_PATH)).toBe(true);
    expect(isLegacyDerpMirrorTargetPath(` ${LEGACY_DERP_MIRROR_TARGET_PATH} `)).toBe(true);
    expect(isLegacyDerpMirrorTargetPath("/srv/maps/official-mirror.yaml")).toBe(false);
    expect(isLegacyDerpMirrorTargetPath(undefined)).toBe(false);
    expect(isLegacyDerpMirrorTargetPath(7)).toBe(false);
  });
});
