import { vi } from "vitest";

const fakeFs = new Map<string, string>();
export function createFakeFile(path: string, content: string) {
  fakeFs.set(path, content);
}

export function clearFakeFiles() {
  fakeFs.clear();
}

// @ts-expect-error: I have no clue why vitest's types are wrong here
vi.mock(import("node:fs/promises"), async (importOrig) => {
  const orig = await importOrig();

  // `readFile` is heavily overloaded, which makes `Function.prototype.call` pick
  // the wrong tuple; this narrow alias keeps the pass-through below typed.
  const readFileFallback = orig.readFile as (
    path: string | Buffer | URL,
    options?: Parameters<typeof orig.readFile>[1],
  ) => Promise<string | Buffer>;

  return {
    ...orig,
    readFile: (path: string | Buffer | URL, options?: Parameters<typeof orig.readFile>[1]) => {
      const p = path.toString();
      if (fakeFs.has(p)) {
        const content = fakeFs.get(p)!;
        if (typeof options === "string" || options?.encoding) {
          return Promise.resolve(content);
        }

        return Promise.resolve(Buffer.from(content));
      }

      if (options === undefined) {
        return readFileFallback.call(this, path);
      }

      return readFileFallback.call(this, path, options);
    },

    access: (path, mode) => {
      const p = path.toString();
      if (fakeFs.has(p)) {
        return Promise.resolve();
      }

      return orig.access.call(this, path, mode);
    },
  };
});
