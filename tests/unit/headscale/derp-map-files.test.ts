import { join, resolve, sep } from "node:path";

import { describe, expect, test } from "vitest";

import {
  atomicWriteFile,
  DEFAULT_DERP_MAP_MODE,
  guardDerpMapPath,
  saveDerpMapFile,
  type AtomicWriteFs,
} from "~/server/headscale/derp-map-files";

/** Absolute paths differ per platform, so expectations go through `resolve`. */
const abs = (path: string) => resolve(path);

interface FakeEntry {
  content: string;
  mode: number;
}

/**
 * A filesystem that only knows the files handed to it, so the atomic write can
 * be observed step by step: what the temp file held, which mode it carried, and
 * whether it survived a failure.
 */
function createFakeFs(initial: Record<string, FakeEntry> = {}) {
  const files = new Map(Object.entries(initial).map(([path, entry]) => [path, { ...entry }]));
  const fs: AtomicWriteFs = {
    stat: (path) => {
      const entry = files.get(path);
      if (!entry) {
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        return Promise.reject(error);
      }

      return Promise.resolve({ mode: entry.mode });
    },
    writeFile: (path, data, options) => {
      files.set(path, {
        content: typeof data === "string" ? data : Buffer.from(data).toString("utf8"),
        mode: options.mode ?? DEFAULT_DERP_MAP_MODE,
      });
      return Promise.resolve();
    },
    chmod: (path, mode) => {
      const entry = files.get(path);
      if (entry) {
        entry.mode = mode;
      }

      return Promise.resolve();
    },
    rename: (from, to) => {
      const entry = files.get(from);
      if (!entry) {
        return Promise.reject(new Error(`ENOENT: ${from}`));
      }

      files.delete(from);
      files.set(to, entry);
      return Promise.resolve();
    },
    unlink: (path) => {
      files.delete(path);
      return Promise.resolve();
    },
  };

  return { fs, files };
}

const tempFiles = (files: Map<string, FakeEntry>) =>
  [...files.keys()].filter((path) => path.includes(".headplane-"));

describe("guardDerpMapPath", () => {
  const configured = ["/etc/headscale/derp/a.yaml", "/etc/headscale/derp/b.yaml"];

  test("accepts a configured absolute path", () => {
    expect(guardDerpMapPath(configured, "/etc/headscale/derp/a.yaml")).toEqual({
      ok: true,
      path: abs("/etc/headscale/derp/a.yaml"),
    });
  });

  test("rejects a relative path", () => {
    expect(guardDerpMapPath(configured, "derp/a.yaml")).toEqual({
      ok: false,
      code: "invalidDerpMapPath",
    });
  });

  test("rejects a path that is not in derp.paths", () => {
    expect(guardDerpMapPath(configured, "/etc/headscale/config.yaml")).toEqual({
      ok: false,
      code: "derpMapPathNotConfigured",
    });
  });

  test("rejects a traversal attempt even when it resolves to a configured file", () => {
    expect(guardDerpMapPath(configured, "/etc/headscale/derp/../derp/a.yaml")).toEqual({
      ok: false,
      code: "invalidDerpMapPath",
    });
    expect(guardDerpMapPath(configured, "/etc/headscale/derp/../../etc/shadow")).toEqual({
      ok: false,
      code: "invalidDerpMapPath",
    });
  });

  test("resolves a relative configured entry against Headscale's config directory", () => {
    expect(
      guardDerpMapPath(["derp/a.yaml"], "/etc/headscale/derp/a.yaml", "/etc/headscale"),
    ).toEqual({ ok: true, path: abs("/etc/headscale/derp/a.yaml") });
  });

  test("rejects an empty path", () => {
    expect(guardDerpMapPath(configured, "  ")).toEqual({ ok: false, code: "invalidDerpMapPath" });
  });
});

describe("atomicWriteFile", () => {
  test("writes the content and leaves no temp file behind", async () => {
    const { fs, files } = createFakeFs({ "/tmp/a.yaml": { content: "old\n", mode: 0o600 } });

    await atomicWriteFile("/tmp/a.yaml", "new\n", fs);

    expect(files.get("/tmp/a.yaml")?.content).toBe("new\n");
    expect(tempFiles(files)).toEqual([]);
  });

  test("preserves the mode of the file it replaces", async () => {
    const { fs, files } = createFakeFs({ "/tmp/a.yaml": { content: "old\n", mode: 0o640 } });

    await atomicWriteFile("/tmp/a.yaml", "new\n", fs);

    expect(files.get("/tmp/a.yaml")?.mode).toBe(0o640);
  });

  test("creates a new file with the default mode", async () => {
    const { fs, files } = createFakeFs();

    await atomicWriteFile("/tmp/new.yaml", "fresh\n", fs);

    expect(files.get("/tmp/new.yaml")).toEqual({
      content: "fresh\n",
      mode: DEFAULT_DERP_MAP_MODE,
    });
  });

  test("cleans up the temp file and keeps the old content when the rename fails", async () => {
    const { fs, files } = createFakeFs({ "/tmp/a.yaml": { content: "old\n", mode: 0o600 } });
    const failing: AtomicWriteFs = {
      ...fs,
      rename: () => Promise.reject(new Error("EXDEV")),
    };

    await expect(atomicWriteFile("/tmp/a.yaml", "new\n", failing)).rejects.toThrow("EXDEV");

    expect(files.get("/tmp/a.yaml")?.content).toBe("old\n");
    expect(tempFiles(files)).toEqual([]);
  });

  test("attempts the temp file in the target's own directory so the rename is atomic", async () => {
    const { fs, files } = createFakeFs();
    const seen: string[] = [];
    const watching: AtomicWriteFs = {
      ...fs,
      writeFile: (path, data, options) => {
        seen.push(path);
        return fs.writeFile(path, data, options);
      },
    };

    await atomicWriteFile("/etc/headscale/derp/a.yaml", "new\n", watching);

    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(join("/etc/headscale/derp") + sep)).toBe(true);
    expect(files.has("/etc/headscale/derp/a.yaml")).toBe(true);
  });
});

describe("saveDerpMapFile", () => {
  const configuredPaths = ["/etc/headscale/derp/a.yaml"];
  const valid = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - name: "901a"
        regionid: 901
        hostname: derp.example.com
`;

  test("refuses a path that is not in derp.paths before touching the disk", async () => {
    const result = await saveDerpMapFile({
      configuredPaths,
      requestedPath: "/etc/shadow",
      content: valid,
    });

    expect(result).toEqual({ ok: false, code: "derpMapPathNotConfigured" });
  });

  test("refuses a relative path", async () => {
    const result = await saveDerpMapFile({
      configuredPaths,
      requestedPath: "derp/a.yaml",
      content: valid,
    });

    expect(result).toEqual({ ok: false, code: "invalidDerpMapPath" });
  });

  test("refuses content that is not a DERP map and returns the problems", async () => {
    const result = await saveDerpMapFile({
      configuredPaths,
      requestedPath: configuredPaths[0],
      content: "regions: []\n",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("derpMapInvalid");
      expect(result.issues?.map((issue) => issue.code)).toEqual(["derpMapInvalidRegions"]);
    }
  });

  test("refuses content over the size cap", async () => {
    const padding = `# ${"x".repeat(300 * 1024)}\n`;
    const result = await saveDerpMapFile({
      configuredPaths,
      requestedPath: configuredPaths[0],
      content: `${valid}${padding}`,
    });

    expect(result).toEqual({ ok: false, code: "derpMapTooLarge" });
  });
});
